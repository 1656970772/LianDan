import type {
  DomainEvent,
  DomainState,
  DomainStatus,
  PrototypeRules,
  RuleCommand,
} from '../domain/index.ts'
import type { SimulationDelta } from '../simulation/index.ts'

type EnvelopeRuleCommand<T> = T extends RuleCommand
  ? Readonly<T & { sequence: number; targetTick: number }>
  : never

export type CommandEnvelope = EnvelopeRuleCommand<RuleCommand>

export type LifecycleSnapshot = Readonly<{
  hasFocus: boolean
  visibilityState: 'visible' | 'hidden'
}>

export type ApplicationControl =
  | Readonly<{ type: 'Pause'; payload: Readonly<Record<string, never>> }>
  | Readonly<{ type: 'Resume'; payload: Readonly<Record<string, never>> }>
  | Readonly<{
      type: 'WindowBlur'
      payload: Readonly<{ lifecycleSnapshot: LifecycleSnapshot }>
    }>
  | Readonly<{
      type: 'WindowFocus'
      payload: Readonly<{ lifecycleSnapshot: LifecycleSnapshot }>
    }>
  | Readonly<{
      type: 'VisibilityChanged'
      payload: Readonly<{ lifecycleSnapshot: LifecycleSnapshot }>
    }>
  | Readonly<{ type: 'RequestRestart'; payload: Readonly<Record<string, never>> }>
  | Readonly<{
      type: 'ConfirmRestart'
      payload: Readonly<{ lifecycleSnapshot: LifecycleSnapshot }>
    }>
  | Readonly<{ type: 'CancelRestart'; payload: Readonly<Record<string, never>> }>
  | Readonly<{
      type: 'Again'
      payload: Readonly<{ lifecycleSnapshot: LifecycleSnapshot }>
    }>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function hasValidLifecycleSnapshot(payload: unknown): boolean {
  if (!hasExactKeys(payload, ['lifecycleSnapshot'])) return false
  const snapshot = payload.lifecycleSnapshot
  return (
    hasExactKeys(snapshot, ['hasFocus', 'visibilityState']) &&
    typeof snapshot.hasFocus === 'boolean' &&
    (snapshot.visibilityState === 'visible' || snapshot.visibilityState === 'hidden')
  )
}

export function validateApplicationControlPayload(
  control: unknown,
): control is ApplicationControl {
  if (!isRecord(control) || typeof control.type !== 'string') return false

  switch (control.type) {
    case 'Pause':
    case 'Resume':
    case 'RequestRestart':
    case 'CancelRestart':
      return hasExactKeys(control.payload, [])
    case 'WindowBlur':
    case 'WindowFocus':
    case 'VisibilityChanged':
    case 'ConfirmRestart':
    case 'Again':
      return hasValidLifecycleSnapshot(control.payload)
    default:
      return false
  }
}

type EnvelopeControl<T> = T extends ApplicationControl
  ? Readonly<T & { sequence: number }>
  : never

export type ApplicationControlEnvelope = EnvelopeControl<ApplicationControl>

type WithoutSequence<T> = T extends { sequence: number }
  ? Readonly<Omit<T, 'sequence'>>
  : never

export type RuleCommandDraft = WithoutSequence<CommandEnvelope>
export type ApplicationControlDraft = WithoutSequence<ApplicationControlEnvelope>

export type CapturedInput =
  | Readonly<{ channel: 'rule'; envelope: CommandEnvelope }>
  | Readonly<{ channel: 'control'; envelope: ApplicationControlEnvelope }>

export type SequenceValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false
      reason: 'duplicateOrOutOfOrder' | 'notContinuous'
      expectedSequence: number
    }>

type InputLogBase = Readonly<{
  sessionId: string
  sequence: number
  deliveryBoundaryTick: number
  sequenceValidation: SequenceValidation
}>

export type InputLogEntry =
  | Readonly<
      InputLogBase & {
        channel: 'rule'
        envelope: CommandEnvelope
      }
    >
  | Readonly<
      InputLogBase & {
        channel: 'control'
        envelope: ApplicationControlEnvelope
      }
    >

export type AppErrorCode =
  | 'APP_COMMAND_SEQUENCE_INVALID'
  | 'APP_COMMAND_LATE'
  | 'APP_COMMAND_NOT_ALLOWED'
  | 'APP_COMMAND_PAYLOAD_INVALID'
  | 'APP_EXECUTION_REENTRANT'
  | 'APP_BOUNDARY_INVALID'

export type InputOutcome =
  | 'queued'
  | 'applied'
  | 'discardedByReset'
  | Extract<
      AppErrorCode,
      | 'APP_COMMAND_SEQUENCE_INVALID'
      | 'APP_COMMAND_LATE'
      | 'APP_COMMAND_NOT_ALLOWED'
      | 'APP_COMMAND_PAYLOAD_INVALID'
    >

export type InputResult = Readonly<{
  sessionId: string
  inputLogIndex: number
  sequence: number
  channel: 'rule' | 'control'
  type: RuleCommand['type'] | ApplicationControl['type']
  targetTick?: number
  outcome: InputOutcome
}>

export type DiscardedQueuedCommand = Readonly<{
  targetTick: number
  sequence: number
  type: RuleCommand['type']
}>

export type SessionArchive = Readonly<{
  sessionId: string
  inputLog: readonly InputLogEntry[]
  results: readonly InputResult[]
  discardedQueuedCommands: readonly DiscardedQueuedCommand[]
  lastCapturedSequence: number
  lastAppliedSequence: number
}>

export type PauseReason = 'manual' | 'blur' | 'hidden' | 'restartConfirmation'
export type RestartConfirmation = 'closed' | 'open'

export const TICK_PHASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type TickPhase = (typeof TICK_PHASES)[number]

export type ExecutionMode = 'idle' | 'boundary' | 'controlPump' | 'phase'

export type BoundaryResult =
  | Readonly<{
      accepted: true
      canAdvance: boolean
      resetCutover: boolean
      deliveryBoundaryTick: number
    }>
  | Readonly<{
      accepted: false
      error: AppErrorCode
      canAdvance: false
      resetCutover: false
    }>

export type ApplicationReadModel = Readonly<{
  sessionId: string
  status: DomainStatus
  nextTick: number
  availableFireSourceIds: readonly string[]
  equippedFireSourceId: string | null
  fireSize: number
  isSpraying: boolean
  effectiveFireSize: number
  canFinish: boolean
  paused: boolean
  pauseReasons: readonly PauseReason[]
  restartConfirmation: RestartConfirmation
}>

export type TickCommit = Readonly<{
  tick: number
  state: DomainState
  readModel: ApplicationReadModel
  events: readonly DomainEvent[]
}>

export type TickHooks = Readonly<{
  buildSimulationDelta?: (tick: number, state: DomainState) => SimulationDelta
  onPhase?: (phase: TickPhase, state: DomainState) => DomainState | void
  beforeTickFinalized?: () => void
  onTickCommitted?: (commit: TickCommit) => void
}>

export type ExtractionApplicationOptions = Readonly<{
  domainState?: DomainState
  sessionOrdinal?: number
  nextTick?: number
  nextSequence?: number
  restartConfirmation?: RestartConfirmation
  pauseReasons?: readonly PauseReason[]
  onControlPump?: (
    stage: 'start' | 'end',
    envelope: ApplicationControlEnvelope,
  ) => void
}>

export type ResetCutoverVectorInput =
  | Readonly<{ channel: 'rule'; envelope: RuleCommandDraft }>
  | Readonly<{ channel: 'control'; envelope: ApplicationControlDraft }>

export type ResetCutoverVector = Readonly<{
  name:
    | 'reset-cutover-active-batch'
    | 'reset-cutover-terminal-first'
    | 'reset-cutover-terminal-prefix'
  initialStatus: Extract<DomainStatus, 'extracting' | 'failed'>
  restartConfirmation: RestartConfirmation
  deliveryBoundaryTick: number
  firstSequence: number
  randomness: Readonly<{
    draws: 0
    applicability: 'notApplicable'
  }>
  inputs: readonly ResetCutoverVectorInput[]
  expectedOutcomes: readonly InputOutcome[]
}>

export type ResetCutoverFixture = Readonly<{
  schemaVersion: 1
  simulationContentFingerprint: string
  seed: number
  vectors: readonly ResetCutoverVector[]
  criticalTicks: readonly Readonly<{
    vectorName: ResetCutoverVector['name']
    deliveryBoundaryTick: number
    state: Readonly<{
      sessionId: string
      status: DomainStatus
      nextTick: number
      queuedCommandCount: number
    }>
  }>[]
  final: Readonly<{
    domainEvents: readonly Readonly<{ type: string; sequence: number }>[]
    settlement: Readonly<{
      status: DomainStatus
      archivedSessionCount: number
      queuedCommandCount: number
    }>
  }>
}>

export type ApplicationConstruction = Readonly<{
  rules: PrototypeRules
  options?: ExtractionApplicationOptions
}>
