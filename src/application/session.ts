import {
  addMaterialServingFromBatch,
  applyRuleCommand,
  createDomainState,
  deriveCanFinish,
  evaluateExtractionState,
  isRuleCommandAllowed,
  settleRequestedCompletion,
  stopSpraying,
  validateRuleCommandPayload,
  type DomainEvent,
  type DomainState,
  type PrototypeRules,
  type RuleCommand,
} from '../domain/index.ts'
import {
  commitSimulationDeltaCandidate,
  resolvePearlTerminalOutcome,
  type SimulationDelta,
} from '../simulation/index.ts'
import {
  TICK_PHASES,
  validateApplicationControlPayload,
  type ApplicationControlDraft,
  type ApplicationControlEnvelope,
  type ApplicationReadModel,
  type BoundaryResult,
  type CapturedInput,
  type CommandEnvelope,
  type DiscardedQueuedCommand,
  type ExecutionMode,
  type ExtractionApplicationOptions,
  type InputLogEntry,
  type InputOutcome,
  type InputResult,
  type LifecycleSnapshot,
  type PauseReason,
  type RestartConfirmation,
  type RuleCommandDraft,
  type SequenceValidation,
  type SessionArchive,
  type TickHooks,
} from './contracts.ts'

type QueuedCommand = Readonly<{
  envelope: CommandEnvelope
  inputLogIndex: number
}>

type PreparedMaterialAddition = Readonly<{
  command: QueuedCommand
  inventoryBatchId: string
}>

type PreflightInput = Readonly<{
  entry: InputLogEntry
  inputLogIndex: number
}>

type PendingReset = Readonly<{
  lifecycleSnapshot: LifecycleSnapshot
  discardedQueuedCommands: readonly DiscardedQueuedCommand[]
}>

type PreparedTickSnapshot = Readonly<{
  domainState: DomainState
  nextTick: number
  lastAppliedSequence: number
  results: readonly InputResult[]
  queuedCommands: readonly QueuedCommand[]
  preparedBoundary: number
  trace: readonly string[]
}>

type ControlDecision = Readonly<{
  outcome: Extract<InputOutcome, 'applied' | 'APP_COMMAND_NOT_ALLOWED'>
  resetLifecycleSnapshot?: LifecycleSnapshot
}>

function sessionId(ordinal: number): string {
  return `session-${ordinal.toString().padStart(6, '0')}`
}

function isTerminal(state: DomainState): boolean {
  return state.status === 'failed' || state.status === 'completed'
}

function isActive(state: DomainState): boolean {
  return state.status === 'ready' || state.status === 'extracting'
}

function compareQueued(left: QueuedCommand, right: QueuedCommand): number {
  return (
    left.envelope.targetTick - right.envelope.targetTick ||
    left.envelope.sequence - right.envelope.sequence
  )
}

function compareResults(left: InputResult, right: InputResult): number {
  return left.sequence - right.sequence || left.inputLogIndex - right.inputLogIndex
}

function emptySimulationDelta(tick: number): SimulationDelta {
  return {
    tick,
    dissolutions: [],
    births: [],
    pearlVolumeChanges: [],
    terminalOutcomes: [],
    naturalLosses: [],
    inheritedLosses: [],
  }
}

const TERMINAL_EVENT_TYPE = Object.freeze({
  caught: 'PearlCaught',
  missed: 'PearlMissed',
  burned: 'PearlBurned',
} as const)

function createDomainEvents(
  tick: number,
  before: DomainState,
  after: DomainState,
  delta: SimulationDelta,
): readonly DomainEvent[] {
  const events: DomainEvent[] = []
  const existingMaterials = new Set(
    before.materialInstances.map((instance) => instance.materialInstanceId),
  )
  for (const instance of after.materialInstances) {
    if (existingMaterials.has(instance.materialInstanceId)) continue
    events.push({
      type: 'MaterialAdded',
      tick,
      materialInstanceId: instance.materialInstanceId,
      materialDefinitionId: instance.materialDefinitionId,
      inventoryBatchId: instance.inventoryBatchId,
      initialVolume: instance.initialVolume,
    })
  }

  for (const birth of [...delta.births].sort((left, right) =>
    left.pearlId.localeCompare(right.pearlId),
  )) {
    events.push({ type: 'PearlBorn', tick, ...birth })
  }

  for (const activation of [...(delta.shieldActivations ?? [])].sort(
    (left, right) => left.pearlId.localeCompare(right.pearlId),
  )) {
    events.push({ type: 'PearlShieldActivated', tick, pearlId: activation.pearlId })
  }

  const damagedPearlIds = new Set(
    delta.pearlVolumeChanges.map(({ pearlId }) => pearlId),
  )
  for (const loss of delta.naturalLosses) {
    if (loss.sourceKind === 'pearl') damagedPearlIds.add(loss.pearlId)
  }
  for (const pearlId of [...damagedPearlIds].sort()) {
    const previousVolume = before.ledger.pearlVolumes[pearlId]
    const currentVolume = after.ledger.pearlVolumes[pearlId]
    if (
      previousVolume !== undefined &&
      currentVolume !== undefined &&
      currentVolume < previousVolume
    ) {
      events.push({
        type: 'PearlDamaged',
        tick,
        pearlId,
        previousVolume,
        currentVolume,
      })
    }
  }

  const terminalCandidates = new Map<string, Array<'caught' | 'missed' | 'burned'>>()
  for (const terminal of delta.terminalOutcomes) {
    if (before.ledger.terminalPearls[terminal.pearlId] !== undefined) continue
    const candidates = terminalCandidates.get(terminal.pearlId) ?? []
    candidates.push(terminal.outcome)
    terminalCandidates.set(terminal.pearlId, candidates)
  }
  for (const pearlId of [...terminalCandidates.keys()].sort()) {
    const outcome = resolvePearlTerminalOutcome(terminalCandidates.get(pearlId)!)
    if (outcome !== null) {
      events.push({ type: TERMINAL_EVENT_TYPE[outcome], tick, pearlId })
    }
  }

  if (before.lossWarningLevel !== after.lossWarningLevel) {
    events.push({
      type: 'LossWarningChanged',
      tick,
      previousLevel: before.lossWarningLevel,
      currentLevel: after.lossWarningLevel,
    })
  }

  if (!deriveCanFinish(before) && deriveCanFinish(after)) {
    events.push({ type: 'CanFinish', tick })
  }
  if (
    before.status !== 'failed' &&
    after.status === 'failed' &&
    after.failureResult !== null
  ) {
    events.push({ type: 'ExtractionFailed', tick, result: after.failureResult })
  }
  if (before.status !== 'completed' && after.status === 'completed') {
    events.push({ type: 'ExtractionCompleted', tick })
  }
  return events
}

function hasValidRuntimePayload(entry: InputLogEntry): boolean {
  if (entry.channel === 'control') {
    return validateApplicationControlPayload(entry.envelope)
  }
  return (
    Number.isSafeInteger(entry.envelope.targetTick) &&
    entry.envelope.targetTick >= 0 &&
    validateRuleCommandPayload(entry.envelope)
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isReplayBoundaryEntry(value: unknown): value is CapturedInput {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'channel') ||
    !Object.hasOwn(value, 'envelope') ||
    (value.channel !== 'rule' && value.channel !== 'control') ||
    !isPlainRecord(value.envelope)
  ) {
    return false
  }

  const envelope = value.envelope
  if (
    !Object.hasOwn(envelope, 'sequence') ||
    !Number.isSafeInteger(envelope.sequence) ||
    !Object.hasOwn(envelope, 'type') ||
    typeof envelope.type !== 'string' ||
    !Object.hasOwn(envelope, 'payload') ||
    !isPlainRecord(envelope.payload)
  ) {
    return false
  }

  return (
    value.channel === 'control' ||
    (Object.hasOwn(envelope, 'targetTick') && typeof envelope.targetTick === 'number')
  )
}

function isReplayBoundaryEntries(value: unknown): value is readonly CapturedInput[] {
  if (!Array.isArray(value)) return false
  return value.every(isReplayBoundaryEntry)
}

export class ExtractionApplication {
  readonly #rules: PrototypeRules
  readonly #onControlPump: ExtractionApplicationOptions['onControlPump']
  #domainState: DomainState
  #sessionOrdinal: number
  #sessionId: string
  #nextTick: number
  #nextCaptureSequence: number
  #lastContinuousSequence: number
  #lastCapturedSequence: number
  #lastAppliedSequence: number
  #pendingCaptured: CapturedInput[] = []
  #inputLog: InputLogEntry[] = []
  #results: InputResult[] = []
  #queuedCommands: QueuedCommand[] = []
  #pauseReasons: Set<PauseReason>
  #restartConfirmation: RestartConfirmation
  #archives: SessionArchive[] = []
  #mode: ExecutionMode = 'idle'
  #preparedBoundary: number | null = null
  #trace: string[] = []

  constructor(rules: PrototypeRules, options: ExtractionApplicationOptions = {}) {
    this.#rules = rules
    this.#onControlPump = options.onControlPump
    this.#nextTick = options.nextTick ?? 0
    const initialDomainState = options.domainState ?? createDomainState(rules)
    if (
      options.domainState !== undefined &&
      (!Number.isSafeInteger(this.#nextTick) ||
        this.#nextTick < 0 ||
        initialDomainState.lastCommittedTick !== this.#nextTick - 1)
    ) {
      throw new Error('APP_BOUNDARY_INVALID')
    }
    this.#domainState =
      options.domainState === undefined &&
      Number.isSafeInteger(this.#nextTick) &&
      this.#nextTick >= 0
        ? { ...initialDomainState, lastCommittedTick: this.#nextTick - 1 }
        : initialDomainState
    this.#sessionOrdinal = options.sessionOrdinal ?? 1
    this.#sessionId = sessionId(this.#sessionOrdinal)
    this.#nextCaptureSequence = options.nextSequence ?? 1
    this.#lastContinuousSequence = this.#nextCaptureSequence - 1
    this.#lastCapturedSequence = this.#nextCaptureSequence - 1
    this.#lastAppliedSequence = this.#nextCaptureSequence - 1
    this.#restartConfirmation = options.restartConfirmation ?? 'closed'
    this.#pauseReasons = new Set(options.pauseReasons ?? [])
    if (this.#restartConfirmation === 'open') this.#pauseReasons.add('restartConfirmation')
  }

  captureRuleCommand(draft: RuleCommandDraft): CommandEnvelope {
    const envelope = {
      ...draft,
      sequence: this.#nextCaptureSequence,
    } as CommandEnvelope
    this.#nextCaptureSequence += 1
    this.#pendingCaptured.push({ channel: 'rule', envelope })
    return envelope
  }

  captureApplicationControl(draft: ApplicationControlDraft): ApplicationControlEnvelope {
    const envelope = {
      ...draft,
      sequence: this.#nextCaptureSequence,
    } as ApplicationControlEnvelope
    this.#nextCaptureSequence += 1
    this.#pendingCaptured.push({ channel: 'control', envelope })
    return envelope
  }

  beforePhase0(deliveryBoundaryTick: number): BoundaryResult {
    const batch = this.#pendingCaptured
    const boundaryError = this.#canEnterBoundary(deliveryBoundaryTick)
    if (boundaryError !== null) {
      return {
        accepted: false,
        error: boundaryError,
        canAdvance: false,
        resetCutover: false,
      }
    }
    this.#pendingCaptured = []
    return this.#processBoundary(deliveryBoundaryTick, batch)
  }

  injectReplayBoundary(
    deliveryBoundaryTick: number,
    entries: unknown,
  ): BoundaryResult {
    const boundaryError = this.#canEnterBoundary(deliveryBoundaryTick)
    if (
      boundaryError !== null ||
      this.#pendingCaptured.length > 0 ||
      !isReplayBoundaryEntries(entries)
    ) {
      return {
        accepted: false,
        error: boundaryError ?? 'APP_BOUNDARY_INVALID',
        canAdvance: false,
        resetCutover: false,
      }
    }
    for (const entry of entries) {
      const replayMetadata = entry as CapturedInput &
        Partial<Pick<InputLogEntry, 'deliveryBoundaryTick' | 'sessionId'>>
      if (
        'deliveryBoundaryTick' in replayMetadata &&
        replayMetadata.deliveryBoundaryTick !== deliveryBoundaryTick
      ) {
        return {
          accepted: false,
          error: 'APP_BOUNDARY_INVALID',
          canAdvance: false,
          resetCutover: false,
        }
      }
      if ('sessionId' in replayMetadata && replayMetadata.sessionId !== this.#sessionId) {
        return {
          accepted: false,
          error: 'APP_BOUNDARY_INVALID',
          canAdvance: false,
          resetCutover: false,
        }
      }
    }
    return this.#processBoundary(
      deliveryBoundaryTick,
      entries,
    )
  }

  #canEnterBoundary(deliveryBoundaryTick: number): 'APP_EXECUTION_REENTRANT' | 'APP_BOUNDARY_INVALID' | null {
    if (this.#mode !== 'idle') return 'APP_EXECUTION_REENTRANT'
    if (
      this.#preparedBoundary !== null ||
      !Number.isSafeInteger(deliveryBoundaryTick) ||
      deliveryBoundaryTick < 0 ||
      deliveryBoundaryTick !== this.#nextTick
    ) {
      return 'APP_BOUNDARY_INVALID'
    }
    return null
  }

  #processBoundary(
    deliveryBoundaryTick: number,
    batch: readonly CapturedInput[],
  ): BoundaryResult {
    this.#mode = 'boundary'
    this.#trace.push(`boundary:${deliveryBoundaryTick}:preflight`)
    const preflight = this.#preflight(deliveryBoundaryTick, batch)
    const ordered = [...preflight].sort(
      (left, right) =>
        left.entry.sequence - right.entry.sequence || left.inputLogIndex - right.inputLogIndex,
    )
    let pendingReset: PendingReset | null = null

    for (const item of ordered) {
      if (pendingReset !== null) {
        this.#recordResult(item, 'discardedByReset')
        continue
      }
      if (!item.entry.sequenceValidation.valid) {
        this.#recordResult(item, 'APP_COMMAND_SEQUENCE_INVALID')
        continue
      }
      if (!hasValidRuntimePayload(item.entry)) {
        this.#recordResult(item, 'APP_COMMAND_PAYLOAD_INVALID')
        continue
      }

      if (item.entry.channel === 'rule') {
        pendingReset = this.#processRuleAtBoundary(
          { entry: item.entry, inputLogIndex: item.inputLogIndex },
          deliveryBoundaryTick,
        )
      } else {
        const decision = this.#processControl(item.entry.envelope)
        this.#recordResult(item, decision.outcome)
        if (decision.outcome === 'applied') {
          this.#lastAppliedSequence = Math.max(
            this.#lastAppliedSequence,
            item.entry.sequence,
          )
        }
        if (decision.resetLifecycleSnapshot !== undefined) {
          pendingReset = {
            lifecycleSnapshot: decision.resetLifecycleSnapshot,
            discardedQueuedCommands: this.#discardQueuedByReset(),
          }
        }
      }
    }

    if (pendingReset !== null) {
      this.#finalizeReset(pendingReset)
      this.#mode = 'idle'
      return {
        accepted: true,
        canAdvance: false,
        resetCutover: true,
        deliveryBoundaryTick,
      }
    }

    const canAdvance = this.#pauseReasons.size === 0 && isActive(this.#domainState)
    if (canAdvance) this.#preparedBoundary = deliveryBoundaryTick
    this.#mode = 'idle'
    return {
      accepted: true,
      canAdvance,
      resetCutover: false,
      deliveryBoundaryTick,
    }
  }

  #preflight(
    deliveryBoundaryTick: number,
    batch: readonly CapturedInput[],
  ): readonly PreflightInput[] {
    let expectedSequence = this.#lastContinuousSequence + 1
    const seenInBatch = new Set<number>()
    const prepared: PreflightInput[] = []

    for (const input of batch) {
      const sequence = input.envelope.sequence
      let sequenceValidation: SequenceValidation
      if (Number.isSafeInteger(sequence) && sequence === expectedSequence && !seenInBatch.has(sequence)) {
        sequenceValidation = { valid: true }
        expectedSequence += 1
      } else {
        sequenceValidation = {
          valid: false,
          reason:
            seenInBatch.has(sequence) || sequence < expectedSequence
              ? 'duplicateOrOutOfOrder'
              : 'notContinuous',
          expectedSequence,
        }
      }
      seenInBatch.add(sequence)
      if (Number.isSafeInteger(sequence)) {
        this.#lastCapturedSequence = Math.max(this.#lastCapturedSequence, sequence)
        this.#nextCaptureSequence = Math.max(this.#nextCaptureSequence, sequence + 1)
      }

      const base = {
        sessionId: this.#sessionId,
        sequence,
        deliveryBoundaryTick,
        sequenceValidation,
      }
      const entry: InputLogEntry =
        input.channel === 'rule'
          ? { ...base, channel: 'rule', envelope: input.envelope }
          : { ...base, channel: 'control', envelope: input.envelope }
      const inputLogIndex = this.#inputLog.length
      this.#inputLog.push(entry)
      prepared.push({ entry, inputLogIndex })
    }
    this.#lastContinuousSequence = expectedSequence - 1
    return prepared
  }

  #processRuleAtBoundary(
    item: PreflightInput & Readonly<{ entry: Extract<InputLogEntry, { channel: 'rule' }> }>,
    deliveryBoundaryTick: number,
  ): PendingReset | null {
    const envelope = item.entry.envelope
    if (envelope.targetTick < deliveryBoundaryTick) {
      this.#recordResult(item, 'APP_COMMAND_LATE')
      return null
    }
    if (!isRuleCommandAllowed(this.#domainState, envelope, this.#rules)) {
      this.#recordResult(item, 'APP_COMMAND_NOT_ALLOWED')
      return null
    }
    this.#queuedCommands.push({ envelope, inputLogIndex: item.inputLogIndex })
    this.#queuedCommands.sort(compareQueued)
    this.#recordResult(item, 'queued')
    return null
  }

  #recordResult(item: PreflightInput, outcome: InputOutcome): void {
    const targetTick = item.entry.channel === 'rule' ? item.entry.envelope.targetTick : undefined
    const result: InputResult = {
      sessionId: this.#sessionId,
      inputLogIndex: item.inputLogIndex,
      sequence: item.entry.sequence,
      channel: item.entry.channel,
      type: item.entry.envelope.type,
      ...(targetTick === undefined ? {} : { targetTick }),
      outcome,
    }
    const existing = this.#results.findIndex(
      (candidate) => candidate.inputLogIndex === item.inputLogIndex,
    )
    if (existing === -1) this.#results.push(result)
    else this.#results[existing] = result
  }

  #replaceQueuedResult(command: QueuedCommand, outcome: InputOutcome): void {
    const index = this.#results.findIndex(
      (candidate) => candidate.inputLogIndex === command.inputLogIndex,
    )
    if (index === -1) return
    this.#results[index] = { ...this.#results[index]!, outcome }
  }

  #processControl(envelope: ApplicationControlEnvelope): ControlDecision {
    this.#mode = 'controlPump'
    this.#trace.push(`control:${envelope.sequence}:start`)
    this.#onControlPump?.('start', envelope)
    let decision: ControlDecision

    switch (envelope.type) {
      case 'Pause':
        this.#pauseReasons.add('manual')
        this.#domainState = stopSpraying(this.#domainState)
        decision = { outcome: 'applied' }
        break
      case 'Resume':
        this.#pauseReasons.delete('manual')
        decision = { outcome: 'applied' }
        break
      case 'WindowBlur':
      case 'WindowFocus':
      case 'VisibilityChanged':
        this.#synchronizeLifecycle(envelope.payload.lifecycleSnapshot)
        if (this.#pauseReasons.size > 0) this.#domainState = stopSpraying(this.#domainState)
        decision = { outcome: 'applied' }
        break
      case 'RequestRestart':
        if (!isActive(this.#domainState)) {
          decision = { outcome: 'APP_COMMAND_NOT_ALLOWED' }
          break
        }
        this.#restartConfirmation = 'open'
        this.#pauseReasons.add('restartConfirmation')
        this.#domainState = stopSpraying(this.#domainState)
        decision = { outcome: 'applied' }
        break
      case 'CancelRestart':
        if (!isActive(this.#domainState) || this.#restartConfirmation !== 'open') {
          decision = { outcome: 'APP_COMMAND_NOT_ALLOWED' }
          break
        }
        this.#restartConfirmation = 'closed'
        this.#pauseReasons.delete('restartConfirmation')
        decision = { outcome: 'applied' }
        break
      case 'ConfirmRestart':
        if (!isActive(this.#domainState) || this.#restartConfirmation !== 'open') {
          decision = { outcome: 'APP_COMMAND_NOT_ALLOWED' }
          break
        }
        decision = {
          outcome: 'applied',
          resetLifecycleSnapshot: envelope.payload.lifecycleSnapshot,
        }
        break
      case 'Again':
        if (!isTerminal(this.#domainState)) {
          decision = { outcome: 'APP_COMMAND_NOT_ALLOWED' }
          break
        }
        decision = {
          outcome: 'applied',
          resetLifecycleSnapshot: envelope.payload.lifecycleSnapshot,
        }
        break
    }

    this.#onControlPump?.('end', envelope)
    this.#trace.push(`control:${envelope.sequence}:end`)
    this.#mode = 'boundary'
    return decision
  }

  #synchronizeLifecycle(snapshot: LifecycleSnapshot): void {
    if (snapshot.hasFocus) this.#pauseReasons.delete('blur')
    else this.#pauseReasons.add('blur')
    if (snapshot.visibilityState === 'visible') this.#pauseReasons.delete('hidden')
    else this.#pauseReasons.add('hidden')
  }

  #discardQueuedByReset(): readonly DiscardedQueuedCommand[] {
    const ordered = [...this.#queuedCommands].sort(compareQueued)
    const discarded = ordered.map(({ envelope }) => ({
      targetTick: envelope.targetTick,
      sequence: envelope.sequence,
      type: envelope.type,
    }))
    for (const command of ordered) this.#replaceQueuedResult(command, 'discardedByReset')
    this.#queuedCommands = []
    return discarded
  }

  #finalizeReset(reset: PendingReset): void {
    const archive: SessionArchive = {
      sessionId: this.#sessionId,
      inputLog: [...this.#inputLog],
      results: [...this.#results].sort(compareResults),
      discardedQueuedCommands: reset.discardedQueuedCommands,
      lastCapturedSequence: this.#lastCapturedSequence,
      lastAppliedSequence: this.#lastAppliedSequence,
    }
    this.#archives.push(archive)

    this.#sessionOrdinal += 1
    this.#sessionId = sessionId(this.#sessionOrdinal)
    this.#domainState = createDomainState(this.#rules)
    this.#nextTick = 0
    this.#nextCaptureSequence = 1
    this.#lastContinuousSequence = 0
    this.#lastCapturedSequence = 0
    this.#lastAppliedSequence = 0
    this.#pendingCaptured = []
    this.#inputLog = []
    this.#results = []
    this.#queuedCommands = []
    this.#restartConfirmation = 'closed'
    this.#pauseReasons = new Set()
    this.#synchronizeLifecycle(reset.lifecycleSnapshot)
    this.#preparedBoundary = null
  }

  runPreparedTick(hooks: TickHooks = {}): void {
    if (this.#mode !== 'idle' || this.#preparedBoundary === null) {
      throw new Error(this.#mode === 'idle' ? 'APP_BOUNDARY_INVALID' : 'APP_EXECUTION_REENTRANT')
    }
    const tick = this.#preparedBoundary
    const snapshot = this.#capturePreparedTickSnapshot()
    const enteredWithTerminalState = isTerminal(this.#domainState)
    let preparedMaterialAdditions: readonly PreparedMaterialAddition[] = []
    let phase8Committed = false
    let committedDelta = emptySimulationDelta(tick)
    this.#mode = 'phase'

    try {
      for (const phase of TICK_PHASES) {
        this.#trace.push(`phase:${phase}`)
        if (phase === 0) preparedMaterialAdditions = this.#prepareCommandsForTick(tick)
        if (phase === 1) this.#applyPreparedMaterialAdditions(preparedMaterialAdditions)
        if (phase === 8) {
          const delta =
            hooks.buildSimulationDelta?.(tick, this.#domainState) ??
            emptySimulationDelta(tick)
          const committed = commitSimulationDeltaCandidate(this.#domainState, delta)
          if (!committed.ok) throw new Error(committed.error)
          this.#domainState = committed.state
          committedDelta = delta
          phase8Committed = true
        }
        if (phase === 10 && !enteredWithTerminalState && isTerminal(this.#domainState)) {
          this.#drainFutureCommandsAtTerminal()
        }

        const nextState = hooks.onPhase?.(phase, this.#domainState)
        if (nextState !== undefined) this.#domainState = nextState

        if (phase === 9) {
          this.#domainState = evaluateExtractionState(
            this.#domainState,
            this.#rules,
          )
          this.#domainState = settleRequestedCompletion(this.#domainState)
        }
      }
      if (phase8Committed) hooks.beforeTickFinalized?.()
    } catch (error) {
      this.#restorePreparedTickSnapshot(snapshot)
      throw error
    }

    this.#nextTick = tick + 1
    this.#preparedBoundary = null
    this.#mode = 'idle'
    if (phase8Committed) {
      hooks.onTickCommitted?.({
        tick,
        state: this.#domainState,
        readModel: this.getReadModel(),
        events: createDomainEvents(
          tick,
          snapshot.domainState,
          this.#domainState,
          committedDelta,
        ),
      })
    }
  }

  #capturePreparedTickSnapshot(): PreparedTickSnapshot {
    return {
      domainState: this.#domainState,
      nextTick: this.#nextTick,
      lastAppliedSequence: this.#lastAppliedSequence,
      results: [...this.#results],
      queuedCommands: [...this.#queuedCommands],
      preparedBoundary: this.#preparedBoundary!,
      trace: [...this.#trace],
    }
  }

  #restorePreparedTickSnapshot(snapshot: PreparedTickSnapshot): void {
    this.#domainState = snapshot.domainState
    this.#nextTick = snapshot.nextTick
    this.#lastAppliedSequence = snapshot.lastAppliedSequence
    this.#results = [...snapshot.results]
    this.#queuedCommands = [...snapshot.queuedCommands]
    this.#preparedBoundary = snapshot.preparedBoundary
    this.#trace = [...snapshot.trace]
    this.#mode = 'idle'
  }

  #prepareCommandsForTick(tick: number): readonly PreparedMaterialAddition[] {
    const current = this.#queuedCommands
      .filter((command) => command.envelope.targetTick === tick)
      .sort(compareQueued)
    this.#queuedCommands = this.#queuedCommands.filter(
      (command) => command.envelope.targetTick !== tick,
    )
    const preparedMaterialAdditions: PreparedMaterialAddition[] = []
    let projectedState = this.#domainState

    for (const queued of current) {
      const command = queued.envelope as RuleCommand
      if (!isRuleCommandAllowed(projectedState, command, this.#rules)) {
        this.#replaceQueuedResult(queued, 'APP_COMMAND_NOT_ALLOWED')
        continue
      }
      const selectedMaterialBatchId = projectedState.selectedMaterialBatchId
      const projected = applyRuleCommand(projectedState, command, this.#rules)
      if (!projected.ok) {
        this.#replaceQueuedResult(
          queued,
          projected.error === 'DOMAIN_COMMAND_NOT_ALLOWED'
            ? 'APP_COMMAND_NOT_ALLOWED'
            : 'APP_COMMAND_PAYLOAD_INVALID',
        )
        continue
      }
      projectedState = projected.state

      if (command.type === 'AddSelectedMaterial') {
        if (selectedMaterialBatchId === null) {
          this.#replaceQueuedResult(queued, 'APP_COMMAND_PAYLOAD_INVALID')
          continue
        }
        preparedMaterialAdditions.push({
          command: queued,
          inventoryBatchId: selectedMaterialBatchId,
        })
        continue
      }

      const applied = applyRuleCommand(this.#domainState, command, this.#rules)
      if (!applied.ok) {
        this.#replaceQueuedResult(
          queued,
          applied.error === 'DOMAIN_COMMAND_NOT_ALLOWED'
            ? 'APP_COMMAND_NOT_ALLOWED'
            : 'APP_COMMAND_PAYLOAD_INVALID',
        )
        continue
      }
      this.#domainState = applied.state
      this.#replaceQueuedResult(queued, 'applied')
      this.#lastAppliedSequence = Math.max(
        this.#lastAppliedSequence,
        queued.envelope.sequence,
      )
    }

    return preparedMaterialAdditions
  }

  #applyPreparedMaterialAdditions(
    additions: readonly PreparedMaterialAddition[],
  ): void {
    for (const addition of additions) {
      const applied = addMaterialServingFromBatch(
        this.#domainState,
        addition.inventoryBatchId,
        this.#rules,
      )
      if (!applied.ok) {
        this.#replaceQueuedResult(
          addition.command,
          applied.error === 'DOMAIN_COMMAND_NOT_ALLOWED'
            ? 'APP_COMMAND_NOT_ALLOWED'
            : 'APP_COMMAND_PAYLOAD_INVALID',
        )
        continue
      }
      this.#domainState = applied.state
      this.#replaceQueuedResult(addition.command, 'applied')
      this.#lastAppliedSequence = Math.max(
        this.#lastAppliedSequence,
        addition.command.envelope.sequence,
      )
    }
  }

  #drainFutureCommandsAtTerminal(): void {
    const ordered = [...this.#queuedCommands].sort(compareQueued)
    for (const command of ordered) this.#replaceQueuedResult(command, 'APP_COMMAND_NOT_ALLOWED')
    this.#queuedCommands = []
  }

  getReadModel(): ApplicationReadModel {
    const pauseReasons = this.getPauseReasons()
    return {
      sessionId: this.#sessionId,
      status: this.#domainState.status,
      nextTick: this.#nextTick,
      availableFireSourceIds: [...this.#rules.availableFireSourceIds],
      equippedFireSourceId: this.#domainState.equippedFireSourceId,
      fireSize: this.#domainState.fireSize,
      isSpraying: this.#domainState.isSpraying,
      effectiveFireSize:
        this.#domainState.equippedFireSourceId !== null && this.#domainState.isSpraying
          ? this.#domainState.fireSize
          : 0,
      canFinish: deriveCanFinish(this.#domainState),
      lossWarningLevel: this.#domainState.lossWarningLevel,
      failureResult: this.#domainState.failureResult,
      paused: pauseReasons.length > 0,
      pauseReasons,
      restartConfirmation: this.#restartConfirmation,
    }
  }

  getDomainState(): DomainState {
    return this.#domainState
  }

  getSessionId(): string {
    return this.#sessionId
  }

  getNextTick(): number {
    return this.#nextTick
  }

  getNextCaptureSequence(): number {
    return this.#nextCaptureSequence
  }

  getExecutionMode(): ExecutionMode {
    return this.#mode
  }

  getPauseReasons(): readonly PauseReason[] {
    const order: readonly PauseReason[] = [
      'manual',
      'blur',
      'hidden',
      'restartConfirmation',
    ]
    return order.filter((reason) => this.#pauseReasons.has(reason))
  }

  getInputLog(): readonly InputLogEntry[] {
    return [...this.#inputLog]
  }

  getInputResults(): readonly InputResult[] {
    return [...this.#results].sort(compareResults)
  }

  getQueuedCommands(): readonly CommandEnvelope[] {
    return [...this.#queuedCommands].sort(compareQueued).map(({ envelope }) => envelope)
  }

  getSessionArchives(): readonly SessionArchive[] {
    return [...this.#archives]
  }

  getExecutionTrace(): readonly string[] {
    return [...this.#trace]
  }
}
