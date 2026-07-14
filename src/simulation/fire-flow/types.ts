export interface FireFlowGridGeometry {
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly originX: number
  readonly originY: number
}

export interface FireFlowSolverConfig {
  readonly circleCoverageSamplesPerAxis: number
  readonly lateralSpread: number
  readonly obstacleDeflection: number
  readonly partialObstaclePenalty: number
  readonly mergeRate: number
  readonly fullObstacleThreshold: number
}

export interface FireFlowFieldConfig {
  readonly geometry: FireFlowGridGeometry
  readonly solver: FireFlowSolverConfig
}

export interface FireFlowSource {
  readonly x: number
  readonly y: number
  readonly directionX: number
  readonly directionY: number
  readonly width: number
}

/**
 * Dynamic circles use structure-of-arrays storage so callers can pass their
 * simulation buffers directly. Only entries in [0, count) are read and a zero
 * eligible byte excludes an entry without compacting the arrays.
 */
export interface FireFlowCircleObstacles {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly radius: Float32Array
  readonly eligible: Uint8Array
  readonly count: number
}

export interface FireFlowUpdateInput {
  readonly tick: number
  readonly source: FireFlowSource | null
  readonly fullObstacles: Uint8Array
  readonly circles: FireFlowCircleObstacles
}

/**
 * A borrowed view. The object and buffers stay identical across updates; their
 * contents, tick and generation are replaced by the next update.
 */
export interface FireFlowReadView {
  readonly generation: number
  readonly tick: number
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
