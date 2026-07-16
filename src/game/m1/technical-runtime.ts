import {
  ExtractionApplication,
  FixedStepClock,
  type TickHooks,
} from '../../application/index.ts'
import type { M1FireFlowFixture } from '../../config/m1-fire-flow-fixture.ts'
import type { NormalizedConfig } from '../../config/model.ts'
import type { PrototypeRules } from '../../domain/index.ts'
import {
  FireFlowField,
  type FireFlowReadView,
  type FireFlowUpdateInput,
} from '../../simulation/fire-flow/index.ts'
import type { M1OverlayMode, M1Snapshot } from './contracts.ts'
import type { M1PerformanceSample } from './performance-metrics.ts'
import {
  advanceM1Circles,
  countM1EligibleCircles,
  createM1CircleObstacles,
  digestM1FlowView,
  rasterizeM1FullObstacles,
  sampleM1FlowView,
  type M1CircleObstacleBuffers,
  type M1FlowSample,
} from './scenario-runtime.ts'
import {
  resolveM1Scenario,
  type M1ResolvedScenario,
} from './scenarios.ts'

interface MutableFireFlowUpdateInput extends FireFlowUpdateInput {
  tick: number
  circles: M1CircleObstacleBuffers
}

interface MutablePublishedFireFlowView extends FireFlowReadView {
  generation: number
  tick: number
}

export interface M1TechnicalRuntimeOptions {
  readonly config: NormalizedConfig
  readonly fixture: M1FireFlowFixture
  readonly simulationContentFingerprint: string
  readonly initialScenarioId: string
  readonly initialOverlayMode: M1OverlayMode
}

function createPublishedView(
  source: FireFlowReadView,
): MutablePublishedFireFlowView {
  return {
    generation: 0,
    tick: -1,
    columns: source.columns,
    rows: source.rows,
    cellSize: source.cellSize,
    originX: source.originX,
    originY: source.originY,
    obstacle: source.obstacle,
    flowX: source.flowX,
    flowY: source.flowY,
    intensity: source.intensity,
  }
}

function createCircleStagingBuffers(
  source: M1CircleObstacleBuffers,
): M1CircleObstacleBuffers {
  return {
    x: new Float32Array(source.count),
    y: new Float32Array(source.count),
    radius: new Float32Array(source.count),
    eligible: new Uint8Array(source.count),
    count: source.count,
  }
}

function copyCircleState(
  source: M1CircleObstacleBuffers,
  target: M1CircleObstacleBuffers,
): void {
  target.x.set(source.x)
  target.y.set(source.y)
  target.radius.set(source.radius)
  target.eligible.set(source.eligible)
}

class TimestampRing {
  readonly #values: Float64Array
  #size = 0
  #next = 0

  constructor(capacity: number) {
    this.#values = new Float64Array(capacity)
  }

  push(value: number): void {
    this.#values[this.#next] = value
    this.#next = (this.#next + 1) % this.#values.length
    this.#size = Math.min(this.#size + 1, this.#values.length)
  }

  countSince(minimum: number): number {
    let count = 0
    for (let offset = 0; offset < this.#size; offset += 1) {
      const index =
        (this.#next - this.#size + offset + this.#values.length) %
        this.#values.length
      if (this.#values[index]! >= minimum) count += 1
    }
    return count
  }
}

class ActivePerformanceSample {
  readonly startMilliseconds: number
  readonly durationMilliseconds: number
  readonly endMilliseconds: number
  readonly frameTimestamps: Float64Array
  readonly flowTimestamps: Float64Array
  readonly flowDurations: Float64Array
  readonly droppedTickCountAtStart: number
  readonly promise: Promise<M1PerformanceSample>
  #frameCount = 0
  #flowCount = 0
  #resolve!: (sample: M1PerformanceSample) => void
  #reject!: (error: Error) => void

  constructor(
    durationMilliseconds: number,
    expectedTickRateHz: number,
    droppedTickCountAtStart: number,
  ) {
    this.startMilliseconds = performance.now()
    this.durationMilliseconds = durationMilliseconds
    this.endMilliseconds = this.startMilliseconds + durationMilliseconds
    this.droppedTickCountAtStart = droppedTickCountAtStart
    const durationSeconds = Math.ceil(durationMilliseconds / 1_000)
    this.frameTimestamps = new Float64Array(durationSeconds * 1_000 + 16)
    this.flowTimestamps = new Float64Array(
      Math.ceil((durationMilliseconds / 1_000) * expectedTickRateHz) + 32,
    )
    this.flowDurations = new Float64Array(this.flowTimestamps.length)
    this.promise = new Promise<M1PerformanceSample>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
  }

  recordFrame(timestamp: number): void {
    if (
      timestamp < this.startMilliseconds ||
      timestamp >= this.endMilliseconds ||
      this.#frameCount >= this.frameTimestamps.length
    ) {
      return
    }
    this.frameTimestamps[this.#frameCount] = timestamp
    this.#frameCount += 1
  }

  recordFlow(timestamp: number, durationMilliseconds: number): void {
    if (
      timestamp < this.startMilliseconds ||
      timestamp >= this.endMilliseconds ||
      this.#flowCount >= this.flowTimestamps.length
    ) {
      return
    }
    this.flowTimestamps[this.#flowCount] = timestamp
    this.flowDurations[this.#flowCount] = durationMilliseconds
    this.#flowCount += 1
  }

  shouldFinish(timestamp: number): boolean {
    return timestamp >= this.endMilliseconds
  }

  finish(
    droppedTickCount: number,
    activePearlCount: number,
    interactionCount: number,
  ): void {
    this.#resolve({
      sampleStartMilliseconds: this.startMilliseconds,
      sampleDurationMilliseconds: this.durationMilliseconds,
      frameTimestamps: Array.from(
        this.frameTimestamps.subarray(0, this.#frameCount),
      ),
      flowTimestamps: Array.from(
        this.flowTimestamps.subarray(0, this.#flowCount),
      ),
      flowDurationsMilliseconds: Array.from(
        this.flowDurations.subarray(0, this.#flowCount),
      ),
      droppedTickCount: droppedTickCount - this.droppedTickCountAtStart,
      activePearlCount,
      interactionCount,
    })
  }

  cancel(reason: string): void {
    this.#reject(new Error(reason))
  }
}

export class M1TechnicalRuntime {
  readonly #config: NormalizedConfig
  readonly #fixture: M1FireFlowFixture
  readonly #fingerprint: string
  readonly #frameWindow = new TimestampRing(1_024)
  readonly #tickWindow = new TimestampRing(256)
  #scenario!: M1ResolvedScenario
  #overlayMode: M1OverlayMode
  #clock!: FixedStepClock
  #application!: ExtractionApplication
  #field!: FireFlowField
  #committedField!: FireFlowField
  #view!: MutablePublishedFireFlowView
  #stagedView!: MutablePublishedFireFlowView
  #pendingSolverView!: FireFlowReadView
  #circles!: M1CircleObstacleBuffers
  #stagedCircles!: M1CircleObstacleBuffers
  #updateInput!: MutableFireFlowUpdateInput
  #ruleSample!: M1FlowSample
  #pendingRuleSample!: M1FlowSample
  #renderSample!: M1FlowSample
  #renderedGeneration = 0
  #fieldUpdateCount = 0
  #flowDigest = '00000000'
  #pendingFlowDigest = '00000000'
  #lastFlowDurationMilliseconds = 0
  #pendingFlowTimestamp = 0
  #pendingFlowDurationMilliseconds = 0
  #activeSample: ActivePerformanceSample | null = null
  #destroyed = false
  #tickPrepared = false

  readonly tickHooks = {
    onPhase: (phase: number): void => {
      if (phase === 2) {
        this.#updateInput.tick = this.#application.getNextTick()
      }
      if (phase === 3) {
        const timestamp = performance.now()
        this.#pendingSolverView = this.#field.update(this.#updateInput)
        const duration = performance.now() - timestamp
        this.#pendingFlowTimestamp = timestamp
        this.#pendingFlowDurationMilliseconds = duration
      }
      if (phase === 4) {
        this.#pendingRuleSample = sampleM1FlowView(
          this.#pendingSolverView,
          this.#samplePosition(),
        )
        this.#pendingFlowDigest = digestM1FlowView(this.#pendingSolverView)
      }
      if (phase === 5) {
        copyCircleState(this.#circles, this.#stagedCircles)
        advanceM1Circles(
          this.#stagedCircles,
          this.#scenario.circles,
          1 / this.#config.parameters.simulation.fixedStepHz,
        )
      }
    },
  }

  constructor(options: M1TechnicalRuntimeOptions) {
    this.#config = options.config
    this.#fixture = options.fixture
    this.#fingerprint = options.simulationContentFingerprint
    this.#overlayMode = options.initialOverlayMode
    this.selectScenario(options.initialScenarioId)
  }

  selectScenario(scenarioId: string): void {
    this.#activeSample?.cancel('M1_PERFORMANCE_SAMPLE_SCENARIO_CHANGED')
    this.#activeSample = null
    this.#scenario = resolveM1Scenario(this.#fixture, scenarioId)
    const flow = this.#config.parameters.flowField
    const simulation = this.#config.parameters.simulation
    const geometry = {
      columns: flow.gridColumns,
      rows: flow.gridRows,
      cellSize: flow.cellSize,
      originX: 0,
      originY: 0,
    }
    const fieldConfig = {
      geometry,
      solver: {
        circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
        lateralSpread: flow.lateralSpread,
        obstacleDeflection: flow.obstacleDeflection,
        partialObstaclePenalty: flow.partialObstaclePenalty,
        mergeRate: flow.mergeRate,
        fullObstacleThreshold: flow.fullObstacleThreshold,
      },
    }
    this.#committedField = new FireFlowField(fieldConfig)
    this.#field = new FireFlowField(fieldConfig)
    this.#clock = new FixedStepClock({
      tickRateHz: simulation.fixedStepHz,
      maxCatchUpSteps: simulation.maxCatchUpSteps,
    })
    const rules: PrototypeRules = {
      fixedDeltaSeconds: 1 / simulation.fixedStepHz,
      availableFireSourceIds: [`m1-${this.#scenario.metadata.id}`],
      fireSources: [
        {
          id: `m1-${this.#scenario.metadata.id}`,
          baseTemperature: 8,
          maximumTemperature: 100,
          heatingRatePerSecond: 24,
          coolingRatePerSecond: 10,
          temperatureCurve: 'linear',
        },
      ],
      initialFireSize: Math.min(100, this.#scenario.source.width),
      initialFireDirection: { ...this.#scenario.source.direction },
      inventoryBatches: [],
      settlement: {
        warningThresholds: [0.5, 0.65],
        failureThreshold: 0.7,
        slagUnitVolume: 100,
      },
    }
    this.#application = new ExtractionApplication(rules)
    this.#circles = createM1CircleObstacles(this.#scenario.circles)
    this.#stagedCircles = createCircleStagingBuffers(this.#circles)
    copyCircleState(this.#circles, this.#stagedCircles)
    this.#view = createPublishedView(this.#committedField.read())
    this.#stagedView = createPublishedView(this.#field.read())
    this.#pendingSolverView = this.#field.read()
    this.#updateInput = {
      tick: 0,
      source: {
        x: this.#scenario.source.position.x,
        y: this.#scenario.source.position.y,
        directionX: this.#scenario.source.direction.x,
        directionY: this.#scenario.source.direction.y,
        width: this.#scenario.source.width,
      },
      fullObstacles: rasterizeM1FullObstacles(
        this.#scenario.fullObstacleRects,
        geometry,
      ),
      circles: this.#circles,
    }
    this.#ruleSample = sampleM1FlowView(this.#view, this.#samplePosition())
    this.#pendingRuleSample = this.#ruleSample
    this.#renderSample = this.#ruleSample
    this.#renderedGeneration = 0
    this.#fieldUpdateCount = 0
    this.#flowDigest = '00000000'
    this.#pendingFlowDigest = '00000000'
    this.#lastFlowDurationMilliseconds = 0
    this.#pendingFlowTimestamp = 0
    this.#pendingFlowDurationMilliseconds = 0
    this.#tickPrepared = false
  }

  frame(clockTimestamp: number, wallTimestamp: number): void {
    if (this.#destroyed) return
    if (this.#activeSample?.shouldFinish(wallTimestamp)) {
      const sample = this.#activeSample
      this.#activeSample = null
      sample.finish(
        this.#clock.getMetrics().droppedTickCount,
        countM1EligibleCircles(this.#circles),
        0,
      )
    }
    this.#clock.frame(clockTimestamp, () => this.advanceTick())
    this.#frameWindow.push(wallTimestamp)
    this.#activeSample?.recordFrame(wallTimestamp)
  }

  advanceTick(hooks: TickHooks = {}): void {
    if (!this.#tickPrepared) {
      const boundary = this.#application.beforePhase0(
        this.#application.getNextTick(),
      )
      if (!boundary.accepted || !boundary.canAdvance) {
        throw new Error(
          boundary.accepted ? 'APP_M1_TICK_NOT_ADVANCEABLE' : boundary.error,
        )
      }
      this.#tickPrepared = true
    }
    this.#application.runPreparedTick({
      buildSimulationDelta: hooks.buildSimulationDelta,
      onPhase: (phase, state) => {
        this.tickHooks.onPhase(phase)
        return hooks.onPhase?.(phase, state)
      },
      onTickCommitted: (commit) => {
        this.#publishCommittedTick(commit.tick)
        hooks.onTickCommitted?.(commit)
      },
    })
  }

  #publishCommittedTick(tick: number): void {
    const previousField = this.#committedField
    this.#committedField = this.#field
    this.#field = previousField

    const previousView = this.#view
    this.#stagedView.generation = this.#fieldUpdateCount + 1
    this.#stagedView.tick = tick
    this.#view = this.#stagedView
    this.#stagedView = previousView
    this.#pendingSolverView = this.#field.read()

    const previousCircles = this.#circles
    this.#circles = this.#stagedCircles
    this.#stagedCircles = previousCircles
    this.#updateInput.circles = this.#circles

    this.#ruleSample = this.#pendingRuleSample
    this.#flowDigest = this.#pendingFlowDigest
    this.#lastFlowDurationMilliseconds =
      this.#pendingFlowDurationMilliseconds
    this.#fieldUpdateCount += 1
    this.#tickWindow.push(this.#pendingFlowTimestamp)
    this.#activeSample?.recordFlow(
      this.#pendingFlowTimestamp,
      this.#pendingFlowDurationMilliseconds,
    )
    this.#tickPrepared = false
  }

  setOverlayMode(mode: M1OverlayMode): void {
    this.#overlayMode = mode
  }

  startSample(durationMilliseconds: number): Promise<M1PerformanceSample> {
    if (
      this.#destroyed ||
      !Number.isFinite(durationMilliseconds) ||
      durationMilliseconds <= 0 ||
      durationMilliseconds > 3_600_000
    ) {
      return Promise.reject(new Error('M1_PERFORMANCE_SAMPLE_INVALID'))
    }
    if (this.#activeSample !== null) {
      return Promise.reject(new Error('M1_PERFORMANCE_SAMPLE_ACTIVE'))
    }
    const active = new ActivePerformanceSample(
      durationMilliseconds,
      this.#config.parameters.simulation.fixedStepHz,
      this.#clock.getMetrics().droppedTickCount,
    )
    this.#activeSample = active
    return active.promise
  }

  markRendered(sample: M1FlowSample): void {
    this.#renderSample = sample
    this.#renderedGeneration = this.#view.generation
  }

  snapshot(wallTimestamp = performance.now()): M1Snapshot {
    const applicationState = this.#application.getDomainState()
    return {
      ready:
        this.#view.generation > 0 &&
        this.#renderedGeneration === this.#view.generation,
      scenarioId: this.#scenario.metadata.id,
      scenarioKind: this.#scenario.metadata.kind,
      overlayMode: this.#overlayMode,
      tick: this.#view.tick,
      nextTick: this.#application.getNextTick(),
      lastCommittedTick: applicationState.lastCommittedTick,
      fieldGeneration: this.#view.generation,
      renderedGeneration: this.#renderedGeneration,
      fieldUpdateCount: this.#fieldUpdateCount,
      activePearlCount: countM1EligibleCircles(this.#circles),
      interactionCount: 0,
      seed: this.#scenario.metadata.seed,
      simulationContentFingerprint: this.#fingerprint,
      flowDigest: this.#flowDigest,
      ruleSample: { ...this.#ruleSample },
      renderSample: { ...this.#renderSample },
      fps: this.#frameWindow.countSince(wallTimestamp - 1_000),
      tickHz: this.#tickWindow.countSince(wallTimestamp - 1_000),
      lastFlowDurationMs: this.#lastFlowDurationMilliseconds,
      droppedTickCount: this.#clock.getMetrics().droppedTickCount,
    }
  }

  get view(): FireFlowReadView {
    return this.#view
  }

  get circles(): M1CircleObstacleBuffers {
    return this.#circles
  }

  get scenario(): M1ResolvedScenario {
    return this.#scenario
  }

  get overlayMode(): M1OverlayMode {
    return this.#overlayMode
  }

  #samplePosition(): Readonly<{ x: number; y: number }> {
    return {
      x:
        this.#scenario.source.position.x +
        this.#scenario.source.direction.x *
          this.#config.parameters.flowField.cellSize *
          2,
      y:
        this.#scenario.source.position.y +
        this.#scenario.source.direction.y *
          this.#config.parameters.flowField.cellSize *
          2,
    }
  }

  samplePosition(): Readonly<{ x: number; y: number }> {
    return this.#samplePosition()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#activeSample?.cancel('M1_PERFORMANCE_SAMPLE_DESTROYED')
    this.#activeSample = null
  }
}
