import type {
  DomainState,
  PearlTerminalOutcome,
  PearlType,
} from '../domain/index.ts'

export type PearlId = string
export type MaterialDefinitionId = string
export type MaterialInstanceId = string
export type TagId = string
export type PearlTypeId = string
export type InteractionProfileId = string

export type PearlEntity = Readonly<{
  pearlId: PearlId
  sourceMaterialDefinitionId: MaterialDefinitionId
  sourceMaterialInstanceId: MaterialInstanceId
  type: PearlType
  tags: readonly TagId[]
  configRef: Readonly<{
    pearlTypeId: PearlTypeId
    interactionProfileIds: readonly InteractionProfileId[]
  }>
  currentVolume: number
  radius: number
  position: Readonly<{ x: number; y: number }>
  velocity: Readonly<{ x: number; y: number }>
  state: 'newborn' | 'active' | 'caught' | 'missed' | 'burned'
  shield: Readonly<{ active: boolean; remainingTicks: number }>
  damage: Readonly<{ accumulated: number; protectionTicks: number }>
  interactionTimers: Readonly<Record<string, number>>
  safeZone: Readonly<{ entered: boolean; enteredTick: number | null }>
}>

export type DissolutionDelta = Readonly<{
  materialDefinitionId: MaterialDefinitionId
  materialInstanceId: MaterialInstanceId
  pearlType: PearlType
  volume: number
}>

export type PearlBirthDelta = Readonly<{
  pearlId: PearlId
  sourceMaterialDefinitionId: MaterialDefinitionId
  sourceMaterialInstanceId: MaterialInstanceId
  pearlType: PearlType
  volume: number
}>

export type PearlVolumeChangeDelta = Readonly<{
  pearlId: PearlId
  previousVolume: number
  currentVolume: number
}>

export type PearlTerminalDelta = Readonly<{
  pearlId: PearlId
  outcome: PearlTerminalOutcome
}>

export type NaturalLossDelta =
  | Readonly<{
      sourceKind: 'materialCell'
      stableEntityId: string
      materialInstanceId: MaterialInstanceId
      pearlType: PearlType
      volume: number
    }>
  | Readonly<{
      sourceKind: 'pearl'
      stableEntityId: string
      pearlId: PearlId
      volume: number
    }>

export type InheritedLossDelta = Readonly<{
  materialInstanceId: MaterialInstanceId
  theoreticalMedicinalVolume: number
  volume: number
}>

export type MaterialVolumeChangeDelta = Readonly<{
  materialInstanceId: MaterialInstanceId
  previousVolume: number
  currentVolume: number
}>

export type PearlShieldActivationDelta = Readonly<{
  pearlId: PearlId
}>

export type PearlInteractionDelta = Readonly<{
  interactionId: InteractionProfileId
  pearlAId: PearlId
  pearlBId: PearlId
}>

export type SimulationDelta = Readonly<{
  tick: number
  dissolutions: readonly DissolutionDelta[]
  births: readonly PearlBirthDelta[]
  pearlVolumeChanges: readonly PearlVolumeChangeDelta[]
  terminalOutcomes: readonly PearlTerminalDelta[]
  naturalLosses: readonly NaturalLossDelta[]
  inheritedLosses: readonly InheritedLossDelta[]
  materialVolumeChanges?: readonly MaterialVolumeChangeDelta[]
  shieldActivations?: readonly PearlShieldActivationDelta[]
  interactions?: readonly PearlInteractionDelta[]
}>

export type SimulationDeltaError =
  | 'SIM_DELTA_INVALID_TICK'
  | 'SIM_DELTA_NON_FINITE_VOLUME'
  | 'SIM_DELTA_NEGATIVE_VOLUME'
  | 'SIM_DELTA_ENTITY_NOT_FOUND'
  | 'SIM_DELTA_DUPLICATE_ENTITY'
  | 'SIM_DELTA_VOLUME_MISMATCH'
  | 'SIM_DELTA_NEWBORN_TERMINAL'
  | 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE'

export type SimulationDeltaCommitResult =
  | Readonly<{ ok: true; state: DomainState }>
  | Readonly<{ ok: false; error: SimulationDeltaError; state: DomainState }>

export type PearlLifecycleBuffers = Readonly<{
  active: readonly PearlEntity[]
  newborn: readonly PearlEntity[]
}>

const TERMINAL_PRIORITY: Readonly<Record<PearlTerminalOutcome, number>> = {
  missed: 0,
  caught: 1,
  burned: 2,
}

export function resolvePearlTerminalOutcome(
  outcomes: readonly PearlTerminalOutcome[],
): PearlTerminalOutcome | null {
  let selected: PearlTerminalOutcome | null = null
  for (const outcome of outcomes) {
    if (selected === null || TERMINAL_PRIORITY[outcome] > TERMINAL_PRIORITY[selected]) {
      selected = outcome
    }
  }
  return selected
}

export function activateNewbornForNextTick(
  buffers: PearlLifecycleBuffers,
): PearlLifecycleBuffers {
  return {
    active: [
      ...buffers.active,
      ...buffers.newborn.map((pearl) => ({ ...pearl, state: 'active' as const })),
    ],
    newborn: [],
  }
}
