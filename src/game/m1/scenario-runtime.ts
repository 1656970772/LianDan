import type {
  M1FixtureRect,
  M1FullObstacleRect,
  M1PerformanceScenario,
  M1TechnicalProbe,
} from '../../config/m1-fire-flow-fixture.ts'
import { createRandomSource } from '../../shared/random-source.ts'
import type {
  FireFlowCircleObstacles,
  FireFlowGridGeometry,
  FireFlowReadView,
} from '../../simulation/fire-flow/index.ts'

export type M1CircleScenario = M1TechnicalProbe | M1PerformanceScenario

export interface M1CircleObstacleBuffers extends FireFlowCircleObstacles {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly radius: Float32Array
  readonly eligible: Uint8Array
  readonly count: number
}

export type M1FlowSample = Readonly<{
  column: number
  row: number
  index: number
  obstacle: number
  flowX: number
  flowY: number
  intensity: number
}>

function circleCount(scenario: M1CircleScenario): number {
  return 'activePearlCount' in scenario
    ? scenario.activePearlCount
    : scenario.circleCount
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function wrapCoordinate(value: number, minimum: number, maximum: number): number {
  const span = maximum - minimum
  if (span <= 0) return minimum
  if (value >= minimum && value <= maximum) return value
  return minimum + positiveModulo(value - minimum, span)
}

export function rasterizeM1FullObstacles(
  rects: readonly M1FullObstacleRect[],
  geometry: FireFlowGridGeometry,
): Uint8Array {
  const cells = new Uint8Array(geometry.columns * geometry.rows)

  for (const rect of rects) {
    const firstColumn = Math.max(
      0,
      Math.floor((rect.x - geometry.originX) / geometry.cellSize),
    )
    const lastColumn = Math.min(
      geometry.columns - 1,
      Math.ceil((rect.x + rect.width - geometry.originX) / geometry.cellSize) - 1,
    )
    const firstRow = Math.max(
      0,
      Math.floor((rect.y - geometry.originY) / geometry.cellSize),
    )
    const lastRow = Math.min(
      geometry.rows - 1,
      Math.ceil((rect.y + rect.height - geometry.originY) / geometry.cellSize) - 1,
    )

    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowOffset = row * geometry.columns
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        cells[rowOffset + column] = 1
      }
    }
  }

  return cells
}

export function createM1CircleObstacles(
  scenario: M1CircleScenario,
): M1CircleObstacleBuffers {
  const count = circleCount(scenario)
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const radius = new Float32Array(count)
  const eligible = new Uint8Array(count)
  const random = createRandomSource(scenario.seed, 'rules')
  const area = scenario.circleSpawnArea
  const minimumX = area.x + scenario.radius
  const maximumX = area.x + area.width - scenario.radius
  const minimumY = area.y + scenario.radius
  const maximumY = area.y + area.height - scenario.radius

  for (let index = 0; index < count; index += 1) {
    x[index] = minimumX + random.nextFloat() * Math.max(0, maximumX - minimumX)
    y[index] = minimumY + random.nextFloat() * Math.max(0, maximumY - minimumY)
    radius[index] = scenario.radius
    eligible[index] = 1
  }

  return { x, y, radius, eligible, count }
}

export function countM1EligibleCircles(
  circles: FireFlowCircleObstacles,
): number {
  let count = 0
  for (let index = 0; index < circles.count; index += 1) {
    if (circles.eligible[index] !== 0) count += 1
  }
  return count
}

export function advanceM1Circles(
  circles: M1CircleObstacleBuffers,
  scenario: M1CircleScenario,
  deltaSeconds: number,
): void {
  const area = scenario.circleSpawnArea
  const velocity = scenario.velocity

  for (let index = 0; index < circles.count; index += 1) {
    if (circles.eligible[index] === 0) continue
    const radius = circles.radius[index]!
    const minimumX = area.x + radius
    const maximumX = area.x + area.width - radius
    const minimumY = area.y + radius
    const maximumY = area.y + area.height - radius
    circles.x[index] = wrapCoordinate(
      circles.x[index]! + velocity.x * deltaSeconds,
      minimumX,
      maximumX,
    )
    circles.y[index] = wrapCoordinate(
      circles.y[index]! + velocity.y * deltaSeconds,
      minimumY,
      maximumY,
    )
  }
}

export function sampleM1FlowView(
  view: FireFlowReadView,
  position: Readonly<{ x: number; y: number }>,
): M1FlowSample {
  const column = Math.max(
    0,
    Math.min(
      view.columns - 1,
      Math.floor((position.x - view.originX) / view.cellSize),
    ),
  )
  const row = Math.max(
    0,
    Math.min(
      view.rows - 1,
      Math.floor((position.y - view.originY) / view.cellSize),
    ),
  )
  const index = row * view.columns + column
  return {
    column,
    row,
    index,
    obstacle: view.obstacle[index]!,
    flowX: view.flowX[index]!,
    flowY: view.flowY[index]!,
    intensity: view.intensity[index]!,
  }
}

function mixHash(hash: number, value: number): number {
  hash ^= value >>> 0
  return Math.imul(hash, 0x01000193) >>> 0
}

export function digestM1FlowView(view: FireFlowReadView): string {
  let hash = 0x811c9dc5
  hash = mixHash(hash, view.columns)
  hash = mixHash(hash, view.rows)
  for (let index = 0; index < view.intensity.length; index += 1) {
    hash = mixHash(hash, Math.round(view.obstacle[index]! * 65_535))
    hash = mixHash(hash, Math.round(view.flowX[index]! * 1_000_000))
    hash = mixHash(hash, Math.round(view.flowY[index]! * 1_000_000))
    hash = mixHash(hash, view.intensity[index]!)
  }
  return hash.toString(16).padStart(8, '0')
}

export function rectContainsPoint(rect: M1FixtureRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}
