export type JsonSchema = Record<string, unknown>

export interface ConfigSchemaBundle {
  readonly configSet: JsonSchema
  readonly parameters: JsonSchema
  readonly material: JsonSchema
}

export interface RawConfigDocument {
  readonly filePath: string
  value: unknown
}

export interface RawConfigSet {
  readonly configSet: RawConfigDocument
  readonly parameters: RawConfigDocument
  readonly materials: RawConfigDocument[]
}

export interface NormalizedParameters {
  readonly standardPearlVolume: number
  readonly slagUnitVolume: number
  readonly simulation: Readonly<{
    readonly fixedStepHz: number
    readonly maxCatchUpSteps: number
  }>
  readonly flowField: Readonly<{
    readonly gridColumns: number
    readonly gridRows: number
    readonly cellSize: number
    readonly circleCoverageSamplesPerAxis: number
    readonly lateralSpread: number
    readonly obstacleDeflection: number
    readonly partialObstaclePenalty: number
    readonly mergeRate: number
    readonly fullObstacleThreshold: number
  }>
}

export interface NormalizedMaterial {
  readonly id: string
  readonly nameZh: string
  readonly targetPearlCount: number
  readonly compositionMapPath: string
}

export interface NormalizedConfig {
  readonly schemaVersion: 1
  readonly parameters: NormalizedParameters
  readonly materials: readonly NormalizedMaterial[]
}

export interface DecodedCompositionMap {
  readonly filePath: string
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}
