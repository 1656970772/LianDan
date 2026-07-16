import { describe, expect, it, vi } from 'vitest'

import { M5EffectPool } from '../../game/extraction/m5-effect-pool.ts'
import { mapM5DomainEvent } from '../../game/extraction/m5-feedback-mapper.ts'
import { validM5Presentation } from '../fixtures/m5-presentation.ts'

describe('M5 可复用表现特效池', () => {
  it('按真实毫秒时间推进，不依赖渲染帧数', () => {
    const pool = new M5EffectPool(2)
    expect(
      pool.spawn('shield', { x: 10, y: 20 }, 100, 400),
    ).toBe(true)

    const first = vi.fn()
    pool.forEachActive(200, first)
    expect(first).toHaveBeenCalledWith(
      'shield',
      10,
      20,
      10,
      20,
      0.25,
      0,
    )

    const second = vi.fn()
    pool.forEachActive(499, second)
    expect(second.mock.calls[0]?.[5]).toBeCloseTo(0.9975)

    const expired = vi.fn()
    pool.forEachActive(500, expired)
    expect(expired).not.toHaveBeenCalled()
    expect(pool.getDiagnostics().activeCount).toBe(0)
  })

  it('支持双点锚点并复用已经过期的槽位', () => {
    const pool = new M5EffectPool(1)
    pool.spawn('fight', { x: 1, y: 2, secondaryX: 8, secondaryY: 9 }, 0, 50)

    const fight = vi.fn()
    pool.forEachActive(25, fight)
    expect(fight).toHaveBeenCalledWith('fight', 1, 2, 8, 9, 0.5, 0)

    pool.forEachActive(50, vi.fn())
    expect(pool.spawn('steam', { x: 3, y: 4 }, 60, 100)).toBe(true)
    expect(pool.getDiagnostics()).toMatchObject({
      activeCount: 1,
      capacity: 1,
      maximumCapacity: 1,
      highWaterMark: 1,
      droppedCount: 0,
      overflowPolicy: 'drop-newest',
    })
  })

  it('显式容量上限时有界丢弃且 reset 原子清空诊断', () => {
    const pool = new M5EffectPool(2, 2)
    expect(pool.spawn('birth', { x: 1, y: 1 }, 0, 100)).toBe(true)
    expect(pool.spawn('damage', { x: 2, y: 2 }, 0, 100)).toBe(true)
    expect(pool.spawn('warningTwo', { x: 3, y: 3 }, 0, 100)).toBe(false)
    expect(pool.getDiagnostics()).toEqual({
      activeCount: 2,
      capacity: 2,
      maximumCapacity: 2,
      highWaterMark: 2,
      droppedCount: 1,
      overflowPolicy: 'drop-newest',
    })

    pool.reset()
    expect(pool.getDiagnostics()).toEqual({
      activeCount: 0,
      capacity: 2,
      maximumCapacity: 2,
      highWaterMark: 0,
      droppedCount: 0,
      overflowPolicy: 'drop-newest',
    })
  })

  it('默认不允许从初始容量无界扩容', () => {
    const pool = new M5EffectPool(2)

    expect(pool.spawn('birth', { x: 1, y: 1 }, 0, 100)).toBe(true)
    expect(pool.spawn('damage', { x: 2, y: 2 }, 0, 100)).toBe(true)
    expect(pool.spawn('steam', { x: 3, y: 3 }, 0, 100)).toBe(false)
    expect(pool.getDiagnostics()).toMatchObject({
      activeCount: 2,
      capacity: 2,
      highWaterMark: 2,
      droppedCount: 1,
    })
  })

  it('按需复制当前 effect kind，不改变池状态且调用间隔离', () => {
    const pool = new M5EffectPool(3)
    pool.spawn('warningOne', { x: 1, y: 1 }, 0, 1_000)
    pool.spawn('warningOne', { x: 2, y: 2 }, 0, 1_000)
    pool.spawn('steam', { x: 3, y: 3 }, 0, 1_000)

    const first = pool.copyActiveKinds()
    expect(first).toEqual(['warningOne', 'steam'])
    ;(first as string[])[0] = 'tampered'
    expect(pool.copyActiveKinds()).toEqual(['warningOne', 'steam'])
    expect(pool.getDiagnostics().activeCount).toBe(3)
  })

  it('视觉正常批次在预热容量内保留 600 个已确认语义反馈', () => {
    const presentation = validM5Presentation()
    const pool = new M5EffectPool(
      presentation.performance.effectPoolInitialCapacity,
      presentation.performance.effectPoolMaximumCapacity,
    )
    let attempted = 0

    for (let index = 0; index < 300; index += 1) {
      const actions = mapM5DomainEvent({
        type: 'PearlShieldActivated',
        tick: 1,
        pearlId: `pearl-${index}`,
      })
      for (const action of actions) {
        attempted += 1
        pool.spawn(action.effect, { x: index, y: index }, 100, 600)
      }
    }

    expect(attempted).toBe(600)
    expect(pool.getDiagnostics()).toMatchObject({
      activeCount: 600,
      capacity: 640,
      maximumCapacity: 1024,
      droppedCount: 0,
    })
  })

  it('压力超限时有界扩容并按 drop-newest 记录全部丢弃', () => {
    const presentation = validM5Presentation()
    const pool = new M5EffectPool(
      presentation.performance.effectPoolInitialCapacity,
      presentation.performance.effectPoolMaximumCapacity,
    )

    for (let index = 0; index < 5_000; index += 1) {
      pool.spawn('steam', { x: index, y: index }, 0, 1_000)
    }

    expect(pool.getDiagnostics()).toEqual({
      activeCount: 1024,
      capacity: 1024,
      maximumCapacity: 1024,
      highWaterMark: 1024,
      droppedCount: 3976,
      overflowPolicy: 'drop-newest',
    })

    pool.reset()
    expect(pool.getDiagnostics()).toEqual({
      activeCount: 0,
      capacity: 1024,
      maximumCapacity: 1024,
      highWaterMark: 0,
      droppedCount: 0,
      overflowPolicy: 'drop-newest',
    })
  })

  it('拒绝非法容量、时间和时长', () => {
    expect(() => new M5EffectPool(0)).toThrow('M5_EFFECT_POOL_CAPACITY_INVALID')
    const pool = new M5EffectPool(1)
    expect(() => pool.spawn('birth', { x: 0, y: 0 }, Number.NaN, 10)).toThrow(
      'M5_EFFECT_POOL_TIMING_INVALID',
    )
    expect(() => pool.spawn('birth', { x: 0, y: 0 }, 0, 0)).toThrow(
      'M5_EFFECT_POOL_TIMING_INVALID',
    )
  })
})
