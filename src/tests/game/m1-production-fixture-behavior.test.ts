import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type {
  M1FireFlowFixture,
  M1TechnicalProbe,
} from '../../config/m1-fire-flow-fixture.ts'
import { validateAndNormalizeConfigSet } from '../../config/validate.ts'
import {
  createM1CircleObstacles,
  rasterizeM1FullObstacles,
} from '../../game/m1/scenario-runtime.ts'
import {
  FireFlowField,
  type FireFlowCircleObstacles,
  type FireFlowReadView,
} from '../../simulation/fire-flow/index.ts'
import { loadTestSchemaBundle } from '../config/schema-fixture.ts'

function readJson(relativeUrl: string): unknown {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

const fixture = readJson(
  '../../../public/config/performance/m1-fire-flow.json',
) as M1FireFlowFixture

const normalized = validateAndNormalizeConfigSet(
  {
    configSet: {
      filePath: '/config/config-set.json',
      value: readJson('../../../public/config/config-set.json'),
    },
    parameters: {
      filePath: '/config/parameters.json',
      value: readJson('../../../public/config/parameters.json'),
    },
    materials: [
      {
        filePath: '/config/materials/prototype-herb.json',
        value: readJson('../../../public/config/materials/prototype-herb.json'),
      },
    ],
  },
  loadTestSchemaBundle(),
)
if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
const flow = normalized.config.parameters.flowField
const geometry = {
  columns: flow.gridColumns,
  rows: flow.gridRows,
  cellSize: flow.cellSize,
  originX: 0,
  originY: 0,
}
const solver = {
  circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
  lateralSpread: flow.lateralSpread,
  obstacleDeflection: flow.obstacleDeflection,
  partialObstaclePenalty: flow.partialObstaclePenalty,
  mergeRate: flow.mergeRate,
  fullObstacleThreshold: flow.fullObstacleThreshold,
}

function probe(id: M1TechnicalProbe['id']): M1TechnicalProbe {
  return fixture.technicalProbes.find((entry) => entry.id === id)!
}

function solve(
  input: M1TechnicalProbe,
  circles: FireFlowCircleObstacles = createM1CircleObstacles(input),
): FireFlowReadView {
  return new FireFlowField({ geometry, solver }).update({
    tick: 0,
    source: {
      x: input.source.position.x,
      y: input.source.position.y,
      directionX: input.source.direction.x,
      directionY: input.source.direction.y,
      width: input.source.width,
    },
    fullObstacles: rasterizeM1FullObstacles(
      input.fullObstacleRects,
      geometry,
    ),
    circles,
  })
}

function cell(view: FireFlowReadView, row: number, column: number): number {
  return row * view.columns + column
}

function assertPillarBehavior(view: FireFlowReadView): void {
  expect(
    [39, 40].map((column) => view.intensity[cell(view, 15, column)]),
    'pillar 中心背风点必须形成阴影',
  ).toEqual([0, 0])
  expect(
    [38, 39, 40, 41].map((column) => ({
      obstacle: view.obstacle[cell(view, 20, column)],
      intensity: view.intensity[cell(view, 20, column)],
    })),
    'pillar 本体必须完全阻挡',
  ).toEqual([
    { obstacle: 1, intensity: 0 },
    { obstacle: 1, intensity: 0 },
    { obstacle: 1, intensity: 0 },
    { obstacle: 1, intensity: 0 },
  ])
  expect(
    [36, 43].map((column) => view.intensity[cell(view, 20, column)]),
    'pillar 左右两侧必须可绕行',
  ).toEqual([1, 1])
  expect(
    [39, 40].map((column) => view.intensity[cell(view, 10, column)]),
    'pillar 远端中心必须重新汇合',
  ).toEqual([1, 1])
}

function countUnreachable(
  view: FireFlowReadView,
  firstRow: number,
  lastRowExclusive: number,
): number {
  let count = 0
  for (let row = firstRow; row < lastRowExclusive; row += 1) {
    for (let column = 0; column < view.columns; column += 1) {
      if (view.intensity[cell(view, row, column)] === 0) count += 1
    }
  }
  return count
}

describe('M1 真实 production fixture 行为证明', () => {
  it('几何变异控制能捕获移走 pillar 后的中心阴影退化', () => {
    const mutated = structuredClone(probe('pillar'))
    mutated.fullObstacleRects[0] = {
      ...mutated.fullObstacleRects[0]!,
      x: 100,
    }

    expect(() => assertPillarBehavior(solve(mutated))).toThrowError(
      /pillar 中心背风点必须形成阴影/,
    )
  })

  it('pillar 真实几何证明完全阻挡、左右绕行、背风阴影与远端汇合', () => {
    assertPillarBehavior(solve(probe('pillar')))
  })

  it('gap 真实几何证明两侧墙阻挡且中心缺口恢复通流', () => {
    const view = solve(probe('gap'))

    expect(
      [20, 50].map((column) => ({
        obstacle: view.obstacle[cell(view, 23, column)],
        intensity: view.intensity[cell(view, 23, column)],
      })),
    ).toEqual([
      { obstacle: 1, intensity: 0 },
      { obstacle: 1, intensity: 0 },
    ])
    expect(
      [39, 40].map((column) => ({
        obstacle: view.obstacle[cell(view, 23, column)],
        intensity: view.intensity[cell(view, 23, column)],
      })),
    ).toEqual([
      { obstacle: 0, intensity: 1 },
      { obstacle: 0, intensity: 1 },
    ])
  })

  it('crowd 真实 seed 相对空场增强动态障碍与受影响区阴影', () => {
    const crowd = probe('crowd')
    const circles = createM1CircleObstacles(crowd)
    const emptyCircles: FireFlowCircleObstacles = {
      ...circles,
      eligible: new Uint8Array(circles.count),
    }
    const crowdView = solve(crowd, circles)
    const emptyView = solve(crowd, emptyCircles)
    const obstacleMass = crowdView.obstacle.reduce(
      (sum, obstacle) => sum + obstacle,
      0,
    )

    expect(obstacleMass).toBeGreaterThan(0)
    expect(countUnreachable(crowdView, 16, 28)).toBeGreaterThan(
      countUnreachable(emptyView, 16, 28),
    )
  })
})
