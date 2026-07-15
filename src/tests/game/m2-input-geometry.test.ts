import { describe, expect, it } from 'vitest'

import {
  adjustFireSizeFromWheel,
  clampDirectionToCone,
  clientPointToLogical,
  resolveContainerAxis,
} from '../../game/extraction/input-geometry.ts'

describe('M2 浏览器输入几何', () => {
  it('把等比缩放后的客户端坐标映射并钳制到 1600×900 逻辑舞台', () => {
    const bounds = { left: 100, top: 50, width: 800, height: 450 }

    expect(clientPointToLogical(500, 275, bounds, 1600, 900)).toEqual({
      x: 800,
      y: 450,
    })
    expect(clientPointToLogical(0, 1_000, bounds, 1600, 900)).toEqual({
      x: 0,
      y: 900,
    })
  })

  it('将鼠标方向归一化并限制在配置化朝上扇形内', () => {
    const origin = { x: 800, y: 820 }
    const center = { x: 0, y: -1 }

    expect(clampDirectionToCone(origin, { x: 800, y: 200 }, center, 35)).toEqual({
      x: 0,
      y: -1,
    })
    const clamped = clampDirectionToCone(
      origin,
      { x: 1_600, y: 820 },
      center,
      30,
    )
    expect(clamped.x).toBeCloseTo(0.5, 8)
    expect(clamped.y).toBeCloseTo(-Math.sqrt(3) / 2, 8)
    expect(clampDirectionToCone(origin, origin, center, 30)).toEqual({
      x: 0,
      y: -1,
    })
  })

  it('滚轮和 A/D 组合只生成钳制后的标准值', () => {
    expect(adjustFireSizeFromWheel(50, -100, 4)).toBe(54)
    expect(adjustFireSizeFromWheel(99, -100, 4)).toBe(100)
    expect(adjustFireSizeFromWheel(1, 100, 4)).toBe(0)
    expect(resolveContainerAxis(false, false)).toBe(0)
    expect(resolveContainerAxis(true, false)).toBe(-1)
    expect(resolveContainerAxis(false, true)).toBe(1)
    expect(resolveContainerAxis(true, true)).toBe(0)
  })
})
