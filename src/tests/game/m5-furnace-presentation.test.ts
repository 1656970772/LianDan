import { describe, expect, it } from 'vitest'

import { deriveM5FurnacePresentation } from '../../game/extraction/m5-furnace-presentation.ts'

const source = Object.freeze({
  baseTemperature: 8,
  maximumTemperature: 120,
})

describe('M5 炉温表现派生', () => {
  it('使用权威非零基温与非 100 上限推导升温目标', () => {
    expect(
      deriveM5FurnacePresentation({
        currentTemperature: 20,
        fireSize: 50,
        isSpraying: true,
        paused: false,
        status: 'extracting',
        source,
      }),
    ).toEqual({
      range: { min: 8, max: 120 },
      targetTemperature: 64,
      trend: 'heating',
    })
  })

  it('停火或降低目标后显示回落，到达目标后显示稳定', () => {
    expect(
      deriveM5FurnacePresentation({
        currentTemperature: 64,
        fireSize: 50,
        isSpraying: false,
        paused: false,
        status: 'extracting',
        source,
      }).trend,
    ).toBe('cooling')
    expect(
      deriveM5FurnacePresentation({
        currentTemperature: 64,
        fireSize: 50,
        isSpraying: true,
        paused: false,
        status: 'extracting',
        source,
      }).trend,
    ).toBe('steady')
  })

  it('暂停与终态不声称仍在升降温', () => {
    for (const state of [
      { paused: true, status: 'extracting' as const },
      { paused: false, status: 'failed' as const },
      { paused: false, status: 'completed' as const },
    ]) {
      expect(
        deriveM5FurnacePresentation({
          currentTemperature: 80,
          fireSize: 100,
          isSpraying: true,
          source,
          ...state,
        }).trend,
      ).toBe('steady')
    }
  })

  it('拒绝无效范围与非有限输入', () => {
    expect(() =>
      deriveM5FurnacePresentation({
        currentTemperature: 8,
        fireSize: 50,
        isSpraying: false,
        paused: false,
        status: 'ready',
        source: { baseTemperature: 8, maximumTemperature: 8 },
      }),
    ).toThrow('M5_FURNACE_PRESENTATION_INPUT_INVALID')
  })
})
