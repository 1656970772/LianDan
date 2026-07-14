import type { M1FixtureSource } from '../../config/m1-fire-flow-fixture.ts'
import type { FireFlowReadView } from '../../simulation/fire-flow/index.ts'
import type { M1FirePresentationConfig } from './fire-presentation-config.ts'

const HASH_DIVISOR = 0x1_0000_0000
const TWO_PI = Math.PI * 2

function hash01(index: number, salt: number): number {
  let value = (index + 1) ^ salt
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d)
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b)
  return ((value ^ (value >>> 16)) >>> 0) / HASH_DIVISOR
}

export type M1FireParticleView = Readonly<{
  count: number
  x: Float32Array
  y: Float32Array
  flowX: Float32Array
  flowY: Float32Array
  displayOffsetX: Float32Array
  displayOffsetY: Float32Array
  trailScale: Float32Array
  sizeScale: Float32Array
}>

export class M1FirePresentation {
  readonly #config: M1FirePresentationConfig
  readonly #x: Float32Array
  readonly #y: Float32Array
  readonly #flowX: Float32Array
  readonly #flowY: Float32Array
  readonly #displayOffsetX: Float32Array
  readonly #displayOffsetY: Float32Array
  readonly #age: Float32Array
  readonly #speedScale: Float32Array
  readonly #trailScale: Float32Array
  readonly #lifeScale: Float32Array
  readonly #sizeScale: Float32Array
  readonly #wavePhase: Float32Array
  readonly #particleView: M1FireParticleView
  #frame = 0

  constructor(config: M1FirePresentationConfig) {
    this.#config = config
    this.#x = new Float32Array(config.particleCount)
    this.#y = new Float32Array(config.particleCount)
    this.#flowX = new Float32Array(config.particleCount)
    this.#flowY = new Float32Array(config.particleCount)
    this.#displayOffsetX = new Float32Array(config.particleCount)
    this.#displayOffsetY = new Float32Array(config.particleCount)
    this.#age = new Float32Array(config.particleCount)
    this.#speedScale = new Float32Array(config.particleCount)
    this.#trailScale = new Float32Array(config.particleCount)
    this.#lifeScale = new Float32Array(config.particleCount)
    this.#sizeScale = new Float32Array(config.particleCount)
    this.#wavePhase = new Float32Array(config.particleCount)

    for (let index = 0; index < config.particleCount; index += 1) {
      this.#speedScale[index] =
        1 + (hash01(index, 0x193a_72d5) * 2 - 1) * config.speedVariationRatio
      this.#trailScale[index] =
        1 + (hash01(index, 0x54c8_0e31) * 2 - 1) * config.trailVariationRatio
      this.#lifeScale[index] =
        1 +
        (hash01(index, 0xa61f_49b7) * 2 - 1) * config.lifetimeVariationRatio
      this.#sizeScale[index] =
        1 +
        (hash01(index, 0x2bd4_f806) * 2 - 1) *
          config.headRadiusVariationRatio
      this.#wavePhase[index] = hash01(index, 0xf31e_65ac) * TWO_PI
    }

    this.#particleView = Object.freeze({
      count: config.particleCount,
      x: this.#x,
      y: this.#y,
      flowX: this.#flowX,
      flowY: this.#flowY,
      displayOffsetX: this.#displayOffsetX,
      displayOffsetY: this.#displayOffsetY,
      trailScale: this.#trailScale,
      sizeScale: this.#sizeScale,
    })
  }

  reset(view: FireFlowReadView, source: M1FixtureSource): void {
    for (let index = 0; index < this.#x.length; index += 1) {
      this.#spawn(index, source)
      const targetAge =
        hash01(index, 0x87b2_16e9) *
        this.#config.lifetimeSeconds *
        this.#lifeScale[index]!
      for (
        let age = 0;
        age < targetAge;
        age += this.#config.prewarmStepSeconds
      ) {
        if (
          !this.#advanceParticle(
            index,
            view,
            source,
            this.#config.prewarmStepSeconds,
          )
        ) {
          this.#spawn(index, source)
        }
      }
    }
    this.#frame = 1
  }

  advance(
    view: FireFlowReadView,
    source: M1FixtureSource,
    deltaSeconds: number,
  ): void {
    const delta = Math.max(
      0,
      Math.min(this.#config.maximumDeltaSeconds, deltaSeconds),
    )
    for (let index = 0; index < this.#x.length; index += 1) {
      if (!this.#advanceParticle(index, view, source, delta)) {
        this.#spawn(index, source)
        this.#sampleFlow(index, view)
      }
    }
    this.#frame += 1
  }

  get particles(): M1FireParticleView {
    return this.#particleView
  }

  get frame(): number {
    return this.#frame
  }

  #spawn(index: number, source: M1FixtureSource): void {
    const directionLength = Math.hypot(
      source.direction.x,
      source.direction.y,
    )
    const directionX = source.direction.x / directionLength
    const directionY = source.direction.y / directionLength
    const perpendicularX = -directionY
    const perpendicularY = directionX
    const uniformLateral = hash01(index, 0x4c93_d17b) - 0.5
    const triangularLateral =
      (hash01(index, 0x4c93_d17b) + hash01(index, 0x6bd1_e995)) / 2 - 0.5
    const lateralRatio =
      uniformLateral +
      (triangularLateral - uniformLateral) *
        this.#config.sourceLateralCenterBias
    const lateral =
      lateralRatio * source.width * this.#config.sourceWidthScale
    const depth = hash01(index, 0xd82a_3fc1) * this.#config.sourceDepthPixels
    this.#x[index] =
      source.position.x + perpendicularX * lateral + directionX * depth
    this.#y[index] =
      source.position.y + perpendicularY * lateral + directionY * depth
    this.#flowX[index] = directionX
    this.#flowY[index] = directionY
    this.#age[index] = 0
    this.#updateDisplayOffset(index, perpendicularX, perpendicularY)
  }

  #advanceParticle(
    index: number,
    view: FireFlowReadView,
    source: M1FixtureSource,
    deltaSeconds: number,
  ): boolean {
    const maximumAge =
      this.#config.lifetimeSeconds * this.#lifeScale[index]!
    if (this.#age[index]! >= maximumAge) return false
    if (!this.#sampleFlow(index, view)) return false
    const step =
      this.#config.speedPixelsPerSecond *
      this.#speedScale[index]! *
      deltaSeconds
    this.#x[index] = this.#x[index]! + this.#flowX[index]! * step
    this.#y[index] = this.#y[index]! + this.#flowY[index]! * step
    this.#age[index] = this.#age[index]! + deltaSeconds
    const directionLength = Math.hypot(
      source.direction.x,
      source.direction.y,
    )
    this.#updateDisplayOffset(
      index,
      -source.direction.y / directionLength,
      source.direction.x / directionLength,
    )
    return this.#sampleFlow(index, view) || this.#age[index]! < 0.05
  }

  #updateDisplayOffset(
    index: number,
    perpendicularX: number,
    perpendicularY: number,
  ): void {
    const sway =
      Math.sin(
        this.#wavePhase[index]! +
          this.#age[index]! * this.#config.displaySwayFrequencyHz * TWO_PI,
      ) * this.#config.displaySwayPixels
    this.#displayOffsetX[index] = perpendicularX * sway
    this.#displayOffsetY[index] = perpendicularY * sway
  }

  #sampleFlow(index: number, view: FireFlowReadView): boolean {
    const column = Math.floor((this.#x[index]! - view.originX) / view.cellSize)
    const row = Math.floor((this.#y[index]! - view.originY) / view.cellSize)
    if (
      column < 0 ||
      column >= view.columns ||
      row < 0 ||
      row >= view.rows
    ) {
      return false
    }
    const cellIndex = row * view.columns + column
    if (view.intensity[cellIndex] === 0) return false
    const flowX = view.flowX[cellIndex]!
    const flowY = view.flowY[cellIndex]!
    const length = Math.hypot(flowX, flowY)
    if (length <= 0.001) return false
    this.#flowX[index] = flowX / length
    this.#flowY[index] = flowY / length
    return true
  }
}
