import { describe, expect, it } from 'vitest'

import {
  deriveM5DebrisFrame,
  deriveM5EmberFrame,
  deriveM5PearlVisualStyle,
  M5DebrisLifetimeWindow,
  M5WallClockRateAccumulator,
} from '../../game/extraction/m5-visual-policy.ts'

describe('M5 纯表现策略', () => {
  it('按每秒速率确定性采样余烬，rate=0 时严格不画', () => {
    const totals = [0, 1, 15, 30].map((ratePerSecond) => {
      let total = 0
      for (let frame = 0; frame < 30; frame += 1) {
        total += deriveM5EmberFrame({
          ratePerSecond,
          framesPerSecond: 30,
          particleCount: 170,
          frame,
        }).drawCount
      }
      return total
    })

    expect(totals).toEqual([0, 1, 15, 30])
    expect(
      deriveM5EmberFrame({
        ratePerSecond: 0,
        framesPerSecond: 30,
        particleCount: 170,
        frame: 0,
      }),
    ).toEqual({ drawCount: 0, stride: 0, startIndex: 0 })
  })

  it('余烬按墙钟时间累计，渲染降帧不降低每秒发射数', () => {
    const sampleOneSecond = (renderFramesPerSecond: number): number => {
      const accumulator = new M5WallClockRateAccumulator()
      accumulator.reset(0)
      let total = 0
      for (let frame = 1; frame <= renderFramesPerSecond; frame += 1) {
        total += accumulator.sample(
          54,
          (frame * 1_000) / renderFramesPerSecond,
        )
      }
      return total
    }

    expect(sampleOneSecond(30)).toBe(54)
    expect(sampleOneSecond(20)).toBe(54)
  })

  it('余烬停火和 reset 都重建墙钟基线，rate=0 不会补发', () => {
    const accumulator = new M5WallClockRateAccumulator()
    accumulator.reset(0)

    expect(accumulator.sample(54, 1_000)).toBe(54)
    expect(accumulator.sample(0, 5_000)).toBe(0)
    expect(accumulator.sample(54, 5_000)).toBe(0)
    expect(accumulator.sample(54, 6_000)).toBe(54)

    accumulator.reset(10_000)
    expect(accumulator.sample(54, 10_000)).toBe(0)
  })

  it('shape 与 surface 分别映射到不同且可直接消费的几何和表面风格', () => {
    expect(
      deriveM5PearlVisualStyle({
        shape: 'droplet',
        motion: 'swim',
        surface: 'glossy',
      }),
    ).toMatchObject({ shape: 'droplet', pointCount: 0, surface: 'glossy' })
    expect(
      deriveM5PearlVisualStyle({
        shape: 'clump',
        motion: 'swim',
        surface: 'smoky',
      }),
    ).toMatchObject({ shape: 'clump', pointCount: 7, surface: 'smoky' })
    expect(
      deriveM5PearlVisualStyle({
        shape: 'spike',
        motion: 'swim',
        surface: 'rough',
      }),
    ).toMatchObject({ shape: 'spike', pointCount: 12, surface: 'rough' })
  })

  it('材料碎屑只由表现速率和已溶比例采样，不修改任何规则数据', () => {
    const input = {
      debrisRatePerSecond: 42,
      framesPerSecond: 60,
      dissolvedRatio: 0.5,
      frame: 0,
      maximumVisible: 12,
    } as const
    const source = { ...input }

    const noDebris = deriveM5DebrisFrame({
      ...input,
      debrisRatePerSecond: 0,
    })
    const someDebris = Array.from({ length: 60 }, (_, frame) =>
      deriveM5DebrisFrame({ ...input, frame }),
    ).reduce((total, sample) => total + sample.emittedCount, 0)

    expect(noDebris).toEqual({ emittedCount: 0, visibleCount: 0 })
    expect(someDebris).toBe(21)
    expect(input).toEqual(source)
  })

  it('碎屑只在实际发射帧新增，低速率不退化成常驻粒子', () => {
    const totals = [1, 7, 8, 42].map((debrisRatePerSecond) => {
      let emitted = 0
      let drawn = 0
      let zeroButDrawn = 0
      for (let frame = 0; frame < 60; frame += 1) {
        const sample = deriveM5DebrisFrame({
          debrisRatePerSecond,
          framesPerSecond: 60,
          dissolvedRatio: 1,
          frame,
          maximumVisible: 12,
        })
        emitted += sample.emittedCount
        drawn += sample.visibleCount
        if (sample.emittedCount === 0 && sample.visibleCount > 0) {
          zeroButDrawn += 1
        }
      }
      return { emitted, drawn, zeroButDrawn }
    })

    expect(totals).toEqual([
      { emitted: 1, drawn: 1, zeroButDrawn: 0 },
      { emitted: 7, drawn: 7, zeroButDrawn: 0 },
      { emitted: 8, drawn: 8, zeroButDrawn: 0 },
      { emitted: 42, drawn: 42, zeroButDrawn: 0 },
    ])
  })

  it('碎屑生命周期窗口只保留 emittedCount 新增项，并按配置容量和寿命结束', () => {
    const window = new M5DebrisLifetimeWindow({
      capacity: 3,
      lifetimeFrames: 3,
    })

    window.advance(0)
    expect(window.emit('material-a', 0, 0)).toBe(0)
    expect(window.activeCount).toBe(0)
    expect(window.emit('material-a', 0, 2)).toBe(2)
    expect(window.activeCount).toBe(2)

    window.advance(2)
    expect(window.activeCount).toBe(2)
    expect(window.emit('material-b', 2, 3)).toBe(3)
    expect(window.activeCount).toBe(3)

    const owners: string[] = []
    window.forEachActive(2, (_slot, ownerId, lifeProgress) => {
      owners.push(ownerId)
      expect(lifeProgress).toBeGreaterThanOrEqual(0)
      expect(lifeProgress).toBeLessThan(1)
    })
    expect(owners).toEqual(['material-b', 'material-b', 'material-b'])

    window.advance(5)
    expect(window.activeCount).toBe(0)
    window.emit('material-a', 5, 1)
    window.reset()
    expect(window.activeCount).toBe(0)
  })
})
