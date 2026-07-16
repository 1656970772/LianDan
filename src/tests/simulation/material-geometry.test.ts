import { describe, expect, it } from 'vitest'

import {
  segmentIntersectsRemainingMaterial,
  type MaterialGeometryState,
} from '../../simulation/extraction/material-geometry.ts'

const GRID_SIZE = 64

function rotateLocalToWorld(
  rotationRadians: number,
  point: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const cosine = Math.cos(rotationRadians)
  const sine = Math.sin(rotationRadians)
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  }
}

function singleCellMaterial(rotationRadians: number): MaterialGeometryState {
  const remainingCellVolumes = new Float64Array(GRID_SIZE * GRID_SIZE)
  remainingCellVolumes[32 * GRID_SIZE + 32] = 1
  return {
    placement: {
      center: { x: 0, y: 0 },
      width: 64,
      height: 64,
      rotationRadians,
      layer: 0,
    },
    remainingCellVolumes,
  }
}

describe('材料格射线边界', () => {
  it.each([
    ['上边', { x: -2, y: 0 }, { x: 2, y: 0 }],
    ['下边', { x: -2, y: 1 }, { x: 2, y: 1 }],
    ['左边', { x: 0, y: -2 }, { x: 0, y: 2 }],
    ['右边', { x: 1, y: -2 }, { x: 1, y: 2 }],
  ] as const)('旋转 37° 后射线仅切触格子%s不算实体遮挡', (_edge, localStart, localEnd) => {
    const rotationRadians = (37 * Math.PI) / 180
    const material = singleCellMaterial(rotationRadians)

    expect(
      segmentIntersectsRemainingMaterial(
        [material],
        rotateLocalToWorld(rotationRadians, localStart),
        rotateLocalToWorld(rotationRadians, localEnd),
      ),
    ).toBe(false)
  })

  it.each([
    ['横穿', { x: -2, y: 0.5 }, { x: 2, y: 0.5 }],
    ['纵穿', { x: 0.5, y: -2 }, { x: 0.5, y: 2 }],
  ] as const)('旋转 37° 后射线%s格子内部仍算真实遮挡', (_edge, localStart, localEnd) => {
    const rotationRadians = (37 * Math.PI) / 180
    const material = singleCellMaterial(rotationRadians)

    expect(
      segmentIntersectsRemainingMaterial(
        [material],
        rotateLocalToWorld(rotationRadians, localStart),
        rotateLocalToWorld(rotationRadians, localEnd),
      ),
    ).toBe(true)
  })
})
