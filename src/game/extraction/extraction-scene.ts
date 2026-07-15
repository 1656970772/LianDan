import Phaser from 'phaser'

import type {
  DecodedCompositionMap,
  NormalizedM2Config,
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
import {
  createDropletOutline,
  drawDroplet,
} from '../presentation/droplet.ts'
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
import { M2GameplayRuntime } from './gameplay-runtime.ts'
import { buildM2InventoryViews } from './inventory-view.ts'
import {
  M2_DROPLET_PRESENTATION,
  M2_FIRE_OCCLUSION_CONFIG,
  M2_FIRE_PRESENTATION_CONFIG,
} from './presentation-config.ts'
import { createM2RuntimeConfiguration } from './runtime-config.ts'

const FIRE_TEXTURE_KEY = 'm2-fire-flow'
const SNAPSHOT_INTERVAL_MILLISECONDS = 120
const EMPTY_FIRE_OCCLUSION_RECTS = Object.freeze([])

type MaterialVisual = {
  readonly texture: Phaser.Textures.CanvasTexture
  readonly image: Phaser.GameObjects.Image
  readonly sourcePixels: ImageData
  readonly outputPixels: ImageData
  remainingVolume: number
}

type EventSpark = {
  x: number
  y: number
  life: number
  color: number
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
  onReady?: (metadata: M2ExtractionSceneMetadata) => void
  onSnapshot?: (snapshot: M2Snapshot) => void
}>

function colorNumber(value: string): number {
  const normalized = value.startsWith('#') ? value.slice(1) : value
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
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
  readonly #fireConfig: FirePresentationConfig
  readonly #firePresentation: FirePresentation
  readonly #fireHeatField: FireHeatField
  readonly #reducedMotion =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  #baseGraphics: Phaser.GameObjects.Graphics | null = null
  #pearlGraphics: Phaser.GameObjects.Graphics | null = null
  #collectorGraphics: Phaser.GameObjects.Graphics | null = null
  #effectGraphics: Phaser.GameObjects.Graphics | null = null
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
  readonly #materialFireCoverage: Uint8Array
  readonly #fireRevealInput: {
    frontDistancePixels: number
    frontFeatherPixels: number
  } = {
    frontDistancePixels: 0,
    frontFeatherPixels: 0,
  }
  readonly #dropletOutlines = new Map<number, Phaser.Math.Vector2[]>()
  readonly #materialVisuals = new Map<string, MaterialVisual>()
  readonly #eventSparks: EventSpark[] = []
  #lastRenderedTick = Number.NEGATIVE_INFINITY
  #lastSnapshotTime = Number.NEGATIVE_INFINITY
  #lastEventTypes: readonly string[] = []
  #ready = false

  constructor(options: M2ExtractionSceneOptions) {
    super({ key: 'm2-extraction-scene' })
    this.#options = options
    this.#theme = options.config.gameplay.prototype.theme.colors
    this.#fireConfig = fitFirePresentationConfig(
      options.config.gameplay.prototype.logicalWidth,
      options.config.gameplay.prototype.logicalHeight,
      M2_FIRE_PRESENTATION_CONFIG,
    )
    this.#firePresentation = new FirePresentation(this.#fireConfig)
    this.#fireHeatField = new FireHeatField(this.#fireConfig.heatField)
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
    this.#pearlGraphics = this.add.graphics().setDepth(4)
    this.#collectorGraphics = this.add.graphics().setDepth(5)
    this.#effectGraphics = this.add.graphics().setDepth(6)
    this.#renderSimulation(this.#runtime.snapshot().simulation)
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
    this.#runtime.frame(time)
    const committedEvents = this.#runtime.drainDomainEvents()
    if (committedEvents.length > 0) {
      this.#lastEventTypes = committedEvents.map((event) => event.type)
      this.#consumeDomainEvents(committedEvents)
    }
    const runtime = this.#runtime.snapshot()
    const simulation = runtime.simulation
    if (simulation.tick !== this.#lastRenderedTick) {
      this.#renderSimulation(simulation)
    } else if (this.#eventSparks.length > 0) {
      this.#renderEffects()
    }
    this.#renderFireFrame(
      simulation,
      time,
      runtime.application.isSpraying && !runtime.application.paused,
    )

    const snapshot = this.getSnapshot()
    this.#publishCanvasMetadata(snapshot)
    if (
      time - this.#lastSnapshotTime >= SNAPSHOT_INTERVAL_MILLISECONDS ||
      committedEvents.length > 0
    ) {
      this.#lastSnapshotTime = time
      this.#options.onSnapshot?.(snapshot)
    }
  }

  captureRuleCommand(command: RuleCommand): void {
    this.#runtime.captureRuleCommand(command)
  }

  captureControl(
    control: Parameters<M2GameplayRuntime['captureControl']>[0],
  ): void {
    this.#runtime.captureControl(control)
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

    return {
      ready: this.#ready,
      scene: 'm2-extraction',
      logicalWidth: gameplay.prototype.logicalWidth,
      logicalHeight: gameplay.prototype.logicalHeight,
      simulationContentFingerprint:
        this.#options.simulationContentFingerprint,
      flowGeneration: runtime.simulation.fireFlow.generation,
      remainingMaterialCellCount: countRemainingCells(runtime.simulation),
      lastDomainEventTypes: [...this.#lastEventTypes],
      sessionId: runtime.application.sessionId,
      status: runtime.application.status,
      tick: runtime.application.nextTick,
      fireSources: gameplay.fireSources.map((source) => ({
        id: source.id,
        nameZh: source.nameZh,
        descriptionZh: '稳定、易控制的基础火种。',
      })),
      equippedFireSourceId: runtime.application.equippedFireSourceId,
      fireSize: runtime.application.fireSize,
      fireSizeRange: {
        min: 0,
        max: 100,
      },
      isSpraying: runtime.application.isSpraying,
      flameThrustEnabled: domain.flameThrustEnabled,
      canFinish: runtime.application.canFinish,
      lossWarningLevel: runtime.application.lossWarningLevel,
      caughtVolumes: { ...domain.ledger.caughtVolumes },
      normalSlagQuantity: deriveNormalSlagQuantity(domain, this.#rules),
      failureResult: runtime.application.failureResult,
      paused: runtime.application.paused,
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
    }
  }

  destroyRuntime(): void {
    for (const visual of this.#materialVisuals.values()) {
      visual.image.destroy()
      visual.texture.destroy()
    }
    this.#materialVisuals.clear()
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
    graphics.fillStyle(background, 1)
    graphics.fillRect(0, 0, width, height)
    graphics.fillStyle(surface, 1)
    graphics.fillRoundedRect(42, 30, width - 84, height - 60, 28)
    graphics.lineStyle(3, border, 0.8)
    graphics.strokeRoundedRect(42, 30, width - 84, height - 60, 28)

    graphics.fillStyle(raised, 0.82)
    graphics.fillRoundedRect(105, 86, width - 210, height - 158, 80)
    graphics.lineStyle(2, border, 0.62)
    graphics.strokeRoundedRect(105, 86, width - 210, height - 158, 80)

    graphics.lineStyle(5, accent, 0.52)
    graphics.beginPath()
    graphics.arc(width / 2, 120, width * 0.34, Math.PI * 0.08, Math.PI * 0.92)
    graphics.strokePath()
    graphics.lineStyle(2, border, 0.34)
    for (let x = 180; x < width - 180; x += 80) {
      graphics.lineBetween(x, 120, x, height - 100)
    }
    for (let y = 140; y < height - 100; y += 80) {
      graphics.lineBetween(140, y, width - 140, y)
    }

    const source = this.#options.config.gameplay.fireSources[0]
    if (source !== undefined) {
      graphics.fillStyle(border, 1)
      graphics.fillRoundedRect(source.origin.x - 58, source.origin.y - 4, 116, 26, 10)
      graphics.fillStyle(accent, 0.9)
      graphics.fillRoundedRect(source.origin.x - 38, source.origin.y, 76, 10, 5)
    }
  }

  #renderSimulation(view: ExtractionSimulationReadView): void {
    this.#renderMaterials(view.materials)
    this.#renderPearls(view)
    this.#renderCollector(view)
    this.#renderEffects()
    this.#lastRenderedTick = view.tick
  }

  #renderFireFrame(
    view: ExtractionSimulationReadView,
    timestamp: number,
    presentationActive: boolean,
  ): void {
    const texture = this.#fireTexture
    const image = this.#fireImage
    const sparks = this.#fireSparkGraphics
    const source = view.effectiveFireSource
    if (texture === null || image === null || sparks === null) return
    if (!presentationActive || source === null) {
      this.#disableFirePresentation()
      return
    }

    const flow = this.#syncPresentationFlow(view.fireFlow)
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
      this.game.canvas.dataset.fireState = 'loading'
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
      this.#fireConfig.sparks.alpha,
    )
    for (
      let index = 0;
      index < particles.count;
      index += this.#fireConfig.sparks.stride
    ) {
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
    canvas.dataset.fireState = this.#reducedMotion
      ? 'reduced'
      : isEmerging
        ? 'emerging'
        : 'animated'
    canvas.dataset.fireStartup = isEmerging ? 'emerging' : 'steady'
    canvas.dataset.fireFrontDistance = isEmerging
      ? revealDistance!.toFixed(1)
      : 'full'
    canvas.dataset.fireFrame = String(this.#firePresentation.frame)
    canvas.dataset.fireParticleCount = String(particles.count)
    canvas.dataset.fireSourceDirection = `${source.direction.x.toFixed(6)},${source.direction.y.toFixed(6)}`
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
    const activePearls = view.pearls.filter(
      (pearl) => pearl.state === 'active',
    )
    const count = activePearls.length
    const x = new Float32Array(count)
    const y = new Float32Array(count)
    const radius = new Float32Array(count)
    const eligible = new Uint8Array(count)
    for (let index = 0; index < count; index += 1) {
      const pearl = activePearls[index]!
      x[index] = pearl.position.x
      y[index] = pearl.position.y
      radius[index] = pearl.radius
      eligible[index] = 1
    }
    this.#rasterizeMaterialFireCoverage(view.materials)
    this.#fireOcclusionInput = {
      fullObstacleRects: EMPTY_FIRE_OCCLUSION_RECTS,
      circles: { count, x, y, radius, eligible },
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
    canvas.dataset.fireState = 'off'
    canvas.dataset.fireParticleCount = '0'
    delete canvas.dataset.fireFrame
    delete canvas.dataset.fireSourceDirection
    delete canvas.dataset.fireStartup
    delete canvas.dataset.fireFrontDistance
  }

  #renderMaterials(materials: readonly ExtractionMaterialReadView[]): void {
    const liveIds = new Set(materials.map((material) => material.materialInstanceId))
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
    }
  }

  #createMaterialVisual(material: ExtractionMaterialReadView): MaterialVisual {
    const definition = this.#options.config.base.materials.find(
      (candidate) => candidate.id === material.materialDefinitionId,
    )
    if (definition?.appearancePath === undefined) {
      throw new Error(`M2_MATERIAL_APPEARANCE_MISSING:${material.materialDefinitionId}`)
    }
    const texture = this.textures.createCanvas(
      materialTextureKey(material.materialInstanceId),
      64,
      64,
    )
    if (texture === null) throw new Error('M2_MATERIAL_TEXTURE_UNAVAILABLE')
    const source = this.textures
      .get(appearanceTextureKey(material.materialDefinitionId))
      .getSourceImage()
    texture.context.clearRect(0, 0, 64, 64)
    texture.context.drawImage(source as CanvasImageSource, 0, 0, 64, 64)
    const sourcePixels = texture.context.getImageData(0, 0, 64, 64)
    const outputPixels = texture.context.createImageData(64, 64)
    const image = this.add
      .image(material.placement.center.x, material.placement.center.y, texture.key)
      .setDisplaySize(material.placement.width, material.placement.height)
      .setDepth(3)
    image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    const visual: MaterialVisual = {
      texture,
      image,
      sourcePixels,
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
    const source = visual.sourcePixels.data
    const output = visual.outputPixels.data
    for (let index = 0; index < material.remainingCellVolumes.length; index += 1) {
      const offset = index * 4
      const initial = material.initialCellVolumes[index] ?? 0
      const remaining = material.remainingCellVolumes[index] ?? 0
      const ratio = initial <= 1e-12 ? 0 : Math.max(0, Math.min(1, remaining / initial))
      output[offset] = source[offset]!
      output[offset + 1] = source[offset + 1]!
      output[offset + 2] = source[offset + 2]!
      output[offset + 3] = Math.round(source[offset + 3]! * ratio)
    }
    visual.texture.context.putImageData(visual.outputPixels, 0, 0)
    visual.texture.refresh()
  }

  #renderPearls(view: ExtractionSimulationReadView): void {
    const graphics = this.#pearlGraphics
    if (graphics === null) return
    graphics.clear()
    const pearlById = new Map(view.pearls.map((pearl) => [pearl.pearlId, pearl]))
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
    for (const pearl of view.pearls) {
      if (pearl.state === 'active') {
        this.#drawPearl(
          graphics,
          pearl.pearlType,
          pearl.sourceMaterialDefinitionId,
          pearl.position.x,
          pearl.position.y,
          pearl.radius,
          1,
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
        this.#drawPearl(
          graphics,
          pearl.pearlType,
          pearl.sourceMaterialDefinitionId,
          x,
          y,
          Math.max(3, Math.min(7, pearl.radius * 0.24)),
          0.86,
        )
        caughtIndex += 1
      }
    }
  }

  #drawPearl(
    graphics: Phaser.GameObjects.Graphics,
    pearlType: PearlType,
    sourceMaterialDefinitionId: string,
    x: number,
    y: number,
    radius: number,
    alpha: number,
  ): void {
    const config = this.#options.config.gameplay.pearlTypes.find(
      (candidate) => candidate.pearlType === pearlType,
    )
    const material = this.#options.config.base.materials.find(
      (candidate) => candidate.id === sourceMaterialDefinitionId,
    )
    const fillColor = colorNumber(
      pearlType === 'medicinalLiquid'
        ? material?.pearlColor ?? config?.color ?? '#FFFFFF'
        : config?.color ?? '#FFFFFF',
    )
    const outlineColor = colorNumber(config?.outlineColor ?? '#FFFFFF')
    if (pearlType === 'medicinalLiquid') {
      let outline = this.#dropletOutlines.get(radius)
      if (outline === undefined) {
        outline = createDropletOutline(radius, M2_DROPLET_PRESENTATION.droplet)
        this.#dropletOutlines.set(radius, outline)
      }
      drawDroplet(graphics, x, y, radius, outline, {
        ...M2_DROPLET_PRESENTATION,
        fillColor,
        fillAlpha: M2_DROPLET_PRESENTATION.fillAlpha * alpha,
        outlineColor,
        outlineAlpha: M2_DROPLET_PRESENTATION.outlineAlpha * alpha,
      })
      return
    }

    const points = pearlType === 'slag'
      ? [
          new Phaser.Math.Vector2(x - radius * 0.82, y - radius * 0.18),
          new Phaser.Math.Vector2(x - radius * 0.38, y - radius * 0.82),
          new Phaser.Math.Vector2(x + radius * 0.48, y - radius * 0.66),
          new Phaser.Math.Vector2(x + radius * 0.88, y + radius * 0.08),
          new Phaser.Math.Vector2(x + radius * 0.24, y + radius * 0.82),
          new Phaser.Math.Vector2(x - radius * 0.68, y + radius * 0.56),
        ]
      : [
          new Phaser.Math.Vector2(x, y - radius),
          new Phaser.Math.Vector2(x + radius * 0.72, y),
          new Phaser.Math.Vector2(x, y + radius),
          new Phaser.Math.Vector2(x - radius * 0.72, y),
        ]
    graphics.fillStyle(fillColor, 0.92 * alpha)
    graphics.fillPoints(points, true, true)
    graphics.lineStyle(2, outlineColor, 0.8 * alpha)
    graphics.strokePoints(points, true, true)
    graphics.fillStyle(0xffffff, 0.28 * alpha)
    graphics.fillCircle(x - radius * 0.22, y - radius * 0.24, radius * 0.16)
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

  #consumeDomainEvents(events: readonly DomainEvent[]): void {
    const simulation = this.#runtime.snapshot().simulation
    for (const event of events) {
      if (event.type === 'PearlBorn') {
        const pearl = simulation.pearls.find(
          (candidate) => candidate.pearlId === event.pearlId,
        )
        if (pearl !== undefined) {
          this.#eventSparks.push({
            x: pearl.position.x,
            y: pearl.position.y,
            life: 8,
            color: 0x78e6d0,
          })
        }
      } else if (event.type === 'PearlCaught') {
        this.#eventSparks.push({
          x: simulation.collector.center.x,
          y: simulation.collector.center.y,
          life: 12,
          color: colorNumber(this.#theme.accent),
        })
      } else if (event.type === 'PearlShieldActivated') {
        const pearl = simulation.pearls.find(
          (candidate) => candidate.pearlId === event.pearlId,
        )
        if (pearl !== undefined) {
          this.#eventSparks.push({
            x: pearl.position.x,
            y: pearl.position.y,
            life: 11,
            color: colorNumber(this.#theme.focus),
          })
        }
      } else if (event.type === 'PearlInteractionStarted') {
        const pearlA = simulation.pearls.find(
          (candidate) => candidate.pearlId === event.pearlAId,
        )
        const pearlB = simulation.pearls.find(
          (candidate) => candidate.pearlId === event.pearlBId,
        )
        if (pearlA !== undefined && pearlB !== undefined) {
          this.#eventSparks.push({
            x: (pearlA.position.x + pearlB.position.x) * 0.5,
            y: (pearlA.position.y + pearlB.position.y) * 0.5,
            life: 15,
            color: colorNumber(this.#theme.danger),
          })
        }
      } else if (event.type === 'PearlDamaged' || event.type === 'PearlBurned') {
        const pearl = simulation.pearls.find(
          (candidate) => candidate.pearlId === event.pearlId,
        )
        if (pearl !== undefined) {
          this.#eventSparks.push({
            x: pearl.position.x,
            y: pearl.position.y,
            life: event.type === 'PearlBurned' ? 14 : 7,
            color: colorNumber(this.#theme.danger),
          })
        }
      } else if (event.type === 'ExtractionFailed') {
        this.#eventSparks.push({
          x: simulation.collector.center.x,
          y: simulation.collector.center.y - 80,
          life: 18,
          color: colorNumber(this.#theme.danger),
        })
      } else if (event.type === 'CanFinish') {
        this.#eventSparks.push({
          x: simulation.collector.center.x,
          y: simulation.collector.center.y - 30,
          life: 18,
          color: colorNumber(this.#theme.focus),
        })
      }
    }
  }

  #renderEffects(): void {
    const graphics = this.#effectGraphics
    if (graphics === null) return
    graphics.clear()
    for (let index = this.#eventSparks.length - 1; index >= 0; index -= 1) {
      const spark = this.#eventSparks[index]!
      const alpha = Math.min(1, spark.life / 10)
      graphics.lineStyle(3, spark.color, alpha)
      graphics.strokeCircle(spark.x, spark.y, 4 + (18 - spark.life) * 2)
      spark.life -= 1
      if (spark.life <= 0) this.#eventSparks.splice(index, 1)
    }
  }

  #publishCanvasMetadata(snapshot: M2Snapshot): void {
    const canvas = this.game.canvas
    canvas.dataset.game = 'liandan'
    canvas.dataset.gameState = snapshot.ready ? 'ready' : 'loading'
    canvas.dataset.scene = snapshot.scene
    canvas.dataset.logicalWidth = String(snapshot.logicalWidth)
    canvas.dataset.logicalHeight = String(snapshot.logicalHeight)
    canvas.dataset.phaserVersion = Phaser.VERSION
    canvas.dataset.sessionId = snapshot.sessionId
    canvas.dataset.domainStatus = snapshot.status
    canvas.dataset.tick = String(snapshot.tick)
    canvas.dataset.equippedFireSourceId =
      snapshot.equippedFireSourceId ?? ''
    canvas.dataset.isSpraying = String(snapshot.isSpraying)
    canvas.dataset.flameThrustEnabled = String(snapshot.flameThrustEnabled)
    canvas.dataset.canFinish = String(snapshot.canFinish)
    canvas.dataset.lossWarningLevel = String(snapshot.lossWarningLevel)
    canvas.dataset.flowGeneration = String(snapshot.flowGeneration)
    canvas.dataset.fireRenderer = 'heat-field'
    canvas.dataset.pearlRenderer = 'typed-m3'
    canvas.dataset.activePearlCount = String(snapshot.activePearlCount)
    canvas.dataset.fireOcclusion = 'precise-geometry'
    canvas.dataset.remainingMaterialCells = String(
      snapshot.remainingMaterialCellCount,
    )
    canvas.dataset.simulationContentFingerprint =
      snapshot.simulationContentFingerprint
  }
}
