import type { M5EffectPoolDiagnostics } from '../extraction/m5-effect-pool.ts'
import type { M5PearlSpritePoolDiagnostics } from '../extraction/m5-pearl-sprite-pool.ts'
import type { M5VisualPerformanceEffectKind } from '../../config/m5-visual-performance-fixture.ts'
import type { PearlType } from '../../domain/index.ts'

export const M5_VISUAL_EFFECT_KINDS = Object.freeze([
  'steam',
  'shield',
  'damage',
  'fight',
] as const satisfies readonly M5VisualPerformanceEffectKind[])

export const M5_APP_ALLOCATION_KINDS = Object.freeze([
  'pearl',
  'effect',
  'fire',
  'localLight',
  'audio',
] as const)

/** 正式纹理样式数由内容配置派生：每种药液材料 + 每种共享非药液轮廓。 */
export function deriveExpectedM5PearlTextureStyleCount(input: Readonly<{
  materialDefinitionIds: readonly string[]
  pearlTypes: readonly PearlType[]
}>): number {
  const materialDefinitionIds = new Set(input.materialDefinitionIds)
  const pearlTypes = new Set(input.pearlTypes)
  if (
    materialDefinitionIds.size !== input.materialDefinitionIds.length ||
    materialDefinitionIds.has('') ||
    pearlTypes.size !== input.pearlTypes.length
  ) {
    throw new Error('M5_PEARL_TEXTURE_STYLE_CONFIG_INVALID')
  }
  let count = pearlTypes.has('medicinalLiquid')
    ? materialDefinitionIds.size
    : 0
  if (pearlTypes.has('slag')) count += 1
  if (pearlTypes.has('impurity')) count += 1
  if (count <= 0) throw new Error('M5_PEARL_TEXTURE_STYLE_CONFIG_INVALID')
  return count
}

export type M5AppAllocationKind =
  (typeof M5_APP_ALLOCATION_KINDS)[number]

export type M5AppAllocationCounts = Readonly<
  Record<M5AppAllocationKind, number>
>

export type M5FrameAllocationEvidence = Readonly<{
  total: number
  byKind: M5AppAllocationCounts
  observedKinds: readonly M5AppAllocationKind[]
}>

export type M5AppAllocationCoverage = Readonly<{
  definition: 'app-owned-explicit-frame-allocation'
  byKind: Readonly<
    Record<
      M5AppAllocationKind,
      'measured' | 'audited-allocation-free' | 'unsupported'
    >
  >
  thirdParty: Readonly<{
    phaserInternal: 'excluded-not-measured'
    webAudioInternal: 'excluded-not-measured'
  }>
}>

export const M5_APP_ALLOCATION_COVERAGE: M5AppAllocationCoverage =
  Object.freeze({
    definition: 'app-owned-explicit-frame-allocation',
    byKind: Object.freeze({
      pearl: 'measured',
      effect: 'measured',
      fire: 'audited-allocation-free',
      localLight: 'audited-allocation-free',
      audio: 'measured',
    }),
    thirdParty: Object.freeze({
      phaserInternal: 'excluded-not-measured',
      webAudioInternal: 'excluded-not-measured',
    }),
  })

const ALLOCATION_KIND_INDEX = Object.freeze(
  Object.fromEntries(
    M5_APP_ALLOCATION_KINDS.map((kind, index) => [kind, index]),
  ) as Record<M5AppAllocationKind, number>,
)

/**
 * 只计应用显式拥有的对象/缓存增长，不把 Phaser、WebAudio 或 JS 引擎内部
 * 分配伪装成已测量。生产场景逐帧读取数值写入预分配 typed-array。
 */
export class M5FrameAllocationTracker {
  readonly #counts = new Uint32Array(M5_APP_ALLOCATION_KINDS.length)
  #observedMask = 0

  beginFrame(): void {
    this.#counts.fill(0)
    this.#observedMask = 0
  }

  markPath(kind: M5AppAllocationKind): void {
    this.#observedMask |= 1 << ALLOCATION_KIND_INDEX[kind]
  }

  recordAllocation(kind: M5AppAllocationKind, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('M5_FRAME_ALLOCATION_COUNT_INVALID')
    }
    this.markPath(kind)
    const index = ALLOCATION_KIND_INDEX[kind]
    const next = this.#counts[index]! + count
    if (!Number.isSafeInteger(next) || next > 0xffff_ffff) {
      throw new RangeError('M5_FRAME_ALLOCATION_COUNT_OVERFLOW')
    }
    this.#counts[index] = next
  }

  count(kind: M5AppAllocationKind): number {
    return this.#counts[ALLOCATION_KIND_INDEX[kind]]!
  }

  hasObserved(kind: M5AppAllocationKind): boolean {
    return (
      (this.#observedMask & (1 << ALLOCATION_KIND_INDEX[kind])) !== 0
    )
  }

  get total(): number {
    let total = 0
    for (let index = 0; index < this.#counts.length; index += 1) {
      total += this.#counts[index]!
    }
    return total
  }

  snapshot(): M5FrameAllocationEvidence {
    return {
      total: this.total,
      byKind: {
        pearl: this.count('pearl'),
        effect: this.count('effect'),
        fire: this.count('fire'),
        localLight: this.count('localLight'),
        audio: this.count('audio'),
      },
      observedKinds: M5_APP_ALLOCATION_KINDS.filter((kind) =>
        this.hasObserved(kind),
      ),
    }
  }
}

export type M5VisualEffectCounters = Readonly<{
  spawnCount: number
  renderCount: number
  activeHighWater: number
}>

export type M5VisualEffectSecondEvidence = Readonly<{
  secondIndex: number
  byKind: Readonly<
    Record<M5VisualPerformanceEffectKind, M5VisualEffectCounters>
  >
}>

export type M5VisualPresentationEvidence = Readonly<{
  fire: Readonly<{
    renderedFrameCount: number
    minimumParticleCount: number
    maximumParticleCount: number
  }>
  localLight: Readonly<{
    renderedFrameCount: number
    minimumIntensity: number
    maximumIntensity: number
  }>
  fight: Readonly<{
    renderedFrameCount: number
    minimumRenderedGroupCount: number
    maximumRenderedGroupCount: number
  }>
}>

export type M5VisualLongTask = Readonly<{
  startTimeMilliseconds: number
  durationMilliseconds: number
}>

export type M5VisualPerformanceSample = Readonly<{
  scenarioId: string
  sampleStartMilliseconds: number
  sampleDurationMilliseconds: number
  frameTimestamps: readonly number[]
  frameDeltasMilliseconds: readonly number[]
  longTasks: readonly M5VisualLongTask[]
  activePearlCount: number
  interactionGroupCount: number
  observedEffectKinds: readonly M5VisualPerformanceEffectKind[]
  effectPool: M5EffectPoolDiagnostics
  audioVoiceHighWaterMark: number
  pearlSpritePool: M5PearlSpritePoolDiagnostics
  effectSeconds: readonly M5VisualEffectSecondEvidence[]
  presentationEvidence: M5VisualPresentationEvidence
  frameAllocationEvidence: readonly M5FrameAllocationEvidence[]
  allocationCoverage: M5AppAllocationCoverage
}>

export type M5VisualDurationSummary = Readonly<{
  meanMilliseconds: number
  medianMilliseconds: number
  p95Milliseconds: number
  maxMilliseconds: number
}>

export type M5VisualPerformanceSummary = Readonly<{
  scenarioId: string
  sampleDurationMilliseconds: number
  frameDelta: M5VisualDurationSummary
  framesPerCompleteSecond: readonly number[]
  minimumFramesPerCompleteSecond: number
  totalFrameCount: number
  longTaskCount: number
  longTaskDuration: M5VisualDurationSummary
  activePearlCount: number
  interactionGroupCount: number
  observedEffectKinds: readonly M5VisualPerformanceEffectKind[]
  effectPool: M5EffectPoolDiagnostics
  audioVoiceHighWaterMark: number
  pearlSpritePool: M5PearlSpritePoolDiagnostics
  effectSeconds: readonly M5VisualEffectSecondEvidence[]
  effectTotalsByKind: Readonly<
    Record<M5VisualPerformanceEffectKind, M5VisualEffectCounters>
  >
  presentationEvidence: M5VisualPresentationEvidence
  allocationCoverage: M5AppAllocationCoverage
  maximumTrackedFrameAllocationCount: number
  maximumTrackedFrameAllocationByKind: M5AppAllocationCounts
  frameAllocationEvidence: readonly M5FrameAllocationEvidence[]
}>

export type M5VisualPerformanceThresholds = Readonly<{
  expectedActivePearlCount: number
  expectedPearlTextureStyleCount: number
  minimumFramesPerCompleteSecond: number
  minimumInteractionGroupCount: number
  requiredEffectKinds: readonly M5VisualPerformanceEffectKind[]
  maximumDroppedEffectCount: number
  minimumAudioVoiceHighWaterMark: number
  maximumTrackedFrameAllocationCount: number
}>

export type M5VisualPerformanceGateCheck = Readonly<{
  id:
    | 'fps-every-complete-second'
    | 'active-pearl-count'
    | 'pearl-sprite-pool'
    | 'interaction-groups'
    | 'required-effect-kinds'
    | 'effect-evidence-every-second'
    | 'fire-particles-rendered'
    | 'local-light-rendered'
    | 'fight-groups-rendered'
    | 'effect-pool-bounded'
    | 'effect-pool-dropped'
    | 'audio-voice-high-water'
    | 'app-owned-allocation-coverage'
    | 'tracked-frame-allocations'
  passed: boolean
  actual: number | string | readonly number[] | readonly string[]
  expected: number | string
}>

export type M5VisualPerformanceGate = Readonly<{
  passed: boolean
  checks: readonly M5VisualPerformanceGateCheck[]
}>

function invalid(): never {
  throw new Error('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
}

function assertFiniteNonNegative(value: number): void {
  if (!Number.isFinite(value) || value < 0) invalid()
}

function validateInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid()
}

function summarizeDurations(
  values: readonly number[],
  allowEmpty: boolean,
): M5VisualDurationSummary {
  if (values.length === 0) {
    if (!allowEmpty) invalid()
    return {
      meanMilliseconds: 0,
      medianMilliseconds: 0,
      p95Milliseconds: 0,
      maxMilliseconds: 0,
    }
  }
  const sorted = [...values].sort((left, right) => left - right)
  let total = 0
  for (const value of sorted) {
    assertFiniteNonNegative(value)
    total += value
  }
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  return {
    meanMilliseconds: total / sorted.length,
    medianMilliseconds: median,
    p95Milliseconds: sorted[p95Index]!,
    maxMilliseconds: sorted[sorted.length - 1]!,
  }
}

function emptyEffectCounters(): Record<
  M5VisualPerformanceEffectKind,
  { spawnCount: number; renderCount: number; activeHighWater: number }
> {
  return {
    steam: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
    shield: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
    damage: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
    fight: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
  }
}

function validatePresentationEvidence(
  evidence: M5VisualPresentationEvidence,
): void {
  validateInteger(evidence.fire.renderedFrameCount)
  validateInteger(evidence.fire.minimumParticleCount)
  validateInteger(evidence.fire.maximumParticleCount)
  validateInteger(evidence.localLight.renderedFrameCount)
  assertFiniteNonNegative(evidence.localLight.minimumIntensity)
  assertFiniteNonNegative(evidence.localLight.maximumIntensity)
  validateInteger(evidence.fight.renderedFrameCount)
  validateInteger(evidence.fight.minimumRenderedGroupCount)
  validateInteger(evidence.fight.maximumRenderedGroupCount)
  if (
    evidence.fire.minimumParticleCount > evidence.fire.maximumParticleCount ||
    evidence.localLight.minimumIntensity >
      evidence.localLight.maximumIntensity ||
    evidence.fight.minimumRenderedGroupCount >
      evidence.fight.maximumRenderedGroupCount
  ) {
    invalid()
  }
}

export function summarizeM5VisualPerformanceSample(
  sample: M5VisualPerformanceSample,
): M5VisualPerformanceSummary {
  if (sample.scenarioId.length === 0) invalid()
  assertFiniteNonNegative(sample.sampleStartMilliseconds)
  if (
    !Number.isSafeInteger(sample.sampleDurationMilliseconds) ||
    sample.sampleDurationMilliseconds < 1_000 ||
    sample.sampleDurationMilliseconds % 1_000 !== 0
  ) {
    invalid()
  }
  const sampleEnd =
    sample.sampleStartMilliseconds + sample.sampleDurationMilliseconds
  if (!Number.isFinite(sampleEnd) || sample.frameTimestamps.length === 0) {
    invalid()
  }
  if (
    sample.frameDeltasMilliseconds.length !==
      sample.frameTimestamps.length - 1 ||
    sample.frameAllocationEvidence.length !== sample.frameTimestamps.length
  ) {
    invalid()
  }
  let previous = Number.NEGATIVE_INFINITY
  for (const timestamp of sample.frameTimestamps) {
    if (
      !Number.isFinite(timestamp) ||
      timestamp < sample.sampleStartMilliseconds ||
      timestamp >= sampleEnd ||
      timestamp <= previous
    ) {
      invalid()
    }
    previous = timestamp
  }
  for (let index = 1; index < sample.frameTimestamps.length; index += 1) {
    const expectedDelta =
      sample.frameTimestamps[index]! - sample.frameTimestamps[index - 1]!
    if (
      !Number.isFinite(sample.frameDeltasMilliseconds[index - 1]) ||
      Math.abs(sample.frameDeltasMilliseconds[index - 1]! - expectedDelta) >
        1e-6
    ) {
      invalid()
    }
  }

  const maximumByKind: Record<M5AppAllocationKind, number> = {
    pearl: 0,
    effect: 0,
    fire: 0,
    localLight: 0,
    audio: 0,
  }
  let maximumAllocationTotal = 0
  for (const frame of sample.frameAllocationEvidence) {
    validateInteger(frame.total)
    const observed = new Set(frame.observedKinds)
    if (
      observed.size !== M5_APP_ALLOCATION_KINDS.length ||
      M5_APP_ALLOCATION_KINDS.some((kind) => !observed.has(kind))
    ) {
      invalid()
    }
    let sum = 0
    for (const kind of M5_APP_ALLOCATION_KINDS) {
      const count = frame.byKind[kind]
      validateInteger(count)
      sum += count
      maximumByKind[kind] = Math.max(maximumByKind[kind], count)
    }
    if (sum !== frame.total) invalid()
    maximumAllocationTotal = Math.max(maximumAllocationTotal, frame.total)
  }
  if (
    sample.allocationCoverage.definition !==
      'app-owned-explicit-frame-allocation' ||
    sample.allocationCoverage.thirdParty.phaserInternal !==
      'excluded-not-measured' ||
    sample.allocationCoverage.thirdParty.webAudioInternal !==
      'excluded-not-measured' ||
    M5_APP_ALLOCATION_KINDS.some((kind) => {
      const status = sample.allocationCoverage.byKind[kind]
      return (
        status !== 'measured' &&
        status !== 'audited-allocation-free' &&
        status !== 'unsupported'
      )
    })
  ) {
    invalid()
  }

  validateInteger(sample.activePearlCount)
  validateInteger(sample.interactionGroupCount)
  validateInteger(sample.audioVoiceHighWaterMark)
  validateInteger(sample.pearlSpritePool.capacity)
  validateInteger(sample.pearlSpritePool.initializedCount)
  validateInteger(sample.pearlSpritePool.activeCount)
  validateInteger(sample.pearlSpritePool.activeHighWaterMark)
  validateInteger(sample.pearlSpritePool.renderedFrameCount)
  validateInteger(sample.pearlSpritePool.minimumRenderedCountPerFrame)
  validateInteger(sample.pearlSpritePool.maximumRenderedCountPerFrame)
  validateInteger(sample.pearlSpritePool.textureCount)
  validateInteger(sample.pearlSpritePool.runtimeStorageGrowthCount)
  if (
    typeof sample.pearlSpritePool.sealed !== 'boolean' ||
    sample.pearlSpritePool.minimumRenderedCountPerFrame >
      sample.pearlSpritePool.maximumRenderedCountPerFrame ||
    sample.pearlSpritePool.visualKinds.some(
      (kind) =>
        kind !== 'medicinalLiquid' &&
        kind !== 'slag' &&
        kind !== 'impurity',
    )
  ) {
    invalid()
  }
  validateInteger(sample.effectPool.activeCount)
  validateInteger(sample.effectPool.capacity)
  validateInteger(sample.effectPool.maximumCapacity)
  validateInteger(sample.effectPool.highWaterMark)
  validateInteger(sample.effectPool.droppedCount)
  validatePresentationEvidence(sample.presentationEvidence)

  const windowCount = sample.sampleDurationMilliseconds / 1_000
  if (sample.effectSeconds.length !== windowCount) invalid()
  const effectTotals = emptyEffectCounters()
  for (let index = 0; index < sample.effectSeconds.length; index += 1) {
    const window = sample.effectSeconds[index]!
    if (window.secondIndex !== index) invalid()
    for (const kind of M5_VISUAL_EFFECT_KINDS) {
      const counters = window.byKind[kind]
      validateInteger(counters.spawnCount)
      validateInteger(counters.renderCount)
      validateInteger(counters.activeHighWater)
      effectTotals[kind].spawnCount += counters.spawnCount
      effectTotals[kind].renderCount += counters.renderCount
      effectTotals[kind].activeHighWater = Math.max(
        effectTotals[kind].activeHighWater,
        counters.activeHighWater,
      )
    }
  }

  const framesPerCompleteSecond = new Array<number>(windowCount).fill(0)
  for (const timestamp of sample.frameTimestamps) {
    const windowIndex = Math.floor(
      (timestamp - sample.sampleStartMilliseconds) / 1_000,
    )
    framesPerCompleteSecond[windowIndex] += 1
  }

  const longTaskDurations: number[] = []
  for (const task of sample.longTasks) {
    assertFiniteNonNegative(task.startTimeMilliseconds)
    assertFiniteNonNegative(task.durationMilliseconds)
    longTaskDurations.push(task.durationMilliseconds)
  }

  const observedEffectKinds = [...new Set(sample.observedEffectKinds)].sort()
  if (
    observedEffectKinds.some(
      (kind) => !M5_VISUAL_EFFECT_KINDS.includes(kind),
    )
  ) {
    invalid()
  }

  return {
    scenarioId: sample.scenarioId,
    sampleDurationMilliseconds: sample.sampleDurationMilliseconds,
    frameDelta: summarizeDurations(sample.frameDeltasMilliseconds, false),
    framesPerCompleteSecond,
    minimumFramesPerCompleteSecond: Math.min(...framesPerCompleteSecond),
    totalFrameCount: framesPerCompleteSecond.reduce(
      (total, count) => total + count,
      0,
    ),
    longTaskCount: sample.longTasks.length,
    longTaskDuration: summarizeDurations(longTaskDurations, true),
    activePearlCount: sample.activePearlCount,
    interactionGroupCount: sample.interactionGroupCount,
    observedEffectKinds,
    effectPool: { ...sample.effectPool },
    audioVoiceHighWaterMark: sample.audioVoiceHighWaterMark,
    pearlSpritePool: {
      ...sample.pearlSpritePool,
      visualKinds: [...sample.pearlSpritePool.visualKinds],
    },
    effectSeconds: sample.effectSeconds.map((window) => ({
      secondIndex: window.secondIndex,
      byKind: {
        steam: { ...window.byKind.steam },
        shield: { ...window.byKind.shield },
        damage: { ...window.byKind.damage },
        fight: { ...window.byKind.fight },
      },
    })),
    effectTotalsByKind: effectTotals,
    presentationEvidence: {
      fire: { ...sample.presentationEvidence.fire },
      localLight: { ...sample.presentationEvidence.localLight },
      fight: { ...sample.presentationEvidence.fight },
    },
    allocationCoverage: sample.allocationCoverage,
    maximumTrackedFrameAllocationCount: maximumAllocationTotal,
    maximumTrackedFrameAllocationByKind: maximumByKind,
    frameAllocationEvidence: sample.frameAllocationEvidence.map((frame) => ({
      total: frame.total,
      byKind: { ...frame.byKind },
      observedKinds: [...frame.observedKinds],
    })),
  }
}

export function evaluateM5VisualPerformanceGate(
  summary: M5VisualPerformanceSummary,
  thresholds: M5VisualPerformanceThresholds,
): M5VisualPerformanceGate {
  const observed = new Set(summary.observedEffectKinds)
  const missingEffectKinds = thresholds.requiredEffectKinds.filter(
    (kind) => !observed.has(kind),
  )
  const effectEvidenceComplete = summary.effectSeconds.every((window) =>
    thresholds.requiredEffectKinds.every((kind) => {
      const counters = window.byKind[kind]
      return (
        counters.spawnCount > 0 &&
        counters.renderCount > 0 &&
        counters.activeHighWater > 0
      )
    }),
  )
  const poolBounded =
    summary.effectPool.capacity <= summary.effectPool.maximumCapacity &&
    summary.effectPool.highWaterMark <= summary.effectPool.capacity
  const allocationCoverageComplete = M5_APP_ALLOCATION_KINDS.every(
    (kind) => summary.allocationCoverage.byKind[kind] !== 'unsupported',
  )
  const pearlVisualKinds = new Set(summary.pearlSpritePool.visualKinds)
  const pearlSpritePoolComplete =
    summary.pearlSpritePool.sealed &&
    summary.pearlSpritePool.capacity === summary.activePearlCount &&
    summary.pearlSpritePool.initializedCount === summary.activePearlCount &&
    summary.pearlSpritePool.activeCount === summary.activePearlCount &&
    summary.pearlSpritePool.activeHighWaterMark >= summary.activePearlCount &&
    summary.pearlSpritePool.renderedFrameCount === summary.totalFrameCount &&
    summary.pearlSpritePool.minimumRenderedCountPerFrame ===
      summary.activePearlCount &&
    summary.pearlSpritePool.maximumRenderedCountPerFrame ===
      summary.activePearlCount &&
    summary.pearlSpritePool.textureCount ===
      thresholds.expectedPearlTextureStyleCount &&
    summary.pearlSpritePool.runtimeStorageGrowthCount === 0 &&
    ['medicinalLiquid', 'slag', 'impurity'].every((kind) =>
      pearlVisualKinds.has(kind as 'medicinalLiquid' | 'slag' | 'impurity'),
    )
  const checks: M5VisualPerformanceGateCheck[] = [
    {
      id: 'fps-every-complete-second',
      passed: summary.framesPerCompleteSecond.every(
        (count) => count >= thresholds.minimumFramesPerCompleteSecond,
      ),
      actual: summary.framesPerCompleteSecond,
      expected: `每个完整 1 秒窗口 >= ${thresholds.minimumFramesPerCompleteSecond}`,
    },
    {
      id: 'active-pearl-count',
      passed: summary.activePearlCount === thresholds.expectedActivePearlCount,
      actual: summary.activePearlCount,
      expected: thresholds.expectedActivePearlCount,
    },
    {
      id: 'pearl-sprite-pool',
      passed: pearlSpritePoolComplete,
      actual: `${summary.pearlSpritePool.initializedCount}/${summary.pearlSpritePool.capacity}/${summary.pearlSpritePool.activeCount}/${summary.pearlSpritePool.activeHighWaterMark}/${summary.pearlSpritePool.renderedFrameCount}/${summary.pearlSpritePool.minimumRenderedCountPerFrame}/${summary.pearlSpritePool.maximumRenderedCountPerFrame}/${summary.pearlSpritePool.textureCount}/${summary.pearlSpritePool.runtimeStorageGrowthCount}/${summary.pearlSpritePool.visualKinds.join(',')}`,
      expected:
        `initialized=capacity=activePearlCount、每帧 unique=${summary.activePearlCount}、textureStyles=${thresholds.expectedPearlTextureStyleCount}、三类正式视觉齐全且 runtime growth=0`,
    },
    {
      id: 'interaction-groups',
      passed:
        summary.interactionGroupCount >=
        thresholds.minimumInteractionGroupCount,
      actual: summary.interactionGroupCount,
      expected: `>= ${thresholds.minimumInteractionGroupCount}`,
    },
    {
      id: 'required-effect-kinds',
      passed: missingEffectKinds.length === 0,
      actual: summary.observedEffectKinds,
      expected: `包含 ${thresholds.requiredEffectKinds.join(',')}`,
    },
    {
      id: 'effect-evidence-every-second',
      passed: effectEvidenceComplete,
      actual: effectEvidenceComplete ? 'complete' : 'missing-or-zero',
      expected: '每个完整秒内每种必需效果 spawn/render/activeHighWater 均 > 0',
    },
    {
      id: 'fire-particles-rendered',
      passed:
        summary.presentationEvidence.fire.renderedFrameCount ===
          summary.totalFrameCount &&
        summary.presentationEvidence.fire.minimumParticleCount > 0,
      actual: `${summary.presentationEvidence.fire.renderedFrameCount}/${summary.presentationEvidence.fire.minimumParticleCount}/${summary.presentationEvidence.fire.maximumParticleCount}`,
      expected: `renderedFrameCount=${summary.totalFrameCount} 且 particleCount > 0`,
    },
    {
      id: 'local-light-rendered',
      passed:
        summary.presentationEvidence.localLight.renderedFrameCount ===
          summary.totalFrameCount &&
        summary.presentationEvidence.localLight.minimumIntensity > 0,
      actual: `${summary.presentationEvidence.localLight.renderedFrameCount}/${summary.presentationEvidence.localLight.minimumIntensity}/${summary.presentationEvidence.localLight.maximumIntensity}`,
      expected: `renderedFrameCount=${summary.totalFrameCount} 且 intensity > 0`,
    },
    {
      id: 'fight-groups-rendered',
      passed:
        summary.presentationEvidence.fight.renderedFrameCount ===
          summary.totalFrameCount &&
        summary.presentationEvidence.fight.minimumRenderedGroupCount >=
          thresholds.minimumInteractionGroupCount,
      actual: `${summary.presentationEvidence.fight.renderedFrameCount}/${summary.presentationEvidence.fight.minimumRenderedGroupCount}/${summary.presentationEvidence.fight.maximumRenderedGroupCount}`,
      expected: `renderedFrameCount=${summary.totalFrameCount} 且 groups >= ${thresholds.minimumInteractionGroupCount}`,
    },
    {
      id: 'effect-pool-bounded',
      passed: poolBounded,
      actual: `${summary.effectPool.highWaterMark}/${summary.effectPool.capacity}/${summary.effectPool.maximumCapacity}`,
      expected: 'highWater <= capacity <= maximumCapacity',
    },
    {
      id: 'effect-pool-dropped',
      passed:
        summary.effectPool.droppedCount <=
        thresholds.maximumDroppedEffectCount,
      actual: summary.effectPool.droppedCount,
      expected: `<= ${thresholds.maximumDroppedEffectCount}`,
    },
    {
      id: 'audio-voice-high-water',
      passed:
        summary.audioVoiceHighWaterMark >=
        thresholds.minimumAudioVoiceHighWaterMark,
      actual: summary.audioVoiceHighWaterMark,
      expected: `>= ${thresholds.minimumAudioVoiceHighWaterMark}`,
    },
    {
      id: 'app-owned-allocation-coverage',
      passed: allocationCoverageComplete,
      actual: M5_APP_ALLOCATION_KINDS.map(
        (kind) => `${kind}:${summary.allocationCoverage.byKind[kind]}`,
      ),
      expected:
        '五条 app-owned 表现路径均 measured 或 audited-allocation-free；第三方内部明确排除',
    },
    {
      id: 'tracked-frame-allocations',
      passed:
        summary.maximumTrackedFrameAllocationCount <=
        thresholds.maximumTrackedFrameAllocationCount,
      actual: summary.maximumTrackedFrameAllocationCount,
      expected: `<= ${thresholds.maximumTrackedFrameAllocationCount}`,
    },
  ]
  return { passed: checks.every((check) => check.passed), checks }
}
