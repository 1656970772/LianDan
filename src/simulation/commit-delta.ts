import type {
  DomainState,
  MaterialInstance,
  PearlTerminalOutcome,
  PearlType,
  VolumeByPearlType,
} from '../domain/index.ts'
import {
  resolvePearlTerminalOutcome,
  type SimulationDelta,
  type SimulationDeltaCommitResult,
  type SimulationDeltaError,
} from './contracts.ts'
import {
  clampVolumeToZero,
  volumeTolerance,
  volumesApproximatelyEqual,
} from './volume-tolerance.ts'

function reject(
  state: DomainState,
  error: SimulationDeltaError,
): SimulationDeltaCommitResult {
  return { ok: false, error, state }
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function cloneVolumeGroups(
  groups: Readonly<Record<string, VolumeByPearlType>>,
): Record<string, Partial<Record<PearlType, number>>> {
  const clone: Record<string, Partial<Record<PearlType, number>>> = {}
  for (const [key, value] of Object.entries(groups)) clone[key] = { ...value }
  return clone
}

function addGroupedVolume(
  groups: Record<string, Partial<Record<PearlType, number>>>,
  key: string,
  pearlType: PearlType,
  volume: number,
): void {
  const group = groups[key] ?? {}
  group[pearlType] = (group[pearlType] ?? 0) + volume
  groups[key] = group
}

function groupedVolume(
  groups: Readonly<Record<string, VolumeByPearlType>>,
  key: string,
  pearlType: PearlType,
): number {
  return groups[key]?.[pearlType] ?? 0
}

export function commitSimulationDeltaCandidate(
  state: DomainState,
  delta: SimulationDelta,
): SimulationDeltaCommitResult {
  if (!Number.isSafeInteger(delta.tick) || delta.tick < 0 || delta.tick !== state.lastCommittedTick + 1) {
    return reject(state, 'SIM_DELTA_INVALID_TICK')
  }

  const materialInstances: MaterialInstance[] = state.materialInstances.map((instance) => ({
    ...instance,
  }))
  const materialIndexes = new Map(
    materialInstances.map((instance, index) => [instance.materialInstanceId, index]),
  )
  const materialOperationCounts = new Map<string, number>()
  const pearlVolumes: Record<string, number> = { ...state.ledger.pearlVolumes }
  const pearlSources = { ...state.ledger.pearlSources }
  const terminalPearls: Record<string, PearlTerminalOutcome> = {
    ...state.ledger.terminalPearls,
  }
  const theoreticalMedicinalVolumes = {
    ...state.ledger.theoreticalMedicinalVolumes,
  }
  const dissolvedVolumes = cloneVolumeGroups(state.ledger.dissolvedVolumes)
  const bornVolumes = cloneVolumeGroups(state.ledger.bornVolumes)
  let naturalLossVolume = state.ledger.naturalLossVolume
  let inheritedLossVolume = state.ledger.inheritedLossVolume
  let burnedMedicinalVolume = state.ledger.burnedMedicinalVolume
  let missedMedicinalVolume = state.ledger.missedMedicinalVolume
  const caughtVolumes = { ...state.ledger.caughtVolumes }
  const slagPoolVolumes = { ...state.ledger.slagPoolVolumes }

  const subtractMaterial = (
    materialInstanceId: string,
    volume: number,
  ): SimulationDeltaError | null => {
    const index = materialIndexes.get(materialInstanceId)
    if (index === undefined) return 'SIM_DELTA_ENTITY_NOT_FOUND'
    const instance = materialInstances[index]!
    if (
      instance.remainingVolume +
        volumeTolerance(instance.remainingVolume, volume) <
      volume
    ) return 'SIM_DELTA_NEGATIVE_VOLUME'
    const remainingVolume = Math.max(0, instance.remainingVolume - volume)
    materialInstances[index] = {
      ...instance,
      remainingVolume: clampVolumeToZero(
        remainingVolume,
        instance.initialVolume,
      ),
    }
    materialOperationCounts.set(
      materialInstanceId,
      (materialOperationCounts.get(materialInstanceId) ?? 0) + 1,
    )
    return null
  }

  for (const dissolution of delta.dissolutions) {
    if (!Number.isFinite(dissolution.volume)) return reject(state, 'SIM_DELTA_NON_FINITE_VOLUME')
    if (dissolution.volume < 0) return reject(state, 'SIM_DELTA_NEGATIVE_VOLUME')
    const index = materialIndexes.get(dissolution.materialInstanceId)
    if (index === undefined) return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    if (materialInstances[index]!.materialDefinitionId !== dissolution.materialDefinitionId) {
      return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    }
    const error = subtractMaterial(dissolution.materialInstanceId, dissolution.volume)
    if (error !== null) return reject(state, error)
    addGroupedVolume(
      dissolvedVolumes,
      dissolution.materialInstanceId,
      dissolution.pearlType,
      dissolution.volume,
    )
  }

  const bornThisTick = new Set<string>()
  const affectedBirthTypes = new Map<string, Set<PearlType>>()
  for (const birth of delta.births) {
    if (!Number.isFinite(birth.volume)) return reject(state, 'SIM_DELTA_NON_FINITE_VOLUME')
    if (birth.volume <= 0) return reject(state, 'SIM_DELTA_NEGATIVE_VOLUME')
    if (bornThisTick.has(birth.pearlId) || pearlVolumes[birth.pearlId] !== undefined) {
      return reject(state, 'SIM_DELTA_DUPLICATE_ENTITY')
    }
    const sourceIndex = materialIndexes.get(birth.sourceMaterialInstanceId)
    if (
      sourceIndex === undefined ||
      materialInstances[sourceIndex]!.materialDefinitionId !== birth.sourceMaterialDefinitionId
    ) {
      return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    }
    bornThisTick.add(birth.pearlId)
    pearlVolumes[birth.pearlId] = birth.volume
    pearlSources[birth.pearlId] = {
      sourceMaterialDefinitionId: birth.sourceMaterialDefinitionId,
      sourceMaterialInstanceId: birth.sourceMaterialInstanceId,
      pearlType: birth.pearlType,
    }
    addGroupedVolume(
      bornVolumes,
      birth.sourceMaterialInstanceId,
      birth.pearlType,
      birth.volume,
    )
    const pearlTypes = affectedBirthTypes.get(birth.sourceMaterialInstanceId) ?? new Set<PearlType>()
    pearlTypes.add(birth.pearlType)
    affectedBirthTypes.set(birth.sourceMaterialInstanceId, pearlTypes)
  }

  const terminalCandidates = new Map<string, PearlTerminalOutcome[]>()
  for (const terminal of delta.terminalOutcomes) {
    const candidates = terminalCandidates.get(terminal.pearlId) ?? []
    candidates.push(terminal.outcome)
    terminalCandidates.set(terminal.pearlId, candidates)
  }
  for (const loss of delta.naturalLosses) {
    if (loss.sourceKind === 'pearl' && bornThisTick.has(loss.pearlId)) {
      return reject(state, 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE')
    }
  }

  for (const [materialInstanceId, pearlTypes] of affectedBirthTypes) {
    for (const pearlType of pearlTypes) {
      if (
        groupedVolume(bornVolumes, materialInstanceId, pearlType) >
        groupedVolume(dissolvedVolumes, materialInstanceId, pearlType) +
          volumeTolerance(
            groupedVolume(bornVolumes, materialInstanceId, pearlType),
            groupedVolume(dissolvedVolumes, materialInstanceId, pearlType),
          )
      ) {
        return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
      }
    }
  }

  const changedPearls = new Set<string>()
  for (const change of delta.pearlVolumeChanges) {
    if (!validNonNegative(change.previousVolume) || !validNonNegative(change.currentVolume)) {
      return reject(
        state,
        Number.isFinite(change.previousVolume) && Number.isFinite(change.currentVolume)
          ? 'SIM_DELTA_NEGATIVE_VOLUME'
          : 'SIM_DELTA_NON_FINITE_VOLUME',
      )
    }
    if (changedPearls.has(change.pearlId)) return reject(state, 'SIM_DELTA_DUPLICATE_ENTITY')
    if (bornThisTick.has(change.pearlId)) {
      return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    }
    const current = pearlVolumes[change.pearlId]
    if (current === undefined || terminalPearls[change.pearlId] !== undefined) {
      return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    }
    if (!volumesApproximatelyEqual(current, change.previousVolume)) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    if (
      change.currentVolume >
      change.previousVolume +
        volumeTolerance(change.currentVolume, change.previousVolume)
    ) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    changedPearls.add(change.pearlId)
    pearlVolumes[change.pearlId] = change.currentVolume
    if (pearlSources[change.pearlId]!.pearlType === 'medicinalLiquid') {
      burnedMedicinalVolume += change.previousVolume - change.currentVolume
    }
  }

  const naturallyLostPearls = new Set<string>()
  for (const loss of delta.naturalLosses) {
    if (!Number.isFinite(loss.volume)) return reject(state, 'SIM_DELTA_NON_FINITE_VOLUME')
    if (loss.volume < 0) return reject(state, 'SIM_DELTA_NEGATIVE_VOLUME')
    if (loss.sourceKind === 'materialCell') {
      if (loss.pearlType !== 'medicinalLiquid') {
        return reject(state, 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE')
      }
      const error = subtractMaterial(loss.materialInstanceId, loss.volume)
      if (error !== null) return reject(state, error)
    } else {
      const current = pearlVolumes[loss.pearlId]
      if (current === undefined) {
        return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
      }
      if (
        bornThisTick.has(loss.pearlId) ||
        terminalPearls[loss.pearlId] !== undefined ||
        pearlSources[loss.pearlId] === undefined ||
        pearlSources[loss.pearlId]!.pearlType !== 'medicinalLiquid'
      ) {
        return reject(state, 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE')
      }
      if (naturallyLostPearls.has(loss.pearlId)) {
        return reject(state, 'SIM_DELTA_DUPLICATE_ENTITY')
      }
      if (
        current + volumeTolerance(current, loss.volume) < loss.volume
      ) return reject(state, 'SIM_DELTA_NEGATIVE_VOLUME')
      const remainingVolume = Math.max(0, current - loss.volume)
      const sameDeltaTerminals = terminalCandidates.get(loss.pearlId) ?? []
      const hasNaturalLossBurn =
        sameDeltaTerminals.length === 1 &&
        sameDeltaTerminals[0] === 'burned' &&
        remainingVolume <= volumeTolerance(current)
      if (
        (sameDeltaTerminals.length > 0 && !hasNaturalLossBurn) ||
        (remainingVolume <= volumeTolerance(current) && !hasNaturalLossBurn)
      ) {
        return reject(state, 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE')
      }
      naturallyLostPearls.add(loss.pearlId)
      pearlVolumes[loss.pearlId] = remainingVolume
    }
    naturalLossVolume += loss.volume
  }

  for (const loss of delta.inheritedLosses) {
    if (!Number.isFinite(loss.volume) || !Number.isFinite(loss.theoreticalMedicinalVolume)) {
      return reject(state, 'SIM_DELTA_NON_FINITE_VOLUME')
    }
    if (
      loss.volume < 0 ||
      loss.theoreticalMedicinalVolume < 0 ||
      loss.volume >
        loss.theoreticalMedicinalVolume +
          volumeTolerance(loss.volume, loss.theoreticalMedicinalVolume)
    ) return reject(state, 'SIM_DELTA_NEGATIVE_VOLUME')
    const index = materialIndexes.get(loss.materialInstanceId)
    if (index === undefined) return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    const material = materialInstances[index]!
    if (
      theoreticalMedicinalVolumes[loss.materialInstanceId] !== undefined ||
      (material.theoreticalMedicinalVolume !== undefined &&
        !volumesApproximatelyEqual(
          material.theoreticalMedicinalVolume,
          loss.theoreticalMedicinalVolume,
        )) ||
      (material.inheritedLossAtAddition !== undefined &&
        !volumesApproximatelyEqual(material.inheritedLossAtAddition, loss.volume))
    ) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    const error = subtractMaterial(loss.materialInstanceId, loss.volume)
    if (error !== null) return reject(state, error)
    theoreticalMedicinalVolumes[loss.materialInstanceId] =
      loss.theoreticalMedicinalVolume
    inheritedLossVolume += loss.volume
  }

  const materialVolumeChanges = delta.materialVolumeChanges ?? []
  const changedMaterialIds = new Set<string>()
  for (const change of materialVolumeChanges) {
    if (
      !validNonNegative(change.previousVolume) ||
      !validNonNegative(change.currentVolume)
    ) {
      return reject(
        state,
        Number.isFinite(change.previousVolume) && Number.isFinite(change.currentVolume)
          ? 'SIM_DELTA_NEGATIVE_VOLUME'
          : 'SIM_DELTA_NON_FINITE_VOLUME',
      )
    }
    if (changedMaterialIds.has(change.materialInstanceId)) {
      return reject(state, 'SIM_DELTA_DUPLICATE_ENTITY')
    }
    changedMaterialIds.add(change.materialInstanceId)
    const index = materialIndexes.get(change.materialInstanceId)
    if (index === undefined) return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    const original = state.materialInstances[index]!
    const calculated = materialInstances[index]!
    if (!volumesApproximatelyEqual(original.remainingVolume, change.previousVolume)) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    if (
      change.currentVolume >
      change.previousVolume +
        volumeTolerance(change.currentVolume, change.previousVolume)
    ) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    const roundingTolerance =
      volumeTolerance(calculated.remainingVolume, change.currentVolume) *
      Math.max(1, materialOperationCounts.get(change.materialInstanceId) ?? 0)
    if (
      Math.abs(calculated.remainingVolume - change.currentVolume) >
      roundingTolerance
    ) {
      return reject(state, 'SIM_DELTA_VOLUME_MISMATCH')
    }
    materialInstances[index] = {
      ...calculated,
      remainingVolume: clampVolumeToZero(
        change.currentVolume,
        calculated.initialVolume,
      ),
    }
  }

  for (const terminal of delta.terminalOutcomes) {
    if (bornThisTick.has(terminal.pearlId)) return reject(state, 'SIM_DELTA_NEWBORN_TERMINAL')
    if (
      pearlVolumes[terminal.pearlId] === undefined ||
      terminalPearls[terminal.pearlId] !== undefined
    ) {
      return reject(state, 'SIM_DELTA_ENTITY_NOT_FOUND')
    }
  }
  for (const [pearlId, candidates] of terminalCandidates) {
    const outcome = resolvePearlTerminalOutcome(candidates)
    if (outcome === null) continue
    terminalPearls[pearlId] = outcome
    const source = pearlSources[pearlId]!
    const volume = pearlVolumes[pearlId]!
    if (outcome === 'caught') {
      caughtVolumes[source.pearlType] += volume
    } else if (outcome === 'missed') {
      slagPoolVolumes[source.pearlType] += volume
      if (source.pearlType === 'medicinalLiquid') missedMedicinalVolume += volume
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      materialInstances,
      ledger: {
        dissolvedVolumes,
        bornVolumes,
        pearlVolumes,
        pearlSources,
        terminalPearls,
        theoreticalMedicinalVolumes,
        naturalLossVolume,
        inheritedLossVolume,
        burnedMedicinalVolume,
        missedMedicinalVolume,
        caughtVolumes,
        slagPoolVolumes,
      },
      lastCommittedTick: delta.tick,
    },
  }
}
