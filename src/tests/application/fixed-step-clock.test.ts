import { describe, expect, it, vi } from 'vitest'

import { FixedStepClock } from '../../application/index.ts'

const CLOCK_OPTIONS = {
  tickRateHz: 30,
  maxCatchUpSteps: 5,
} as const

describe('FixedStepClock', () => {
  it('以 30 Hz 固定步推进，并暴露渲染插值比例', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()

    expect(clock.frame(0, advance)).toMatchObject({
      advancedTickCount: 0,
      droppedTickCount: 0,
      interpolationAlpha: 0,
    })
    expect(clock.frame(16, advance).advancedTickCount).toBe(0)

    const frame = clock.frame(34, advance)

    expect(frame.advancedTickCount).toBe(1)
    expect(frame.droppedTickCount).toBe(0)
    expect(frame.interpolationAlpha).toBeGreaterThanOrEqual(0)
    expect(frame.interpolationAlpha).toBeLessThan(1)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(clock.getMetrics()).toMatchObject({
      totalAdvancedTickCount: 1,
      droppedTickCount: 0,
    })
  })

  it('单帧只补有限步并明确记录被丢弃的积压 tick', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()
    clock.frame(0, advance)

    const frame = clock.frame(1_000, advance)

    expect(frame.advancedTickCount).toBe(5)
    expect(frame.droppedTickCount).toBe(25)
    expect(frame.interpolationAlpha).toBe(0)
    expect(advance).toHaveBeenCalledTimes(5)
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 5,
      droppedTickCount: 25,
    })
  })

  it('60 秒的 60 Hz 渲染时间线精确推进 1800 个规则 tick', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()
    clock.frame(0, advance)

    for (let frame = 1; frame <= 3_600; frame += 1) {
      clock.frame((frame * 1_000) / 60, advance)
    }

    expect(advance).toHaveBeenCalledTimes(1_800)
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 1_800,
      droppedTickCount: 0,
    })
  })

  it('暂停与恢复都清空累加器，恢复首帧只重新锚定时间', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()
    clock.frame(0, advance)
    clock.frame(20, advance)

    clock.setPaused(true)
    expect(clock.frame(5_000, advance).advancedTickCount).toBe(0)
    clock.setPaused(false)
    expect(clock.frame(6_000, advance).advancedTickCount).toBe(0)
    expect(clock.frame(6_020, advance).advancedTickCount).toBe(0)
    expect(clock.frame(6_034, advance).advancedTickCount).toBe(1)
    expect(advance).toHaveBeenCalledTimes(1)
  })

  it('rebase 只清空墙钟基线与累加器，保留已有 metrics', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()
    clock.frame(0, advance)
    clock.frame(34, advance)

    clock.rebase()

    expect(clock.frame(10_034, advance).advancedTickCount).toBe(0)
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 1,
      droppedTickCount: 0,
    })
    expect(clock.frame(10_068, advance).advancedTickCount).toBe(1)
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 2,
      droppedTickCount: 0,
    })
  })

  it('拒绝非法或倒退时间戳，不改变既有计数', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    const advance = vi.fn()
    clock.frame(10, advance)

    expect(() => clock.frame(Number.NaN, advance)).toThrow('APP_CLOCK_INVALID_TIMESTAMP')
    expect(() => clock.frame(9, advance)).toThrow('APP_CLOCK_INVALID_TIMESTAMP')
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 0,
      droppedTickCount: 0,
    })
  })

  it('回调报告暂停后停止 catch-up，只计真实推进且不把暂停积压记为 dropped', () => {
    const clock = new FixedStepClock(CLOCK_OPTIONS)
    let callCount = 0
    clock.frame(0, () => true)

    const frame = clock.frame(1_000, () => {
      callCount += 1
      return callCount === 1
    })

    expect(callCount).toBe(2)
    expect(frame).toMatchObject({
      advancedTickCount: 1,
      droppedTickCount: 0,
    })
    expect(clock.getMetrics()).toEqual({
      totalAdvancedTickCount: 1,
      droppedTickCount: 0,
    })
  })
})
