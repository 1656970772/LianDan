import { describe, expect, it } from 'vitest'

import {
  FireFlowField,
  type FireFlowCircleObstacles,
  type FireFlowFieldConfig,
  type FireFlowSource,
} from '../../simulation/index.ts'

const EMPTY_CIRCLES: FireFlowCircleObstacles = {
  x: new Float32Array(0),
  y: new Float32Array(0),
  radius: new Float32Array(0),
  eligible: new Uint8Array(0),
  count: 0,
}

function config(columns: number, rows: number): FireFlowFieldConfig {
  return {
    geometry: {
      columns,
      rows,
      cellSize: 1,
      originX: 0,
      originY: 0,
    },
    solver: {
      circleCoverageSamplesPerAxis: 4,
      lateralSpread: 0.35,
      obstacleDeflection: 0.75,
      partialObstaclePenalty: 0.5,
      mergeRate: 0.15,
      fullObstacleThreshold: 0.95,
    },
  }
}

function source(
  x: number,
  y: number,
  directionX = 0,
  directionY = -1,
  width = 1,
): FireFlowSource {
  return { x, y, directionX, directionY, width }
}

function index(columns: number, column: number, row: number): number {
  return row * columns + column
}

function fullMask(columns: number, rows: number): Uint8Array {
  return new Uint8Array(columns * rows)
}

function circles(
  entries: readonly (readonly [x: number, y: number, radius: number, eligible?: number])[],
): FireFlowCircleObstacles {
  const x = new Float32Array(entries.length)
  const y = new Float32Array(entries.length)
  const radius = new Float32Array(entries.length)
  const eligible = new Uint8Array(entries.length)

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]
    if (entry === undefined) continue
    x[entryIndex] = entry[0]
    y[entryIndex] = entry[1]
    radius[entryIndex] = entry[2]
    eligible[entryIndex] = entry[3] ?? 1
  }

  return { x, y, radius, eligible, count: entries.length }
}

describe('FireFlowField 障碍栅格', () => {
  it('完全障碍固定写 1，单圆按中心、边界和格外位置确定性子采样', () => {
    const columns = 5
    const rows = 5
    const field = new FireFlowField(config(columns, rows))
    const fullObstacles = fullMask(columns, rows)
    fullObstacles[index(columns, 0, 0)] = 1

    const view = field.update({
      tick: 4,
      source: source(2.5, 4.5),
      fullObstacles,
      circles: circles([
        [2.5, 2.5, 0.3],
        [4, 1.5, 0.3],
        [-10, -10, 2],
      ]),
    })

    expect(view.obstacle[index(columns, 0, 0)]).toBe(1)
    expect(view.obstacle[index(columns, 2, 2)]).toBeGreaterThan(0)
    expect(view.obstacle[index(columns, 3, 1)]).toBeGreaterThan(0)
    expect(view.obstacle[index(columns, 4, 1)]).toBeGreaterThan(0)
    expect(view.obstacle[index(columns, 3, 1)]).toBe(
      view.obstacle[index(columns, 4, 1)],
    )
    expect(view.obstacle[index(columns, 0, 4)]).toBe(0)
  })

  it('圆覆盖累加封顶 1，eligible=0 不参与', () => {
    const columns = 3
    const rows = 3
    const field = new FireFlowField(config(columns, rows))
    const common = {
      tick: 0,
      source: source(1.5, 2.5),
      fullObstacles: fullMask(columns, rows),
    }

    const one = field.update({
      ...common,
      circles: circles([[1.5, 1.5, 0.45]]),
    }).obstacle[index(columns, 1, 1)]
    const stacked = field.update({
      ...common,
      tick: 1,
      circles: circles([
        [1.5, 1.5, 0.45],
        [1.5, 1.5, 0.45],
        [1.5, 1.5, 10, 0],
      ]),
    }).obstacle[index(columns, 1, 1)]

    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThan(1)
    expect(stacked).toBe(1)
  })

  it('每次全量重建，圆移动、缩小、删除都不留下旧贡献', () => {
    const columns = 5
    const rows = 3
    const field = new FireFlowField(config(columns, rows))
    const fullObstacles = fullMask(columns, rows)
    const input = {
      source: source(2.5, 2.5),
      fullObstacles,
    }
    const oldIndex = index(columns, 1, 1)
    const newIndex = index(columns, 3, 1)

    const initial = field.update({
      ...input,
      tick: 0,
      circles: circles([[1.5, 1.5, 0.7]]),
    })
    const initialCoverage = initial.obstacle[oldIndex] ?? 0
    expect(initialCoverage).toBeGreaterThan(0)

    const moved = field.update({
      ...input,
      tick: 1,
      circles: circles([[3.5, 1.5, 0.3]]),
    })
    expect(moved.obstacle[oldIndex]).toBe(0)
    expect(moved.obstacle[newIndex]).toBeGreaterThan(0)
    expect(moved.obstacle[newIndex]).toBeLessThan(initialCoverage)

    const deleted = field.update({ ...input, tick: 2, circles: EMPTY_CIRCLES })
    expect(deleted.obstacle[oldIndex]).toBe(0)
    expect(deleted.obstacle[newIndex]).toBe(0)
  })

  it('拒绝长度不足 count 的 SoA 输入和错误长度的完全障碍数组', () => {
    const field = new FireFlowField(config(3, 3))
    const base = { tick: 0, source: source(1.5, 2.5) }

    expect(() =>
      field.update({
        ...base,
        fullObstacles: new Uint8Array(8),
        circles: EMPTY_CIRCLES,
      }),
    ).toThrow(/fullObstacles/u)
    expect(() =>
      field.update({
        ...base,
        fullObstacles: new Uint8Array(9),
        circles: {
          x: new Float32Array(0),
          y: new Float32Array(1),
          radius: new Float32Array(1),
          eligible: new Uint8Array(1),
          count: 1,
        },
      }),
    ).toThrow(/count/u)
  })
})

describe('FireFlowField 定向绕流', () => {
  it('中心柱产生阴影、左右肩向两侧绕行，并在远端中心重新汇合', () => {
    const columns = 15
    const rows = 15
    const field = new FireFlowField(config(columns, rows))
    const fullObstacles = fullMask(columns, rows)
    for (let row = 5; row <= 8; row += 1) {
      for (let column = 6; column <= 8; column += 1) {
        fullObstacles[index(columns, column, row)] = 1
      }
    }

    const view = field.update({
      tick: 10,
      source: source(7.5, 14.5, 0, -2),
      fullObstacles,
      circles: EMPTY_CIRCLES,
    })

    expect(view.intensity[index(columns, 7, 5)]).toBe(0)
    expect(view.intensity[index(columns, 7, 4)]).toBe(0)
    expect(view.intensity[index(columns, 5, 7)]).toBe(1)
    expect(view.intensity[index(columns, 9, 7)]).toBe(1)
    expect(view.flowX[index(columns, 5, 7)]).toBeLessThan(0)
    expect(view.flowX[index(columns, 9, 7)]).toBeGreaterThan(0)
    expect(view.intensity[index(columns, 7, 1)]).toBe(1)
  })

  it('闭墙阻断，打开缺口后恢复且 generation 增长', () => {
    const columns = 15
    const rows = 15
    const field = new FireFlowField(config(columns, rows))
    const wall = fullMask(columns, rows)
    for (let column = 0; column < columns; column += 1) {
      wall[index(columns, column, 7)] = 1
    }
    const common = {
      source: source(7.5, 14.5),
      circles: EMPTY_CIRCLES,
    }

    const closed = field.update({ ...common, tick: 20, fullObstacles: wall })
    const closedGeneration = closed.generation
    expect(closed.intensity[index(columns, 7, 6)]).toBe(0)

    wall[index(columns, 7, 7)] = 0
    const opened = field.update({ ...common, tick: 21, fullObstacles: wall })
    expect(opened.generation).toBe(closedGeneration + 1)
    expect(opened.tick).toBe(21)
    expect(opened.intensity[index(columns, 7, 6)]).toBe(1)
  })

  it('珠群由部分覆盖增强到饱和墙，并形成阻挡阴影', () => {
    const columns = 11
    const rows = 11
    const field = new FireFlowField(config(columns, rows))
    const entries: [number, number, number][] = []
    for (let column = 0; column < columns; column += 1) {
      entries.push([column + 0.5, 5.5, 0.45])
    }

    const partial = field.update({
      tick: 0,
      source: source(5.5, 10.5),
      fullObstacles: fullMask(columns, rows),
      circles: circles(entries),
    })
    expect(partial.obstacle[index(columns, 5, 5)]).toBeLessThan(1)
    expect(partial.intensity[index(columns, 5, 4)]).toBe(1)

    const doubledEntries = entries.flatMap((entry) => [entry, entry])
    const saturated = field.update({
      tick: 1,
      source: source(5.5, 10.5),
      fullObstacles: fullMask(columns, rows),
      circles: circles(doubledEntries),
    })
    expect(saturated.obstacle[index(columns, 5, 5)]).toBe(1)
    expect(saturated.intensity[index(columns, 5, 4)]).toBe(0)
  })

  it('方向改变会全量清理旧流向与可达区', () => {
    const columns = 9
    const rows = 9
    const field = new FireFlowField(config(columns, rows))
    const fullObstacles = fullMask(columns, rows)
    const common = { fullObstacles, circles: EMPTY_CIRCLES }

    const upward = field.update({
      ...common,
      tick: 0,
      source: source(4.5, 4.5, 0, -1),
    })
    expect(upward.intensity[index(columns, 4, 1)]).toBe(1)
    expect(upward.intensity[index(columns, 4, 7)]).toBe(0)

    const downward = field.update({
      ...common,
      tick: 1,
      source: source(4.5, 4.5, 0, 1),
    })
    expect(downward.intensity[index(columns, 4, 1)]).toBe(0)
    expect(downward.flowX[index(columns, 4, 1)]).toBe(0)
    expect(downward.flowY[index(columns, 4, 1)]).toBe(0)
    expect(downward.intensity[index(columns, 4, 7)]).toBe(1)
  })
})

describe('FireFlowField 输出契约', () => {
  it('输出长度固定、强度只为 0/1、方向有限且可达方向近似单位', () => {
    const columns = 80
    const rows = 45
    const field = new FireFlowField(config(columns, rows))
    const view = field.update({
      tick: 30,
      source: source(40.5, 44.5, 0.25, -1, 5),
      fullObstacles: fullMask(columns, rows),
      circles: circles([
        [40.5, 30.5, 1.2],
        [42.5, 20.5, 0.8],
      ]),
    })

    expect(view.obstacle).toHaveLength(columns * rows)
    expect(view.flowX).toHaveLength(columns * rows)
    expect(view.flowY).toHaveLength(columns * rows)
    expect(view.intensity).toHaveLength(columns * rows)
    for (let cellIndex = 0; cellIndex < view.intensity.length; cellIndex += 1) {
      const intensity = view.intensity[cellIndex]
      const flowX = view.flowX[cellIndex] ?? Number.NaN
      const flowY = view.flowY[cellIndex] ?? Number.NaN
      expect(intensity === 0 || intensity === 1).toBe(true)
      expect(Number.isFinite(view.obstacle[cellIndex])).toBe(true)
      expect(Number.isFinite(flowX)).toBe(true)
      expect(Number.isFinite(flowY)).toBe(true)
      if (intensity === 1) {
        expect(Math.hypot(flowX, flowY)).toBeCloseTo(1, 5)
      } else {
        expect(flowX).toBe(0)
        expect(flowY).toBe(0)
      }
    }
  })

  it('相同输入逐格确定，read 与 update 借用同一 generation/tick 和数组', () => {
    const fieldA = new FireFlowField(config(12, 10))
    const fieldB = new FireFlowField(config(12, 10))
    const input = {
      tick: 123,
      source: source(6.5, 9.5, 0.1, -1, 3),
      fullObstacles: fullMask(12, 10),
      circles: circles([
        [4.5, 4.5, 0.6],
        [8.5, 5.5, 0.4],
      ]),
    }

    const viewA = fieldA.update(input)
    const borrowedByRules = fieldA.read()
    const borrowedByRenderer = fieldA.read()
    const viewB = fieldB.update(input)

    expect(borrowedByRules).toBe(viewA)
    expect(borrowedByRenderer).toBe(viewA)
    expect(borrowedByRules.generation).toBe(borrowedByRenderer.generation)
    expect(borrowedByRules.tick).toBe(123)
    expect(Array.from(viewA.obstacle)).toEqual(Array.from(viewB.obstacle))
    expect(Array.from(viewA.flowX)).toEqual(Array.from(viewB.flowX))
    expect(Array.from(viewA.flowY)).toEqual(Array.from(viewB.flowY))
    expect(Array.from(viewA.intensity)).toEqual(Array.from(viewB.intensity))

    const obstacleBuffer = viewA.obstacle
    const flowXBuffer = viewA.flowX
    const flowYBuffer = viewA.flowY
    const intensityBuffer = viewA.intensity
    const next = fieldA.update({ ...input, tick: 124 })
    expect(next).toBe(viewA)
    expect(next.obstacle).toBe(obstacleBuffer)
    expect(next.flowX).toBe(flowXBuffer)
    expect(next.flowY).toBe(flowYBuffer)
    expect(next.intensity).toBe(intensityBuffer)
    expect(next.generation).toBe(viewB.generation + 1)
  })
})
