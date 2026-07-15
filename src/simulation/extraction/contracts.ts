import type { DomainState, PearlTerminalOutcome, PearlType } from '../../domain/index.ts'
import type { FireFlowFieldConfig } from '../fire-flow/index.ts'

export const EXTRACTION_COMPOSITION_GRID_SIZE = 64
export const EXTRACTION_COMPOSITION_CELL_COUNT =
  EXTRACTION_COMPOSITION_GRID_SIZE * EXTRACTION_COMPOSITION_GRID_SIZE

export type MaterialCompositionCode = 0 | 1 | 2 | 3

export type ExtractionVector = Readonly<{ x: number; y: number }>

export type ExtractionMaterialDefinition = Readonly<{
  id: string
  targetPearlCount: number
  composition: Uint8Array
}>

export type ExtractionMaterialPlacementConfig = Readonly<{
  center: ExtractionVector
  width: number
  height: number
  offsetPerInstance: ExtractionVector
  rotationRadiansPerInstance: number
}>

export type ExtractionFireSourceConfig = Readonly<{
  origin: ExtractionVector
  halfAngleRadians: number
  minWidth: number
  maxWidth: number
}>

export type ExtractionPearlPhysicsConfig = Readonly<{
  radiusAtStandardVolume: number
  spawnVelocity: Readonly<{
    minX: number
    maxX: number
    minY: number
    maxY: number
  }>
  gravity: number
  driftX: number
  maxSpeed: number
  materialRestitution: number
  wallRestitution: number
  fireProtectionSeconds: number
  resetProtectionOnExit: boolean
  burnDurationSeconds: number
  thrustAcceleration: number
}>

export type ExtractionCollectorConfig = Readonly<{
  initialCenter: ExtractionVector
  width: number
  height: number
  trackMinX: number
  trackMaxX: number
  acceleration: number
  deceleration: number
  maxSpeed: number
}>

export type ExtractionWorldBounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export type ExtractionSimulationConfig = Readonly<{
  seed: number
  standardPearlVolume: number
  fixedDeltaSeconds: number
  dissolutionVolumePerTick: number
  exposureProbeDistance: number
  naturalLossRatePerMinute: number
  safeZoneY: number
  fireFlow: FireFlowFieldConfig
  materials: readonly ExtractionMaterialDefinition[]
  materialPlacement: ExtractionMaterialPlacementConfig
  fireSource: ExtractionFireSourceConfig
  pearlPhysics: Readonly<Record<PearlType, ExtractionPearlPhysicsConfig>>
  collector: ExtractionCollectorConfig
  worldBounds: ExtractionWorldBounds
}>

export type ExtractionSimulationTickInput = Readonly<{
  tick: number
  domainState: DomainState
}>

export type ExtractionSimulationPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ExtractionMaterialPlacement = Readonly<{
  center: ExtractionVector
  width: number
  height: number
  rotationRadians: number
  layer: number
}>

export type ExtractionMaterialReadView = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: ExtractionMaterialPlacement
  initialVolume: number
  remainingVolume: number
  initialVolumeByType: Readonly<Record<PearlType, number>>
  composition: readonly number[]
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
}>

export type ExtractionPearlReadView = Readonly<{
  pearlId: string
  sourceMaterialDefinitionId: string
  sourceMaterialInstanceId: string
  pearlType: PearlType
  currentVolume: number
  initialVolume: number
  radius: number
  position: ExtractionVector
  velocity: ExtractionVector
  state: 'active' | 'caught' | 'missed' | 'burned'
  shield: Readonly<{ active: boolean; exposureTicks: number }>
  safeZone: Readonly<{ entered: boolean; enteredTick: number | null }>
}>

export type ExtractionCollectorReadView = Readonly<{
  center: ExtractionVector
  width: number
  height: number
  velocityX: number
}>

export type ExtractionFireFlowReadView = Readonly<{
  generation: number
  tick: number
  columns: number
  rows: number
  cellSize: number
  originX: number
  originY: number
  obstacle: Float32Array
  flowX: Float32Array
  flowY: Float32Array
  intensity: Uint8Array
}>

export type ExtractionEffectiveFireSource = Readonly<{
  position: ExtractionVector
  direction: ExtractionVector
  width: number
}>

export type ExtractionSimulationReadView = Readonly<{
  tick: number
  materials: readonly ExtractionMaterialReadView[]
  pearls: readonly ExtractionPearlReadView[]
  collector: ExtractionCollectorReadView
  fireFlow: ExtractionFireFlowReadView
  effectiveFireSource: ExtractionEffectiveFireSource | null
}>

export type ExtractionPearlTerminal = Readonly<{
  pearlId: string
  outcome: Extract<PearlTerminalOutcome, 'caught' | 'missed'>
}>
