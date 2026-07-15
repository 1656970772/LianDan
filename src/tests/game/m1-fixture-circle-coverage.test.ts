import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import fixtureJson from '../../../public/config/performance/m1-fire-flow.json'
import type { M1FireFlowFixture } from '../../config/m1-fire-flow-fixture.ts'
import { loadAndValidatePublicConfig } from '../../config/node-loader.ts'
import {
  advanceM1Circles,
  createM1CircleObstacles,
} from '../../game/m1/scenario-runtime.ts'
import { FireFlowField } from '../../simulation/fire-flow/index.ts'

const fixture = fixtureJson as unknown as M1FireFlowFixture

function loadNormalizedProductionDefaults() {
  const result = loadAndValidatePublicConfig(
    fileURLToPath(new URL('../../../', import.meta.url)),
  )
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.config
}

function countCirclesWithoutAnyCoverageSample(
  circles: ReturnType<typeof createM1CircleObstacles>,
  cellSize: number,
  samplesPerAxis: number,
): number {
  const sampleStep = cellSize / samplesPerAxis
  const sampleOffset = sampleStep * 0.5
  let invisibleCount = 0

  for (let index = 0; index < circles.count; index += 1) {
    const x = circles.x[index]!
    const y = circles.y[index]!
    const radius = circles.radius[index]!
    const radiusSquared = radius * radius
    const firstColumn = Math.floor((x - radius) / cellSize)
    const lastColumn = Math.floor((x + radius) / cellSize)
    const firstRow = Math.floor((y - radius) / cellSize)
    const lastRow = Math.floor((y + radius) / cellSize)
    let visible = false

    for (let row = firstRow; row <= lastRow && !visible; row += 1) {
      for (let column = firstColumn; column <= lastColumn && !visible; column += 1) {
        for (let sampleRow = 0; sampleRow < samplesPerAxis && !visible; sampleRow += 1) {
          const deltaY =
            row * cellSize + sampleOffset + sampleRow * sampleStep - y
          for (let sampleColumn = 0; sampleColumn < samplesPerAxis; sampleColumn += 1) {
            const deltaX =
              column * cellSize + sampleOffset + sampleColumn * sampleStep - x
            if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
              visible = true
              break
            }
          }
        }
      }
    }
    if (!visible) invisibleCount += 1
  }
  return invisibleCount
}

describe('M1 真实 fixture 的圆覆盖默认质量', () => {
  it.each(fixture.performanceScenarios)(
    '$id 在完整 60 秒采样期内每颗活动珠都参与动态障碍覆盖',
    (scenario) => {
      const config = loadNormalizedProductionDefaults()
      const flow = config.parameters.flowField
      const circles = createM1CircleObstacles(scenario)

      expect(flow.circleCoverageSamplesPerAxis).toBe(4)
      const maximumDistanceToNearestSample =
        flow.cellSize /
        flow.circleCoverageSamplesPerAxis /
        Math.SQRT2
      expect(scenario.radius).toBeGreaterThanOrEqual(
        maximumDistanceToNearestSample,
      )

      expect(
        countCirclesWithoutAnyCoverageSample(
          circles,
          flow.cellSize,
          flow.circleCoverageSamplesPerAxis,
        ),
      ).toBe(0)

      const field = new FireFlowField({
        geometry: {
          columns: flow.gridColumns,
          rows: flow.gridRows,
          cellSize: flow.cellSize,
          originX: 0,
          originY: 0,
        },
        solver: {
          circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
          lateralSpread: flow.lateralSpread,
          obstacleDeflection: flow.obstacleDeflection,
          partialObstaclePenalty: flow.partialObstaclePenalty,
          mergeRate: flow.mergeRate,
          fullObstacleThreshold: flow.fullObstacleThreshold,
        },
      })
      const fullObstacles = new Uint8Array(flow.gridColumns * flow.gridRows)
      const initialView = field.update({
        tick: 0,
        source: null,
        fullObstacles,
        circles,
      })
      expect(initialView.obstacle.some((value) => value > 0)).toBe(true)

      let maximumInvisibleCircleCount = 0
      const sampleTickCount =
        fixture.protocol.sampleSeconds * fixture.protocol.expectedTickHz
      for (let tick = 1; tick <= sampleTickCount; tick += 1) {
        advanceM1Circles(
          circles,
          scenario,
          1 / fixture.protocol.expectedTickHz,
        )
        maximumInvisibleCircleCount = Math.max(
          maximumInvisibleCircleCount,
          countCirclesWithoutAnyCoverageSample(
            circles,
            flow.cellSize,
            flow.circleCoverageSamplesPerAxis,
          ),
        )
      }

      // 多个动态圆重叠时覆盖值累加到 full 阈值是合法规则，不是“伪完全阻挡”。
      expect(maximumInvisibleCircleCount).toBe(0)
    },
  )
})
