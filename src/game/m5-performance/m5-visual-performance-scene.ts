import Phaser from 'phaser'

import type {
  M5VisualPerformanceEffectKind,
  M5VisualPerformanceFixture,
  M5VisualPerformanceScenario,
  NormalizedM2Config,
} from '../../config/index.ts'
import type { PearlType } from '../../domain/index.ts'
import {
  FireFlowField,
  type FireFlowUpdateInput,
} from '../../simulation/fire-flow/index.ts'
import { FireHeatField } from '../presentation/fire/fire-heat-field.ts'
import { fitFirePresentationConfig } from '../presentation/fire/fire-presentation-config.ts'
import { FirePresentation } from '../presentation/fire/fire-presentation.ts'
import type { FirePresentationSource } from '../presentation/fire/contracts.ts'
import { createM5AudioConfigFromPresentation } from '../extraction/m5-audio-config.ts'
import {
  createBrowserM5AudioBackend,
  M5AudioDirector,
  type M5AudioCue,
} from '../extraction/m5-audio-director.ts'
import { M5EffectPool, type M5EffectVisitor } from '../extraction/m5-effect-pool.ts'
import { createM5FirePresentationConfig } from '../extraction/m5-fire-presentation-config.ts'
import type { M5EffectKind } from '../extraction/m5-feedback-mapper.ts'
import {
  M5PearlSpritePool,
  type M5PearlSpritePoolHost,
} from '../extraction/m5-pearl-sprite-pool.ts'
import {
  drawM5Effect,
  drawM5LocalLight,
  M5PearlRenderer,
  m5ColorNumber,
} from '../extraction/m5-presentation-renderer.ts'
import { M5WallClockRateAccumulator } from '../extraction/m5-visual-policy.ts'
import type { M5VisualPerformanceSnapshot } from './contracts.ts'
import {
  createM5VisualPerformanceSnapshot,
  isValidM5VisualSampleDuration,
} from './m5-visual-performance-contract.ts'
import type {
  M5AppAllocationKind,
  M5FrameAllocationEvidence,
  M5VisualLongTask,
  M5VisualEffectSecondEvidence,
  M5VisualPerformanceSample,
} from './m5-visual-performance-metrics.ts'
import {
  M5_APP_ALLOCATION_COVERAGE,
  M5_APP_ALLOCATION_KINDS,
  M5FrameAllocationTracker,
} from './m5-visual-performance-metrics.ts'

const EMPTY_CIRCLES = Object.freeze({
  count: 0,
  x: new Float32Array(0),
  y: new Float32Array(0),
  radius: new Float32Array(0),
  eligible: new Uint8Array(0),
})
const PEARL_TYPES: readonly PearlType[] = [
  'medicinalLiquid',
  'slag',
  'impurity',
]
const REQUIRED_EFFECT_KINDS: readonly M5VisualPerformanceEffectKind[] = [
  'steam',
  'shield',
  'damage',
  'fight',
]
const AUDIO_CUES: readonly Exclude<M5AudioCue, 'fireLoop'>[] = [
  'pearlShield',
  'pearlDamaged',
  'interaction',
  'pearlCaught',
]

type MutableFlowInput = {
  tick: number
  source: NonNullable<FireFlowUpdateInput['source']>
  readonly fullObstacles: Uint8Array
  readonly circles: typeof EMPTY_CIRCLES
}

type SamplePromise = Readonly<{
  resolve: (sample: M5VisualPerformanceSample) => void
  reject: (error: Error) => void
}>

export type M5VisualPerformanceSceneOptions = Readonly<{
  config: NormalizedM2Config
  fixture: M5VisualPerformanceFixture
  scenario: M5VisualPerformanceScenario
  simulationContentFingerprint: string
  presentationContentFingerprint: string
  onReady?: () => void
}>

function deterministicUnit(index: number, seed: number): number {
  let value = (index + 1) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d)
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000
}

function choosePearlType(
  unit: number,
  weights: M5VisualPerformanceScenario['pearlTypeWeights'],
): PearlType {
  const total = weights.medicinalLiquid + weights.slag + weights.impurity
  const scaled = unit * total
  if (scaled < weights.medicinalLiquid) return 'medicinalLiquid'
  if (scaled < weights.medicinalLiquid + weights.slag) return 'slag'
  return 'impurity'
}

function effectDurationMilliseconds(
  kind: M5VisualPerformanceEffectKind,
  config: NormalizedM2Config['presentation'],
): number {
  if (kind === 'steam') return config.effects.steamDurationSeconds * 1_000
  if (kind === 'shield') return config.effects.shieldDurationSeconds * 1_000
  if (kind === 'damage') return config.effects.damageDurationSeconds * 1_000
  return config.camera.durationSeconds * 1_000
}

function effectBit(kind: M5VisualPerformanceEffectKind): number {
  return 1 << REQUIRED_EFFECT_KINDS.indexOf(kind)
}

export class M5VisualPerformanceScene extends Phaser.Scene {
  readonly #options: M5VisualPerformanceSceneOptions
  readonly #scenario: M5VisualPerformanceScenario
  readonly #pearlRenderer: M5PearlRenderer
  readonly #effectPool: M5EffectPool
  readonly #audio: M5AudioDirector
  readonly #flow: FireFlowField
  readonly #flowInput: MutableFlowInput
  readonly #fireSource: FirePresentationSource
  readonly #firePresentation: FirePresentation
  readonly #fireHeatField: FireHeatField
  readonly #ids: readonly string[]
  readonly #types: Uint8Array
  readonly #baseX: Float32Array
  readonly #baseY: Float32Array
  readonly #x: Float32Array
  readonly #y: Float32Array
  readonly #radius: Float32Array
  readonly #motionPhase: Float32Array
  readonly #interactionA: Uint16Array
  readonly #interactionB: Uint16Array
  readonly #materialIds: readonly string[]
  readonly #steamRate = new M5WallClockRateAccumulator()
  readonly #shieldRate = new M5WallClockRateAccumulator()
  readonly #damageRate = new M5WallClockRateAccumulator()
  readonly #fightRate = new M5WallClockRateAccumulator()
  readonly #frameTimestamps: Float64Array
  readonly #frameDeltas: Float64Array
  readonly #frameAllocationTotals: Uint32Array
  readonly #frameAllocationByKind: Readonly<
    Record<M5AppAllocationKind, Uint32Array>
  >
  readonly #frameAllocationObservedMasks: Uint8Array
  readonly #allocationTracker = new M5FrameAllocationTracker()
  readonly #effectSpawnCounts: Uint32Array
  readonly #effectRenderCounts: Uint32Array
  readonly #effectActiveHighWater: Uint16Array
  readonly #effectActiveThisFrame = new Uint16Array(
    REQUIRED_EFFECT_KINDS.length,
  )
  readonly #pearlRenderCountThisFrame = new Uint16Array(PEARL_TYPES.length)
  readonly #longTaskStarts = new Float64Array(4_096)
  readonly #longTaskDurations = new Float64Array(4_096)
  readonly #effectVisitor: M5EffectVisitor
  readonly #effectAnchor = {
    x: 0,
    y: 0,
    secondaryX: 0,
    secondaryY: 0,
  }
  readonly #longTaskObserver: PerformanceObserver | null
  #baseGraphics: Phaser.GameObjects.Graphics | null = null
  #pearlGraphics: Phaser.GameObjects.Graphics | null = null
  #pearlSpritePool: M5PearlSpritePool<
    Phaser.GameObjects.Graphics,
    Phaser.GameObjects.Image
  > | null = null
  #effectGraphics: Phaser.GameObjects.Graphics | null = null
  #lightGraphics: Phaser.GameObjects.Graphics | null = null
  #fireTexture: Phaser.Textures.CanvasTexture | null = null
  #firePixels: ImageData | null = null
  #fireImage: Phaser.GameObjects.Image | null = null
  #ready = false
  #lastFrameTime = Number.NaN
  #nextFlowTime = 0
  #effectSequence = 0
  #audioCueIndex = 0
  #nextAudioCueTime = 0
  #observedEffectMask = 0
  #samplingState: M5VisualPerformanceSnapshot['samplingState'] = 'idle'
  #sampleDurationMilliseconds = 0
  #sampleStartMilliseconds = Number.NaN
  #sampleFrameCount = 0
  #sampleLongTaskCount = 0
  #samplePromise: SamplePromise | null = null
  #effectPoolCapacity = 0
  #pearlSpritePoolGrowthCount = 0
  #audioPendingStorageGrowthCount = 0
  #fireRenderedFrameCount = 0
  #minimumFireParticleCount = Number.MAX_SAFE_INTEGER
  #maximumFireParticleCount = 0
  #localLightRenderedFrameCount = 0
  #minimumLocalLightIntensity = Number.POSITIVE_INFINITY
  #maximumLocalLightIntensity = 0
  #fightRenderedFrameCount = 0
  #minimumFightGroupCount = Number.MAX_SAFE_INTEGER
  #maximumFightGroupCount = 0
  #currentFrameSequence = 0
  #currentFrameTimeMilliseconds = 0
  #currentFireParticleCount = 0
  #currentLocalLightIntensity = 0

  constructor(options: M5VisualPerformanceSceneOptions) {
    super({ key: 'm5-visual-performance-scene' })
    this.#options = options
    this.#scenario = options.scenario
    const count = options.scenario.activePearlCount
    this.#ids = Array.from(
      { length: count },
      (_, index) => `m5-visual-pearl-${index}`,
    )
    this.#types = new Uint8Array(count)
    this.#baseX = new Float32Array(count)
    this.#baseY = new Float32Array(count)
    this.#x = new Float32Array(count)
    this.#y = new Float32Array(count)
    this.#radius = new Float32Array(count)
    this.#motionPhase = new Float32Array(count)
    this.#interactionA = new Uint16Array(options.scenario.interactionGroupCount)
    this.#interactionB = new Uint16Array(options.scenario.interactionGroupCount)
    this.#materialIds = options.config.base.materials.map(({ id }) => id)
    this.#pearlRenderer = new M5PearlRenderer({
      pearlTypes: options.config.gameplay.pearlTypes,
      materials: options.config.base.materials,
      profiles: options.config.presentation.pearls,
    })
    this.#effectPool = new M5EffectPool(
      options.scenario.effectPool.initialCapacity,
      options.scenario.effectPool.maximumCapacity,
    )
    const audioConfig = createM5AudioConfigFromPresentation(
      options.config.presentation,
    )
    this.#audio = new M5AudioDirector(
      audioConfig,
      createBrowserM5AudioBackend(globalThis, audioConfig.maxVoices),
    )
    this.#audioPendingStorageGrowthCount =
      this.#audio.runtimeStorageGrowthCount

    const flow = options.config.base.parameters.flowField
    this.#flow = new FireFlowField({
      geometry: {
        columns: flow.gridColumns,
        rows: flow.gridRows,
        cellSize: flow.cellSize,
        originX: 0,
        originY: 0,
      },
      solver: {
        circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
        lateralSpread: flow.lateralSpread,
        obstacleDeflection: flow.obstacleDeflection,
        partialObstaclePenalty: flow.partialObstaclePenalty,
        mergeRate: flow.mergeRate,
        fullObstacleThreshold: flow.fullObstacleThreshold,
      },
    })
    const sourceConfig =
      options.config.gameplay.fireSources.find((source) =>
        options.config.gameplay.prototype.availableFireSourceIds.includes(
          source.id,
        ),
      ) ?? options.config.gameplay.fireSources[0]!
    const direction = options.config.gameplay.prototype.initialFireDirection
    const directionLength = Math.max(0.001, Math.hypot(direction.x, direction.y))
    const sourceWidth =
      sourceConfig.minWidth +
      (sourceConfig.maxWidth - sourceConfig.minWidth) *
        (options.scenario.fireSize / 100)
    this.#flowInput = {
      tick: 0,
      source: {
        x: sourceConfig.origin.x,
        y: sourceConfig.origin.y,
        directionX: direction.x / directionLength,
        directionY: direction.y / directionLength,
        width: sourceWidth,
      },
      fullObstacles: new Uint8Array(flow.gridColumns * flow.gridRows),
      circles: EMPTY_CIRCLES,
    }
    this.#fireSource = {
      position: { x: sourceConfig.origin.x, y: sourceConfig.origin.y },
      direction: {
        x: direction.x / directionLength,
        y: direction.y / directionLength,
      },
      width: sourceWidth,
    }
    const fireConfig = fitFirePresentationConfig(
      options.fixture.protocol.viewportWidth,
      options.fixture.protocol.viewportHeight,
      createM5FirePresentationConfig(
        options.config.presentation,
        options.fixture.protocol.viewportWidth,
        options.fixture.protocol.viewportHeight,
      ),
    )
    this.#firePresentation = new FirePresentation(fireConfig)
    this.#fireHeatField = new FireHeatField(fireConfig.heatField)
    const maximumFrames =
      options.fixture.protocol.sampleSeconds *
      options.fixture.protocol.maximumRecordedFramesPerSecond
    const maximumEffectWindows = options.fixture.protocol.sampleSeconds
    this.#frameTimestamps = new Float64Array(maximumFrames)
    this.#frameDeltas = new Float64Array(Math.max(0, maximumFrames - 1))
    this.#frameAllocationTotals = new Uint32Array(maximumFrames)
    this.#frameAllocationByKind = {
      pearl: new Uint32Array(maximumFrames),
      effect: new Uint32Array(maximumFrames),
      fire: new Uint32Array(maximumFrames),
      localLight: new Uint32Array(maximumFrames),
      audio: new Uint32Array(maximumFrames),
    }
    this.#frameAllocationObservedMasks = new Uint8Array(maximumFrames)
    this.#effectSpawnCounts = new Uint32Array(
      maximumEffectWindows * REQUIRED_EFFECT_KINDS.length,
    )
    this.#effectRenderCounts = new Uint32Array(
      maximumEffectWindows * REQUIRED_EFFECT_KINDS.length,
    )
    this.#effectActiveHighWater = new Uint16Array(
      maximumEffectWindows * REQUIRED_EFFECT_KINDS.length,
    )
    this.#effectPoolCapacity = options.scenario.effectPool.initialCapacity
    this.#effectVisitor = (
      kind,
      x,
      y,
      secondaryX,
      secondaryY,
      progress,
      slotIndex,
    ) => {
      const graphics = this.#effectGraphics
      if (graphics === null) return
      drawM5Effect(
        graphics,
        options.config.gameplay.prototype.theme.colors,
        options.fixture.protocol.viewportWidth,
        options.fixture.protocol.viewportHeight,
        kind,
        x,
        y,
        secondaryX,
        secondaryY,
        progress,
        slotIndex,
      )
      this.#recordEffectRender(kind, this.#lastFrameTime)
    }
    const Observer = globalThis.PerformanceObserver
    this.#longTaskObserver =
      Observer === undefined ||
      !Observer.supportedEntryTypes.includes('longtask')
        ? null
        : new Observer((list) => {
            if (this.#samplingState !== 'sampling') return
            this.#recordLongTasks(list.getEntries())
          })
  }

  create(): void {
    const { viewportWidth: width, viewportHeight: height } =
      this.#options.fixture.protocol
    this.#baseGraphics = this.add.graphics().setDepth(0)
    this.#drawBenchmarkChamber(this.#baseGraphics, width, height)

    const initialFlow = this.#flow.update(this.#flowInput)
    this.#firePresentation.resetSteady(initialFlow, this.#fireSource)
    const heat = this.#fireHeatField.render(
      initialFlow,
      this.#firePresentation.particles,
      this.#fireSource,
    )
    const textureKey = `m5-visual-fire-${this.#scenario.id}`
    this.#fireTexture = this.textures.createCanvas(textureKey, heat.width, heat.height)
    if (this.#fireTexture === null) throw new Error('M5_VISUAL_FIRE_TEXTURE_UNAVAILABLE')
    this.#firePixels = new ImageData(heat.pixels, heat.width, heat.height)
    this.#fireImage = this.add
      .image(0, 0, textureKey)
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setDepth(1)
    this.#fireImage.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.#pearlGraphics = this.add.graphics().setDepth(2)
    this.#lightGraphics = this.add
      .graphics()
      .setDepth(4)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.#effectGraphics = this.add.graphics().setDepth(5)
    this.#pearlSpritePool = this.#createPearlSpritePool()
    this.#initializePearls(width, height)
    this.#longTaskObserver?.observe({ type: 'longtask', buffered: false })
    this.input.on('pointerdown', () => {
      void this.unlockAudio()
    })
    this.#audio.setFireActive(true, 0)
    this.#ready = true
    this.#publishCanvasEvidence()
    this.#options.onReady?.()
  }

  update(time: number): void {
    this.#allocationTracker.beginFrame()
    this.#currentFrameSequence += 1
    this.#currentFrameTimeMilliseconds = time
    this.#effectActiveThisFrame.fill(0)
    if (
      this.#samplingState === 'sampling' &&
      !Number.isFinite(this.#sampleStartMilliseconds)
    ) {
      this.#sampleStartMilliseconds = time
    }
    const deltaSeconds = Number.isFinite(this.#lastFrameTime)
      ? Math.max(0, Math.min(0.05, (time - this.#lastFrameTime) / 1_000))
      : 0
    this.#lastFrameTime = time
    const fixedFlowStep =
      1_000 / this.#options.config.base.parameters.simulation.fixedStepHz
    if (this.#nextFlowTime === 0) this.#nextFlowTime = time
    while (time >= this.#nextFlowTime) {
      this.#flowInput.tick += 1
      this.#flow.update(this.#flowInput)
      this.#nextFlowTime += fixedFlowStep
    }
    this.#updatePositions(time)
    this.#renderPearls(time)
    this.#spawnScheduledEffects(time)
    this.#renderEffects(time)
    this.#renderFire(time, deltaSeconds)
    this.#renderLocalLight(time)
    this.#updateAudio(time)
    this.#recordSampleFrame(time)
  }

  async unlockAudio(): Promise<void> {
    if (!this.#scenario.audio.enabled) return
    await this.#audio.unlock()
    this.#audio.setFireActive(true, this.#lastFrameTime || 0)
  }

  async enableAudioAudit(): Promise<void> {
    if (!this.#scenario.audio.enabled) return
    await this.#audio.unlock()
    this.#audio.setMuted(false)
    this.#audio.setFireActive(true, this.#lastFrameTime || 0)
  }

  startSample(durationMilliseconds: number): Promise<M5VisualPerformanceSample> {
    if (
      this.#samplingState === 'sampling' ||
      !isValidM5VisualSampleDuration(
        durationMilliseconds,
        this.#options.fixture.protocol.sampleSeconds * 1_000,
      )
    ) {
      return Promise.reject(new Error('M5_VISUAL_SAMPLE_REQUEST_INVALID'))
    }
    this.#samplingState = 'sampling'
    this.#sampleDurationMilliseconds = durationMilliseconds
    this.#sampleStartMilliseconds = Number.NaN
    this.#sampleFrameCount = 0
    this.#sampleLongTaskCount = 0
    this.#observedEffectMask = 0
    this.#effectSpawnCounts.fill(0)
    this.#effectRenderCounts.fill(0)
    this.#effectActiveHighWater.fill(0)
    this.#fireRenderedFrameCount = 0
    this.#minimumFireParticleCount = Number.MAX_SAFE_INTEGER
    this.#maximumFireParticleCount = 0
    this.#localLightRenderedFrameCount = 0
    this.#minimumLocalLightIntensity = Number.POSITIVE_INFINITY
    this.#maximumLocalLightIntensity = 0
    this.#fightRenderedFrameCount = 0
    this.#minimumFightGroupCount = Number.MAX_SAFE_INTEGER
    this.#maximumFightGroupCount = 0
    this.#effectPool.reset()
    this.#effectPoolCapacity = this.#effectPool.capacity
    const pearlSpritePool = this.#pearlSpritePool
    if (pearlSpritePool === null) {
      return Promise.reject(
        new Error('M5_VISUAL_PEARL_SPRITE_POOL_UNAVAILABLE'),
      )
    }
    this.#pearlSpritePoolGrowthCount =
      pearlSpritePool.runtimeStorageGrowthCount
    pearlSpritePool.resetFrameDiagnostics()
    this.#audio.reset()
    this.#audioPendingStorageGrowthCount =
      this.#audio.runtimeStorageGrowthCount
    this.#audioCueIndex = 0
    this.#nextAudioCueTime = Number.isFinite(this.#lastFrameTime)
      ? this.#lastFrameTime
      : 0
    this.#audio.setFireActive(true, this.#lastFrameTime || 0)
    this.#resetEffectRates(this.#lastFrameTime)
    this.#longTaskObserver?.takeRecords()
    return new Promise<M5VisualPerformanceSample>((resolve, reject) => {
      this.#samplePromise = { resolve, reject }
    })
  }

  getSnapshot(): M5VisualPerformanceSnapshot {
    return createM5VisualPerformanceSnapshot({
      ready: this.#ready,
      fixture: this.#options.fixture,
      scenario: this.#scenario,
      observedEffectKinds: this.#observedEffectKinds(),
      currentFrame: {
        frameSequence: this.#currentFrameSequence,
        frameTimeMilliseconds: this.#currentFrameTimeMilliseconds,
        fireParticleCount: this.#currentFireParticleCount,
        localLightIntensity: this.#currentLocalLightIntensity,
        pearlRenderCountByType: {
          medicinalLiquid: this.#pearlRenderCountThisFrame[0]!,
          slag: this.#pearlRenderCountThisFrame[1]!,
          impurity: this.#pearlRenderCountThisFrame[2]!,
        },
        effectCountByKind: {
          steam: {
            activeCount: this.#effectActiveThisFrame[0]!,
            renderCount: this.#effectActiveThisFrame[0]!,
          },
          shield: {
            activeCount: this.#effectActiveThisFrame[1]!,
            renderCount: this.#effectActiveThisFrame[1]!,
          },
          damage: {
            activeCount: this.#effectActiveThisFrame[2]!,
            renderCount: this.#effectActiveThisFrame[2]!,
          },
          fight: {
            activeCount: this.#effectActiveThisFrame[3]!,
            renderCount: this.#effectActiveThisFrame[3]!,
          },
        },
      },
      effectPool: this.#effectPool.getDiagnostics(),
      audio: this.#audio.getDiagnostics(),
      trackedFrameAllocationCount: this.#allocationTracker.total,
      samplingState: this.#samplingState,
      sampledFrameCount: this.#sampleFrameCount,
      simulationContentFingerprint:
        this.#options.simulationContentFingerprint,
      presentationContentFingerprint:
        this.#options.presentationContentFingerprint,
    })
  }

  destroyRuntime(): void {
    this.#longTaskObserver?.disconnect()
    this.#samplePromise?.reject(new Error('M5_VISUAL_SAMPLE_DESTROYED'))
    this.#samplePromise = null
    this.#pearlSpritePool?.destroy()
    this.#pearlSpritePool = null
    void this.#audio.destroy()
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
        const graphics = this.make.graphics({
          x: 0,
          y: 0,
        })
        try {
          draw(graphics, size / 2)
          graphics.generateTexture(key, size, size)
        } finally {
          graphics.destroy()
        }
      },
      createSprite: (textureKey, depth) =>
        this.add.image(0, 0, textureKey).setDepth(depth),
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
    return new M5PearlSpritePool(host, this.#pearlRenderer, {
      textureNamespace: `m5-formal-pearl-${this.#scenario.id}`,
      capacity: this.#scenario.activePearlCount,
      depth: 3,
    })
  }

  #initializePearls(width: number, height: number): void {
    const spritePool = this.#pearlSpritePool
    if (spritePool === null) {
      throw new Error('M5_VISUAL_PEARL_SPRITE_POOL_UNAVAILABLE')
    }
    const count = this.#scenario.activePearlCount
    const columns = Math.max(1, Math.ceil(Math.sqrt((count * width) / height)))
    const rows = Math.max(1, Math.ceil(count / columns))
    const marginX = 42
    const marginY = 60
    for (let index = 0; index < count; index += 1) {
      const type = choosePearlType(
        deterministicUnit(index, this.#scenario.seed),
        this.#scenario.pearlTypeWeights,
      )
      const typeIndex = PEARL_TYPES.indexOf(type)
      const pearlConfig = this.#options.config.gameplay.pearlTypes.find(
        (candidate) => candidate.pearlType === type,
      )!
      const column = index % columns
      const row = Math.floor(index / columns)
      const jitterX =
        (deterministicUnit(index, this.#scenario.seed ^ 0x9e37_79b9) - 0.5) * 9
      const jitterY =
        (deterministicUnit(index, this.#scenario.seed ^ 0x85eb_ca6b) - 0.5) * 7
      const x =
        columns === 1
          ? width / 2
          : marginX + (column / (columns - 1)) * (width - marginX * 2) + jitterX
      const y =
        rows === 1
          ? height / 2
          : marginY + (row / (rows - 1)) * (height - marginY * 2) + jitterY
      this.#types[index] = typeIndex
      this.#baseX[index] = x
      this.#baseY[index] = y
      this.#x[index] = x
      this.#y[index] = y
      this.#radius[index] = pearlConfig.standardRadius
      this.#motionPhase[index] =
        deterministicUnit(index, this.#scenario.seed ^ 0xc2b2_ae35) * Math.PI * 2
      this.#pearlRenderer.prewarm(
        this.#ids[index]!,
        type,
        pearlConfig.standardRadius,
      )
      spritePool.prewarm(index, {
        pearlId: this.#ids[index]!,
        pearlType: type,
        sourceMaterialDefinitionId:
          this.#materialIds[index % this.#materialIds.length]!,
        radius: pearlConfig.standardRadius,
      })
    }
    for (let group = 0; group < this.#interactionA.length; group += 1) {
      const first = Math.floor((group * count) / this.#interactionA.length)
      this.#interactionA[group] = first
      this.#interactionB[group] = (first + Math.max(1, Math.floor(count / 3))) % count
    }
    spritePool.seal()
    this.#pearlSpritePoolGrowthCount =
      spritePool.runtimeStorageGrowthCount
    this.#pearlRenderer.beginFrame()
    this.#spawnRequiredEffects(0)
  }

  #updatePositions(time: number): void {
    const seconds = time / 1_000
    const motion = this.#scenario.motion
    for (let index = 0; index < this.#x.length; index += 1) {
      const phase = this.#motionPhase[index]!
      this.#x[index] =
        this.#baseX[index]! +
        Math.sin(seconds * motion.cyclesPerSecond * Math.PI * 2 + phase) *
          motion.horizontalAmplitudePixels
      this.#y[index] =
        this.#baseY[index]! +
        Math.cos(seconds * motion.cyclesPerSecond * Math.PI * 2 + phase * 1.31) *
          motion.verticalAmplitudePixels
    }
  }

  #renderPearls(time: number): void {
    this.#allocationTracker.markPath('pearl')
    const graphics = this.#pearlGraphics
    const spritePool = this.#pearlSpritePool
    if (graphics === null || spritePool === null) return
    graphics.clear()
    this.#pearlRenderCountThisFrame.fill(0)
    this.#pearlRenderer.beginFrame()
    spritePool.beginFrame()
    const danger = m5ColorNumber(
      this.#options.config.gameplay.prototype.theme.colors.danger,
    )
    graphics.lineStyle(3, danger, 0.68)
    for (let group = 0; group < this.#interactionA.length; group += 1) {
      const a = this.#interactionA[group]!
      const b = this.#interactionB[group]!
      graphics.lineBetween(this.#x[a]!, this.#y[a]!, this.#x[b]!, this.#y[b]!)
    }
    this.#recordFightGroups(time, this.#interactionA.length)
    for (let index = 0; index < this.#x.length; index += 1) {
      this.#pearlRenderCountThisFrame[this.#types[index]!] += 1
      spritePool.render(
        index,
        this.#x[index]!,
        this.#y[index]!,
        this.#radius[index]!,
        1,
        time,
        true,
      )
    }
    spritePool.endFrame(this.#sampleSecondIndex(time) >= 0)
    const spritePoolGrowthCount = spritePool.runtimeStorageGrowthCount
    this.#allocationTracker.recordAllocation(
      'pearl',
      this.#pearlRenderer.trackedFrameAllocationCount +
        Math.max(
          0,
          spritePoolGrowthCount - this.#pearlSpritePoolGrowthCount,
        ),
    )
    this.#pearlSpritePoolGrowthCount = spritePoolGrowthCount
  }

  #spawnScheduledEffects(time: number): void {
    this.#allocationTracker.markPath('effect')
    const schedule = this.#scenario.effectSchedule
    this.#spawnEffectCount('steam', this.#steamRate.sample(schedule.steamPerSecond, time), time)
    this.#spawnEffectCount('shield', this.#shieldRate.sample(schedule.shieldPerSecond, time), time)
    this.#spawnEffectCount('damage', this.#damageRate.sample(schedule.damagePerSecond, time), time)
    this.#spawnEffectCount('fight', this.#fightRate.sample(schedule.fightPerSecond, time), time)
  }

  #spawnEffectCount(
    kind: M5VisualPerformanceEffectKind,
    count: number,
    time: number,
  ): void {
    for (let emission = 0; emission < count; emission += 1) {
      this.#spawnEffect(kind, time)
    }
  }

  #spawnEffect(kind: M5VisualPerformanceEffectKind, time: number): void {
    const first = this.#effectSequence % this.#x.length
    const group = this.#effectSequence % this.#interactionA.length
    const second =
      kind === 'fight' ? this.#interactionB[group]! : first
    this.#effectAnchor.x = this.#x[first]!
    this.#effectAnchor.y = this.#y[first]!
    this.#effectAnchor.secondaryX = this.#x[second]!
    this.#effectAnchor.secondaryY = this.#y[second]!
    const spawned = this.#effectPool.spawn(
      kind as M5EffectKind,
      this.#effectAnchor,
      Number.isFinite(time) ? time : 0,
      effectDurationMilliseconds(kind, this.#options.config.presentation),
    )
    if (spawned) this.#recordEffectSpawn(kind, time)
    this.#effectSequence += 1
  }

  #spawnRequiredEffects(time: number): void {
    for (const kind of this.#scenario.requiredEffectKinds) {
      this.#spawnEffect(kind, Number.isFinite(time) ? time : 0)
    }
  }

  #resetEffectRates(time: number): void {
    const timestamp = Number.isFinite(time) ? time : Number.NaN
    this.#steamRate.reset(timestamp)
    this.#shieldRate.reset(timestamp)
    this.#damageRate.reset(timestamp)
    this.#fightRate.reset(timestamp)
  }

  #renderEffects(time: number): void {
    this.#allocationTracker.markPath('effect')
    const graphics = this.#effectGraphics
    if (graphics === null) return
    graphics.clear()
    this.#effectPool.forEachActive(time, this.#effectVisitor)
    const capacity = this.#effectPool.capacity
    if (capacity > this.#effectPoolCapacity) {
      this.#allocationTracker.recordAllocation(
        'effect',
        capacity - this.#effectPoolCapacity,
      )
    }
    this.#effectPoolCapacity = capacity
  }

  #renderFire(time: number, deltaSeconds: number): void {
    this.#allocationTracker.markPath('fire')
    const pixels = this.#firePixels
    const texture = this.#fireTexture
    if (pixels === null || texture === null) return
    const view = this.#flow.read()
    this.#firePresentation.advance(view, this.#fireSource, deltaSeconds)
    const frame = this.#fireHeatField.render(
      view,
      this.#firePresentation.particles,
      this.#fireSource,
    )
    pixels.data.set(frame.pixels)
    texture.context.putImageData(pixels, 0, 0)
    texture.refresh()
    this.#recordFirePresentation(
      time,
      this.#firePresentation.particles.count,
    )
  }

  #renderLocalLight(time: number): void {
    this.#allocationTracker.markPath('localLight')
    const graphics = this.#lightGraphics
    if (graphics === null) return
    const intensity = drawM5LocalLight(
      graphics,
      this.#options.config.presentation,
      this.#fireSource,
      this.#scenario.fireSize,
      1,
    )
    this.#recordLocalLightPresentation(time, intensity)
  }

  #updateAudio(time: number): void {
    this.#allocationTracker.markPath('audio')
    if (this.#scenario.audio.enabled && time >= this.#nextAudioCueTime) {
      const cueIndex = this.#audioCueIndex % AUDIO_CUES.length
      const cue = AUDIO_CUES[cueIndex]!
      this.#audio.emit(cue, time)
      this.#audioCueIndex += 1
      this.#nextAudioCueTime =
        time + this.#scenario.audio.cueIntervalMilliseconds
    }
    this.#audio.update(time)
    const storageGrowthCount =
      this.#audio.runtimeStorageGrowthCount
    if (storageGrowthCount > this.#audioPendingStorageGrowthCount) {
      this.#allocationTracker.recordAllocation(
        'audio',
        storageGrowthCount - this.#audioPendingStorageGrowthCount,
      )
    }
    this.#audioPendingStorageGrowthCount = storageGrowthCount
  }

  #sampleSecondIndex(time: number): number {
    if (
      this.#samplingState !== 'sampling' ||
      !Number.isFinite(this.#sampleStartMilliseconds)
    ) {
      return -1
    }
    const elapsed = time - this.#sampleStartMilliseconds
    if (elapsed < 0 || elapsed >= this.#sampleDurationMilliseconds) return -1
    return Math.floor(elapsed / 1_000)
  }

  #effectMetricOffset(
    time: number,
    kind: M5VisualPerformanceEffectKind,
  ): number {
    const secondIndex = this.#sampleSecondIndex(time)
    if (secondIndex < 0) return -1
    return (
      secondIndex * REQUIRED_EFFECT_KINDS.length +
      REQUIRED_EFFECT_KINDS.indexOf(kind)
    )
  }

  #recordEffectSpawn(
    kind: M5VisualPerformanceEffectKind,
    time: number,
  ): void {
    const offset = this.#effectMetricOffset(time, kind)
    if (offset < 0) return
    this.#effectSpawnCounts[offset] += 1
    this.#observedEffectMask |= effectBit(kind)
  }

  #recordEffectRender(kind: M5EffectKind, time: number): void {
    if (
      kind !== 'steam' &&
      kind !== 'shield' &&
      kind !== 'damage' &&
      kind !== 'fight'
    ) {
      return
    }
    const kindIndex = REQUIRED_EFFECT_KINDS.indexOf(kind)
    this.#effectActiveThisFrame[kindIndex] += 1
    const offset = this.#effectMetricOffset(time, kind)
    if (offset < 0) return
    this.#effectRenderCounts[offset] += 1
    this.#effectActiveHighWater[offset] = Math.max(
      this.#effectActiveHighWater[offset]!,
      this.#effectActiveThisFrame[kindIndex]!,
    )
    this.#observedEffectMask |= effectBit(kind)
  }

  #recordFirePresentation(time: number, particleCount: number): void {
    this.#currentFireParticleCount = particleCount
    if (this.#sampleSecondIndex(time) < 0) return
    this.#fireRenderedFrameCount += 1
    this.#minimumFireParticleCount = Math.min(
      this.#minimumFireParticleCount,
      particleCount,
    )
    this.#maximumFireParticleCount = Math.max(
      this.#maximumFireParticleCount,
      particleCount,
    )
  }

  #recordLocalLightPresentation(time: number, intensity: number): void {
    this.#currentLocalLightIntensity = intensity
    if (this.#sampleSecondIndex(time) < 0) return
    this.#localLightRenderedFrameCount += 1
    this.#minimumLocalLightIntensity = Math.min(
      this.#minimumLocalLightIntensity,
      intensity,
    )
    this.#maximumLocalLightIntensity = Math.max(
      this.#maximumLocalLightIntensity,
      intensity,
    )
  }

  #recordFightGroups(time: number, renderedGroupCount: number): void {
    if (this.#sampleSecondIndex(time) < 0) return
    this.#fightRenderedFrameCount += 1
    this.#minimumFightGroupCount = Math.min(
      this.#minimumFightGroupCount,
      renderedGroupCount,
    )
    this.#maximumFightGroupCount = Math.max(
      this.#maximumFightGroupCount,
      renderedGroupCount,
    )
  }

  #recordSampleFrame(time: number): void {
    if (this.#samplingState !== 'sampling') return
    const end =
      this.#sampleStartMilliseconds + this.#sampleDurationMilliseconds
    if (time >= end) {
      this.#completeSample()
      return
    }
    if (this.#sampleFrameCount >= this.#frameTimestamps.length) {
      this.#failSample(new Error('M5_VISUAL_SAMPLE_FRAME_BUFFER_OVERFLOW'))
      return
    }
    const index = this.#sampleFrameCount
    this.#frameTimestamps[index] = time
    if (index > 0) {
      this.#frameDeltas[index - 1] = time - this.#frameTimestamps[index - 1]!
    }
    this.#frameAllocationTotals[index] = this.#allocationTracker.total
    let observedMask = 0
    for (
      let kindIndex = 0;
      kindIndex < M5_APP_ALLOCATION_KINDS.length;
      kindIndex += 1
    ) {
      const kind = M5_APP_ALLOCATION_KINDS[kindIndex]!
      this.#frameAllocationByKind[kind][index] =
        this.#allocationTracker.count(kind)
      if (this.#allocationTracker.hasObserved(kind)) {
        observedMask |= 1 << kindIndex
      }
    }
    this.#frameAllocationObservedMasks[index] = observedMask
    this.#sampleFrameCount += 1
  }

  #completeSample(): void {
    const promise = this.#samplePromise
    if (promise === null) return
    this.#recordLongTasks(this.#longTaskObserver?.takeRecords() ?? [])
    const frameTimestamps = Array.from(
      this.#frameTimestamps.subarray(0, this.#sampleFrameCount),
    )
    const frameDeltasMilliseconds = Array.from(
      this.#frameDeltas.subarray(0, Math.max(0, this.#sampleFrameCount - 1)),
    )
    const frameAllocationEvidence: M5FrameAllocationEvidence[] = Array.from(
      { length: this.#sampleFrameCount },
      (_, index) => ({
        total: this.#frameAllocationTotals[index]!,
        byKind: {
          pearl: this.#frameAllocationByKind.pearl[index]!,
          effect: this.#frameAllocationByKind.effect[index]!,
          fire: this.#frameAllocationByKind.fire[index]!,
          localLight: this.#frameAllocationByKind.localLight[index]!,
          audio: this.#frameAllocationByKind.audio[index]!,
        },
        observedKinds: M5_APP_ALLOCATION_KINDS.filter(
          (_, kindIndex) =>
            (this.#frameAllocationObservedMasks[index]! &
              (1 << kindIndex)) !==
            0,
        ),
      }),
    )
    const effectSeconds: M5VisualEffectSecondEvidence[] = Array.from(
      { length: this.#sampleDurationMilliseconds / 1_000 },
      (_, secondIndex) => {
        const counters = (
          kind: M5VisualPerformanceEffectKind,
        ): Readonly<{
          spawnCount: number
          renderCount: number
          activeHighWater: number
        }> => {
          const offset =
            secondIndex * REQUIRED_EFFECT_KINDS.length +
            REQUIRED_EFFECT_KINDS.indexOf(kind)
          return {
            spawnCount: this.#effectSpawnCounts[offset]!,
            renderCount: this.#effectRenderCounts[offset]!,
            activeHighWater: this.#effectActiveHighWater[offset]!,
          }
        }
        return {
          secondIndex,
          byKind: {
            steam: counters('steam'),
            shield: counters('shield'),
            damage: counters('damage'),
            fight: counters('fight'),
          },
        }
      },
    )
    const longTasks: M5VisualLongTask[] = Array.from(
      { length: this.#sampleLongTaskCount },
      (_, index) => ({
        startTimeMilliseconds: this.#longTaskStarts[index]!,
        durationMilliseconds: this.#longTaskDurations[index]!,
      }),
    )
    const audio = this.#audio.getDiagnostics()
    const pearlSpritePool = this.#pearlSpritePool
    if (pearlSpritePool === null) {
      this.#failSample(
        new Error('M5_VISUAL_PEARL_SPRITE_POOL_UNAVAILABLE'),
      )
      return
    }
    this.#samplingState = 'complete'
    this.#samplePromise = null
    promise.resolve({
      scenarioId: this.#scenario.id,
      sampleStartMilliseconds: this.#sampleStartMilliseconds,
      sampleDurationMilliseconds: this.#sampleDurationMilliseconds,
      frameTimestamps,
      frameDeltasMilliseconds,
      longTasks,
      activePearlCount: this.#scenario.activePearlCount,
      interactionGroupCount: this.#scenario.interactionGroupCount,
      observedEffectKinds: this.#observedEffectKinds(),
      effectPool: this.#effectPool.getDiagnostics(),
      audioVoiceHighWaterMark: audio.voiceHighWaterMark,
      pearlSpritePool: pearlSpritePool.getDiagnostics(),
      effectSeconds,
      presentationEvidence: {
        fire: {
          renderedFrameCount: this.#fireRenderedFrameCount,
          minimumParticleCount:
            this.#minimumFireParticleCount === Number.MAX_SAFE_INTEGER
              ? 0
              : this.#minimumFireParticleCount,
          maximumParticleCount: this.#maximumFireParticleCount,
        },
        localLight: {
          renderedFrameCount: this.#localLightRenderedFrameCount,
          minimumIntensity: Number.isFinite(
            this.#minimumLocalLightIntensity,
          )
            ? this.#minimumLocalLightIntensity
            : 0,
          maximumIntensity: this.#maximumLocalLightIntensity,
        },
        fight: {
          renderedFrameCount: this.#fightRenderedFrameCount,
          minimumRenderedGroupCount:
            this.#minimumFightGroupCount === Number.MAX_SAFE_INTEGER
              ? 0
              : this.#minimumFightGroupCount,
          maximumRenderedGroupCount: this.#maximumFightGroupCount,
        },
      },
      frameAllocationEvidence,
      allocationCoverage: M5_APP_ALLOCATION_COVERAGE,
    })
  }

  #failSample(error: Error): void {
    const promise = this.#samplePromise
    this.#samplingState = 'idle'
    this.#samplePromise = null
    promise?.reject(error)
  }

  #recordLongTasks(entries: readonly PerformanceEntry[]): void {
    if (!Number.isFinite(this.#sampleStartMilliseconds)) return
    const sampleEnd =
      this.#sampleStartMilliseconds + this.#sampleDurationMilliseconds
    for (const entry of entries) {
      if (
        entry.startTime < this.#sampleStartMilliseconds ||
        entry.startTime >= sampleEnd
      ) {
        continue
      }
      if (this.#sampleLongTaskCount >= this.#longTaskStarts.length) break
      this.#longTaskStarts[this.#sampleLongTaskCount] = entry.startTime
      this.#longTaskDurations[this.#sampleLongTaskCount] = entry.duration
      this.#sampleLongTaskCount += 1
    }
  }

  #observedEffectKinds(): M5VisualPerformanceEffectKind[] {
    return REQUIRED_EFFECT_KINDS.filter(
      (kind) => (this.#observedEffectMask & effectBit(kind)) !== 0,
    )
  }

  #drawBenchmarkChamber(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
  ): void {
    const theme = this.#options.config.gameplay.prototype.theme.colors
    graphics.fillStyle(m5ColorNumber(theme.background), 1)
    graphics.fillRect(0, 0, width, height)
    graphics.fillStyle(m5ColorNumber(theme.surface), 0.94)
    graphics.fillRoundedRect(18, 18, width - 36, height - 36, 28)
    graphics.lineStyle(2, m5ColorNumber(theme.border), 0.72)
    graphics.strokeRoundedRect(18, 18, width - 36, height - 36, 28)
    graphics.fillStyle(m5ColorNumber(theme.surfaceRaised), 0.72)
    graphics.fillEllipse(width / 2, height - 24, 480, 88)
    graphics.lineStyle(5, m5ColorNumber(theme.accent), 0.56)
    graphics.strokeEllipse(width / 2, height - 24, 480, 88)
  }

  #publishCanvasEvidence(): void {
    const dataset = this.game.canvas.dataset
    dataset.game = 'liandan'
    dataset.scene = 'm5-visual-performance'
    dataset.benchmarkKind = 'presentation-only'
    dataset.scenario = this.#scenario.id
    dataset.activePearlCount = String(this.#scenario.activePearlCount)
    dataset.interactionGroupCount = String(this.#scenario.interactionGroupCount)
    dataset.fireSize = String(this.#scenario.fireSize)
    dataset.fireRenderer = 'm5-heat-field'
    dataset.pearlRenderer = 'm5-shape-motion-surface'
    dataset.pearlBatchRenderer = 'm5-formal-sprite-pool'
    dataset.effectRenderer = 'm5-effect-pool'
    dataset.localLightRenderer = 'm5-local-light'
    dataset.proxyPearls = 'false'
    dataset.automaticQualityReduction = 'false'
    dataset.simulationContentFingerprint =
      this.#options.simulationContentFingerprint
    dataset.presentationContentFingerprint =
      this.#options.presentationContentFingerprint
  }
}
