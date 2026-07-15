import {
  FIRE_SIZE_MAX,
  FIRE_SIZE_MIN,
  validateRuleCommandPayload,
  type RuleCommand,
} from './commands.ts'

export type DomainStatus = 'ready' | 'extracting' | 'failed' | 'completed'
export type PearlType = 'medicinalLiquid' | 'slag' | 'impurity'
export type PearlTerminalOutcome = 'caught' | 'missed' | 'burned'

export type Vector2 = Readonly<{ x: number; y: number }>

export type InventoryBatchRule = Readonly<{
  batchId: string
  materialDefinitionId: string
  servings: number
  volumePerServing: number
  medicinalLiquidVolumePerServing: number
  tagIds?: readonly string[]
}>

export type ExtractionSettlementRules = Readonly<{
  warningThresholds: readonly [number, number]
  failureThreshold: number
  slagUnitVolume: number
}>

export type PrototypeRules = Readonly<{
  availableFireSourceIds: readonly string[]
  initialFireSize: number
  initialFireDirection: Vector2
  inventoryBatches: readonly InventoryBatchRule[]
  settlement: ExtractionSettlementRules
}>

export type MaterialInstance = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  initialVolume: number
  remainingVolume: number
  theoreticalMedicinalVolume?: number
  inheritedLossAtAddition?: number
  tagIds?: readonly string[]
}>

export type PearlSource = Readonly<{
  sourceMaterialDefinitionId: string
  sourceMaterialInstanceId: string
  pearlType: PearlType
}>

export type VolumeByPearlType = Readonly<Partial<Record<PearlType, number>>>
export type PearlTypeVolumes = Readonly<Record<PearlType, number>>

export type DomainLedger = Readonly<{
  dissolvedVolumes: Readonly<Record<string, VolumeByPearlType>>
  bornVolumes: Readonly<Record<string, VolumeByPearlType>>
  pearlVolumes: Readonly<Record<string, number>>
  pearlSources: Readonly<Record<string, PearlSource>>
  terminalPearls: Readonly<Record<string, PearlTerminalOutcome>>
  theoreticalMedicinalVolumes: Readonly<Record<string, number>>
  naturalLossVolume: number
  inheritedLossVolume: number
  burnedMedicinalVolume: number
  missedMedicinalVolume: number
  caughtVolumes: PearlTypeVolumes
  slagPoolVolumes: PearlTypeVolumes
}>

export type LossWarningLevel = 0 | 1 | 2

export type ExtractionFailureResult = Readonly<{
  reason: 'excessiveMedicinalLoss'
  remainingEntityVolume: number
  slagQuantity: number
}>

export type DomainState = Readonly<{
  status: DomainStatus
  inventory: Readonly<Record<string, number>>
  selectedMaterialBatchId: string | null
  materialInstances: readonly MaterialInstance[]
  nextMaterialInstanceOrdinal: number
  equippedFireSourceId: string | null
  fireSize: number
  isSpraying: boolean
  fireDirection: Vector2
  containerAxis: number
  flameThrustEnabled: boolean
  finishRequested: boolean
  lossWarningLevel: LossWarningLevel
  failureResult: ExtractionFailureResult | null
  ledger: DomainLedger
  lastCommittedTick: number
}>

export type DomainCommandError =
  | 'DOMAIN_COMMAND_NOT_ALLOWED'
  | 'DOMAIN_COMMAND_PAYLOAD_INVALID'

export type DomainCommandResult =
  | Readonly<{ ok: true; state: DomainState }>
  | Readonly<{ ok: false; error: DomainCommandError; state: DomainState }>

function emptyLedger(): DomainLedger {
  return {
    dissolvedVolumes: {},
    bornVolumes: {},
    pearlVolumes: {},
    pearlSources: {},
    terminalPearls: {},
    theoreticalMedicinalVolumes: {},
    naturalLossVolume: 0,
    inheritedLossVolume: 0,
    burnedMedicinalVolume: 0,
    missedMedicinalVolume: 0,
    caughtVolumes: { medicinalLiquid: 0, slag: 0, impurity: 0 },
    slagPoolVolumes: { medicinalLiquid: 0, slag: 0, impurity: 0 },
  }
}

export function createDomainState(rules: PrototypeRules): DomainState {
  const inventory: Record<string, number> = {}
  for (const batch of rules.inventoryBatches) inventory[batch.batchId] = batch.servings

  return {
    status: 'ready',
    inventory,
    selectedMaterialBatchId: null,
    materialInstances: [],
    nextMaterialInstanceOrdinal: 1,
    equippedFireSourceId: null,
    fireSize: rules.initialFireSize,
    isSpraying: false,
    fireDirection: { ...rules.initialFireDirection },
    containerAxis: 0,
    flameThrustEnabled: false,
    finishRequested: false,
    lossWarningLevel: 0,
    failureResult: null,
    ledger: emptyLedger(),
    lastCommittedTick: -1,
  }
}

export function deriveTheoreticalMedicinalVolume(state: DomainState): number {
  return Object.values(state.ledger.theoreticalMedicinalVolumes).reduce(
    (total, volume) => total + volume,
    0,
  )
}

export function deriveLossRate(state: DomainState): number {
  const theoretical = deriveTheoreticalMedicinalVolume(state)
  if (theoretical <= 0) return 0
  const lost =
    state.ledger.naturalLossVolume +
    state.ledger.inheritedLossVolume +
    state.ledger.burnedMedicinalVolume +
    state.ledger.missedMedicinalVolume
  return Math.max(0, Math.min(1, lost / theoretical))
}

function totalSlagPoolVolume(state: DomainState): number {
  const volumes = state.ledger.slagPoolVolumes
  return volumes.medicinalLiquid + volumes.slag + volumes.impurity
}

function convertSlagVolume(volume: number, unitVolume: number): number {
  if (volume <= 0) return 0
  return Math.max(1, Math.floor(volume / unitVolume))
}

export function deriveNormalSlagQuantity(
  state: DomainState,
  rules: PrototypeRules,
): number {
  return convertSlagVolume(
    totalSlagPoolVolume(state),
    rules.settlement.slagUnitVolume,
  )
}

function deriveFailureRemainingEntityVolume(state: DomainState): number {
  let total = state.materialInstances.reduce(
    (sum, material) => sum + material.remainingVolume,
    0,
  )
  for (const [pearlId, volume] of Object.entries(state.ledger.pearlVolumes)) {
    const outcome = state.ledger.terminalPearls[pearlId]
    if (outcome === 'missed' || outcome === 'burned') continue
    total += volume
  }
  return total
}

export function evaluateExtractionState(
  state: DomainState,
  rules: PrototypeRules,
): DomainState {
  if (state.status !== 'extracting') return state
  const lossRate = deriveLossRate(state)
  const [warningOne, warningTwo] = rules.settlement.warningThresholds
  const lossWarningLevel: LossWarningLevel =
    lossRate >= warningTwo ? 2 : lossRate >= warningOne ? 1 : 0
  if (lossRate <= rules.settlement.failureThreshold) {
    if (state.lossWarningLevel === lossWarningLevel && state.failureResult === null) {
      return state
    }
    return { ...state, lossWarningLevel, failureResult: null }
  }

  const remainingEntityVolume = deriveFailureRemainingEntityVolume(state)
  return {
    ...state,
    status: 'failed',
    isSpraying: false,
    finishRequested: false,
    lossWarningLevel,
    failureResult: {
      reason: 'excessiveMedicinalLoss',
      remainingEntityVolume,
      slagQuantity: convertSlagVolume(
        remainingEntityVolume,
        rules.settlement.slagUnitVolume,
      ),
    },
  }
}

export function deriveActivePearlCount(state: DomainState): number {
  let count = 0
  for (const pearlId of Object.keys(state.ledger.pearlVolumes)) {
    if (state.ledger.terminalPearls[pearlId] === undefined) count += 1
  }
  return count
}

export function deriveCanFinish(state: DomainState): boolean {
  return (
    state.status === 'extracting' &&
    state.materialInstances.length > 0 &&
    state.materialInstances.every((instance) => instance.remainingVolume === 0) &&
    deriveActivePearlCount(state) === 0
  )
}

function isActive(status: DomainStatus): boolean {
  return status === 'ready' || status === 'extracting'
}

export function isRuleCommandAllowed(
  state: DomainState,
  command: RuleCommand,
  _rules: PrototypeRules,
): boolean {
  if (!validateRuleCommandPayload(command)) return false
  if (!isActive(state.status)) return false

  switch (command.type) {
    case 'SelectFireSource':
      return state.equippedFireSourceId === null
    case 'SetSpraying':
      return !command.payload.spraying || state.equippedFireSourceId !== null
    case 'RequestFinish':
      return deriveCanFinish(state)
    case 'PreselectMaterial':
    case 'CancelMaterialSelection':
    case 'AddSelectedMaterial':
    case 'SetFireDirection':
    case 'SetFireSize':
    case 'SetContainerAxis':
    case 'SetFlameThrust':
      return true
  }
}

function invalid(state: DomainState): DomainCommandResult {
  return { ok: false, error: 'DOMAIN_COMMAND_PAYLOAD_INVALID', state }
}

function allowed(state: DomainState): DomainCommandResult {
  return { ok: true, state }
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

export function addMaterialServingFromBatch(
  state: DomainState,
  inventoryBatchId: string,
  rules: PrototypeRules,
): DomainCommandResult {
  if (!isActive(state.status)) {
    return { ok: false, error: 'DOMAIN_COMMAND_NOT_ALLOWED', state }
  }
  const batch = rules.inventoryBatches.find(
    (candidate) => candidate.batchId === inventoryBatchId,
  )
  if (batch === undefined || (state.inventory[batch.batchId] ?? 0) <= 0) {
    return invalid(state)
  }

  const instance: MaterialInstance = {
    materialInstanceId: `material-instance-${state.nextMaterialInstanceOrdinal}`,
    materialDefinitionId: batch.materialDefinitionId,
    inventoryBatchId: batch.batchId,
    initialVolume: batch.volumePerServing,
    remainingVolume: batch.volumePerServing,
    theoreticalMedicinalVolume: batch.medicinalLiquidVolumePerServing,
    inheritedLossAtAddition:
      batch.medicinalLiquidVolumePerServing * deriveLossRate(state),
    tagIds: [...(batch.tagIds ?? [])],
  }
  return allowed({
    ...state,
    status: 'extracting',
    inventory: {
      ...state.inventory,
      [batch.batchId]: (state.inventory[batch.batchId] ?? 0) - 1,
    },
    materialInstances: [...state.materialInstances, instance],
    nextMaterialInstanceOrdinal: state.nextMaterialInstanceOrdinal + 1,
  })
}

export function applyRuleCommand(
  state: DomainState,
  command: RuleCommand,
  rules: PrototypeRules,
): DomainCommandResult {
  if (!validateRuleCommandPayload(command)) return invalid(state)
  if (!isRuleCommandAllowed(state, command, rules)) {
    return { ok: false, error: 'DOMAIN_COMMAND_NOT_ALLOWED', state }
  }

  switch (command.type) {
    case 'PreselectMaterial': {
      const batch = rules.inventoryBatches.find(
        (candidate) => candidate.batchId === command.payload.inventoryBatchId,
      )
      if (batch === undefined || (state.inventory[batch.batchId] ?? 0) <= 0) return invalid(state)
      return allowed({ ...state, selectedMaterialBatchId: batch.batchId })
    }
    case 'CancelMaterialSelection':
      return allowed({ ...state, selectedMaterialBatchId: null })
    case 'AddSelectedMaterial': {
      if (state.selectedMaterialBatchId === null) return invalid(state)
      return addMaterialServingFromBatch(state, state.selectedMaterialBatchId, rules)
    }
    case 'SelectFireSource':
      if (!rules.availableFireSourceIds.includes(command.payload.fireSourceId)) return invalid(state)
      return allowed({ ...state, equippedFireSourceId: command.payload.fireSourceId })
    case 'SetSpraying':
      return allowed({ ...state, isSpraying: command.payload.spraying })
    case 'SetFireDirection':
      if (!finite(command.payload.x) || !finite(command.payload.y)) return invalid(state)
      return allowed({
        ...state,
        fireDirection: { x: command.payload.x, y: command.payload.y },
      })
    case 'SetFireSize':
      if (
        !finite(command.payload.size) ||
        command.payload.size < FIRE_SIZE_MIN ||
        command.payload.size > FIRE_SIZE_MAX
      ) {
        return invalid(state)
      }
      return allowed({ ...state, fireSize: command.payload.size })
    case 'SetContainerAxis':
      if (!finite(command.payload.axis) || Math.abs(command.payload.axis) > 1) return invalid(state)
      return allowed({ ...state, containerAxis: command.payload.axis })
    case 'SetFlameThrust':
      return allowed({ ...state, flameThrustEnabled: command.payload.enabled })
    case 'RequestFinish':
      return allowed({ ...state, finishRequested: true })
  }
}

export function stopSpraying(state: DomainState): DomainState {
  if (!state.isSpraying) return state
  return { ...state, isSpraying: false }
}

export function enterFailed(state: DomainState): DomainState {
  if (state.status !== 'extracting') return state
  return {
    ...state,
    status: 'failed',
    isSpraying: false,
    finishRequested: false,
  }
}

export function settleRequestedCompletion(state: DomainState): DomainState {
  if (state.status !== 'extracting' || !state.finishRequested || !deriveCanFinish(state)) return state
  return {
    ...state,
    status: 'completed',
    isSpraying: false,
    finishRequested: false,
  }
}
