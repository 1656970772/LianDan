import { describe, expect, it } from 'vitest'

import type { M1PerformanceScenario } from '../../config/m1-fire-flow-fixture.ts'
import {
  advanceM1Circles,
  countM1EligibleCircles,
  createM1CircleObstacles,
  rasterizeM1FullObstacles,
} from '../../game/m1/scenario-runtime.ts'

const SCENARIO: M1PerformanceScenario = {
  id: 'm1-test',
  seed: 42,
  activePearlCount: 3,
  circleSpawnArea: { x: 10, y: 20, width: 40, height: 30 },
  radius: 2,
  velocity: { x: 6, y: -12 },
  fullObstacleFixtureId: 'fixture',
  thresholds: {
    fireFlowUpdateP95Ms: 6,
    fireFlowUpdateMaxMs: 10,
    minimumFpsPerFullSecond: 59,
  },
}

describe('M1 scenario runtime helpers', () => {
  it('把与网格重叠的 fixture rect 栅格化为 full obstacle', () => {
    const cells = rasterizeM1FullObstacles(
      [{ x: 20, y: 20, width: 20, height: 40, obstacleValue: 1 }],
      { columns: 4, rows: 4, cellSize: 20, originX: 0, originY: 0 },
    )

    expect([...cells]).toEqual([
      0, 0, 0, 0,
      0, 1, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 0,
    ])
  })

  it('用固定 seed 一次性预分配确定性 SoA，并保持活动数不变', () => {
    const left = createM1CircleObstacles(SCENARIO)
    const right = createM1CircleObstacles(SCENARIO)

    expect(left.count).toBe(3)
    expect(left.x).toBeInstanceOf(Float32Array)
    expect(left.y).toBeInstanceOf(Float32Array)
    expect(left.radius).toBeInstanceOf(Float32Array)
    expect(left.eligible).toBeInstanceOf(Uint8Array)
    expect([...left.x]).toEqual([...right.x])
    expect([...left.y]).toEqual([...right.y])
    expect([...left.eligible]).toEqual([1, 1, 1])
  })

  it('每 tick 原地移动并在 spawn area 边界 wrap，不分配或删珠', () => {
    const circles = createM1CircleObstacles(SCENARIO)
    circles.x.set([47, 12, 30])
    circles.y.set([22, 46, 21])
    const xReference = circles.x
    const yReference = circles.y

    advanceM1Circles(circles, SCENARIO, 1)

    expect(circles.x).toBe(xReference)
    expect(circles.y).toBe(yReference)
    expect(circles.count).toBe(3)
    expect([...circles.eligible]).toEqual([1, 1, 1])
    for (let index = 0; index < circles.count; index += 1) {
      expect(circles.x[index]).toBeGreaterThanOrEqual(12)
      expect(circles.x[index]).toBeLessThanOrEqual(48)
      expect(circles.y[index]).toBeGreaterThanOrEqual(22)
      expect(circles.y[index]).toBeLessThanOrEqual(48)
    }
  })

  it('仅统计 eligible 珠，且被排除的珠不再移动', () => {
    const circles = createM1CircleObstacles(SCENARIO)
    circles.eligible[1] = 0
    const excludedX = circles.x[1]
    const excludedY = circles.y[1]

    expect(countM1EligibleCircles(circles)).toBe(2)
    advanceM1Circles(circles, SCENARIO, 1)

    expect(circles.x[1]).toBe(excludedX)
    expect(circles.y[1]).toBe(excludedY)
    expect(countM1EligibleCircles(circles)).toBe(2)
  })
})
