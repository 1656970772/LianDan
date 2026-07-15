import type {
  ExtractionFailureResult,
  LossWarningLevel,
  PearlType,
} from './model.ts'

export type DomainEvent =
  | Readonly<{
      type: 'MaterialAdded'
      tick: number
      materialInstanceId: string
      materialDefinitionId: string
      inventoryBatchId: string
      initialVolume: number
    }>
  | Readonly<{
      type: 'PearlBorn'
      tick: number
      pearlId: string
      sourceMaterialDefinitionId: string
      sourceMaterialInstanceId: string
      pearlType: PearlType
      volume: number
    }>
  | Readonly<{
      type: 'PearlCaught' | 'PearlMissed' | 'PearlBurned'
      tick: number
      pearlId: string
    }>
  | Readonly<{
      type: 'PearlShieldActivated'
      tick: number
      pearlId: string
    }>
  | Readonly<{
      type: 'PearlDamaged'
      tick: number
      pearlId: string
      previousVolume: number
      currentVolume: number
    }>
  | Readonly<{
      type: 'PearlInteractionStarted'
      tick: number
      interactionId: string
      pearlAId: string
      pearlBId: string
    }>
  | Readonly<{
      type: 'LossWarningChanged'
      tick: number
      previousLevel: LossWarningLevel
      currentLevel: LossWarningLevel
    }>
  | Readonly<{
      type: 'ExtractionFailed'
      tick: number
      result: ExtractionFailureResult
    }>
  | Readonly<{
      type: 'CanFinish' | 'ExtractionCompleted'
      tick: number
    }>
