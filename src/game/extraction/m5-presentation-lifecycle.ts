import {
  assertM5FailurePhaseConfig,
  deriveM5FailureState,
  type M5FailurePhaseConfig,
  type M5FailurePresentationState,
} from './m5-failure-presentation.ts'

export type { M5FailurePresentationState } from './m5-failure-presentation.ts'

export type M5FirePresentationState =
  | 'off'
  | 'emerging'
  | 'steady'
  | 'cooling'

export type M5PresentationLifecycleConfig = Readonly<{
  afterglowSeconds: number
  steadyThresholdSeconds: number
  failureDurationSeconds: number
  failurePhases: M5FailurePhaseConfig
  reducedMotion: boolean
}>

export type M5PresentationSemanticEvent = Readonly<{
  type: 'FailureConversionCompleted'
  sessionId: string
  occurredAtMs: number
}>

export type M5PresentationLifecycleSnapshot = Readonly<{
  sessionId: string | null
  reducedMotion: boolean
  fire: Readonly<{
    state: M5FirePresentationState
    visualIntensity: number
  }>
  failure: Readonly<{
    state: M5FailurePresentationState
    progress: number
  }>
}>

const EMPTY_PRESENTATION_EVENTS: readonly M5PresentationSemanticEvent[] =
  Object.freeze([])
const MILLISECONDS_PER_SECOND = 1_000

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function requireFiniteDuration(
  value: number,
  minimum: number,
  errorCode: string,
): void {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(errorCode)
}

function requireTimestamp(timestampMs: number): void {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError('M5_PRESENTATION_TIMESTAMP_INVALID')
  }
}

function requireSessionId(sessionId: string): void {
  if (sessionId.trim().length === 0) {
    throw new TypeError('M5_PRESENTATION_SESSION_ID_INVALID')
  }
}

/**
 * Owns presentation-only timelines. Every mutating timeline call is scoped to a
 * session id so callbacks retained by an archived session become harmless.
 */
export class M5PresentationLifecycle {
  readonly #afterglowDurationMs: number
  readonly #steadyThresholdDurationMs: number
  readonly #failureDurationMs: number
  readonly #failurePhases: M5FailurePhaseConfig
  readonly #reducedMotion: boolean
  #sessionId: string | null = null
  #lastTimestampMs = Number.NEGATIVE_INFINITY
  #timelinePaused = false
  #timelinePausedAtMs = Number.NaN
  #rulesFireActive = false
  #fireState: M5FirePresentationState = 'off'
  #fireVisualIntensity = 0
  #fireStartedAtMs = Number.NaN
  #coolingStartedAtMs = Number.NaN
  #coolingStartIntensity = 0
  #failureState: M5FailurePresentationState = 'idle'
  #failureProgress = 0
  #failureStartedAtMs = Number.NaN
  #failureCompletionPublished = false
  readonly #events: M5PresentationSemanticEvent[] = []
  #snapshotCache: M5PresentationLifecycleSnapshot | null = null

  constructor(config: M5PresentationLifecycleConfig) {
    requireFiniteDuration(
      config.afterglowSeconds,
      0,
      'M5_PRESENTATION_AFTERGLOW_INVALID',
    )
    assertM5FailurePhaseConfig(config.failurePhases)
    requireFiniteDuration(
      config.steadyThresholdSeconds,
      0,
      'M5_PRESENTATION_STEADY_THRESHOLD_INVALID',
    )
    requireFiniteDuration(
      config.failureDurationSeconds,
      Number.EPSILON,
      'M5_PRESENTATION_FAILURE_DURATION_INVALID',
    )
    if (typeof config.reducedMotion !== 'boolean') {
      throw new TypeError('M5_PRESENTATION_REDUCED_MOTION_INVALID')
    }
    this.#afterglowDurationMs =
      config.afterglowSeconds * MILLISECONDS_PER_SECOND
    this.#steadyThresholdDurationMs =
      config.steadyThresholdSeconds * MILLISECONDS_PER_SECOND
    this.#failureDurationMs =
      config.failureDurationSeconds * MILLISECONDS_PER_SECOND
    this.#failurePhases = Object.freeze({ ...config.failurePhases })
    this.#reducedMotion = config.reducedMotion
  }

  resetSession(sessionId: string): M5PresentationLifecycleSnapshot {
    requireSessionId(sessionId)
    this.#sessionId = sessionId
    this.#lastTimestampMs = Number.NEGATIVE_INFINITY
    this.#timelinePaused = false
    this.#timelinePausedAtMs = Number.NaN
    this.#clearFire()
    this.#failureState = 'idle'
    this.#failureProgress = 0
    this.#failureStartedAtMs = Number.NaN
    this.#failureCompletionPublished = false
    this.#events.length = 0
    return this.getSnapshot()
  }

  setRuleFireActive(
    sessionId: string,
    active: boolean,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    this.#rulesFireActive = active
    if (active) {
      if (this.#fireState === 'off' || this.#fireState === 'cooling') {
        this.#fireState = this.#reducedMotion ? 'steady' : 'emerging'
        this.#fireVisualIntensity = 1
        this.#fireStartedAtMs = timestampMs
        this.#coolingStartedAtMs = Number.NaN
        this.#coolingStartIntensity = 0
      }
    } else if (this.#fireState === 'emerging' || this.#fireState === 'steady') {
      this.#fireState = 'cooling'
      this.#coolingStartedAtMs = timestampMs
      this.#coolingStartIntensity = clampUnit(this.#fireVisualIntensity)
    }
    return this.getSnapshot()
  }

  markFireSteady(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    if (
      this.#rulesFireActive &&
      this.#fireState === 'emerging' &&
      timestampMs - this.#fireStartedAtMs >= this.#steadyThresholdDurationMs
    ) {
      this.#fireState = 'steady'
      this.#fireVisualIntensity = 1
    }
    return this.getSnapshot()
  }

  hardClearFire(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    this.#clearFire()
    return this.getSnapshot()
  }

  beginFailureConversion(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    if (this.#failureState !== 'idle') return this.getSnapshot()
    this.#clearFire()
    this.#failureState = 'charring'
    this.#failureProgress = 0
    this.#failureStartedAtMs = timestampMs
    this.#failureCompletionPublished = false
    return this.getSnapshot()
  }

  advance(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    return this.getSnapshot()
  }

  pauseTimeline(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#prepareTimelineCall(sessionId, timestampMs)) return null
    if (!this.#timelinePaused) {
      this.#timelinePaused = true
      this.#timelinePausedAtMs = timestampMs
    }
    return this.getSnapshot()
  }

  resumeTimeline(
    sessionId: string,
    timestampMs: number,
  ): M5PresentationLifecycleSnapshot | null {
    if (!this.#validateTimelineCall(sessionId, timestampMs)) return null
    if (!this.#timelinePaused) {
      this.#advanceFire(timestampMs)
      this.#advanceFailure(timestampMs)
      this.#lastTimestampMs = timestampMs
      return this.getSnapshot()
    }

    const pausedAtMs = this.#timelinePausedAtMs
    this.#fireStartedAtMs = this.#rebaseTimelineAnchor(
      this.#fireStartedAtMs,
      pausedAtMs,
      timestampMs,
    )
    this.#coolingStartedAtMs = this.#rebaseTimelineAnchor(
      this.#coolingStartedAtMs,
      pausedAtMs,
      timestampMs,
    )
    this.#failureStartedAtMs = this.#rebaseTimelineAnchor(
      this.#failureStartedAtMs,
      pausedAtMs,
      timestampMs,
    )
    this.#timelinePaused = false
    this.#timelinePausedAtMs = Number.NaN
    this.#lastTimestampMs = timestampMs
    return this.getSnapshot()
  }

  drainEvents(sessionId: string): readonly M5PresentationSemanticEvent[] {
    if (sessionId !== this.#sessionId || this.#events.length === 0) {
      return EMPTY_PRESENTATION_EVENTS
    }
    return Object.freeze(this.#events.splice(0, this.#events.length))
  }

  getSnapshot(): M5PresentationLifecycleSnapshot {
    const fireVisualIntensity = clampUnit(this.#fireVisualIntensity)
    const failureProgress = clampUnit(this.#failureProgress)
    const cached = this.#snapshotCache
    if (
      cached !== null &&
      cached.sessionId === this.#sessionId &&
      cached.fire.state === this.#fireState &&
      cached.fire.visualIntensity === fireVisualIntensity &&
      cached.failure.state === this.#failureState &&
      cached.failure.progress === failureProgress
    ) {
      return cached
    }
    const snapshot = Object.freeze({
      sessionId: this.#sessionId,
      reducedMotion: this.#reducedMotion,
      fire: Object.freeze({
        state: this.#fireState,
        visualIntensity: fireVisualIntensity,
      }),
      failure: Object.freeze({
        state: this.#failureState,
        progress: failureProgress,
      }),
    })
    this.#snapshotCache = snapshot
    return snapshot
  }

  #prepareTimelineCall(sessionId: string, timestampMs: number): boolean {
    if (!this.#validateTimelineCall(sessionId, timestampMs)) return false
    if (!this.#timelinePaused) {
      this.#advanceFire(timestampMs)
      this.#advanceFailure(timestampMs)
    }
    this.#lastTimestampMs = timestampMs
    return true
  }

  #validateTimelineCall(sessionId: string, timestampMs: number): boolean {
    if (sessionId !== this.#sessionId) return false
    requireTimestamp(timestampMs)
    if (timestampMs < this.#lastTimestampMs) {
      throw new RangeError('M5_PRESENTATION_TIMESTAMP_REVERSED')
    }
    return true
  }

  #rebaseTimelineAnchor(
    anchorMs: number,
    pausedAtMs: number,
    resumedAtMs: number,
  ): number {
    if (!Number.isFinite(anchorMs)) return anchorMs
    return anchorMs + resumedAtMs - Math.max(pausedAtMs, anchorMs)
  }

  #advanceFire(timestampMs: number): void {
    if (this.#fireState !== 'cooling') return
    if (this.#afterglowDurationMs === 0) {
      this.#clearFire()
      return
    }
    const elapsedMs = Math.max(0, timestampMs - this.#coolingStartedAtMs)
    const remainingRatio = 1 - elapsedMs / this.#afterglowDurationMs
    this.#fireVisualIntensity = clampUnit(
      this.#coolingStartIntensity * remainingRatio,
    )
    if (remainingRatio <= 0) this.#clearFire()
  }

  #advanceFailure(timestampMs: number): void {
    if (this.#failureState === 'idle' || this.#failureState === 'result') return
    const elapsedMs = Math.max(0, timestampMs - this.#failureStartedAtMs)
    this.#failureProgress = clampUnit(elapsedMs / this.#failureDurationMs)
    if (this.#failureProgress >= 1) {
      this.#failureState = 'result'
      this.#publishFailureCompletion()
    } else {
      this.#failureState = deriveM5FailureState(
        this.#failureProgress,
        this.#failurePhases,
      )
    }
  }

  #publishFailureCompletion(): void {
    if (this.#failureCompletionPublished || this.#sessionId === null) return
    this.#failureCompletionPublished = true
    this.#events.push(
      Object.freeze({
        type: 'FailureConversionCompleted',
        sessionId: this.#sessionId,
        occurredAtMs: this.#failureStartedAtMs + this.#failureDurationMs,
      }),
    )
  }

  #clearFire(): void {
    this.#rulesFireActive = false
    this.#fireState = 'off'
    this.#fireVisualIntensity = 0
    this.#fireStartedAtMs = Number.NaN
    this.#coolingStartedAtMs = Number.NaN
    this.#coolingStartIntensity = 0
  }
}
