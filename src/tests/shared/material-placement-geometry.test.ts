import { describe, expect, it } from 'vitest'

import {
  orientedMaterialRectangleIsWithinBounds,
  orientedMaterialRectanglesHaveInteriorIntersection,
  type OrientedMaterialRectangle,
} from '../../shared/material-placement-geometry.ts'

function square(
  x: number,
  y: number,
  rotationRadians = 0,
): OrientedMaterialRectangle {
  return {
    center: { x, y },
    width: 160,
    height: 160,
    rotationRadians,
  }
}

describe('药材显式槽位 OBB 几何', () => {
  it('轴对齐矩形允许精确边缘与角点接触，但拒绝正面积相交', () => {
    const origin = square(0, 0)

    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        origin,
        square(160, 0),
      ),
    ).toBe(false)
    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        origin,
        square(160, 160),
      ),
    ).toBe(false)
    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        origin,
        square(160 - 1e-6, 0),
      ),
    ).toBe(true)
  })

  it('旋转 OBB 在精确投影接触时通过，向内移动 epsilon 后相交', () => {
    const origin = square(0, 0)
    const contactDistance = 80 + 80 * Math.SQRT2

    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        origin,
        square(contactDistance, 0, Math.PI / 4),
      ),
    ).toBe(false)
    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        origin,
        square(contactDistance - 1e-6, 0, Math.PI / 4),
      ),
    ).toBe(true)
  })

  it('旋转 OBB 的投影边界允许精确接触，向外越界 epsilon 后拒绝', () => {
    const bounds = { left: 0, top: 0, right: 1000, bottom: 1000 }
    const halfExtent = 80 * Math.SQRT2

    expect(
      orientedMaterialRectangleIsWithinBounds(
        square(halfExtent, 500, Math.PI / 4),
        bounds,
      ),
    ).toBe(true)
    expect(
      orientedMaterialRectangleIsWithinBounds(
        square(halfExtent - 1e-6, 500, Math.PI / 4),
        bounds,
      ),
    ).toBe(false)
  })
})
