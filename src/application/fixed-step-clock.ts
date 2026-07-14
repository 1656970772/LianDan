export type FixedStepClockOptions = Readonly<{
  tickRateHz: number
  maxCatchUpSteps: number
}>

export type FixedStepClockFrame = Readonly<{
  advancedTickCount: number
  droppedTickCount: number
  interpolationAlpha: number
}>

export type FixedStepClockMetrics = Readonly<{
  totalAdvancedTickCount: number
  droppedTickCount: number
}>

const CLOCK_EPSILON_FACTOR = 1e-9

export class FixedStepClock {
  readonly #stepMilliseconds: number
  readonly #maxCatchUpSteps: number
  #lastFrameTimeMilliseconds: number | null = null
  #accumulatorMilliseconds = 0
  #paused = false
  #totalAdvancedTickCount = 0
  #droppedTickCount = 0

  constructor(options: FixedStepClockOptions) {
    if (
      !Number.isFinite(options.tickRateHz) ||
      options.tickRateHz <= 0 ||
      !Number.isSafeInteger(options.maxCatchUpSteps) ||
      options.maxCatchUpSteps <= 0
    ) {
      throw new Error('APP_CLOCK_INVALID_OPTIONS')
    }

    this.#stepMilliseconds = 1_000 / options.tickRateHz
    this.#maxCatchUpSteps = options.maxCatchUpSteps
  }

  frame(frameTimeMilliseconds: number, advanceTick: () => void): FixedStepClockFrame {
    if (
      !Number.isFinite(frameTimeMilliseconds) ||
      frameTimeMilliseconds < 0 ||
      (this.#lastFrameTimeMilliseconds !== null &&
        frameTimeMilliseconds < this.#lastFrameTimeMilliseconds)
    ) {
      throw new Error('APP_CLOCK_INVALID_TIMESTAMP')
    }

    if (this.#paused) {
      this.#lastFrameTimeMilliseconds = frameTimeMilliseconds
      return this.#frameResult(0, 0)
    }

    if (this.#lastFrameTimeMilliseconds === null) {
      this.#lastFrameTimeMilliseconds = frameTimeMilliseconds
      return this.#frameResult(0, 0)
    }

    this.#accumulatorMilliseconds +=
      frameTimeMilliseconds - this.#lastFrameTimeMilliseconds
    this.#lastFrameTimeMilliseconds = frameTimeMilliseconds

    const epsilon = this.#stepMilliseconds * CLOCK_EPSILON_FACTOR
    const dueTickCount = Math.floor(
      (this.#accumulatorMilliseconds + epsilon) / this.#stepMilliseconds,
    )
    const advancedTickCount = Math.min(dueTickCount, this.#maxCatchUpSteps)
    const droppedTickCount = Math.max(0, dueTickCount - advancedTickCount)

    for (let index = 0; index < advancedTickCount; index += 1) advanceTick()

    this.#accumulatorMilliseconds -= dueTickCount * this.#stepMilliseconds
    if (Math.abs(this.#accumulatorMilliseconds) <= epsilon) {
      this.#accumulatorMilliseconds = 0
    }
    this.#totalAdvancedTickCount += advancedTickCount
    this.#droppedTickCount += droppedTickCount

    return this.#frameResult(advancedTickCount, droppedTickCount)
  }

  setPaused(paused: boolean): void {
    if (this.#paused === paused) return
    this.#paused = paused
    this.#lastFrameTimeMilliseconds = null
    this.#accumulatorMilliseconds = 0
  }

  resetMetrics(): void {
    this.#totalAdvancedTickCount = 0
    this.#droppedTickCount = 0
  }

  getMetrics(): FixedStepClockMetrics {
    return {
      totalAdvancedTickCount: this.#totalAdvancedTickCount,
      droppedTickCount: this.#droppedTickCount,
    }
  }

  #frameResult(
    advancedTickCount: number,
    droppedTickCount: number,
  ): FixedStepClockFrame {
    return {
      advancedTickCount,
      droppedTickCount,
      interpolationAlpha: this.#accumulatorMilliseconds / this.#stepMilliseconds,
    }
  }
}
