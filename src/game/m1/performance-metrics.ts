export type M1PerformanceSample = Readonly<{
  sampleStartMilliseconds: number
  sampleDurationMilliseconds: number
  frameTimestamps: readonly number[]
  flowTimestamps: readonly number[]
  flowDurationsMilliseconds: readonly number[]
  droppedTickCount: number
  activePearlCount: number
  interactionCount: number
}>

export type M1DurationSummary = Readonly<{
  meanMilliseconds: number
  medianMilliseconds: number
  p95Milliseconds: number
  maxMilliseconds: number
}>

export type M1PerformanceSummary = Readonly<{
  sampleDurationMilliseconds: number
  flowDuration: M1DurationSummary
  framesPerSecond: readonly number[]
  ticksPerSecond: readonly number[]
  minimumFramesPerSecond: number
  totalFrameCount: number
  totalTickCount: number
  flowUpdateCount: number
  droppedTickCount: number
  activePearlCount: number
  interactionCount: number
}>

export type M1PerformanceThresholds = Readonly<{
  flowP95Milliseconds: number
  flowMaxMilliseconds: number
  minimumFramesPerSecond: number
  expectedTickRateHz: number
  minimumTicksPerSecond: number
  maximumTicksPerSecond: number
  allowedTotalTickError: number
  expectedDroppedTickCount: number
  expectedActivePearlCount: number
}>

export type M1PerformanceGateCheck = Readonly<{
  id:
    | 'flow-p95'
    | 'flow-max'
    | 'fps-every-window'
    | 'ticks-every-window'
    | 'total-ticks'
    | 'dropped-ticks'
    | 'flow-update-count'
    | 'active-pearl-count'
  passed: boolean
  actual: number | readonly number[]
  expected: number | string
}>

export type M1PerformanceGate = Readonly<{
  passed: boolean
  checks: readonly M1PerformanceGateCheck[]
}>

function assertFiniteNonNegative(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }
}

function summarizeDurations(values: readonly number[]): M1DurationSummary {
  if (values.length === 0) throw new Error('M1_PERFORMANCE_SAMPLE_EMPTY')
  const sorted = [...values].sort((left, right) => left - right)
  for (const value of sorted) assertFiniteNonNegative(value)
  const total = sorted.reduce((sum, value) => sum + value, 0)
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

function assertValidTimestampSeries(
  timestamps: readonly number[],
  sampleStartMilliseconds: number,
  sampleEndMilliseconds: number,
): void {
  if (timestamps.length === 0) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }

  let previousTimestamp = Number.NEGATIVE_INFINITY
  for (const timestamp of timestamps) {
    if (
      !Number.isFinite(timestamp) ||
      timestamp < sampleStartMilliseconds ||
      timestamp >= sampleEndMilliseconds ||
      timestamp <= previousTimestamp
    ) {
      throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
    }
    previousTimestamp = timestamp
  }
}

function countCompleteWindows(
  timestamps: readonly number[],
  sampleStartMilliseconds: number,
  sampleDurationMilliseconds: number,
): readonly number[] {
  const windowCount = Math.floor(sampleDurationMilliseconds / 1_000)
  const counts = new Array<number>(windowCount).fill(0)
  const sampleEndMilliseconds = sampleStartMilliseconds + windowCount * 1_000

  for (const timestamp of timestamps) {
    if (timestamp >= sampleEndMilliseconds) continue
    const windowIndex = Math.floor((timestamp - sampleStartMilliseconds) / 1_000)
    counts[windowIndex] += 1
  }
  return counts
}

export function summarizeM1PerformanceSample(
  sample: M1PerformanceSample,
): M1PerformanceSummary {
  assertFiniteNonNegative(sample.sampleStartMilliseconds)
  if (
    !Number.isFinite(sample.sampleDurationMilliseconds) ||
    sample.sampleDurationMilliseconds < 1_000
  ) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }
  if (
    !Number.isSafeInteger(sample.droppedTickCount) ||
    sample.droppedTickCount < 0 ||
    !Number.isSafeInteger(sample.activePearlCount) ||
    sample.activePearlCount < 0 ||
    !Number.isSafeInteger(sample.interactionCount) ||
    sample.interactionCount < 0
  ) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }
  const sampleEndMilliseconds =
    sample.sampleStartMilliseconds + sample.sampleDurationMilliseconds
  if (!Number.isFinite(sampleEndMilliseconds)) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }
  if (sample.flowTimestamps.length !== sample.flowDurationsMilliseconds.length) {
    throw new Error('M1_PERFORMANCE_SAMPLE_INVALID')
  }
  assertValidTimestampSeries(
    sample.frameTimestamps,
    sample.sampleStartMilliseconds,
    sampleEndMilliseconds,
  )
  assertValidTimestampSeries(
    sample.flowTimestamps,
    sample.sampleStartMilliseconds,
    sampleEndMilliseconds,
  )

  const framesPerSecond = countCompleteWindows(
    sample.frameTimestamps,
    sample.sampleStartMilliseconds,
    sample.sampleDurationMilliseconds,
  )
  const ticksPerSecond = countCompleteWindows(
    sample.flowTimestamps,
    sample.sampleStartMilliseconds,
    sample.sampleDurationMilliseconds,
  )

  return {
    sampleDurationMilliseconds: sample.sampleDurationMilliseconds,
    flowDuration: summarizeDurations(sample.flowDurationsMilliseconds),
    framesPerSecond,
    ticksPerSecond,
    minimumFramesPerSecond: Math.min(...framesPerSecond),
    totalFrameCount: framesPerSecond.reduce((sum, count) => sum + count, 0),
    totalTickCount: ticksPerSecond.reduce((sum, count) => sum + count, 0),
    flowUpdateCount: sample.flowDurationsMilliseconds.length,
    droppedTickCount: sample.droppedTickCount,
    activePearlCount: sample.activePearlCount,
    interactionCount: sample.interactionCount,
  }
}

export function evaluateM1PerformanceGate(
  summary: M1PerformanceSummary,
  thresholds: M1PerformanceThresholds,
): M1PerformanceGate {
  const expectedTotalTicks = Math.round(
    (summary.sampleDurationMilliseconds / 1_000) * thresholds.expectedTickRateHz,
  )
  const minimumWindowTicks = thresholds.minimumTicksPerSecond
  const maximumWindowTicks = thresholds.maximumTicksPerSecond
  const checks: M1PerformanceGateCheck[] = [
    {
      id: 'flow-p95',
      passed:
        summary.flowDuration.p95Milliseconds <= thresholds.flowP95Milliseconds,
      actual: summary.flowDuration.p95Milliseconds,
      expected: `<= ${thresholds.flowP95Milliseconds} ms`,
    },
    {
      id: 'flow-max',
      passed: summary.flowDuration.maxMilliseconds <= thresholds.flowMaxMilliseconds,
      actual: summary.flowDuration.maxMilliseconds,
      expected: `<= ${thresholds.flowMaxMilliseconds} ms`,
    },
    {
      id: 'fps-every-window',
      passed: summary.framesPerSecond.every(
        (value) => value >= thresholds.minimumFramesPerSecond,
      ),
      actual: summary.framesPerSecond,
      expected: `每个窗口 >= ${thresholds.minimumFramesPerSecond}`,
    },
    {
      id: 'ticks-every-window',
      passed: summary.ticksPerSecond.every(
        (value) => value >= minimumWindowTicks && value <= maximumWindowTicks,
      ),
      actual: summary.ticksPerSecond,
      expected: `每个窗口 ${minimumWindowTicks}..${maximumWindowTicks}`,
    },
    {
      id: 'total-ticks',
      passed:
        Math.abs(summary.totalTickCount - expectedTotalTicks) <=
        thresholds.allowedTotalTickError,
      actual: summary.totalTickCount,
      expected: `${expectedTotalTicks} +/- ${thresholds.allowedTotalTickError}`,
    },
    {
      id: 'dropped-ticks',
      passed: summary.droppedTickCount === thresholds.expectedDroppedTickCount,
      actual: summary.droppedTickCount,
      expected: thresholds.expectedDroppedTickCount,
    },
    {
      id: 'flow-update-count',
      passed: summary.flowUpdateCount === summary.totalTickCount,
      actual: summary.flowUpdateCount,
      expected: summary.totalTickCount,
    },
    {
      id: 'active-pearl-count',
      passed: summary.activePearlCount === thresholds.expectedActivePearlCount,
      actual: summary.activePearlCount,
      expected: thresholds.expectedActivePearlCount,
    },
  ]

  return {
    passed: checks.every((check) => check.passed),
    checks,
  }
}
