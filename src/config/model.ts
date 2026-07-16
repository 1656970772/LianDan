export type JsonSchema = Record<string, unknown>

export interface ConfigSchemaBundle {
  readonly configSet: JsonSchema
  readonly parameters: JsonSchema
  readonly material: JsonSchema
  readonly tags: JsonSchema
}

export interface RawConfigDocument {
  readonly filePath: string
  value: unknown
}

export interface RawConfigSet {
  readonly configSet: RawConfigDocument
  readonly parameters: RawConfigDocument
  readonly tags?: RawConfigDocument
  readonly materials: RawConfigDocument[]
}

export type MaterialTagCategory =
  | 'medicinalProperty'
  | 'efficacyClue'
  | 'reactionTrait'
  | 'risk'
  | 'state'

export type IntrinsicMaterialTagCategory = Exclude<MaterialTagCategory, 'state'>

export type NormalizedTagStrength = Readonly<{
  tagId: string
  strength: number
}>

export type NormalizedTagDefinition = Readonly<{
  id: string
  nameZh: string
  category: MaterialTagCategory
  descriptionZh: string
}>

export type NormalizedTagCatalog = Readonly<{
  definitions: readonly NormalizedTagDefinition[]
  stateDerivation: Readonly<{
    preservationStates: readonly Readonly<{
      stateId: string
      tagId: string
      strength: number
    }>[]
    growthSources: readonly Readonly<{
      stateId: string
      tagId: string
      strength: number
    }>[]
    ages: readonly Readonly<{
      ageYears: number
      tagId: string
      strength: number
    }>[]
  }>
}>

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
  readonly dissolution: Readonly<{
    readonly volumePerTick: number
    readonly exposureProbeDistance: number
    readonly frontLaneWidthCells: number
  }>
  readonly loss: Readonly<{
    readonly naturalRatePerMinute: number
    readonly warningThresholds: readonly [number, number]
    readonly failureThreshold: number
  }>
}

export interface NormalizedMaterial {
  readonly id: string
  readonly nameZh: string
  readonly appearancePath?: string
  readonly pearlColor?: string
  readonly targetPearlCount: number
  readonly compositionMapPath: string
  readonly intrinsicTags?: Readonly<
    Record<IntrinsicMaterialTagCategory, readonly NormalizedTagStrength[]>
  >
}

export interface NormalizedConfig {
  readonly schemaVersion: 1
  readonly parameters: NormalizedParameters
  readonly tags?: NormalizedTagCatalog
  readonly materials: readonly NormalizedMaterial[]
}

export interface DecodedCompositionMap {
  readonly filePath: string
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}
