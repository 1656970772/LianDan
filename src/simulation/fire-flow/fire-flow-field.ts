import type {
  FireFlowCircleObstacles,
  FireFlowFieldConfig,
  FireFlowReadView,
  FireFlowSource,
  FireFlowUpdateInput,
} from './types.ts'

interface MutableFireFlowReadView {
  generation: number
  tick: number
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly originX: number
  readonly originY: number
  readonly obstacle: Float32Array
  readonly flowX: Float32Array
  readonly flowY: Float32Array
  readonly intensity: Uint8Array
}

const NEIGHBOR_COLUMN_OFFSETS = new Int8Array([-1, 0, 1, -1, 1, -1, 0, 1])
const NEIGHBOR_ROW_OFFSETS = new Int8Array([-1, -1, -1, 0, 0, 1, 1, 1])
const DISTANCE_EPSILON = 1e-10
const FORWARD_EPSILON = 1e-7

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`)
  }
}

function requireUnitInterval(name: string, value: number): void {
  requireFinite(name, value)
  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`)
  }
}

function validateConfig(config: FireFlowFieldConfig): void {
  const { geometry, solver } = config
  if (!Number.isInteger(geometry.columns) || geometry.columns <= 0) {
    throw new RangeError('geometry.columns must be a positive integer')
  }
  if (!Number.isInteger(geometry.rows) || geometry.rows <= 0) {
    throw new RangeError('geometry.rows must be a positive integer')
  }
  requireFinite('geometry.cellSize', geometry.cellSize)
  if (geometry.cellSize <= 0) {
    throw new RangeError('geometry.cellSize must be greater than 0')
  }
  requireFinite('geometry.originX', geometry.originX)
  requireFinite('geometry.originY', geometry.originY)

  if (
    !Number.isInteger(solver.circleCoverageSamplesPerAxis) ||
    solver.circleCoverageSamplesPerAxis < 1 ||
    solver.circleCoverageSamplesPerAxis > 16
  ) {
    throw new RangeError('solver.circleCoverageSamplesPerAxis must be an integer from 1 to 16')
  }
  requireUnitInterval('solver.lateralSpread', solver.lateralSpread)
  requireUnitInterval('solver.obstacleDeflection', solver.obstacleDeflection)
  requireUnitInterval('solver.partialObstaclePenalty', solver.partialObstaclePenalty)
  requireUnitInterval('solver.mergeRate', solver.mergeRate)
  requireFinite('solver.fullObstacleThreshold', solver.fullObstacleThreshold)
  if (solver.fullObstacleThreshold <= 0 || solver.fullObstacleThreshold > 1) {
    throw new RangeError('solver.fullObstacleThreshold must be greater than 0 and at most 1')
  }
}

function validateCircles(circles: FireFlowCircleObstacles): void {
  const { count } = circles
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('circles.count must be a non-negative integer')
  }
  if (
    circles.x.length < count ||
    circles.y.length < count ||
    circles.radius.length < count ||
    circles.eligible.length < count
  ) {
    throw new RangeError('circle SoA array lengths must cover circles.count')
  }
}

function validateSource(source: FireFlowSource): number {
  requireFinite('source.x', source.x)
  requireFinite('source.y', source.y)
  requireFinite('source.directionX', source.directionX)
  requireFinite('source.directionY', source.directionY)
  requireFinite('source.width', source.width)
  if (source.width < 0) {
    throw new RangeError('source.width must be non-negative')
  }
  const directionLength = Math.hypot(source.directionX, source.directionY)
  if (directionLength <= 0) {
    throw new RangeError('source direction must be non-zero')
  }
  return directionLength
}

export class FireFlowField {
  readonly #config: FireFlowFieldConfig
  readonly #cellCount: number
  readonly #view: MutableFireFlowReadView
  readonly #distance: Float64Array
  readonly #parent: Int32Array
  readonly #heapNodes: Int32Array
  readonly #heapPositions: Int32Array
  #heapSize = 0

  constructor(config: FireFlowFieldConfig) {
    validateConfig(config)
    this.#config = config
    this.#cellCount = config.geometry.columns * config.geometry.rows
    const obstacle = new Float32Array(this.#cellCount)
    const flowX = new Float32Array(this.#cellCount)
    const flowY = new Float32Array(this.#cellCount)
    const intensity = new Uint8Array(this.#cellCount)
    this.#view = {
      generation: 0,
      tick: -1,
      columns: config.geometry.columns,
      rows: config.geometry.rows,
      cellSize: config.geometry.cellSize,
      originX: config.geometry.originX,
      originY: config.geometry.originY,
      obstacle,
      flowX,
      flowY,
      intensity,
    }
    this.#distance = new Float64Array(this.#cellCount)
    this.#parent = new Int32Array(this.#cellCount)
    this.#heapNodes = new Int32Array(this.#cellCount)
    this.#heapPositions = new Int32Array(this.#cellCount)
  }

  read(): FireFlowReadView {
    return this.#view
  }

  update(input: FireFlowUpdateInput): FireFlowReadView {
    if (!Number.isSafeInteger(input.tick) || input.tick < 0) {
      throw new RangeError('tick must be a non-negative safe integer')
    }
    if (input.fullObstacles.length !== this.#cellCount) {
      throw new RangeError(`fullObstacles length must equal ${this.#cellCount}`)
    }
    validateCircles(input.circles)

    this.#rebuildObstacles(input.fullObstacles, input.circles)
    this.#view.flowX.fill(0)
    this.#view.flowY.fill(0)
    this.#view.intensity.fill(0)

    if (input.source !== null) {
      const directionLength = validateSource(input.source)
      this.#solve(input.source, directionLength)
    }

    this.#view.tick = input.tick
    this.#view.generation += 1
    return this.#view
  }

  #rebuildObstacles(fullObstacles: Uint8Array, circles: FireFlowCircleObstacles): void {
    const obstacle = this.#view.obstacle
    for (let cellIndex = 0; cellIndex < this.#cellCount; cellIndex += 1) {
      obstacle[cellIndex] = fullObstacles[cellIndex] === 0 ? 0 : 1
    }

    const { geometry, solver } = this.#config
    const samplesPerAxis = solver.circleCoverageSamplesPerAxis
    const samplesPerCell = samplesPerAxis * samplesPerAxis
    const sampleStep = geometry.cellSize / samplesPerAxis
    const sampleOffset = sampleStep * 0.5
    const maximumColumn = geometry.columns - 1
    const maximumRow = geometry.rows - 1

    for (let circleIndex = 0; circleIndex < circles.count; circleIndex += 1) {
      if (circles.eligible[circleIndex] === 0) continue
      const circleX = circles.x[circleIndex]
      const circleY = circles.y[circleIndex]
      const radius = circles.radius[circleIndex]
      if (circleX === undefined || circleY === undefined || radius === undefined) continue
      if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
        throw new RangeError(`eligible circle ${circleIndex} must contain finite values`)
      }
      if (radius <= 0) continue

      const unclampedMinimumColumn = Math.floor(
        (circleX - radius - geometry.originX) / geometry.cellSize,
      )
      const unclampedMaximumColumn = Math.floor(
        (circleX + radius - geometry.originX) / geometry.cellSize,
      )
      const unclampedMinimumRow = Math.floor(
        (circleY - radius - geometry.originY) / geometry.cellSize,
      )
      const unclampedMaximumRow = Math.floor(
        (circleY + radius - geometry.originY) / geometry.cellSize,
      )
      if (
        unclampedMaximumColumn < 0 ||
        unclampedMinimumColumn > maximumColumn ||
        unclampedMaximumRow < 0 ||
        unclampedMinimumRow > maximumRow
      ) {
        continue
      }

      const minimumColumn = Math.max(0, unclampedMinimumColumn)
      const maximumColumnForCircle = Math.min(maximumColumn, unclampedMaximumColumn)
      const minimumRow = Math.max(0, unclampedMinimumRow)
      const maximumRowForCircle = Math.min(maximumRow, unclampedMaximumRow)
      const radiusSquared = radius * radius

      for (let row = minimumRow; row <= maximumRowForCircle; row += 1) {
        const cellY = geometry.originY + row * geometry.cellSize
        for (let column = minimumColumn; column <= maximumColumnForCircle; column += 1) {
          const cellIndex = row * geometry.columns + column
          if (obstacle[cellIndex] === 1) continue
          const cellX = geometry.originX + column * geometry.cellSize
          let coveredSamples = 0
          for (let sampleRow = 0; sampleRow < samplesPerAxis; sampleRow += 1) {
            const deltaY = cellY + sampleOffset + sampleRow * sampleStep - circleY
            const deltaYSquared = deltaY * deltaY
            for (let sampleColumn = 0; sampleColumn < samplesPerAxis; sampleColumn += 1) {
              const deltaX = cellX + sampleOffset + sampleColumn * sampleStep - circleX
              if (deltaX * deltaX + deltaYSquared <= radiusSquared) {
                coveredSamples += 1
              }
            }
          }
          if (coveredSamples === 0) continue
          const accumulated = (obstacle[cellIndex] ?? 0) + coveredSamples / samplesPerCell
          obstacle[cellIndex] = accumulated >= 1 ? 1 : accumulated
        }
      }
    }
  }

  #solve(source: FireFlowSource, directionLength: number): void {
    const { geometry, solver } = this.#config
    const directionX = source.directionX / directionLength
    const directionY = source.directionY / directionLength
    const perpendicularX = -directionY
    const perpendicularY = directionX
    const halfWidth = Math.max(source.width * 0.5, geometry.cellSize * 0.5)

    this.#distance.fill(Number.POSITIVE_INFINITY)
    this.#parent.fill(-1)
    this.#heapPositions.fill(-1)
    this.#heapSize = 0

    let minimumProjection = Number.POSITIVE_INFINITY
    for (let row = 0; row < geometry.rows; row += 1) {
      const cellY = geometry.originY + (row + 0.5) * geometry.cellSize
      for (let column = 0; column < geometry.columns; column += 1) {
        const cellIndex = row * geometry.columns + column
        if (this.#isBlocked(cellIndex)) continue
        const cellX = geometry.originX + (column + 0.5) * geometry.cellSize
        const relativeX = cellX - source.x
        const relativeY = cellY - source.y
        const projection = relativeX * directionX + relativeY * directionY
        if (projection < -geometry.cellSize * 0.5 - FORWARD_EPSILON) continue
        const lateral = Math.abs(relativeX * perpendicularX + relativeY * perpendicularY)
        if (lateral > halfWidth + FORWARD_EPSILON) continue
        if (projection < minimumProjection) minimumProjection = projection
      }
    }
    if (!Number.isFinite(minimumProjection)) return

    const seedDepth = geometry.cellSize * 0.51
    for (let row = 0; row < geometry.rows; row += 1) {
      const cellY = geometry.originY + (row + 0.5) * geometry.cellSize
      for (let column = 0; column < geometry.columns; column += 1) {
        const cellIndex = row * geometry.columns + column
        if (this.#isBlocked(cellIndex)) continue
        const cellX = geometry.originX + (column + 0.5) * geometry.cellSize
        const relativeX = cellX - source.x
        const relativeY = cellY - source.y
        const projection = relativeX * directionX + relativeY * directionY
        if (
          projection < minimumProjection - FORWARD_EPSILON ||
          projection > minimumProjection + seedDepth
        ) {
          continue
        }
        const lateral = Math.abs(relativeX * perpendicularX + relativeY * perpendicularY)
        if (lateral > halfWidth + FORWARD_EPSILON) continue
        this.#distance[cellIndex] = Math.max(0, projection)
        this.#pushOrDecrease(cellIndex)
      }
    }

    while (this.#heapSize > 0) {
      const cellIndex = this.#popMinimum()
      this.#view.intensity[cellIndex] = 1
      const parentIndex = this.#parent[cellIndex]
      if (parentIndex === undefined || parentIndex < 0) {
        this.#view.flowX[cellIndex] = directionX
        this.#view.flowY[cellIndex] = directionY
      } else {
        const column = cellIndex % geometry.columns
        const row = Math.floor(cellIndex / geometry.columns)
        const parentColumn = parentIndex % geometry.columns
        const parentRow = Math.floor(parentIndex / geometry.columns)
        const stepX = column - parentColumn
        const stepY = row - parentRow
        const stepLength = Math.hypot(stepX, stepY)
        const pathX = stepX / stepLength
        const pathY = stepY / stepLength
        const parentFlowX = this.#view.flowX[parentIndex] ?? directionX
        const parentFlowY = this.#view.flowY[parentIndex] ?? directionY
        const guidedX =
          pathX * (1 - solver.obstacleDeflection) + parentFlowX * solver.obstacleDeflection
        const guidedY =
          pathY * (1 - solver.obstacleDeflection) + parentFlowY * solver.obstacleDeflection
        const mixedX = guidedX * (1 - solver.mergeRate) + directionX * solver.mergeRate
        const mixedY = guidedY * (1 - solver.mergeRate) + directionY * solver.mergeRate
        const mixedLength = Math.hypot(mixedX, mixedY)
        this.#view.flowX[cellIndex] = mixedX / mixedLength
        this.#view.flowY[cellIndex] = mixedY / mixedLength
      }

      const column = cellIndex % geometry.columns
      const row = Math.floor(cellIndex / geometry.columns)
      const currentDistance = this.#distance[cellIndex] ?? Number.POSITIVE_INFINITY
      for (let neighbor = 0; neighbor < NEIGHBOR_COLUMN_OFFSETS.length; neighbor += 1) {
        const columnOffset = NEIGHBOR_COLUMN_OFFSETS[neighbor]
        const rowOffset = NEIGHBOR_ROW_OFFSETS[neighbor]
        if (columnOffset === undefined || rowOffset === undefined) continue
        const candidateColumn = column + columnOffset
        const candidateRow = row + rowOffset
        if (
          candidateColumn < 0 ||
          candidateColumn >= geometry.columns ||
          candidateRow < 0 ||
          candidateRow >= geometry.rows
        ) {
          continue
        }

        const stepLength = columnOffset === 0 || rowOffset === 0 ? 1 : Math.SQRT2
        const stepX = columnOffset / stepLength
        const stepY = rowOffset / stepLength
        const forward = stepX * directionX + stepY * directionY
        if (forward <= FORWARD_EPSILON) continue
        const candidateIndex = candidateRow * geometry.columns + candidateColumn
        if (this.#isBlocked(candidateIndex) || this.#heapPositions[candidateIndex] === -2) continue

        const lateral = Math.abs(stepX * perpendicularX + stepY * perpendicularY)
        const lateralScale = 0.05 + solver.lateralSpread * 0.95
        const lateralPenalty = (lateral * lateral) / lateralScale
        const obstacleValue = this.#view.obstacle[candidateIndex] ?? 0
        const obstaclePenalty =
          obstacleValue * (solver.partialObstaclePenalty + solver.obstacleDeflection * lateral)
        const candidateCenterX = geometry.originX + (candidateColumn + 0.5) * geometry.cellSize
        const candidateCenterY = geometry.originY + (candidateRow + 0.5) * geometry.cellSize
        const centerlineDistance = Math.abs(
          (candidateCenterX - source.x) * perpendicularX +
            (candidateCenterY - source.y) * perpendicularY,
        )
        const mergePenalty =
          solver.mergeRate * (centerlineDistance / geometry.cellSize) * 0.01
        const candidateDistance =
          currentDistance +
          stepLength * geometry.cellSize *
            (1 + lateralPenalty + obstaclePenalty + mergePenalty)
        const existingDistance = this.#distance[candidateIndex] ?? Number.POSITIVE_INFINITY
        const existingParent = this.#parent[candidateIndex] ?? -1
        if (
          candidateDistance < existingDistance - DISTANCE_EPSILON ||
          (Math.abs(candidateDistance - existingDistance) <= DISTANCE_EPSILON &&
            (existingParent < 0 || cellIndex < existingParent))
        ) {
          this.#distance[candidateIndex] = candidateDistance
          this.#parent[candidateIndex] = cellIndex
          this.#pushOrDecrease(candidateIndex)
        }
      }
    }
  }

  #isBlocked(cellIndex: number): boolean {
    const value = this.#view.obstacle[cellIndex] ?? 0
    return value === 1 || value >= this.#config.solver.fullObstacleThreshold
  }

  #pushOrDecrease(cellIndex: number): void {
    const position = this.#heapPositions[cellIndex]
    if (position === undefined || position < 0) {
      const insertionPosition = this.#heapSize
      this.#heapSize += 1
      this.#heapNodes[insertionPosition] = cellIndex
      this.#heapPositions[cellIndex] = insertionPosition
      this.#bubbleUp(insertionPosition)
      return
    }
    this.#bubbleUp(position)
  }

  #popMinimum(): number {
    const minimum = this.#heapNodes[0] ?? -1
    this.#heapSize -= 1
    if (this.#heapSize > 0) {
      const tail = this.#heapNodes[this.#heapSize] ?? -1
      this.#heapNodes[0] = tail
      this.#heapPositions[tail] = 0
      this.#bubbleDown(0)
    }
    this.#heapPositions[minimum] = -2
    return minimum
  }

  #bubbleUp(startPosition: number): void {
    let position = startPosition
    while (position > 0) {
      const parentPosition = Math.floor((position - 1) * 0.5)
      const node = this.#heapNodes[position] ?? -1
      const parent = this.#heapNodes[parentPosition] ?? -1
      if (!this.#comesBefore(node, parent)) break
      this.#heapNodes[position] = parent
      this.#heapNodes[parentPosition] = node
      this.#heapPositions[parent] = position
      this.#heapPositions[node] = parentPosition
      position = parentPosition
    }
  }

  #bubbleDown(startPosition: number): void {
    let position = startPosition
    while (true) {
      const left = position * 2 + 1
      if (left >= this.#heapSize) return
      const right = left + 1
      let child = left
      if (
        right < this.#heapSize &&
        this.#comesBefore(this.#heapNodes[right] ?? -1, this.#heapNodes[left] ?? -1)
      ) {
        child = right
      }
      const node = this.#heapNodes[position] ?? -1
      const childNode = this.#heapNodes[child] ?? -1
      if (!this.#comesBefore(childNode, node)) return
      this.#heapNodes[position] = childNode
      this.#heapNodes[child] = node
      this.#heapPositions[childNode] = position
      this.#heapPositions[node] = child
      position = child
    }
  }

  #comesBefore(left: number, right: number): boolean {
    const leftDistance = this.#distance[left] ?? Number.POSITIVE_INFINITY
    const rightDistance = this.#distance[right] ?? Number.POSITIVE_INFINITY
    if (leftDistance < rightDistance - DISTANCE_EPSILON) return true
    if (leftDistance > rightDistance + DISTANCE_EPSILON) return false
    return left < right
  }
}
