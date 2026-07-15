import type { DomainEvent, DomainState, PrototypeRules } from '../domain/index.ts'
import type { SimulationDelta } from '../simulation/index.ts'
import type {
  ApplicationControlDraft,
  ApplicationReadModel,
  RuleCommandDraft,
  SessionArchive,
  TickCommit,
} from './contracts.ts'
import { FixedStepClock, type FixedStepClockMetrics } from './fixed-step-clock.ts'
import { ExtractionApplication } from './session.ts'

export type ExtractionSimulationPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface ExtractionSimulationPort<TRead> {
  beginTick(input: Readonly<{ tick: number; domainState: DomainState }>): void
  runPhase(phase: ExtractionSimulationPhase, state: DomainState): void
  buildCandidate(): SimulationDelta
  commitTick(): void
  rollbackTick(): void
  reset(): void
  read(): TRead
}

export type ExtractionRuntimeSnapshot<TRead> = Readonly<{
  application: ApplicationReadModel
  domain: DomainState
  simulation: TRead
  events: readonly DomainEvent[]
  clock: FixedStepClockMetrics
}>

export type ExtractionRuntimeOptions<TRead> = Readonly<{
  rules: PrototypeRules
  simulation: ExtractionSimulationPort<TRead>
  tickRateHz: number
  maxCatchUpSteps: number
  onCommitted?: (snapshot: ExtractionRuntimeSnapshot<TRead>) => void
}>

function isSimulationPhase(phase: number): phase is ExtractionSimulationPhase {
  return phase >= 1 && phase <= 7
}

function tickCanNeverAdvance(model: ApplicationReadModel): boolean {
  return model.status === 'failed' || model.status === 'completed'
}

export class ExtractionRuntime<TRead> {
  readonly #application: ExtractionApplication
  readonly #simulation: ExtractionSimulationPort<TRead>
  readonly #clock: FixedStepClock
  readonly #onCommitted: ExtractionRuntimeOptions<TRead>['onCommitted']
  #lastEvents: readonly DomainEvent[] = []

  constructor(options: ExtractionRuntimeOptions<TRead>) {
    this.#application = new ExtractionApplication(options.rules)
    this.#simulation = options.simulation
    this.#clock = new FixedStepClock({
      tickRateHz: options.tickRateHz,
      maxCatchUpSteps: options.maxCatchUpSteps,
    })
    this.#onCommitted = options.onCommitted
  }

  captureRuleCommand(draft: RuleCommandDraft): void {
    this.#application.captureRuleCommand(draft)
  }

  captureControl(draft: ApplicationControlDraft): void {
    this.#application.captureApplicationControl(draft)
  }

  frame(frameTimeMilliseconds: number): void {
    const beforeFrame = this.#application.getReadModel()
    const controlOnly = beforeFrame.paused || tickCanNeverAdvance(beforeFrame)
    this.#clock.setPaused(controlOnly)

    if (controlOnly) {
      const boundary = this.#application.beforePhase0(
        this.#application.getNextTick(),
      )
      if (!boundary.accepted) throw new Error(boundary.error)
      if (boundary.resetCutover) {
        this.#resetSimulationAfterCutover()
        return
      }
      if (boundary.canAdvance) {
        this.#clock.setPaused(false)
        this.#runPreparedTick()
      }
      this.#synchronizeClockPause()
      return
    }

    let halted = false
    this.#clock.frame(frameTimeMilliseconds, () => {
      if (halted) return false
      const boundary = this.#application.beforePhase0(
        this.#application.getNextTick(),
      )
      if (!boundary.accepted) throw new Error(boundary.error)
      if (boundary.resetCutover) {
        this.#resetSimulationAfterCutover()
        halted = true
        return false
      }
      if (!boundary.canAdvance) {
        halted = true
        return false
      }
      this.#runPreparedTick()
      return true
    })
    this.#synchronizeClockPause()
  }

  #runPreparedTick(): void {
    const tick = this.#application.getNextTick()
    this.#simulation.beginTick({
      tick,
      domainState: this.#application.getDomainState(),
    })
    let committed: TickCommit | null = null
    let simulationCommitted = false
    try {
      this.#application.runPreparedTick({
        onPhase: (phase, state) => {
          if (isSimulationPhase(phase)) this.#simulation.runPhase(phase, state)
        },
        buildSimulationDelta: () => this.#simulation.buildCandidate(),
        beforeTickFinalized: () => {
          this.#simulation.commitTick()
          simulationCommitted = true
        },
        onTickCommitted: (commit) => {
          committed = commit
        },
      })
    } catch (error) {
      if (!simulationCommitted) this.#simulation.rollbackTick()
      throw error
    }

    if (committed !== null) {
      this.#lastEvents = (committed as TickCommit).events
      this.#onCommitted?.(this.snapshot())
    }
  }

  #resetSimulationAfterCutover(): void {
    this.#simulation.reset()
    this.#lastEvents = []
    this.#clock.resetMetrics()
    this.#synchronizeClockPause()
  }

  #synchronizeClockPause(): void {
    const model = this.#application.getReadModel()
    this.#clock.setPaused(model.paused || tickCanNeverAdvance(model))
  }

  snapshot(): ExtractionRuntimeSnapshot<TRead> {
    return {
      application: this.#application.getReadModel(),
      domain: this.#application.getDomainState(),
      simulation: this.#simulation.read(),
      events: [...this.#lastEvents],
      clock: this.#clock.getMetrics(),
    }
  }

  getSessionArchives(): readonly SessionArchive[] {
    return this.#application.getSessionArchives()
  }
}
