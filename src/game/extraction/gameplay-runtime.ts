import {
  ExtractionRuntime,
  type ApplicationControlDraft,
  type ExtractionRuntimeSnapshot,
  type SessionArchive,
} from '../../application/index.ts'
import type {
  DomainEvent,
  PrototypeRules,
  RuleCommand,
} from '../../domain/index.ts'
import {
  ExtractionSimulation,
  type ExtractionSimulationConfig,
  type ExtractionSimulationReadView,
} from '../../simulation/index.ts'

const EMPTY_DOMAIN_EVENTS: readonly DomainEvent[] = Object.freeze([])

export type M2GameplayRuntimeSnapshot =
  ExtractionRuntimeSnapshot<ExtractionSimulationReadView>

export type M2GameplayRuntimeOptions = Readonly<{
  rules: PrototypeRules
  simulationConfig: ExtractionSimulationConfig
  tickRateHz: number
  maxCatchUpSteps: number
}>

/**
 * Browser-facing adapter around the authoritative application/simulation pair.
 * It owns tick targeting and turns committed domain events into a drainable
 * queue so a rendering frame cannot observe or replay half-written changes.
 */
export class M2GameplayRuntime {
  readonly #runtime: ExtractionRuntime<ExtractionSimulationReadView>
  #pendingDomainEvents: DomainEvent[] = []
  #sessionId: string

  constructor(options: M2GameplayRuntimeOptions) {
    const simulation = new ExtractionSimulation(options.simulationConfig)
    this.#runtime = new ExtractionRuntime({
      rules: options.rules,
      simulation,
      tickRateHz: options.tickRateHz,
      maxCatchUpSteps: options.maxCatchUpSteps,
      onCommitted: (snapshot) => {
        this.#pendingDomainEvents.push(...snapshot.events)
      },
    })
    this.#sessionId = this.#runtime.snapshot().application.sessionId
  }

  frame(frameTimeMilliseconds: number): M2GameplayRuntimeSnapshot {
    this.#runtime.frame(frameTimeMilliseconds)
    const snapshot = this.#runtime.snapshot()
    if (snapshot.application.sessionId !== this.#sessionId) {
      this.#pendingDomainEvents = []
      this.#sessionId = snapshot.application.sessionId
    }
    return snapshot
  }

  captureRuleCommand(command: RuleCommand): void {
    this.#runtime.captureRuleCommand({
      ...command,
      targetTick: this.#runtime.snapshot().application.nextTick,
    })
  }

  captureControl(control: ApplicationControlDraft): void {
    this.#runtime.captureControl(control)
  }

  snapshot(): M2GameplayRuntimeSnapshot {
    return this.#runtime.snapshot()
  }

  drainDomainEvents(): readonly DomainEvent[] {
    if (this.#pendingDomainEvents.length === 0) return EMPTY_DOMAIN_EVENTS
    const events = this.#pendingDomainEvents
    this.#pendingDomainEvents = []
    return Object.freeze(events)
  }

  getSessionArchives(): readonly SessionArchive[] {
    return this.#runtime.getSessionArchives()
  }
}
