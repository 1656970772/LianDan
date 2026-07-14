import { describe, expect, it } from 'vitest'

import {
  evaluateM1PerformanceGate,
  summarizeM1PerformanceSample,
  type M1PerformanceThresholds,
} from '../../game/m1/performance-metrics.ts'

function regularTimestamps(rate: number, seconds: number): number[] {
  const timestamps: number[] = []
  for (let second = 0; second < seconds; second += 1) {
    for (let index = 0; index < rate; index += 1) {
      timestamps.push(second * 1_000 + (index * 1_000) / rate)
    }
  }
  return timestamps
}

function passingThresholds(
  overrides: Partial<M1PerformanceThresholds> = {},
): M1PerformanceThresholds {
  return {
    flowP95Milliseconds: 20,
    flowMaxMilliseconds: 20,
    minimumFramesPerSecond: 59,
    expectedTickRateHz: 30,
    minimumTicksPerSecond: 29,
    maximumTicksPerSecond: 31,
    allowedTotalTickError: 1,
    expectedDroppedTickCount: 0,
    expectedActivePearlCount: 900,
    ...overrides,
  }
}

describe('M1 performance metrics', () => {
  it.each([
    {
      caseName: '重复 frame timestamp',
      frameTimestamps: [0, 0, 1_000, 1_001],
      flowTimestamps: [0, 1, 1_000, 1_001],
    },
    {
      caseName: '重复 flow timestamp',
      frameTimestamps: [0, 1, 1_000, 1_001],
      flowTimestamps: [0, 0, 1_000, 1_001],
    },
    {
      caseName: '逆序 frame timestamp',
      frameTimestamps: [1, 0, 1_000, 1_001],
      flowTimestamps: [0, 1, 1_000, 1_001],
    },
    {
      caseName: '逆序 flow timestamp',
      frameTimestamps: [0, 1, 1_000, 1_001],
      flowTimestamps: [1, 0, 1_000, 1_001],
    },
  ])('拒绝 $caseName', ({ frameTimestamps, flowTimestamps }) => {
    expect(() =>
      summarizeM1PerformanceSample({
        sampleStartMilliseconds: 0,
        sampleDurationMilliseconds: 2_000,
        frameTimestamps,
        flowTimestamps,
        flowDurationsMilliseconds: new Array<number>(flowTimestamps.length).fill(1),
        droppedTickCount: 0,
        activePearlCount: 900,
        interactionCount: 0,
      }),
    ).toThrow('M1_PERFORMANCE_SAMPLE_INVALID')
  })

  it.each([
    {
      caseName: '空 frame timestamp 序列',
      frameTimestamps: [] as number[],
      flowTimestamps: [0, 1],
    },
    {
      caseName: '空 flow timestamp 序列',
      frameTimestamps: [0, 1],
      flowTimestamps: [] as number[],
    },
    {
      caseName: '早于采样起点的 timestamp',
      frameTimestamps: [-1, 0],
      flowTimestamps: [0, 1],
    },
    {
      caseName: '等于采样终点的 timestamp',
      frameTimestamps: [0, 1],
      flowTimestamps: [0, 2_000],
    },
  ])('拒绝 $caseName', ({ frameTimestamps, flowTimestamps }) => {
    expect(() =>
      summarizeM1PerformanceSample({
        sampleStartMilliseconds: 0,
        sampleDurationMilliseconds: 2_000,
        frameTimestamps,
        flowTimestamps,
        flowDurationsMilliseconds: new Array<number>(flowTimestamps.length).fill(1),
        droppedTickCount: 0,
        activePearlCount: 900,
        interactionCount: 0,
      }),
    ).toThrow('M1_PERFORMANCE_SAMPLE_INVALID')
  })

  it('按 nearest-rank 计算 p95，并保留每个完整 1 秒窗口', () => {
    const summary = summarizeM1PerformanceSample({
      sampleStartMilliseconds: 0,
      sampleDurationMilliseconds: 2_000,
      frameTimestamps: regularTimestamps(60, 2),
      flowTimestamps: regularTimestamps(30, 2),
      flowDurationsMilliseconds: Array.from(
        { length: 60 },
        (_, index) => (index % 20) + 1,
      ),
      droppedTickCount: 0,
      activePearlCount: 900,
      interactionCount: 0,
    })

    expect(summary.flowDuration).toEqual({
      meanMilliseconds: 10.5,
      medianMilliseconds: 10.5,
      p95Milliseconds: 19,
      maxMilliseconds: 20,
    })
    expect(summary.framesPerSecond).toEqual([60, 60])
    expect(summary.ticksPerSecond).toEqual([30, 30])
    expect(summary.totalTickCount).toBe(60)
    expect(summary.minimumFramesPerSecond).toBe(60)
  })

  it('门禁逐项返回证据，不用汇总结论掩盖单个窗口失败', () => {
    const thresholds = passingThresholds({
      flowP95Milliseconds: 6,
      flowMaxMilliseconds: 10,
    })
    const summary = summarizeM1PerformanceSample({
      sampleStartMilliseconds: 0,
      sampleDurationMilliseconds: 2_000,
      frameTimestamps: [
        ...regularTimestamps(60, 1),
        ...regularTimestamps(58, 1).map((timestamp) => timestamp + 1_000),
      ],
      flowTimestamps: regularTimestamps(30, 2),
      flowDurationsMilliseconds: [
        ...new Array<number>(54).fill(5),
        ...new Array<number>(5).fill(7),
        11,
      ],
      droppedTickCount: 1,
      activePearlCount: 900,
      interactionCount: 0,
    })

    const gate = evaluateM1PerformanceGate(summary, thresholds)

    expect(gate.passed).toBe(false)
    expect(gate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'flow-p95', passed: false }),
        expect.objectContaining({ id: 'flow-max', passed: false }),
        expect.objectContaining({ id: 'fps-every-window', passed: false }),
        expect.objectContaining({ id: 'dropped-ticks', passed: false }),
      ]),
    )
    expect(gate.checks.find((check) => check.id === 'fps-every-window')).toMatchObject({
      actual: [60, 58],
      expected: '每个窗口 >= 59',
    })
  })

  it('拒绝 flow timestamp 与 duration 无法一一对应的原始样本', () => {
    expect(() =>
      summarizeM1PerformanceSample({
        sampleStartMilliseconds: 0,
        sampleDurationMilliseconds: 2_000,
        frameTimestamps: regularTimestamps(60, 2),
        flowTimestamps: regularTimestamps(30, 2),
        flowDurationsMilliseconds: new Array<number>(59).fill(2),
        droppedTickCount: 0,
        activePearlCount: 900,
        interactionCount: 0,
      }),
    ).toThrow('M1_PERFORMANCE_SAMPLE_INVALID')
  })

  it('活动珠数不符合场景预期时独立门禁失败', () => {
    const summary = summarizeM1PerformanceSample({
      sampleStartMilliseconds: 0,
      sampleDurationMilliseconds: 2_000,
      frameTimestamps: regularTimestamps(60, 2),
      flowTimestamps: regularTimestamps(30, 2),
      flowDurationsMilliseconds: new Array<number>(60).fill(2),
      droppedTickCount: 0,
      activePearlCount: 0,
      interactionCount: 0,
    })

    const gate = evaluateM1PerformanceGate(summary, passingThresholds())

    expect(gate.passed).toBe(false)
    expect(gate.checks.find((check) => check.id === 'active-pearl-count')).toEqual({
      id: 'active-pearl-count',
      passed: false,
      actual: 0,
      expected: 900,
    })
  })

  it('使用显式每秒 tick 上下界，而不是隐式用 Hz 加减 1', () => {
    const summary = summarizeM1PerformanceSample({
      sampleStartMilliseconds: 0,
      sampleDurationMilliseconds: 2_000,
      frameTimestamps: regularTimestamps(60, 2),
      flowTimestamps: [
        ...regularTimestamps(28, 1),
        ...regularTimestamps(32, 1).map((timestamp) => timestamp + 1_000),
      ],
      flowDurationsMilliseconds: new Array<number>(60).fill(2),
      droppedTickCount: 0,
      activePearlCount: 900,
      interactionCount: 0,
    })

    const gate = evaluateM1PerformanceGate(
      summary,
      passingThresholds({ minimumTicksPerSecond: 28, maximumTicksPerSecond: 32 }),
    )

    expect(gate.checks.find((check) => check.id === 'ticks-every-window')).toEqual({
      id: 'ticks-every-window',
      passed: true,
      actual: [28, 32],
      expected: '每个窗口 28..32',
    })
  })
})
