import type { PearlType } from './model.ts'

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
      type: 'CanFinish' | 'ExtractionCompleted'
      tick: number
    }>
