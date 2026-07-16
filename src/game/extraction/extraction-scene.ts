import Phaser from 'phaser'

import type {
  DecodedCompositionMap,
  NormalizedM2Config,
  NormalizedM2PresentationConfig,
} from '../../config/index.ts'
import {
  deriveActivePearlCount,
  deriveNormalSlagQuantity,
  type DomainEvent,
  type PearlType,
  type PrototypeRules,
  type RuleCommand,
} from '../../domain/index.ts'
import type {
  ExtractionFireFlowReadView,
  ExtractionMaterialReadView,
  ExtractionSimulationReadView,
} from '../../simulation/index.ts'
import { EXTRACTION_COMPOSITION_GRID_SIZE } from '../../simulation/index.ts'
import type { FireFlowReadView } from '../../simulation/fire-flow/index.ts'
import type { M2WorkbenchModel } from '../../ui/createM2Workbench.ts'
import { deriveMaterialContentRectangle } from '../../shared/material-content-geometry.ts'
import {
  FireHeatField,
  type FireOcclusionInput,
  type FireRevealInput,
} from '../presentation/fire/fire-heat-field.ts'
import {
  fitFirePresentationConfig,
  type FirePresentationConfig,
} from '../presentation/fire/fire-presentation-config.ts'
import { FirePresentation } from '../presentation/fire/fire-presentation.ts'
import type { M2Snapshot } from './contracts.ts'
import {
  M2GameplayRuntime,
  type M2GameplayRuntimeSnapshot,
} from './gameplay-runtime.ts'
import { buildM2InventoryViews } from './inventory-view.ts'
import {
  createBrowserM5AudioBackend,
  M5AudioDirector,
} from './m5-audio-director.ts'
import { createM5AudioConfigFromPresentation } from './m5-audio-config.ts'
import {
  deleteChangedCanvasDataset,
  shouldPublishM5CanvasMetadata,
  setChangedCanvasDataset,
} from './m5-canvas-metadata.ts'
import {
  M5EffectPool,
  type M5EffectVisitor,
} from './m5-effect-pool.ts'
import {
  mapM5DomainEvent,
  type M5CameraCue,
  type M5EffectAnchor,
  type M5EffectKind,
} from './m5-feedback-mapper.ts'
import {
  M5FailurePresentation,
  type M5FailureFrame,
} from './m5-failure-presentation.ts'
import { deriveM5FurnacePresentation } from './m5-furnace-presentation.ts'
import {
  renderM5MaterialMask,
  type M5MaterialMaskConfig,
} from './m5-material-mask.ts'
import { createM5FirePresentationConfig } from './m5-fire-presentation-config.ts'
import {
  M5PresentationLifecycle,
  type M5PresentationLifecycleSnapshot,
} from './m5-presentation-lifecycle.ts'
import {
  deriveM5DebrisFrame,
  M5DebrisLifetimeWindow,
  M5WallClockRateAccumulator,
  type M5DebrisLifetimeVisitor,
} from './m5-visual-policy.ts'
import {
  copyM5MaterialTopologyEvidence,
  type M5MaterialTopologyEvidence,
} from './m5-material-topology-evidence.ts'
import {
  copyM5PearlEvidence,
  type M5PearlEvidence,
} from './m5-pearl-evidence.ts'
import {
  drawM5Effect,
  drawM5LocalLight,
  M5PearlRenderer,
} from './m5-presentation-renderer.ts'
import {
  M5PearlSpritePool,
  type M5PearlSpritePoolHost,
} from './m5-pearl-sprite-pool.ts'
import {
  M2_FIRE_OCCLUSION_CONFIG,
} from './presentation-config.ts'
import { createM2RuntimeConfiguration } from './runtime-config.ts'

const FIRE_TEXTURE_KEY = 'm2-fire-flow'
const EMPTY_FIRE_OCCLUSION_RECTS = Object.freeze([])

type MaterialVisual = {
  readonly texture: Phaser.Textures.CanvasTexture
  readonly image: Phaser.GameObjects.Image
  readonly sourceRgba: Uint8ClampedArray
  readonly outputPixels: ImageData
  remainingVolume: number
}

type MutableFireOcclusionCircles = {
  count: number
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  eligible: Uint8Array
}

export type M2ExtractionSceneMetadata = Readonly<{
  scene: 'm2-extraction'
  logicalWidth: number
  logicalHeight: number
  phaserVersion: string
}>

export type M2ExtractionSceneOptions = Readonly<{
  config: NormalizedM2Config
  compositionMaps: readonly DecodedCompositionMap[]
  simulationContentFingerprint: string
  presentationContentFingerprint: string
  onReady?: (metadata: M2ExtractionSceneMetadata) => void
  onSnapshot?: (snapshot: M2Snapshot) => void
}>

function colorNumber(value: string): number {
  const normalized = value.startsWith('#') ? value.slice(1) : value
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
}

function colorRgb(value: string): readonly [number, number, number] {
  const color = colorNumber(value)
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

function alphaByte(alpha: number): number {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 255)
}

function createM5MaterialMaskConfig(
  presentation: NormalizedM2PresentationConfig,
  themeBackground: string,
): M5MaterialMaskConfig {
  const material = presentation.material
  return {
    maskScale: material.maskScale,
    edgeFeatherPixels: material.edgeFeatherPixels,
    heatEdgeWidthPixels: material.heatEdgeWidthPixels,
    heatEdgeColor: colorRgb(presentation.fire.body.color),
    heatEdgeAlpha: alphaByte(presentation.fire.body.alpha),
    charColor: colorRgb(themeBackground),
    charAlpha: alphaByte(material.charAlpha),
  }
}

function effectDurationSeconds(
  effect: M5EffectKind,
  presentation: NormalizedM2PresentationConfig,
): number {
  const durations = presentation.effects
  switch (effect) {
    case 'shield':
    case 'caught':
      return durations.shieldDurationSeconds
    case 'damage':
      return durations.damageDurationSeconds
    case 'steam':
    case 'birth':
      return durations.steamDurationSeconds
    case 'warningOne':
    case 'ready':
      return durations.warningOneDurationSeconds
    case 'warningTwo':
      return durations.warningTwoDurationSeconds
    case 'failure':
      return durations.failureDurationSeconds
    case 'fight':
      return presentation.camera.durationSeconds
  }
}

function materialTextureKey(materialInstanceId: string): string {
  return `m2-material:${materialInstanceId}`
}

function appearanceTextureKey(materialDefinitionId: string): string {
  return `m2-appearance:${materialDefinitionId}`
}

function countRemainingCells(view: ExtractionSimulationReadView): number {
  let count = 0
  for (const material of view.materials) {
    for (const volume of material.remainingCellVolumes) {
      if (volume > 1e-9) count += 1
    }
  }
  return count
}

function distanceFromSourceToStageEdge(
  source: NonNullable<ExtractionSimulationReadView['effectiveFireSource']>,
  width: number,
  height: number,
): number {
  const directionLength = Math.hypot(source.direction.x, source.direction.y)
  if (directionLength <= 0.001) return 0
  const directionX = source.direction.x / directionLength
  const directionY = source.direction.y / directionLength
  const distanceX =
    directionX > 0.001
      ? (width - source.position.x) / directionX
      : directionX < -0.001
        ? -source.position.x / directionX
        : Number.POSITIVE_INFINITY
  const distanceY =
    directionY > 0.001
      ? (height - source.position.y) / directionY
      : directionY < -0.001
        ? -source.position.y / directionY
        : Number.POSITIVE_INFINITY
  return Math.max(0, Math.min(distanceX, distanceY))
}

export class M2ExtractionScene extends Phaser.Scene {
  readonly #options: M2ExtractionSceneOptions
  readonly #runtime: M2GameplayRuntime
  readonly #rules: PrototypeRules
  readonly #theme
  readonly #presentation: NormalizedM2PresentationConfig
  readonly #fireConfig: FirePresentationConfig
  readonly #firePresentation: FirePresentation
  readonly #fireHeatField: FireHeatField
  readonly #materialMaskConfig: M5MaterialMaskConfig
  readonly #presentationLifecycle: M5PresentationLifecycle
  readonly #failurePresentation: M5FailurePresentation
  readonly #audioDirector: M5AudioDirector
  readonly #effectPool: M5EffectPool
  readonly #pearlRenderer: M5PearlRenderer
  readonly #pearlStandardRadius: ReadonlyMap<PearlType, number>
  readonly #reducedMotion =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  #baseGraphics: Phaser.GameObjects.Graphics | null = null
  #debrisGraphics: Phaser.GameObjects.Graphics | null = null
  #pearlGraphics: Phaser.GameObjects.Graphics | null = null
  #pearlSpritePool: M5PearlSpritePool<
    Phaser.GameObjects.Graphics,
    Phaser.GameObjects.Image
  > | null = null
  #collectorGraphics: Phaser.GameObjects.Graphics | null = null
  #effectGraphics: Phaser.GameObjects.Graphics | null = null
  #localLightGraphics: Phaser.GameObjects.Graphics | null = null
  #failureGraphics: Phaser.GameObjects.Graphics | null = null
  #fireSparkGraphics: Phaser.GameObjects.Graphics | null = null
  #fireTexture: Phaser.Textures.CanvasTexture | null = null
  #firePixels: ImageData | null = null
  #fireImage: Phaser.GameObjects.Image | null = null
  #presentationFlowView: FireFlowReadView | null = null
  #firePrepared = false
  #fireLayerVisible = false
  #lastFireTimestamp = Number.NaN
  #lastRenderedFireGeneration = Number.NEGATIVE_INFINITY
  #lastRenderedFireSource: NonNullable<
    ExtractionSimulationReadView['effectiveFireSource']
  > | null = null
  #fireOcclusionInput: FireOcclusionInput | null = null
  #fireOcclusionTick = Number.NEGATIVE_INFINITY
  #fireOcclusionCircles: MutableFireOcclusionCircles
  readonly #fireOcclusionGrowthCapacity: number
  readonly #materialFireCoverage: Uint8Array
  readonly #emberRateAccumulator = new M5WallClockRateAccumulator()
  #emberEmissionSequence = 0
  readonly #emberFrame = { drawCount: 0, stride: 0, startIndex: 0 }
  readonly #debrisLifetimeWindow: M5DebrisLifetimeWindow
  readonly #debrisFrame = { emittedCount: 0, visibleCount: 0 }
  readonly #fireRevealInput: {
    frontDistancePixels: number
    frontFeatherPixels: number
  } = {
    frontDistancePixels: 0,
    frontFeatherPixels: 0,
  }
  readonly #materialVisuals = new Map<string, MaterialVisual>()
  readonly #debrisMaterialViews = new Map<
    string,
    ExtractionMaterialReadView
  >()
  readonly #liveMaterialIds = new Set<string>()
  readonly #pearlById = new Map<
    string,
    ExtractionSimulationReadView['pearls'][number]
  >()
  #lastRenderedTick = Number.NEGATIVE_INFINITY
  #lastSnapshotTime = Number.NEGATIVE_INFINITY
  #requestedSprayingProjection: boolean | null = null
  #lastEventTypes: readonly string[] = []
  #presentationSessionId: string | null = null
  #lastRulesFireActive = false
  #forceRuleFireOff = false
  #lastPresentationTimestamp = 0
  #debrisRenderTick = 0
  #presentationSnapshot: M5PresentationLifecycleSnapshot
  #ready = false
  readonly #debrisVisitor: M5DebrisLifetimeVisitor = (
    slotIndex,
    ownerId,
    lifeProgress,
  ) => {
    this.#drawMaterialDebrisSlot(
      slotIndex,
      ownerId,
      lifeProgress,
      this.#debrisRenderTick,
    )
  }
  readonly #effectVisitor: M5EffectVisitor = (
    kind,
    x,
    y,
    secondaryX,
    secondaryY,
    progress,
    slotIndex,
  ) => {
    this.#drawEffect(
      kind,
      x,
      y,
      secondaryX,
      secondaryY,
      progress,
      slotIndex,
    )
  }

  constructor(options: M2ExtractionSceneOptions) {
    super({ key: 'm2-extraction-scene' })
    this.#options = options
    this.#theme = options.config.gameplay.prototype.theme.colors
    this.#presentation = options.config.presentation
    this.#pearlRenderer = new M5PearlRenderer({
      pearlTypes: options.config.gameplay.pearlTypes,
      materials: options.config.base.materials,
      profiles: options.config.presentation.pearls,
    })
    this.#pearlStandardRadius = new Map(
      options.config.gameplay.pearlTypes.map((candidate) => [
        candidate.pearlType,
        candidate.standardRadius,
      ]),
    )
    this.#fireConfig = fitFirePresentationConfig(
      options.config.gameplay.prototype.logicalWidth,
      options.config.gameplay.prototype.logicalHeight,
      createM5FirePresentationConfig(
        options.config.presentation,
        options.config.gameplay.prototype.logicalWidth,
        options.config.gameplay.prototype.logicalHeight,
      ),
    )
    this.#firePresentation = new FirePresentation(this.#fireConfig)
    this.#fireHeatField = new FireHeatField(this.#fireConfig.heatField)
    this.#materialMaskConfig = createM5MaterialMaskConfig(
      options.config.presentation,
      this.#theme.background,
    )
    this.#presentationLifecycle = new M5PresentationLifecycle({
      afterglowSeconds: options.config.presentation.fire.afterglowSeconds,
      steadyThresholdSeconds:
        options.config.presentation.fire.steadyThresholdSeconds,
      failureDurationSeconds: this.#reducedMotion
        ? options.config.presentation.accessibility
            .reducedMotionFailureDurationSeconds
        : options.config.presentation.effects.failureDurationSeconds,
      failurePhases: {
        shatteringStartRatio:
          options.config.presentation.failure.shatteringStartRatio,
        gatheringStartRatio:
          options.config.presentation.failure.gatheringStartRatio,
        flyingStartRatio: options.config.presentation.failure.flyingStartRatio,
      },
      reducedMotion: this.#reducedMotion,
    })
    this.#failurePresentation = new M5FailurePresentation(
      options.config.presentation.failure,
      { reducedMotion: this.#reducedMotion },
    )
    this.#presentationSnapshot = this.#presentationLifecycle.getSnapshot()
    const audioConfig = createM5AudioConfigFromPresentation(
      options.config.presentation,
    )
    this.#audioDirector = new M5AudioDirector(
      audioConfig,
      createBrowserM5AudioBackend(globalThis, audioConfig.maxVoices),
    )
    const effectCapacity = options.config.presentation.performance
    this.#effectPool = new M5EffectPool(
      effectCapacity.effectPoolInitialCapacity,
      effectCapacity.effectPoolMaximumCapacity,
    )
    this.#debrisLifetimeWindow = new M5DebrisLifetimeWindow({
      capacity: effectCapacity.particlePoolSize,
      lifetimeFrames:
        options.config.presentation.material.debrisLifetimeSeconds *
        options.config.base.parameters.simulation.fixedStepHz,
    })
    this.#fireOcclusionGrowthCapacity = effectCapacity.pearlPoolSize
    this.#fireOcclusionCircles = {
      count: 0,
      x: new Float32Array(effectCapacity.pearlPoolSize),
      y: new Float32Array(effectCapacity.pearlPoolSize),
      radius: new Float32Array(effectCapacity.pearlPoolSize),
      eligible: new Uint8Array(effectCapacity.pearlPoolSize),
    }
    this.#materialFireCoverage = new Uint8Array(
      this.#fireConfig.heatField.width * this.#fireConfig.heatField.height,
    )
    const runtimeConfig = createM2RuntimeConfiguration(
      options.config,
      options.compositionMaps,
    )
    this.#rules = runtimeConfig.rules
    this.#runtime = new M2GameplayRuntime({
      rules: runtimeConfig.rules,
      simulationConfig: runtimeConfig.simulation,
      tickRateHz: options.config.base.parameters.simulation.fixedStepHz,
      maxCatchUpSteps:
        options.config.base.parameters.simulation.maxCatchUpSteps,
    })
  }

  preload(): void {
    for (const material of this.#options.config.base.materials) {
      if (material.appearancePath !== undefined) {
        this.load.image(appearanceTextureKey(material.id), material.appearancePath)
      }
    }
  }

  create(): void {
    const { logicalWidth, logicalHeight } =
      this.#options.config.gameplay.prototype
    this.#baseGraphics = this.add.graphics().setDepth(0)
    this.#drawChamber(this.#baseGraphics, logicalWidth, logicalHeight)

    const heatField = this.#fireConfig.heatField
    this.#fireTexture = this.textures.createCanvas(
      FIRE_TEXTURE_KEY,
      heatField.width,
      heatField.height,
    )
    if (this.#fireTexture === null) throw new Error('M2_FIRE_TEXTURE_UNAVAILABLE')
    this.#fireImage = this.add
      .image(0, 0, FIRE_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDisplaySize(
        heatField.width * heatField.pixelScale,
        heatField.height * heatField.pixelScale,
      )
      .setVisible(false)
      .setDepth(1)
    this.#fireImage.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)

    this.#fireSparkGraphics = this.add.graphics().setDepth(2).setVisible(false)
    this.#debrisGraphics = this.add.graphics().setDepth(3.5)
    this.#pearlGraphics = this.add.graphics().setDepth(4.2)
    this.#pearlSpritePool = this.#createPearlSpritePool()
    this.#localLightGraphics = this.add
      .graphics()
      .setDepth(4.5)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.#collectorGraphics = this.add.graphics().setDepth(5)
    this.#effectGraphics = this.add.graphics().setDepth(6)
    this.#failureGraphics = this.add.graphics().setDepth(7)
    const initialRuntime = this.#runtime.snapshot()
    this.#resetPresentationSession(initialRuntime.application.sessionId)
    this.#renderSimulation(initialRuntime.simulation, 0)
    this.#disableFirePresentation()
    this.#ready = true
    const snapshot = this.getSnapshot()
    this.#publishCanvasMetadata(snapshot)
    this.#options.onReady?.({
      scene: 'm2-extraction',
      logicalWidth,
      logicalHeight,
      phaserVersion: Phaser.VERSION,
    })
    this.#options.onSnapshot?.(snapshot)
  }

  update(time: number): void {
    this.#lastPresentationTimestamp = Math.max(
      this.#lastPresentationTimestamp,
      time,
    )
    const runtime = this.#runtime.frame(time)
    if (runtime.application.sessionId !== this.#presentationSessionId) {
      this.#resetPresentationSession(runtime.application.sessionId)
    }
    const committedEvents = this.#runtime.drainDomainEvents()
    if (committedEvents.length > 0) {
      this.#lastEventTypes = committedEvents.map((event) => event.type)
      this.#consumeDomainEvents(committedEvents, runtime.simulation, time)
    }
    const simulation = runtime.simulation
    this.#advancePresentation(runtime, time)
    if (simulation.tick !== this.#lastRenderedTick) {
      this.#renderSimulation(simulation, time)
    }
    this.#renderEffects(time)
    this.#renderFireFrame(simulation, time, this.#presentationSnapshot)
    this.#renderLocalLight(runtime.application.fireSize)
    this.#renderFailurePresentation(simulation)
    this.#audioDirector.update(time)

    const presentationEvents = this.#presentationLifecycle.drainEvents(
      runtime.application.sessionId,
    )
    if (presentationEvents.length > 0) {
      this.#lastEventTypes = [
        ...this.#lastEventTypes,
        ...presentationEvents.map((event) => event.type),
      ]
    }

    const reachedRequestedSprayingState =
      this.#requestedSprayingProjection !== null &&
      runtime.application.isSpraying === this.#requestedSprayingProjection
    if (reachedRequestedSprayingState) {
      this.#requestedSprayingProjection = null
    }

    if (
      shouldPublishM5CanvasMetadata({
        elapsedMilliseconds: time - this.#lastSnapshotTime,
        hasCommittedEvents: committedEvents.length > 0,
        hasPresentationEvents: presentationEvents.length > 0,
        reachedRequestedSprayingState,
      })
    ) {
      this.#lastSnapshotTime = time
      const snapshot = this.getSnapshot()
      this.#publishCanvasMetadata(snapshot)
      this.#options.onSnapshot?.(snapshot)
    }
  }

  captureRuleCommand(command: RuleCommand): void {
    if (command.type === 'SetSpraying') {
      this.#requestedSprayingProjection = command.payload.spraying
      this.#forceRuleFireOff = !command.payload.spraying
      if (!command.payload.spraying && this.#presentationSessionId !== null) {
        this.#resetTransientEmission(this.#lastPresentationTimestamp)
        this.#debrisGraphics?.clear()
        this.#presentationSnapshot =
          this.#presentationLifecycle.setRuleFireActive(
            this.#presentationSessionId,
            false,
            this.#lastPresentationTimestamp,
          ) ?? this.#presentationSnapshot
        this.#audioDirector.setFireActive(
          false,
          this.#lastPresentationTimestamp,
        )
      }
    }
    this.#runtime.captureRuleCommand(command)
  }

  captureControl(
    control: Parameters<M2GameplayRuntime['captureControl']>[0],
  ): void {
    this.#runtime.captureControl(control)
    const lifecycleRequestsPause =
      control.type === 'Pause' ||
      control.type === 'RequestRestart' ||
      ((control.type === 'WindowBlur' ||
        control.type === 'WindowFocus' ||
        control.type === 'VisibilityChanged') &&
        (!control.payload.lifecycleSnapshot.hasFocus ||
          control.payload.lifecycleSnapshot.visibilityState === 'hidden'))
    if (lifecycleRequestsPause) {
      this.#forceRuleFireOff = true
      if (this.#presentationSessionId !== null) {
        this.#presentationLifecycle.pauseTimeline(
          this.#presentationSessionId,
          this.#lastPresentationTimestamp,
        )
        this.#presentationSnapshot =
          this.#presentationLifecycle.hardClearFire(
            this.#presentationSessionId,
            this.#lastPresentationTimestamp,
          ) ?? this.#presentationSnapshot
      }
      this.#audioDirector.setFireActive(false, this.#lastPresentationTimestamp)
      this.#resetTransientEmission(this.#lastPresentationTimestamp)
      this.#debrisGraphics?.clear()
      this.#disableFirePresentation()
    }
  }

  unlockAudio(): void {
    void this.#audioDirector.unlock().catch(() => {
      // Browsers may reject an unlock not directly associated with a gesture.
    })
  }

  setAudioVolume(volume: number): void {
    this.#audioDirector.setVolume(volume)
  }

  setAudioMuted(muted: boolean): void {
    this.#audioDirector.setMuted(muted)
  }

  getMaterialTopologyEvidence(): readonly M5MaterialTopologyEvidence[] {
    return copyM5MaterialTopologyEvidence(this.#runtime.snapshot().simulation)
  }

  getPearlEvidence(): readonly M5PearlEvidence[] {
    return copyM5PearlEvidence(this.#runtime.snapshot().simulation)
  }

  getPresentationEvidence(): Readonly<{
    activeEffectKinds: readonly M5EffectKind[]
    collectorCenter: Readonly<{ x: number; y: number }>
    collectorVelocityX: number
    simulationTick: number
  }> {
    const simulation = this.#runtime.snapshot().simulation
    return {
      activeEffectKinds: this.#effectPool.copyActiveKinds(),
      collectorCenter: { ...simulation.collector.center },
      collectorVelocityX: simulation.collector.velocityX,
      simulationTick: simulation.tick,
    }
  }

  getSnapshot(): M2Snapshot {
    const runtime = this.#runtime.snapshot()
    const domain = runtime.domain
    const gameplay = this.#options.config.gameplay
    let caughtPearlCount = 0
    for (const outcome of Object.values(domain.ledger.terminalPearls)) {
      if (outcome === 'caught') caughtPearlCount += 1
    }
    const inventory: M2WorkbenchModel['inventory'] = buildM2InventoryViews(
      this.#options.config,
      domain.inventory,
    )
    const audioDiagnostics = this.#audioDirector.getDiagnostics()
    const effectPoolDiagnostics = this.#effectPool.getDiagnostics()
    const failureInvestedMaterials = domain.materialInstances.map(
      ({ materialDefinitionId }) =>
        this.#options.config.base.materials.find(
          ({ id }) => id === materialDefinitionId,
        )?.nameZh ?? materialDefinitionId,
    )
    const furnaceSource =
      gameplay.fireSources.find(
        (source) => source.id === runtime.application.equippedFireSourceId,
      ) ??
      gameplay.fireSources.find((source) =>
        gameplay.prototype.availableFireSourceIds.includes(source.id),
      ) ??
      gameplay.fireSources[0]
    if (furnaceSource === undefined) {
      throw new Error('可用火源配置不能为空。')
    }
    const furnacePresentation = deriveM5FurnacePresentation({
      currentTemperature: runtime.application.furnaceTemperature,
      fireSize: runtime.application.fireSize,
      isSpraying: runtime.application.isSpraying,
      paused: runtime.application.paused,
      status: runtime.application.status,
      source: furnaceSource,
    })

    return {
      ready: this.#ready,
      scene: 'm2-extraction',
      logicalWidth: gameplay.prototype.logicalWidth,
      logicalHeight: gameplay.prototype.logicalHeight,
      seed: gameplay.prototype.seed,
      simulationContentFingerprint:
        this.#options.simulationContentFingerprint,
      presentationContentFingerprint:
        this.#options.presentationContentFingerprint,
      flowGeneration: runtime.simulation.fireFlow.generation,
      remainingMaterialCellCount: countRemainingCells(runtime.simulation),
      lastDomainEventTypes: [...this.#lastEventTypes],
      sessionId: runtime.application.sessionId,
      status: runtime.application.status,
      tick: runtime.application.nextTick,
      fireSources: gameplay.fireSources.map((source) => ({
        id: source.id,
        nameZh: source.nameZh,
        descriptionZh: source.descriptionZh,
      })),
      equippedFireSourceId: runtime.application.equippedFireSourceId,
      fireSize: runtime.application.fireSize,
      fireSizeRange: {
        min: 0,
        max: 100,
      },
      isSpraying: runtime.application.isSpraying,
      furnaceTemperature: runtime.application.furnaceTemperature,
      furnaceTemperatureRange: furnacePresentation.range,
      furnaceTemperatureThresholds: {
        warmRatio: this.#options.config.presentation.temperature.warmRatio,
        blazingRatio:
          this.#options.config.presentation.temperature.blazingRatio,
      },
      furnaceTemperatureTrend: furnacePresentation.trend,
      flameThrustEnabled: domain.flameThrustEnabled,
      audioVolume: audioDiagnostics.volume,
      audioMuted: audioDiagnostics.muted,
      canFinish: runtime.application.canFinish,
      lossWarningLevel: runtime.application.lossWarningLevel,
      caughtVolumes: { ...domain.ledger.caughtVolumes },
      normalSlagQuantity: deriveNormalSlagQuantity(domain, this.#rules),
      failureResult: runtime.application.failureResult,
      failureInvestedMaterials,
      failurePresentationComplete:
        this.#presentationSnapshot.failure.state === 'result',
      paused: runtime.application.paused,
      pauseReasons: [...runtime.application.pauseReasons],
      restartConfirmation: runtime.application.restartConfirmation,
      inventory,
      selectedMaterialBatchId: domain.selectedMaterialBatchId,
      materialRemaining: domain.materialInstances.reduce(
        (total, material) => total + material.remainingVolume,
        0,
      ),
      activePearlCount: deriveActivePearlCount(domain),
      caughtPearlCount,
      interactionCount: runtime.simulation.interactionCount,
      debug: {
        simulationContentFingerprint:
          this.#options.simulationContentFingerprint,
        presentationContentFingerprint:
          this.#options.presentationContentFingerprint,
        flowGeneration: runtime.simulation.fireFlow.generation,
        pauseReasons: [...runtime.application.pauseReasons],
        firePresentationState: this.#presentationSnapshot.fire.state,
        fireVisualIntensity: this.#presentationSnapshot.fire.visualIntensity,
        failurePresentationState: this.#presentationSnapshot.failure.state,
        failurePresentationProgress: this.#presentationSnapshot.failure.progress,
        audioVoiceCount: audioDiagnostics.activeVoiceCount,
        effectPoolActive: effectPoolDiagnostics.activeCount,
      },
      firePresentationState: this.#presentationSnapshot.fire.state,
      fireVisualIntensity: this.#presentationSnapshot.fire.visualIntensity,
      failurePresentationState: this.#presentationSnapshot.failure.state,
      failurePresentationProgress: this.#presentationSnapshot.failure.progress,
      audioDiagnostics,
      effectPoolDiagnostics,
    }
  }

  destroyRuntime(): void {
    for (const visual of this.#materialVisuals.values()) {
      visual.image.destroy()
      visual.texture.destroy()
    }
    this.#materialVisuals.clear()
    this.#pearlSpritePool?.destroy()
    this.#pearlSpritePool = null
    this.#effectPool.reset()
    void this.#audioDirector.destroy()
  }

  #drawChamber(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
  ): void {
    const background = colorNumber(this.#theme.background)
    const surface = colorNumber(this.#theme.surface)
    const raised = colorNumber(this.#theme.surfaceRaised)
    const border = colorNumber(this.#theme.border)
    const accent = colorNumber(this.#theme.accent)
    const danger = colorNumber(this.#theme.danger)
    graphics.fillStyle(background, 1)
    graphics.fillRect(0, 0, width, height)
    graphics.fillStyle(surface, 0.96)
    graphics.fillRoundedRect(34, 26, width - 68, height - 52, 34)
    graphics.lineStyle(3, border, 0.92)
    graphics.strokeRoundedRect(34, 26, width - 68, height - 52, 34)
    graphics.lineStyle(1, accent, 0.24)
    graphics.strokeRoundedRect(48, 40, width - 96, height - 80, 28)

    graphics.fillStyle(raised, 0.88)
    graphics.fillRoundedRect(104, 92, width - 208, height - 204, 76)
    graphics.lineStyle(2, border, 0.72)
    graphics.strokeRoundedRect(104, 92, width - 208, height - 204, 76)

    // 炉室中央只保留稀疏的环形刻度，不再暴露技术网格。
    graphics.fillStyle(background, 0.52)
    graphics.fillEllipse(width / 2, 365, width * 0.69, height * 0.56)
    graphics.lineStyle(3, accent, 0.28)
    graphics.strokeEllipse(width / 2, 365, width * 0.69, height * 0.56)
    graphics.lineStyle(1, border, 0.38)
    graphics.strokeEllipse(width / 2, 365, width * 0.58, height * 0.43)
    graphics.strokeEllipse(width / 2, 365, width * 0.45, height * 0.31)

    // 四角云气纹与两侧炉柱形成志怪图鉴式边框。
    graphics.lineStyle(4, border, 0.68)
    for (const side of [-1, 1]) {
      const pillarX = side < 0 ? 76 : width - 76
      graphics.fillStyle(background, 0.72)
      graphics.fillRoundedRect(pillarX - 18, 156, 36, height - 344, 15)
      graphics.strokeRoundedRect(pillarX - 18, 156, 36, height - 344, 15)
      for (let band = 0; band < 4; band += 1) {
        const bandY = 206 + band * 116
        graphics.lineStyle(3, accent, 0.34)
        graphics.lineBetween(pillarX - 14, bandY, pillarX + 14, bandY)
      }
      const cloudX = side < 0 ? 148 : width - 148
      const direction = side < 0 ? 1 : -1
      graphics.lineStyle(3, accent, 0.4)
      graphics.beginPath()
      graphics.moveTo(cloudX, 132)
      graphics.lineTo(cloudX + direction * 38, 106)
      graphics.lineTo(cloudX + direction * 70, 140)
      graphics.lineTo(cloudX + direction * 108, 118)
      graphics.lineTo(cloudX + direction * 142, 98)
      graphics.lineTo(cloudX + direction * 174, 132)
      graphics.lineTo(cloudX + direction * 208, 112)
      graphics.strokePath()
    }

    graphics.fillStyle(background, 0.88)
    graphics.fillCircle(width / 2, 92, 42)
    graphics.lineStyle(3, accent, 0.64)
    graphics.strokeCircle(width / 2, 92, 42)
    graphics.lineStyle(1, danger, 0.58)
    graphics.strokeCircle(width / 2, 92, 30)

    // 下方弧线既是丹珠落势引导，也是接液皿移动轨迹的视觉框架。
    graphics.lineStyle(5, accent, 0.34)
    graphics.beginPath()
    graphics.arc(width / 2, 118, width * 0.35, Math.PI * 0.08, Math.PI * 0.92)
    graphics.strokePath()
    graphics.lineStyle(2, border, 0.54)
    graphics.lineBetween(160, 820, width - 160, 820)
    graphics.fillStyle(accent, 0.42)
    graphics.fillCircle(160, 820, 8)
    graphics.fillCircle(width - 160, 820, 8)

    const source = this.#options.config.gameplay.fireSources[0]
    if (source !== undefined) {
      graphics.fillStyle(border, 1)
      graphics.fillRoundedRect(source.origin.x - 64, source.origin.y - 8, 128, 32, 12)
      graphics.lineStyle(2, accent, 0.72)
      graphics.strokeRoundedRect(source.origin.x - 64, source.origin.y - 8, 128, 32, 12)
      graphics.fillStyle(background, 0.94)
      graphics.fillRoundedRect(source.origin.x - 40, source.origin.y - 2, 80, 12, 6)
      graphics.fillStyle(danger, 0.52)
      graphics.fillRoundedRect(source.origin.x - 30, source.origin.y + 1, 60, 6, 3)
    }

    this.add
      .text(width / 2, 92, '丹', {
        color: this.#theme.accent,
        fontFamily: 'STKaiti, KaiTi, SimSun, serif',
        fontSize: '34px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(0.2)
      .setAlpha(0.82)
  }

  #renderSimulation(
    view: ExtractionSimulationReadView,
    timestampMilliseconds: number,
  ): void {
    this.#renderMaterials(view.materials, view.tick)
    this.#renderPearls(view, timestampMilliseconds)
    this.#renderCollector(view)
    this.#lastRenderedTick = view.tick
  }

  #renderFireFrame(
    view: ExtractionSimulationReadView,
    timestamp: number,
    presentation: M5PresentationLifecycleSnapshot,
  ): void {
    const texture = this.#fireTexture
    const image = this.#fireImage
    const sparks = this.#fireSparkGraphics
    if (texture === null || image === null || sparks === null) return
    if (presentation.fire.state === 'off') {
      this.#disableFirePresentation()
      return
    }

    const liveSource = view.effectiveFireSource
    const source = liveSource ?? this.#lastRenderedFireSource
    const flow =
      liveSource !== null
        ? this.#syncPresentationFlow(view.fireFlow)
        : this.#presentationFlowView
    if (source === null || flow === null) {
      image.setVisible(false)
      sparks.clear().setVisible(false)
      setChangedCanvasDataset(this.game.canvas.dataset, 'fireState', 'loading')
      return
    }
    image.setVisible(true)
    sparks.setVisible(true)
    this.#fireLayerVisible = true
    if (!this.#firePrepared && flow.generation > 0) {
      if (this.#reducedMotion) {
        this.#firePresentation.resetSteady(flow, source)
      } else {
        this.#firePresentation.reset(flow, source)
      }
      this.#firePrepared = true
    }
    if (!this.#firePrepared) {
      setChangedCanvasDataset(this.game.canvas.dataset, 'fireState', 'loading')
      return
    }

    const lastSource = this.#lastRenderedFireSource
    const sourceChanged =
      lastSource === null ||
      lastSource.position.x !== source.position.x ||
      lastSource.position.y !== source.position.y ||
      lastSource.direction.x !== source.direction.x ||
      lastSource.direction.y !== source.direction.y ||
      lastSource.width !== source.width
    const minimumFrameMilliseconds =
      1_000 / this.#fireConfig.heatField.maximumFramesPerSecond
    const authoritativeStateChanged =
      sourceChanged || flow.generation !== this.#lastRenderedFireGeneration
    if (
      this.#reducedMotion &&
      authoritativeStateChanged &&
      lastSource !== null
    ) {
      this.#firePresentation.resetSteady(flow, source)
    }
    if (
      Number.isFinite(this.#lastFireTimestamp) &&
      (this.#reducedMotion
        ? !authoritativeStateChanged
        : timestamp - this.#lastFireTimestamp < minimumFrameMilliseconds)
    ) {
      return
    }
    if (!this.#reducedMotion && Number.isFinite(this.#lastFireTimestamp)) {
      this.#firePresentation.advance(
        flow,
        source,
        (timestamp - this.#lastFireTimestamp) / 1_000,
      )
    }
    this.#lastFireTimestamp = timestamp

    const particles = this.#firePresentation.particles
    const revealDistance = this.#firePresentation.revealDistancePixels
    const { logicalWidth, logicalHeight } =
      this.#options.config.gameplay.prototype
    const revealCompletionDistance = distanceFromSourceToStageEdge(
      source,
      logicalWidth,
      logicalHeight,
    )
    const isEmerging =
      presentation.fire.state === 'emerging' &&
      !this.#reducedMotion &&
      revealDistance !== null &&
      revealDistance < revealCompletionDistance
    let revealInput: FireRevealInput | undefined
    if (isEmerging && this.#fireConfig.startup.mode === 'rapid-reveal') {
      this.#fireRevealInput.frontDistancePixels = revealDistance
      this.#fireRevealInput.frontFeatherPixels =
        this.#fireConfig.startup.frontFeatherPixels
      revealInput = this.#fireRevealInput
    }
    const frame = this.#fireHeatField.render(
      flow,
      particles,
      source,
      this.#createFireOcclusion(view),
      revealInput,
    )
    if (this.#firePixels === null) {
      this.#firePixels = new ImageData(frame.width, frame.height)
    }
    this.#firePixels.data.set(frame.pixels)
    const visualIntensity = presentation.fire.visualIntensity
    if (visualIntensity < 1) {
      for (
        let alphaOffset = 3;
        alphaOffset < this.#firePixels.data.length;
        alphaOffset += 4
      ) {
        this.#firePixels.data[alphaOffset] = Math.round(
          this.#firePixels.data[alphaOffset]! * visualIntensity,
        )
      }
    }
    texture.context.putImageData(this.#firePixels, 0, 0)
    texture.refresh()
    this.#lastRenderedFireGeneration = flow.generation
    this.#lastRenderedFireSource = {
      position: { ...source.position },
      direction: { ...source.direction },
      width: source.width,
    }

    sparks.clear()
    sparks.fillStyle(
      this.#fireConfig.colors.head,
      this.#fireConfig.sparks.alpha * visualIntensity,
    )
    const emittedEmberCount = this.#emberRateAccumulator.sample(
      this.#lastRulesFireActive ? this.#presentation.fire.emberRate : 0,
      timestamp,
    )
    const emberFrame = this.#emberFrame
    emberFrame.drawCount = Math.min(particles.count, emittedEmberCount)
    if (emberFrame.drawCount === 0 || particles.count === 0) {
      emberFrame.stride = 0
      emberFrame.startIndex = 0
    } else {
      emberFrame.stride = Math.max(
        1,
        Math.floor(particles.count / emberFrame.drawCount),
      )
      emberFrame.startIndex =
        (this.#emberEmissionSequence * 97) % particles.count
    }
    this.#emberEmissionSequence += emittedEmberCount
    for (let sample = 0; sample < emberFrame.drawCount; sample += 1) {
      const index =
        (emberFrame.startIndex + sample * emberFrame.stride) % particles.count
      if (isEmerging && revealDistance !== null) {
        const particleX =
          particles.x[index]! + particles.displayOffsetX[index]!
        const particleY =
          particles.y[index]! + particles.displayOffsetY[index]!
        const directionLength = Math.hypot(
          source.direction.x,
          source.direction.y,
        )
        const particleDistance =
          directionLength > 0.001
            ? ((particleX - source.position.x) * source.direction.x +
                (particleY - source.position.y) * source.direction.y) /
              directionLength
            : Number.POSITIVE_INFINITY
        if (particleDistance > revealDistance) continue
      }
      sparks.fillCircle(
        particles.x[index]! + particles.displayOffsetX[index]!,
        particles.y[index]! + particles.displayOffsetY[index]!,
        this.#fireConfig.sparks.radiusPixels * particles.sizeScale[index]!,
      )
    }

    const canvas = this.game.canvas
    if (
      !isEmerging &&
      presentation.fire.state === 'emerging' &&
      this.#presentationSessionId !== null
    ) {
      this.#presentationSnapshot =
        this.#presentationLifecycle.markFireSteady(
          this.#presentationSessionId,
          timestamp,
        ) ?? this.#presentationSnapshot
    }
    setChangedCanvasDataset(
      canvas.dataset,
      'fireState',
      presentation.fire.state === 'cooling'
        ? 'cooling'
        : this.#reducedMotion
          ? 'reduced'
          : isEmerging
            ? 'emerging'
            : 'animated',
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireStartup',
      isEmerging ? 'emerging' : 'steady',
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireFrontDistance',
      isEmerging ? revealDistance!.toFixed(1) : 'full',
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireFrame',
      String(this.#firePresentation.frame),
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireParticleCount',
      String(particles.count),
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireVisualIntensity',
      visualIntensity.toFixed(3),
    )
    setChangedCanvasDataset(
      canvas.dataset,
      'fireSourceDirection',
      `${source.direction.x.toFixed(6)},${source.direction.y.toFixed(6)}`,
    )
  }

  #syncPresentationFlow(flow: ExtractionFireFlowReadView): FireFlowReadView {
    if (
      this.#presentationFlowView !== null &&
      this.#presentationFlowView.generation === flow.generation
    ) {
      return this.#presentationFlowView
    }
    this.#presentationFlowView = Object.freeze({
      generation: flow.generation,
      tick: flow.tick,
      columns: flow.columns,
      rows: flow.rows,
      cellSize: flow.cellSize,
      originX: flow.originX,
      originY: flow.originY,
      obstacle: flow.obstacle,
      flowX: flow.flowX,
      flowY: flow.flowY,
      intensity: flow.intensity,
    })
    return this.#presentationFlowView
  }

  #createFireOcclusion(
    view: ExtractionSimulationReadView,
  ): FireOcclusionInput {
    if (
      this.#fireOcclusionInput !== null &&
      this.#fireOcclusionTick === view.tick
    ) {
      return this.#fireOcclusionInput
    }
    let count = 0
    for (const pearl of view.pearls) {
      if (pearl.state !== 'active') continue
      this.#ensureFireOcclusionCapacity(count + 1)
      this.#fireOcclusionCircles.x[count] = pearl.position.x
      this.#fireOcclusionCircles.y[count] = pearl.position.y
      this.#fireOcclusionCircles.radius[count] = pearl.radius
      this.#fireOcclusionCircles.eligible[count] = 1
      count += 1
    }
    this.#fireOcclusionCircles.count = count
    this.#rasterizeMaterialFireCoverage(view.materials)
    this.#fireOcclusionInput ??= {
      fullObstacleRects: EMPTY_FIRE_OCCLUSION_RECTS,
      circles: this.#fireOcclusionCircles,
      circleRadiusScale: M2_FIRE_OCCLUSION_CONFIG.circleRadiusScale,
      circleFeatherPixels: M2_FIRE_OCCLUSION_CONFIG.circleFeatherPixels,
      coverageMask: {
        width: this.#fireConfig.heatField.width,
        height: this.#fireConfig.heatField.height,
        coverage: this.#materialFireCoverage,
      },
    }
    this.#fireOcclusionTick = view.tick
    return this.#fireOcclusionInput
  }

  #ensureFireOcclusionCapacity(requiredCapacity: number): void {
    const circles = this.#fireOcclusionCircles
    if (requiredCapacity <= circles.x.length) return
    const capacity =
      Math.ceil(requiredCapacity / this.#fireOcclusionGrowthCapacity) *
      this.#fireOcclusionGrowthCapacity
    const x = new Float32Array(capacity)
    const y = new Float32Array(capacity)
    const radius = new Float32Array(capacity)
    const eligible = new Uint8Array(capacity)
    x.set(circles.x)
    y.set(circles.y)
    radius.set(circles.radius)
    eligible.set(circles.eligible)
    circles.x = x
    circles.y = y
    circles.radius = radius
    circles.eligible = eligible
  }

  #rasterizeMaterialFireCoverage(
    materials: readonly ExtractionMaterialReadView[],
  ): void {
    const coverage = this.#materialFireCoverage
    const { width: fieldWidth, height: fieldHeight, pixelScale } =
      this.#fireConfig.heatField
    coverage.fill(0)
    for (const material of materials) {
      const placement = material.placement
      const halfWidth = placement.width / 2
      const halfHeight = placement.height / 2
      const cosine = Math.cos(placement.rotationRadians)
      const sine = Math.sin(placement.rotationRadians)
      const extentX = Math.abs(cosine) * halfWidth + Math.abs(sine) * halfHeight
      const extentY = Math.abs(sine) * halfWidth + Math.abs(cosine) * halfHeight
      const firstX = Math.max(
        0,
        Math.floor((placement.center.x - extentX) / pixelScale),
      )
      const lastX = Math.min(
        fieldWidth - 1,
        Math.ceil((placement.center.x + extentX) / pixelScale) - 1,
      )
      const firstY = Math.max(
        0,
        Math.floor((placement.center.y - extentY) / pixelScale),
      )
      const lastY = Math.min(
        fieldHeight - 1,
        Math.ceil((placement.center.y + extentY) / pixelScale) - 1,
      )

      for (let y = firstY; y <= lastY; y += 1) {
        const deltaY = (y + 0.5) * pixelScale - placement.center.y
        const rowOffset = y * fieldWidth
        for (let x = firstX; x <= lastX; x += 1) {
          const deltaX = (x + 0.5) * pixelScale - placement.center.x
          const localX = deltaX * cosine + deltaY * sine
          const localY = -deltaX * sine + deltaY * cosine
          if (
            localX < -halfWidth ||
            localX >= halfWidth ||
            localY < -halfHeight ||
            localY >= halfHeight
          ) {
            continue
          }
          const materialX = Math.min(
            EXTRACTION_COMPOSITION_GRID_SIZE - 1,
            Math.floor(
              ((localX + halfWidth) / placement.width) *
                EXTRACTION_COMPOSITION_GRID_SIZE,
            ),
          )
          const materialY = Math.min(
            EXTRACTION_COMPOSITION_GRID_SIZE - 1,
            Math.floor(
              ((localY + halfHeight) / placement.height) *
                EXTRACTION_COMPOSITION_GRID_SIZE,
            ),
          )
          const materialIndex =
            materialY * EXTRACTION_COMPOSITION_GRID_SIZE + materialX
          const initial = material.initialCellVolumes[materialIndex] ?? 0
          if (initial <= 1e-12) continue
          const remaining = material.remainingCellVolumes[materialIndex] ?? 0
          const materialCoverage = Math.round(
            255 * Math.max(0, Math.min(1, remaining / initial)),
          )
          const fieldIndex = rowOffset + x
          coverage[fieldIndex] = Math.max(
            coverage[fieldIndex]!,
            materialCoverage,
          )
        }
      }
    }
  }

  #disableFirePresentation(): void {
    const image = this.#fireImage
    const sparks = this.#fireSparkGraphics
    if (image === null || sparks === null) return
    if (this.#fireLayerVisible) {
      image.setVisible(false)
      sparks.clear().setVisible(false)
      this.#fireLayerVisible = false
    }
    this.#firePrepared = false
    this.#lastFireTimestamp = Number.NaN
    this.#lastRenderedFireGeneration = Number.NEGATIVE_INFINITY
    this.#lastRenderedFireSource = null
    const canvas = this.game.canvas
    setChangedCanvasDataset(canvas.dataset, 'fireState', 'off')
    setChangedCanvasDataset(canvas.dataset, 'fireParticleCount', '0')
    setChangedCanvasDataset(canvas.dataset, 'fireVisualIntensity', '0.000')
    deleteChangedCanvasDataset(canvas.dataset, 'fireFrame')
    deleteChangedCanvasDataset(canvas.dataset, 'fireSourceDirection')
    deleteChangedCanvasDataset(canvas.dataset, 'fireStartup')
    deleteChangedCanvasDataset(canvas.dataset, 'fireFrontDistance')
  }

  #renderMaterials(
    materials: readonly ExtractionMaterialReadView[],
    tick: number,
  ): void {
    this.#debrisGraphics?.clear()
    this.#debrisRenderTick = tick
    this.#debrisMaterialViews.clear()
    if (this.#lastRulesFireActive) {
      this.#debrisLifetimeWindow.advance(tick)
    } else {
      this.#debrisLifetimeWindow.reset()
    }
    const liveIds = this.#liveMaterialIds
    liveIds.clear()
    for (const material of materials) {
      liveIds.add(material.materialInstanceId)
      this.#debrisMaterialViews.set(material.materialInstanceId, material)
    }
    for (const [materialInstanceId, visual] of this.#materialVisuals) {
      if (liveIds.has(materialInstanceId)) continue
      visual.image.destroy()
      visual.texture.destroy()
      this.#materialVisuals.delete(materialInstanceId)
    }

    for (const material of materials) {
      let visual = this.#materialVisuals.get(material.materialInstanceId)
      if (visual === undefined) {
        visual = this.#createMaterialVisual(material)
        this.#materialVisuals.set(material.materialInstanceId, visual)
      }
      visual.image
        .setPosition(material.placement.center.x, material.placement.center.y)
        .setDisplaySize(material.placement.width, material.placement.height)
        .setRotation(material.placement.rotationRadians)
      if (Math.abs(visual.remainingVolume - material.remainingVolume) > 1e-9) {
        this.#paintMaterialMask(visual, material)
        visual.remainingVolume = material.remainingVolume
      }
      this.#emitMaterialDebris(material, tick)
    }
    this.#debrisLifetimeWindow.forEachActive(tick, this.#debrisVisitor)
  }

  #emitMaterialDebris(material: ExtractionMaterialReadView, tick: number): void {
    const graphics = this.#debrisGraphics
    if (
      graphics === null ||
      !this.#lastRulesFireActive ||
      material.initialVolume <= 0 ||
      material.remainingVolume <= 0
    ) {
      return
    }
    const dissolvedRatio = Math.max(
      0,
      Math.min(1, 1 - material.remainingVolume / material.initialVolume),
    )
    const frame = deriveM5DebrisFrame(
      {
        debrisRatePerSecond: this.#presentation.material.debrisRate,
        framesPerSecond:
          this.#options.config.base.parameters.simulation.fixedStepHz,
        dissolvedRatio,
        frame: tick,
        maximumVisible: this.#presentation.performance.particlePoolSize,
      },
      this.#debrisFrame,
    )
    if (frame.emittedCount === 0) return
    this.#debrisLifetimeWindow.emit(
      material.materialInstanceId,
      tick,
      frame.emittedCount,
    )
  }

  #drawMaterialDebrisSlot(
    slotIndex: number,
    ownerId: string,
    lifeProgress: number,
    tick: number,
  ): void {
    const graphics = this.#debrisGraphics
    const material = this.#debrisMaterialViews.get(ownerId)
    if (graphics === null || material === undefined) return
    const placement = material.placement
    const content = deriveMaterialContentRectangle(
      placement,
      material.composition,
    )
    const phase = this.#pearlRenderer.phaseForId(
      `material-debris:${material.materialInstanceId}`,
    )
    const cosRotation = Math.cos(placement.rotationRadians)
    const sinRotation = Math.sin(placement.rotationRadians)
    const emberColor = colorNumber(this.#presentation.fire.ember.color)
    const charColor = colorNumber(this.#theme.border)
    const angle = phase + slotIndex * 2.399_963 + tick * 0.025
    const localX =
      Math.cos(angle) * content.width * (0.34 + lifeProgress * 0.16)
    const localY =
      Math.sin(angle) * content.height * 0.34 -
      lifeProgress * content.height * 0.32
    const x =
      content.center.x + localX * cosRotation - localY * sinRotation
    const y =
      content.center.y + localX * sinRotation + localY * cosRotation
    graphics.fillStyle(
      slotIndex % 3 === 0 ? emberColor : charColor,
      0.72 * (1 - lifeProgress),
    )
    graphics.fillCircle(x, y, 0.9 + ((slotIndex * 7) % 4) * 0.38)
  }

  #createMaterialVisual(material: ExtractionMaterialReadView): MaterialVisual {
    const definition = this.#options.config.base.materials.find(
      (candidate) => candidate.id === material.materialDefinitionId,
    )
    if (definition?.appearancePath === undefined) {
      throw new Error(`M2_MATERIAL_APPEARANCE_MISSING:${material.materialDefinitionId}`)
    }
    const textureSize =
      EXTRACTION_COMPOSITION_GRID_SIZE * this.#materialMaskConfig.maskScale
    const texture = this.textures.createCanvas(
      materialTextureKey(material.materialInstanceId),
      textureSize,
      textureSize,
    )
    if (texture === null) throw new Error('M2_MATERIAL_TEXTURE_UNAVAILABLE')
    const source = this.textures
      .get(appearanceTextureKey(material.materialDefinitionId))
      .getSourceImage()
    texture.context.clearRect(0, 0, textureSize, textureSize)
    texture.context.drawImage(
      source as CanvasImageSource,
      0,
      0,
      EXTRACTION_COMPOSITION_GRID_SIZE,
      EXTRACTION_COMPOSITION_GRID_SIZE,
    )
    const sourceRgba = texture.context
      .getImageData(
        0,
        0,
        EXTRACTION_COMPOSITION_GRID_SIZE,
        EXTRACTION_COMPOSITION_GRID_SIZE,
      )
      .data.slice()
    texture.context.clearRect(0, 0, textureSize, textureSize)
    const outputPixels = texture.context.createImageData(
      textureSize,
      textureSize,
    )
    const image = this.add
      .image(material.placement.center.x, material.placement.center.y, texture.key)
      .setDisplaySize(material.placement.width, material.placement.height)
      .setDepth(3)
    image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    const visual: MaterialVisual = {
      texture,
      image,
      sourceRgba,
      outputPixels,
      remainingVolume: Number.NaN,
    }
    this.#paintMaterialMask(visual, material)
    visual.remainingVolume = material.remainingVolume
    return visual
  }

  #paintMaterialMask(
    visual: MaterialVisual,
    material: ExtractionMaterialReadView,
  ): void {
    renderM5MaterialMask(
      {
        sourceRgba: visual.sourceRgba,
        initialCellVolumes: material.initialCellVolumes,
        remainingCellVolumes: material.remainingCellVolumes,
      },
      this.#materialMaskConfig,
      visual.outputPixels.data,
    )
    visual.texture.context.putImageData(visual.outputPixels, 0, 0)
    visual.texture.refresh()
  }

  #createPearlSpritePool(): M5PearlSpritePool<
    Phaser.GameObjects.Graphics,
    Phaser.GameObjects.Image
  > {
    const host: M5PearlSpritePoolHost<
      Phaser.GameObjects.Graphics,
      Phaser.GameObjects.Image
    > = {
      hasTexture: (key) => this.textures.exists(key),
      createTexture: (key, size, draw) => {
        const graphics = this.make.graphics({ x: 0, y: 0 })
        try {
          draw(graphics, size / 2)
          graphics.generateTexture(key, size, size)
        } finally {
          graphics.destroy()
        }
      },
      createSprite: (textureKey, depth) =>
        this.add.image(0, 0, textureKey).setDepth(depth).setVisible(false),
      setSpritePose: (sprite, x, y, rotation, alpha, scale) => {
        sprite
          .setPosition(x, y)
          .setRotation(rotation)
          .setAlpha(alpha)
          .setScale(scale)
          .setVisible(true)
      },
      hideSprite: (sprite) => {
        sprite.setVisible(false)
      },
      destroySprite: (sprite) => sprite.destroy(),
      removeTexture: (key) => {
        if (this.textures.exists(key)) this.textures.remove(key)
      },
    }
    const effectCapacity = this.#presentation.performance
    return new M5PearlSpritePool(host, this.#pearlRenderer, {
      textureNamespace: 'm5-player-pearl',
      capacity: effectCapacity.pearlPoolSize,
      growthCapacity: effectCapacity.pearlPoolSize,
      depth: 4,
    })
  }

  #renderPearls(
    view: ExtractionSimulationReadView,
    timestampMilliseconds: number,
  ): void {
    const graphics = this.#pearlGraphics
    const pearlSpritePool = this.#pearlSpritePool
    if (graphics === null || pearlSpritePool === null) return
    graphics.clear()
    this.#pearlRenderer.beginFrame()
    pearlSpritePool.beginFrame()
    const pearlById = this.#pearlById
    pearlById.clear()
    for (const pearl of view.pearls) pearlById.set(pearl.pearlId, pearl)
    for (const interaction of view.activeInteractions) {
      const pearlA = pearlById.get(interaction.pearlAId)
      const pearlB = pearlById.get(interaction.pearlBId)
      if (pearlA === undefined || pearlB === undefined) continue
      graphics.lineStyle(3, colorNumber(this.#theme.danger), 0.68)
      graphics.lineBetween(
        pearlA.position.x,
        pearlA.position.y,
        pearlB.position.x,
        pearlB.position.y,
      )
    }
    let caughtIndex = 0
    for (let index = 0; index < view.pearls.length; index += 1) {
      const pearl = view.pearls[index]!
      const standardRadius =
        this.#pearlStandardRadius.get(pearl.pearlType) ?? pearl.radius
      pearlSpritePool.ensure(index, {
        pearlId: pearl.pearlId,
        pearlType: pearl.pearlType,
        sourceMaterialDefinitionId: pearl.sourceMaterialDefinitionId,
        radius: standardRadius,
      })
      if (pearl.state === 'active') {
        pearlSpritePool.render(
          index,
          pearl.position.x,
          pearl.position.y,
          pearl.radius,
          1,
          timestampMilliseconds,
          true,
        )
        if (pearl.shield.active) {
          graphics.lineStyle(3, colorNumber(this.#theme.focus), 0.82)
          graphics.strokeCircle(
            pearl.position.x,
            pearl.position.y,
            pearl.radius + 7,
          )
          graphics.lineStyle(1, 0xffffff, 0.4)
          graphics.strokeCircle(
            pearl.position.x - pearl.radius * 0.18,
            pearl.position.y - pearl.radius * 0.18,
            pearl.radius + 3,
          )
        }
      } else if (pearl.state === 'caught') {
        const columns = 7
        const row = Math.floor(caughtIndex / columns)
        const column = caughtIndex % columns
        const x =
          view.collector.center.x -
          view.collector.width * 0.3 +
          column * (view.collector.width * 0.1)
        const y =
          view.collector.center.y +
          view.collector.height * 0.18 -
          row * 5
        pearlSpritePool.render(
          index,
          x,
          y,
          Math.max(3, Math.min(7, pearl.radius * 0.24)),
          0.86,
          timestampMilliseconds,
          false,
        )
        caughtIndex += 1
      }
    }
    pearlSpritePool.endFrame()
  }

  #renderCollector(view: ExtractionSimulationReadView): void {
    const graphics = this.#collectorGraphics
    if (graphics === null) return
    const collector = view.collector
    const left = collector.center.x - collector.width / 2
    const top = collector.center.y - collector.height / 2
    graphics.clear()
    graphics.fillStyle(colorNumber(this.#theme.surfaceRaised), 1)
    graphics.fillRoundedRect(left, top, collector.width, collector.height, 18)
    graphics.lineStyle(5, colorNumber(this.#theme.accent), 0.95)
    graphics.strokeRoundedRect(left, top, collector.width, collector.height, 18)
    graphics.fillStyle(0x78e6d0, 0.18)
    graphics.fillRoundedRect(left + 12, top + 9, collector.width - 24, 12, 6)
  }

  #advancePresentation(
    runtime: M2GameplayRuntimeSnapshot,
    timestampMilliseconds: number,
  ): void {
    const application = runtime.application
    const sessionId = application.sessionId
    if (!application.isSpraying) this.#forceRuleFireOff = false
    const rulesFireActive =
      !this.#forceRuleFireOff &&
      !application.paused &&
      (application.status === 'ready' || application.status === 'extracting') &&
      application.isSpraying &&
      runtime.simulation.effectiveFireSource !== null

    if (rulesFireActive !== this.#lastRulesFireActive) {
      this.#resetTransientEmission(timestampMilliseconds)
    }

    if (application.paused) {
      this.#presentationLifecycle.pauseTimeline(
        sessionId,
        timestampMilliseconds,
      )
    } else {
      this.#presentationLifecycle.resumeTimeline(
        sessionId,
        timestampMilliseconds,
      )
    }

    if (application.paused || application.status === 'completed') {
      this.#presentationSnapshot =
        this.#presentationLifecycle.hardClearFire(
          sessionId,
          timestampMilliseconds,
        ) ?? this.#presentationSnapshot
    } else if (application.status === 'failed') {
      this.#presentationSnapshot =
        this.#presentationLifecycle.beginFailureConversion(
          sessionId,
          timestampMilliseconds,
        ) ?? this.#presentationSnapshot
    } else if (rulesFireActive !== this.#lastRulesFireActive) {
      this.#presentationSnapshot =
        this.#presentationLifecycle.setRuleFireActive(
          sessionId,
          rulesFireActive,
          timestampMilliseconds,
        ) ?? this.#presentationSnapshot
    }
    this.#presentationSnapshot =
      this.#presentationLifecycle.advance(sessionId, timestampMilliseconds) ??
      this.#presentationSnapshot
    this.#audioDirector.setFireActive(
      rulesFireActive,
      timestampMilliseconds,
    )
    this.#lastRulesFireActive = rulesFireActive
  }

  #resetPresentationSession(sessionId: string): void {
    this.#restoreFailureSourceVisuals()
    this.#presentationSessionId = sessionId
    this.#presentationSnapshot =
      this.#presentationLifecycle.resetSession(sessionId)
    this.#failurePresentation.resetSession(sessionId)
    this.#lastRulesFireActive = false
    this.#forceRuleFireOff = false
    this.#requestedSprayingProjection = null
    this.#audioDirector.reset()
    this.#effectPool.reset()
    this.#resetTransientEmission()
    this.#pearlRenderer.resetSession()
    this.#pearlSpritePool?.reset()
    this.#lastRenderedTick = Number.NEGATIVE_INFINITY
    this.#lastSnapshotTime = Number.NEGATIVE_INFINITY
    this.#lastEventTypes = []
    this.#presentationFlowView = null
    this.#fireOcclusionInput = null
    this.#fireOcclusionTick = Number.NEGATIVE_INFINITY
    this.#debrisGraphics?.clear()
    this.#effectGraphics?.clear()
    this.#localLightGraphics?.clear()
    this.#failureGraphics?.clear()
    const canvas = this.game.canvas
    deleteChangedCanvasDataset(canvas.dataset, 'failureResultX')
    deleteChangedCanvasDataset(canvas.dataset, 'failureResultY')
    deleteChangedCanvasDataset(canvas.dataset, 'failureLogicalCenter')
    deleteChangedCanvasDataset(canvas.dataset, 'failureSourceCount')
    if (this.#fireImage !== null) this.#disableFirePresentation()
  }

  #resetTransientEmission(timestampMilliseconds = Number.NaN): void {
    this.#emberRateAccumulator.reset(timestampMilliseconds)
    this.#emberEmissionSequence = 0
    this.#debrisLifetimeWindow.reset()
  }

  #renderLocalLight(fireSize: number): void {
    const graphics = this.#localLightGraphics
    if (graphics === null) return
    const intensity = drawM5LocalLight(
      graphics,
      this.#presentation,
      this.#lastRenderedFireSource,
      fireSize,
      this.#presentationSnapshot.fire.visualIntensity,
    )
    const canvas = this.game.canvas
    setChangedCanvasDataset(
      canvas.dataset,
      'localLightIntensity',
      intensity.toFixed(3),
    )
  }

  #renderFailurePresentation(view: ExtractionSimulationReadView): void {
    const graphics = this.#failureGraphics
    if (graphics === null) return
    graphics.clear()
    const failure = this.#presentationSnapshot.failure
    if (failure.state === 'idle') {
      this.#restoreFailureSourceVisuals()
      return
    }
    const sessionId = this.#presentationSessionId
    if (sessionId === null) return
    const { logicalWidth, logicalHeight } =
      this.#options.config.gameplay.prototype
    this.#failurePresentation.captureSources(sessionId, {
      logicalWidth,
      logicalHeight,
      materials: view.materials,
      pearls: view.pearls,
      collector: view.collector,
    })
    const frame = this.#failurePresentation.frame(sessionId, failure.progress)
    if (frame === null) return
    this.#applyFailureSourceVisuals(frame)

    const danger = colorNumber(this.#theme.danger)
    const slag = colorNumber(
      this.#options.config.gameplay.pearlTypes.find(
        (candidate) => candidate.pearlType === 'slag',
      )?.color ?? this.#theme.border,
    )
    const visualBySourceId = new Map(
      frame.sourceVisuals.map((visual) => [visual.sourceId, visual]),
    )
    for (const source of frame.sources) {
      const visual = visualBySourceId.get(source.sourceId)
      if (visual === undefined || !visual.visible) continue
      if (source.kind !== 'material') {
        graphics.fillStyle(colorNumber(this.#theme.background), visual.alpha)
        graphics.fillCircle(
          source.origin.x,
          source.origin.y,
          Math.max(3, source.radius),
        )
      }
      graphics.lineStyle(3, danger, visual.alpha * 0.78)
      graphics.strokeCircle(
        source.origin.x,
        source.origin.y,
        Math.max(4, source.radius),
      )
    }
    graphics.fillStyle(slag, 0.9)
    for (const particle of frame.particles) {
      const radius = particle.radius
      graphics.fillTriangle(
        particle.position.x,
        particle.position.y - radius,
        particle.position.x + radius * 0.86,
        particle.position.y + radius * 0.72,
        particle.position.x - radius * 0.72,
        particle.position.y + radius * 0.58,
      )
    }
    if (frame.result.visible) {
      const position = frame.result.position
      graphics.fillStyle(slag, 0.96)
      graphics.fillEllipse(
        position.x,
        position.y,
        frame.result.radius * 2,
        frame.result.radius * 1.45,
      )
      graphics.lineStyle(2, colorNumber(this.#theme.border), 0.82)
      graphics.strokeEllipse(
        position.x,
        position.y,
        frame.result.radius * 2,
        frame.result.radius * 1.45,
      )
      const canvas = this.game.canvas
      setChangedCanvasDataset(
        canvas.dataset,
        'failureResultX',
        position.x.toFixed(3),
      )
      setChangedCanvasDataset(
        canvas.dataset,
        'failureResultY',
        position.y.toFixed(3),
      )
      setChangedCanvasDataset(
        canvas.dataset,
        'failureLogicalCenter',
        `${(logicalWidth / 2).toFixed(3)},${(logicalHeight / 2).toFixed(3)}`,
      )
    }
    setChangedCanvasDataset(
      this.game.canvas.dataset,
      'failureSourceCount',
      String(frame.sources.length),
    )
  }

  #applyFailureSourceVisuals(frame: M5FailureFrame): void {
    const visualsById = new Map(
      frame.sourceVisuals.map((visual) => [visual.sourceId, visual]),
    )
    for (const [materialInstanceId, visual] of this.#materialVisuals) {
      const failureVisual = visualsById.get(`material:${materialInstanceId}`)
      if (failureVisual === undefined) continue
      visual.image
        .setTint(colorNumber(this.#theme.background))
        .setAlpha(failureVisual.alpha)
        .setVisible(failureVisual.visible)
    }
    this.#pearlGraphics?.clear()
    this.#pearlSpritePool?.reset()
  }

  #restoreFailureSourceVisuals(): void {
    for (const visual of this.#materialVisuals.values()) {
      visual.image.clearTint().setAlpha(1).setVisible(true)
    }
  }

  #consumeDomainEvents(
    events: readonly DomainEvent[],
    simulation: ExtractionSimulationReadView,
    timestampMilliseconds: number,
  ): void {
    for (const event of events) {
      if (event.type === 'ExtractionFailed') {
        const sessionId = this.#presentationSessionId
        if (sessionId !== null) {
          this.#presentationLifecycle.beginFailureConversion(
            sessionId,
            timestampMilliseconds,
          )
        }
      }
      for (const action of mapM5DomainEvent(event)) {
        if (action.audioCue !== undefined) {
          this.#audioDirector.emit(action.audioCue, timestampMilliseconds)
        }
        if (action.cameraCue !== undefined) {
          this.#shakeCamera(action.cameraCue)
        }
        const anchor = this.#resolveEffectAnchor(action.anchor, simulation)
        if (anchor === null) continue
        const duration =
          effectDurationSeconds(action.effect, this.#presentation) * 1_000
        if (duration <= 0) continue
        this.#effectPool.spawn(
          action.effect,
          anchor,
          timestampMilliseconds,
          duration,
        )
      }
    }
  }

  #resolveEffectAnchor(
    anchor: M5EffectAnchor,
    simulation: ExtractionSimulationReadView,
  ):
    | Readonly<{
        x: number
        y: number
        secondaryX?: number
        secondaryY?: number
      }>
    | null {
    if (anchor.kind === 'collector') {
      return {
        x: simulation.collector.center.x,
        y: simulation.collector.center.y,
      }
    }
    if (anchor.kind === 'viewport') {
      return {
        x: this.#options.config.gameplay.prototype.logicalWidth / 2,
        y: this.#options.config.gameplay.prototype.logicalHeight / 2,
      }
    }
    const pearlA = simulation.pearls.find(
      (candidate) =>
        candidate.pearlId ===
        (anchor.kind === 'pearl' ? anchor.pearlId : anchor.pearlAId),
    )
    if (pearlA === undefined) return null
    if (anchor.kind === 'pearl') {
      return { x: pearlA.position.x, y: pearlA.position.y }
    }
    const pearlB = simulation.pearls.find(
      (candidate) => candidate.pearlId === anchor.pearlBId,
    )
    if (pearlB === undefined) return null
    return {
      x: pearlA.position.x,
      y: pearlA.position.y,
      secondaryX: pearlB.position.x,
      secondaryY: pearlB.position.y,
    }
  }

  #shakeCamera(cue: M5CameraCue): void {
    const camera = this.cameras.main
    const config = this.#presentation.camera
    const strength =
      cue === 'normalCatch'
        ? config.normalCatchStrength
        : cue === 'damage'
          ? config.damageStrength
          : cue === 'fight'
            ? config.fightStrength
            : cue === 'warningTwo'
              ? config.warningTwoStrength
              : config.failureStrength
    const motionMultiplier = this.#reducedMotion
      ? this.#presentation.accessibility.reducedMotionCameraMultiplier
      : 1
    const maximumDimension = Math.max(camera.width, camera.height, 1)
    const intensity =
      (strength * motionMultiplier * config.maxOffsetPixels) / maximumDimension
    if (intensity <= 0) return
    camera.shake(config.durationSeconds * 1_000, intensity, true)
  }

  #renderEffects(timestampMilliseconds: number): void {
    const graphics = this.#effectGraphics
    if (graphics === null) return
    graphics.clear()
    this.#effectPool.forEachActive(timestampMilliseconds, this.#effectVisitor)
  }

  #drawEffect(
    kind: M5EffectKind,
    x: number,
    y: number,
    secondaryX: number,
    secondaryY: number,
    progress: number,
    slotIndex: number,
  ): void {
    const graphics = this.#effectGraphics
    if (graphics === null) return
    drawM5Effect(
      graphics,
      this.#theme,
      this.#options.config.gameplay.prototype.logicalWidth,
      this.#options.config.gameplay.prototype.logicalHeight,
      kind,
      x,
      y,
      secondaryX,
      secondaryY,
      progress,
      slotIndex,
    )
  }

  #publishCanvasMetadata(snapshot: M2Snapshot): void {
    const dataset = this.game.canvas.dataset
    setChangedCanvasDataset(dataset, 'game', 'liandan')
    setChangedCanvasDataset(
      dataset,
      'gameState',
      snapshot.ready ? 'ready' : 'loading',
    )
    setChangedCanvasDataset(dataset, 'scene', snapshot.scene)
    setChangedCanvasDataset(
      dataset,
      'logicalWidth',
      String(snapshot.logicalWidth),
    )
    setChangedCanvasDataset(
      dataset,
      'logicalHeight',
      String(snapshot.logicalHeight),
    )
    setChangedCanvasDataset(dataset, 'phaserVersion', Phaser.VERSION)
    setChangedCanvasDataset(dataset, 'sessionId', snapshot.sessionId)
    setChangedCanvasDataset(dataset, 'domainStatus', snapshot.status)
    setChangedCanvasDataset(dataset, 'tick', String(snapshot.tick))
    setChangedCanvasDataset(
      dataset,
      'equippedFireSourceId',
      snapshot.equippedFireSourceId ?? '',
    )
    setChangedCanvasDataset(dataset, 'isSpraying', String(snapshot.isSpraying))
    setChangedCanvasDataset(
      dataset,
      'furnaceTemperature',
      snapshot.furnaceTemperature.toFixed(3),
    )
    setChangedCanvasDataset(
      dataset,
      'flameThrustEnabled',
      String(snapshot.flameThrustEnabled),
    )
    setChangedCanvasDataset(dataset, 'canFinish', String(snapshot.canFinish))
    setChangedCanvasDataset(
      dataset,
      'lossWarningLevel',
      String(snapshot.lossWarningLevel),
    )
    setChangedCanvasDataset(
      dataset,
      'flowGeneration',
      String(snapshot.flowGeneration),
    )
    setChangedCanvasDataset(dataset, 'fireRenderer', 'heat-field')
    setChangedCanvasDataset(dataset, 'pearlRenderer', 'm5-formal-sprite-pool')
    const pearlSpriteDiagnostics = this.#pearlSpritePool?.getDiagnostics()
    setChangedCanvasDataset(
      dataset,
      'pearlSpriteCapacity',
      String(pearlSpriteDiagnostics?.capacity ?? 0),
    )
    setChangedCanvasDataset(
      dataset,
      'pearlSpriteInitializedCount',
      String(pearlSpriteDiagnostics?.initializedCount ?? 0),
    )
    setChangedCanvasDataset(
      dataset,
      'pearlSpriteGrowthCount',
      String(pearlSpriteDiagnostics?.runtimeStorageGrowthCount ?? 0),
    )
    setChangedCanvasDataset(
      dataset,
      'pearlSpriteTextureCount',
      String(pearlSpriteDiagnostics?.textureCount ?? 0),
    )
    setChangedCanvasDataset(
      dataset,
      'activePearlCount',
      String(snapshot.activePearlCount),
    )
    setChangedCanvasDataset(dataset, 'fireOcclusion', 'precise-geometry')
    setChangedCanvasDataset(
      dataset,
      'remainingMaterialCells',
      String(snapshot.remainingMaterialCellCount),
    )
    setChangedCanvasDataset(
      dataset,
      'simulationContentFingerprint',
      snapshot.simulationContentFingerprint,
    )
    setChangedCanvasDataset(
      dataset,
      'presentationContentFingerprint',
      snapshot.presentationContentFingerprint,
    )
    setChangedCanvasDataset(
      dataset,
      'failurePresentationState',
      snapshot.failurePresentationState,
    )
    setChangedCanvasDataset(
      dataset,
      'failurePresentationProgress',
      snapshot.failurePresentationProgress.toFixed(3),
    )
    setChangedCanvasDataset(
      dataset,
      'audioVoiceCount',
      String(snapshot.audioDiagnostics.activeVoiceCount),
    )
    setChangedCanvasDataset(
      dataset,
      'effectPoolActive',
      String(snapshot.effectPoolDiagnostics.activeCount),
    )
  }
}
