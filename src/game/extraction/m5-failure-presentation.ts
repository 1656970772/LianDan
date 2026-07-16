import type {
  ExtractionCollectorReadView,
  ExtractionMaterialReadView,
  ExtractionPearlReadView,
} from '../../simulation/index.ts'
import { deriveMaterialContentRectangle } from '../../shared/material-content-geometry.ts'

export type M5FailurePresentationState =
  | 'idle'
  | 'charring'
  | 'shattering'
  | 'gathering'
  | 'flying'
  | 'result'

export type M5FailurePhaseConfig = Readonly<{
  shatteringStartRatio: number
  gatheringStartRatio: number
  flyingStartRatio: number
}>

export type M5FailurePresentationConfig = M5FailurePhaseConfig &
  Readonly<{
    shardsPerSource: number
    maximumParticleCount: number
    scatterRadiusPixels: number
    particleRadiusPixels: number
    resultRadiusPixels: number
    furnaceBottomAnchor: Readonly<{ xRatio: number; yRatio: number }>
    resultAnchor: Readonly<{ xRatio: number; yRatio: number }>
  }>

export type M5FailureSourceKind =
  | 'material'
  | 'activePearl'
  | 'caughtPearl'

export type M5FailureSource = Readonly<{
  sourceId: string
  entityId: string
  kind: M5FailureSourceKind
  origin: Readonly<{ x: number; y: number }>
  radius: number
}>

export type M5FailureSourceVisual = Readonly<{
  sourceId: string
  kind: M5FailureSourceKind
  charred: boolean
  visible: boolean
  alpha: number
}>

export type M5FailureParticle = Readonly<{
  particleId: string
  sourceId: string
  position: Readonly<{ x: number; y: number }>
  radius: number
}>

export type M5FailureFrame = Readonly<{
  state: M5FailurePresentationState
  progress: number
  sources: readonly M5FailureSource[]
  sourceVisuals: readonly M5FailureSourceVisual[]
  particles: readonly M5FailureParticle[]
  result: Readonly<{
    visible: boolean
    position: Readonly<{ x: number; y: number }>
    radius: number
  }>
}>

export type M5FailureCaptureInput = Readonly<{
  logicalWidth: number
  logicalHeight: number
  materials: readonly ExtractionMaterialReadView[]
  pearls: readonly ExtractionPearlReadView[]
  collector: ExtractionCollectorReadView
}>

const EMPTY_FAILURE_SOURCES: readonly M5FailureSource[] = Object.freeze([])
const EMPTY_FAILURE_VISUALS: readonly M5FailureSourceVisual[] = Object.freeze([])
const EMPTY_FAILURE_PARTICLES: readonly M5FailureParticle[] = Object.freeze([])

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function point(
  x: number,
  y: number,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x, y })
}

function requireFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new RangeError(code)
}

export function assertM5FailurePhaseConfig(
  config: M5FailurePhaseConfig,
): void {
  requireFinite(config.shatteringStartRatio, 'M5_FAILURE_PHASE_INVALID')
  requireFinite(config.gatheringStartRatio, 'M5_FAILURE_PHASE_INVALID')
  requireFinite(config.flyingStartRatio, 'M5_FAILURE_PHASE_INVALID')
  if (
    config.shatteringStartRatio <= 0 ||
    config.shatteringStartRatio >= config.gatheringStartRatio ||
    config.gatheringStartRatio >= config.flyingStartRatio ||
    config.flyingStartRatio >= 1
  ) {
    throw new RangeError('M5_FAILURE_PHASE_INVALID')
  }
}

function assertConfig(config: M5FailurePresentationConfig): void {
  assertM5FailurePhaseConfig(config)
  if (
    !Number.isInteger(config.shardsPerSource) ||
    config.shardsPerSource < 1 ||
    !Number.isInteger(config.maximumParticleCount) ||
    config.maximumParticleCount < 1
  ) {
    throw new RangeError('M5_FAILURE_PARTICLE_COUNT_INVALID')
  }
  for (const [value, code] of [
    [config.scatterRadiusPixels, 'M5_FAILURE_SCATTER_RADIUS_INVALID'],
    [config.particleRadiusPixels, 'M5_FAILURE_PARTICLE_RADIUS_INVALID'],
    [config.resultRadiusPixels, 'M5_FAILURE_RESULT_RADIUS_INVALID'],
  ] as const) {
    requireFinite(value, code)
    if (value < (code === 'M5_FAILURE_SCATTER_RADIUS_INVALID' ? 0 : Number.EPSILON)) {
      throw new RangeError(code)
    }
  }
  for (const anchor of [config.furnaceBottomAnchor, config.resultAnchor]) {
    requireFinite(anchor.xRatio, 'M5_FAILURE_ANCHOR_INVALID')
    requireFinite(anchor.yRatio, 'M5_FAILURE_ANCHOR_INVALID')
    if (
      anchor.xRatio < 0 ||
      anchor.xRatio > 1 ||
      anchor.yRatio < 0 ||
      anchor.yRatio > 1
    ) {
      throw new RangeError('M5_FAILURE_ANCHOR_INVALID')
    }
  }
}

export function deriveM5FailureState(
  progress: number,
  phases: M5FailurePhaseConfig,
): M5FailurePresentationState {
  const normalized = clampUnit(progress)
  if (normalized >= 1) return 'result'
  if (normalized >= phases.flyingStartRatio) return 'flying'
  if (normalized >= phases.gatheringStartRatio) return 'gathering'
  if (normalized >= phases.shatteringStartRatio) return 'shattering'
  return 'charring'
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function sourceFromMaterial(material: ExtractionMaterialReadView): M5FailureSource {
  const content = deriveMaterialContentRectangle(
    material.placement,
    material.composition,
  )
  return Object.freeze({
    sourceId: `material:${material.materialInstanceId}`,
    entityId: material.materialInstanceId,
    kind: 'material' as const,
    origin: point(content.center.x, content.center.y),
    radius: Math.max(content.width, content.height) / 2,
  })
}

function sourceFromPearl(
  pearl: ExtractionPearlReadView,
  collector: ExtractionCollectorReadView,
): M5FailureSource {
  const caught = pearl.state === 'caught'
  return Object.freeze({
    sourceId: `${caught ? 'caught-pearl' : 'active-pearl'}:${pearl.pearlId}`,
    entityId: pearl.pearlId,
    kind: caught ? ('caughtPearl' as const) : ('activePearl' as const),
    origin: caught
      ? point(collector.center.x, collector.center.y)
      : point(pearl.position.x, pearl.position.y),
    radius: pearl.radius,
  })
}

function sortByStableId<T>(
  items: readonly T[],
  id: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => {
    const leftId = id(left)
    const rightId = id(right)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

/**
 * Captures the terminal failure view once and derives deterministic presentation
 * frames without mutating simulation or domain settlement state.
 */
export class M5FailurePresentation {
  readonly #config: M5FailurePresentationConfig
  readonly #reducedMotion: boolean
  #sessionId: string | null = null
  #captured = false
  #sources: readonly M5FailureSource[] = EMPTY_FAILURE_SOURCES
  #furnaceBottom = point(0, 0)
  #resultAnchor = point(0, 0)
  #resultFrame: M5FailureFrame | null = null

  constructor(
    config: M5FailurePresentationConfig,
    options: Readonly<{ reducedMotion?: boolean }> = {},
  ) {
    assertConfig(config)
    this.#config = config
    this.#reducedMotion = options.reducedMotion ?? false
  }

  resetSession(sessionId: string): M5FailureFrame {
    if (sessionId.trim().length === 0) {
      throw new TypeError('M5_FAILURE_SESSION_ID_INVALID')
    }
    this.#sessionId = sessionId
    this.#captured = false
    this.#sources = EMPTY_FAILURE_SOURCES
    this.#furnaceBottom = point(0, 0)
    this.#resultAnchor = point(0, 0)
    this.#resultFrame = null
    return this.#idleFrame()
  }

  captureSources(
    sessionId: string,
    input: M5FailureCaptureInput,
  ): readonly M5FailureSource[] {
    if (sessionId !== this.#sessionId) return EMPTY_FAILURE_SOURCES
    if (this.#captured) return this.#sources
    requireFinite(input.logicalWidth, 'M5_FAILURE_VIEWPORT_INVALID')
    requireFinite(input.logicalHeight, 'M5_FAILURE_VIEWPORT_INVALID')
    if (input.logicalWidth <= 0 || input.logicalHeight <= 0) {
      throw new RangeError('M5_FAILURE_VIEWPORT_INVALID')
    }
    const materials = sortByStableId(
      input.materials.filter(({ remainingVolume }) => remainingVolume > 0),
      ({ materialInstanceId }) => materialInstanceId,
    ).map(sourceFromMaterial)
    const activePearls = sortByStableId(
      input.pearls.filter(({ state }) => state === 'active'),
      ({ pearlId }) => pearlId,
    ).map((pearl) => sourceFromPearl(pearl, input.collector))
    const caughtPearls = sortByStableId(
      input.pearls.filter(({ state }) => state === 'caught'),
      ({ pearlId }) => pearlId,
    ).map((pearl) => sourceFromPearl(pearl, input.collector))
    this.#sources = Object.freeze([
      ...materials,
      ...activePearls,
      ...caughtPearls,
    ])
    this.#furnaceBottom = point(
      input.logicalWidth * this.#config.furnaceBottomAnchor.xRatio,
      input.logicalHeight * this.#config.furnaceBottomAnchor.yRatio,
    )
    this.#resultAnchor = point(
      input.logicalWidth * this.#config.resultAnchor.xRatio,
      input.logicalHeight * this.#config.resultAnchor.yRatio,
    )
    this.#captured = true
    return this.#sources
  }

  getSources(sessionId: string): readonly M5FailureSource[] {
    return sessionId === this.#sessionId ? this.#sources : EMPTY_FAILURE_SOURCES
  }

  frame(sessionId: string, progress: number): M5FailureFrame | null {
    if (sessionId !== this.#sessionId) return null
    const normalizedProgress = clampUnit(progress)
    if (normalizedProgress >= 1 && this.#resultFrame !== null) {
      return this.#resultFrame
    }
    const state = deriveM5FailureState(normalizedProgress, this.#config)
    const sourceVisuals = this.#createSourceVisuals(state, normalizedProgress)
    const particles = this.#createParticles(state, normalizedProgress)
    const resultPosition = this.#resultPosition(state, normalizedProgress)
    const frame: M5FailureFrame = Object.freeze({
      state,
      progress: normalizedProgress,
      sources: this.#sources,
      sourceVisuals,
      particles,
      result: Object.freeze({
        visible: state === 'flying' || state === 'result',
        position: resultPosition,
        radius: this.#config.resultRadiusPixels,
      }),
    })
    if (state === 'result') this.#resultFrame = frame
    return frame
  }

  #idleFrame(): M5FailureFrame {
    return Object.freeze({
      state: 'idle',
      progress: 0,
      sources: EMPTY_FAILURE_SOURCES,
      sourceVisuals: EMPTY_FAILURE_VISUALS,
      particles: EMPTY_FAILURE_PARTICLES,
      result: Object.freeze({
        visible: false,
        position: this.#resultAnchor,
        radius: this.#config.resultRadiusPixels,
      }),
    })
  }

  #createSourceVisuals(
    state: M5FailurePresentationState,
    progress: number,
  ): readonly M5FailureSourceVisual[] {
    let alpha = 0
    if (state === 'charring') {
      const local = progress / this.#config.shatteringStartRatio
      alpha = 1 - clampUnit(local) * 0.35
    } else if (state === 'shattering') {
      const local =
        (progress - this.#config.shatteringStartRatio) /
        (this.#config.gatheringStartRatio -
          this.#config.shatteringStartRatio)
      alpha = 0.65 * (1 - clampUnit(local))
    }
    return Object.freeze(
      this.#sources.map((source) =>
        Object.freeze({
          sourceId: source.sourceId,
          kind: source.kind,
          charred: true,
          visible: alpha > 0,
          alpha,
        }),
      ),
    )
  }

  #createParticles(
    state: M5FailurePresentationState,
    progress: number,
  ): readonly M5FailureParticle[] {
    if (state === 'charring' || state === 'result') {
      return EMPTY_FAILURE_PARTICLES
    }
    const output: M5FailureParticle[] = []
    for (const source of this.#sources) {
      for (
        let shard = 0;
        shard < this.#config.shardsPerSource &&
        output.length < this.#config.maximumParticleCount;
        shard += 1
      ) {
        const particleId = `${source.sourceId}:shard:${shard}`
        output.push(
          Object.freeze({
            particleId,
            sourceId: source.sourceId,
            position: this.#particlePosition(source, particleId, state, progress),
            radius: this.#config.particleRadiusPixels,
          }),
        )
      }
      if (output.length >= this.#config.maximumParticleCount) break
    }
    return Object.freeze(output)
  }

  #particlePosition(
    source: M5FailureSource,
    particleId: string,
    state: M5FailurePresentationState,
    progress: number,
  ): Readonly<{ x: number; y: number }> {
    const hash = stableHash(particleId)
    const angle = ((hash % 65_536) / 65_536) * Math.PI * 2
    const distanceScale = 0.55 + ((hash >>> 16) % 1_000) / 2_222
    const scatterDistance = this.#reducedMotion
      ? 0
      : this.#config.scatterRadiusPixels * distanceScale
    const scattered = point(
      source.origin.x + Math.cos(angle) * scatterDistance,
      source.origin.y + Math.sin(angle) * scatterDistance,
    )
    if (state === 'shattering') {
      const local = clampUnit(
        (progress - this.#config.shatteringStartRatio) /
          (this.#config.gatheringStartRatio -
            this.#config.shatteringStartRatio),
      )
      return point(
        interpolate(source.origin.x, scattered.x, local),
        interpolate(source.origin.y, scattered.y, local),
      )
    }
    if (state === 'gathering') {
      const local = clampUnit(
        (progress - this.#config.gatheringStartRatio) /
          (this.#config.flyingStartRatio -
            this.#config.gatheringStartRatio),
      )
      return point(
        interpolate(scattered.x, this.#furnaceBottom.x, local),
        interpolate(scattered.y, this.#furnaceBottom.y, local),
      )
    }
    const local = clampUnit(
      (progress - this.#config.flyingStartRatio) /
        (1 - this.#config.flyingStartRatio),
    )
    return point(
      interpolate(this.#furnaceBottom.x, this.#resultAnchor.x, local),
      interpolate(this.#furnaceBottom.y, this.#resultAnchor.y, local),
    )
  }

  #resultPosition(
    state: M5FailurePresentationState,
    progress: number,
  ): Readonly<{ x: number; y: number }> {
    if (state === 'result') return this.#resultAnchor
    if (state !== 'flying') return this.#furnaceBottom
    const local = clampUnit(
      (progress - this.#config.flyingStartRatio) /
        (1 - this.#config.flyingStartRatio),
    )
    return point(
      interpolate(this.#furnaceBottom.x, this.#resultAnchor.x, local),
      interpolate(this.#furnaceBottom.y, this.#resultAnchor.y, local),
    )
  }
}
