import type { JsonSchema, NormalizedConfig, RawConfigDocument } from './model'

export interface M2GameplaySchemaBundle {
  readonly manifest: JsonSchema
  readonly prototype: JsonSchema
  readonly fireSources: JsonSchema
  readonly pearlTypes: JsonSchema
  readonly collector: JsonSchema
  readonly interactions: JsonSchema
}

export interface RawM2GameplayConfig {
  readonly manifest: RawConfigDocument
  readonly prototype: RawConfigDocument
  readonly fireSources: RawConfigDocument
  readonly pearlTypes: RawConfigDocument
  readonly collector: RawConfigDocument
  readonly interactions?: RawConfigDocument
}

export type M2Vector = Readonly<{ x: number; y: number }>

export interface NormalizedM2Theme {
  readonly colors: Readonly<{
    background: string
    surface: string
    surfaceRaised: string
    border: string
    text: string
    muted: string
    accent: string
    danger: string
    focus: string
  }>
  readonly radius: number
}

export interface NormalizedM2Prototype {
  readonly seed: number
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly materialPlacement: Readonly<{
    centerX: number
    centerY: number
    size: number
    offsetPerInstance: M2Vector
    rotationDegreesPerInstance: number
  }>
  readonly availableFireSourceIds: readonly string[]
  readonly initialFireSize: number
  readonly fireSizeWheelStep: number
  readonly initialFireDirection: M2Vector
  readonly theme: NormalizedM2Theme
  readonly inventoryBatches: readonly Readonly<{
    batchId: string
    materialDefinitionId: string
    servings: number
    preservationStateId?: string
    growthSourceId?: string
    ageYears?: number
    tags?: readonly Readonly<{ tagId: string; strength: number }>[]
  }>[]
}

export type NormalizedM2InteractionSelector = Readonly<{
  materialDefinitionIds: readonly string[]
  requiredTagIds: readonly string[]
  pearlTypes: readonly ('medicinalLiquid' | 'slag' | 'impurity')[]
}>

export type NormalizedM2Interaction = Readonly<{
  id: string
  nameZh?: string
  behavior: 'fight'
  participantA: NormalizedM2InteractionSelector
  participantB: NormalizedM2InteractionSelector
  distance: number
  durationSeconds: number
  impulse: number
  cooldownSeconds: number
}>

export interface NormalizedM2FireSource {
  readonly id: string
  readonly nameZh: string
  readonly origin: M2Vector
  readonly halfAngleDegrees: number
  readonly minWidth: number
  readonly maxWidth: number
}

export interface NormalizedM2PearlType {
  readonly id: string
  readonly pearlType: 'medicinalLiquid' | 'slag' | 'impurity'
  readonly standardRadius: number
  readonly color: string
  readonly outlineColor: string
  readonly spawnVelocity: Readonly<{
    minX: number
    maxX: number
    minY: number
    maxY: number
  }>
  readonly gravity: number
  readonly drift: number
  readonly maxSpeed: number
  readonly materialRestitution: number
  readonly wallRestitution: number
  readonly fireProtectionSeconds: number
  readonly resetProtectionOnExit: boolean
  readonly burnDurationSeconds: number
  readonly thrustAcceleration: number
}

export interface NormalizedM2Collector {
  readonly initialX: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly minX: number
  readonly maxX: number
  readonly acceleration: number
  readonly deceleration: number
  readonly maxSpeed: number
}

export interface NormalizedM2GameplayConfig {
  readonly schemaVersion: 1
  readonly prototype: NormalizedM2Prototype
  readonly fireSources: readonly NormalizedM2FireSource[]
  readonly pearlTypes: readonly NormalizedM2PearlType[]
  readonly collector: NormalizedM2Collector
  readonly interactions?: readonly NormalizedM2Interaction[]
}

export interface NormalizedM2Config {
  readonly schemaVersion: 1
  readonly base: NormalizedConfig
  readonly gameplay: NormalizedM2GameplayConfig
}
