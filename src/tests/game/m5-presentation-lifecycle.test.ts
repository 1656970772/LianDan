import { describe, expect, it } from 'vitest'

import {
  M5PresentationLifecycle,
  type M5PresentationLifecycleConfig,
} from '../../game/extraction/m5-presentation-lifecycle.ts'

const NORMAL_CONFIG: M5PresentationLifecycleConfig = Object.freeze({
  afterglowSeconds: 0.5,
  steadyThresholdSeconds: 0.55,
  failureDurationSeconds: 1.2,
  failurePhases: {
    shatteringStartRatio: 0.24,
    gatheringStartRatio: 0.5,
    flyingStartRatio: 0.8,
  },
  reducedMotion: false,
})

function createLifecycle(
  overrides: Partial<M5PresentationLifecycleConfig> = {},
): M5PresentationLifecycle {
  return new M5PresentationLifecycle({ ...NORMAL_CONFIG, ...overrides })
}

describe('M5PresentationLifecycle', () => {
  it('按毫秒时间线从供火进入余焰并衰减到 off', () => {
    const lifecycle = createLifecycle()
    lifecycle.resetSession('session-1')

    expect(lifecycle.setRuleFireActive('session-1', true, 100)).toMatchObject({
      fire: { state: 'emerging', visualIntensity: 1 },
    })
    expect(lifecycle.markFireSteady('session-1', 650)).toMatchObject({
      fire: { state: 'steady', visualIntensity: 1 },
    })
    expect(lifecycle.setRuleFireActive('session-1', false, 700)).toMatchObject({
      fire: { state: 'cooling', visualIntensity: 1 },
    })
    expect(lifecycle.advance('session-1', 950)).toMatchObject({
      fire: { state: 'cooling', visualIntensity: 0.5 },
    })
    expect(lifecycle.advance('session-1', 1_200)).toMatchObject({
      fire: { state: 'off', visualIntensity: 0 },
    })
  })

  it('火焰揭示完成后仍等待 steady 阈值，避免配置只改指纹不改状态', () => {
    const lifecycle = createLifecycle({ steadyThresholdSeconds: 0.55 })
    lifecycle.resetSession('session-1')
    lifecycle.setRuleFireActive('session-1', true, 100)

    expect(lifecycle.markFireSteady('session-1', 296)).toMatchObject({
      fire: { state: 'emerging', visualIntensity: 1 },
    })
    expect(lifecycle.markFireSteady('session-1', 649)).toMatchObject({
      fire: { state: 'emerging', visualIntensity: 1 },
    })
    expect(lifecycle.markFireSteady('session-1', 650)).toMatchObject({
      fire: { state: 'steady', visualIntensity: 1 },
    })
  })

  it('暂停或终态可硬清火焰，低动态模式跳过起火运动但保留余焰语义', () => {
    const lifecycle = createLifecycle({ reducedMotion: true })
    lifecycle.resetSession('session-1')

    expect(lifecycle.setRuleFireActive('session-1', true, 0)).toMatchObject({
      reducedMotion: true,
      fire: { state: 'steady', visualIntensity: 1 },
    })
    expect(lifecycle.setRuleFireActive('session-1', false, 20)).toMatchObject({
      fire: { state: 'cooling', visualIntensity: 1 },
    })
    expect(lifecycle.hardClearFire('session-1', 30)).toMatchObject({
      fire: { state: 'off', visualIntensity: 0 },
    })
  })

  it('失败按总时长比例推进，并且完成语义事件只发布一次', () => {
    const lifecycle = createLifecycle()
    lifecycle.resetSession('session-1')
    lifecycle.setRuleFireActive('session-1', true, 0)

    expect(lifecycle.beginFailureConversion('session-1', 100)).toMatchObject({
      fire: { state: 'off', visualIntensity: 0 },
      failure: { state: 'charring', progress: 0 },
    })
    expect(lifecycle.advance('session-1', 388)).toMatchObject({
      failure: { state: 'shattering', progress: 0.24 },
    })
    expect(lifecycle.advance('session-1', 700)).toMatchObject({
      failure: { state: 'gathering', progress: 0.5 },
    })
    expect(lifecycle.advance('session-1', 1_060)).toMatchObject({
      failure: { state: 'flying', progress: 0.8 },
    })
    expect(lifecycle.advance('session-1', 1_300)).toMatchObject({
      failure: { state: 'result', progress: 1 },
    })
    lifecycle.advance('session-1', 2_000)

    expect(lifecycle.drainEvents('session-1')).toEqual([
      {
        type: 'FailureConversionCompleted',
        sessionId: 'session-1',
        occurredAtMs: 1_300,
      },
    ])
    expect(lifecycle.drainEvents('session-1')).toEqual([])
    lifecycle.advance('session-1', 3_000)
    expect(lifecycle.drainEvents('session-1')).toEqual([])
  })

  it('失败阶段严格服从配置比例而不是固定三等分', () => {
    const lifecycle = createLifecycle({
      failurePhases: {
        shatteringStartRatio: 0.1,
        gatheringStartRatio: 0.35,
        flyingStartRatio: 0.9,
      },
    })
    lifecycle.resetSession('session-1')
    lifecycle.beginFailureConversion('session-1', 0)

    expect(lifecycle.advance('session-1', 119)).toMatchObject({
      failure: { state: 'charring' },
    })
    expect(lifecycle.advance('session-1', 120)).toMatchObject({
      failure: { state: 'shattering' },
    })
    expect(lifecycle.advance('session-1', 420)).toMatchObject({
      failure: { state: 'gathering' },
    })
    expect(lifecycle.advance('session-1', 1_080)).toMatchObject({
      failure: { state: 'flying' },
    })
    expect(lifecycle.advance('session-1', 1_200)).toMatchObject({
      failure: { state: 'result' },
    })
    expect(lifecycle.drainEvents('session-1')).toHaveLength(1)
  })

  it('空事件排出复用冻结哨兵，非空事件仍只向当前 session 排出一次', () => {
    const lifecycle = createLifecycle()
    lifecycle.resetSession('session-1')

    const emptyCurrent = lifecycle.drainEvents('session-1')
    const emptyCurrentAgain = lifecycle.drainEvents('session-1')
    const emptyOldSession = lifecycle.drainEvents('session-old')
    let previousEmpty = emptyCurrentAgain
    let distinctEmptyResults = 0
    for (let index = 0; index < 10_000; index += 1) {
      const nextEmpty = lifecycle.drainEvents('session-1')
      if (nextEmpty !== previousEmpty) distinctEmptyResults += 1
      previousEmpty = nextEmpty
    }

    expect(emptyCurrentAgain).toBe(emptyCurrent)
    expect(emptyOldSession).toBe(emptyCurrent)
    expect(Object.isFrozen(emptyCurrent)).toBe(true)
    expect(distinctEmptyResults).toBe(0)

    lifecycle.beginFailureConversion('session-1', 0)
    lifecycle.advance('session-1', 1_200)

    expect(lifecycle.drainEvents('session-old')).toBe(emptyCurrent)
    const completedEvents = lifecycle.drainEvents('session-1')
    expect(completedEvents).toEqual([
      {
        type: 'FailureConversionCompleted',
        sessionId: 'session-1',
        occurredAtMs: 1_200,
      },
    ])
    expect(Object.isFrozen(completedEvents)).toBe(true)
    expect(lifecycle.drainEvents('session-1')).toBe(emptyCurrent)
  })

  it('暂停与后台间隔不计入失败转化时间线，恢复时先 rebase 且只完成一次', () => {
    const lifecycle = createLifecycle({ failureDurationSeconds: 3 })
    lifecycle.resetSession('session-1')
    lifecycle.beginFailureConversion('session-1', 0)

    expect(lifecycle.hardClearFire('session-1', 100)).toMatchObject({
      failure: { state: 'charring', progress: 1 / 30 },
    })
    lifecycle.pauseTimeline('session-1', 100)
    expect(lifecycle.advance('session-1', 5_100)).toMatchObject({
      failure: { state: 'charring', progress: 1 / 30 },
    })
    expect(lifecycle.drainEvents('session-1')).toEqual([])

    expect(lifecycle.resumeTimeline('session-1', 5_100)).toMatchObject({
      failure: { state: 'charring', progress: 1 / 30 },
    })
    expect(lifecycle.advance('session-1', 7_999)).toMatchObject({
      failure: { state: 'flying', progress: 2_999 / 3_000 },
    })
    expect(lifecycle.advance('session-1', 8_000)).toMatchObject({
      failure: { state: 'result', progress: 1 },
    })
    expect(lifecycle.drainEvents('session-1')).toEqual([
      {
        type: 'FailureConversionCompleted',
        sessionId: 'session-1',
        occurredAtMs: 8_000,
      },
    ])
    lifecycle.advance('session-1', 9_000)
    expect(lifecycle.drainEvents('session-1')).toEqual([])
  })

  it('无状态变化时复用已冻结的稳定视图，避免空闲帧重复分配', () => {
    const lifecycle = createLifecycle()
    const initial = lifecycle.resetSession('session-1')

    for (let index = 0; index < 10_000; index += 1) {
      expect(lifecycle.advance('session-1', index)).toBe(initial)
      expect(lifecycle.getSnapshot()).toBe(initial)
    }

    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.fire)).toBe(true)
    expect(Object.isFrozen(initial.failure)).toBe(true)
  })

  it('reset 原子清空表现与事件，并忽略旧 session 的迟到时间线', () => {
    const lifecycle = createLifecycle()
    lifecycle.resetSession('session-old')
    lifecycle.setRuleFireActive('session-old', true, 0)
    lifecycle.beginFailureConversion('session-old', 10)
    lifecycle.advance('session-old', 1_210)

    expect(lifecycle.resetSession('session-new')).toMatchObject({
      sessionId: 'session-new',
      fire: { state: 'off', visualIntensity: 0 },
      failure: { state: 'idle', progress: 0 },
    })
    expect(lifecycle.drainEvents('session-new')).toEqual([])
    const resetSnapshot = lifecycle.getSnapshot()

    expect(lifecycle.advance('session-old', 9_999)).toBeNull()
    expect(lifecycle.setRuleFireActive('session-old', true, 10_000)).toBeNull()
    expect(lifecycle.beginFailureConversion('session-old', 10_001)).toBeNull()
    expect(lifecycle.pauseTimeline('session-old', 10_002)).toBeNull()
    expect(lifecycle.resumeTimeline('session-old', 10_003)).toBeNull()
    expect(lifecycle.drainEvents('session-old')).toEqual([])
    expect(lifecycle.getSnapshot()).toEqual(resetSnapshot)
  })

  it('拒绝同一 session 倒退的时间戳和非法时长配置', () => {
    const lifecycle = createLifecycle()
    lifecycle.resetSession('session-1')
    lifecycle.setRuleFireActive('session-1', true, 100)

    expect(() => lifecycle.advance('session-1', 99)).toThrow(
      'M5_PRESENTATION_TIMESTAMP_REVERSED',
    )
    expect(
      () => new M5PresentationLifecycle({ ...NORMAL_CONFIG, afterglowSeconds: -1 }),
    ).toThrow('M5_PRESENTATION_AFTERGLOW_INVALID')
    expect(
      () =>
        new M5PresentationLifecycle({
          ...NORMAL_CONFIG,
          steadyThresholdSeconds: -1,
        }),
    ).toThrow('M5_PRESENTATION_STEADY_THRESHOLD_INVALID')
    expect(
      () =>
        new M5PresentationLifecycle({
          ...NORMAL_CONFIG,
          failureDurationSeconds: 0,
        }),
    ).toThrow('M5_PRESENTATION_FAILURE_DURATION_INVALID')
  })
})
