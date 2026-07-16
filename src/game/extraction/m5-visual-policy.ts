export type M5EmberFrameInput = Readonly<{
  ratePerSecond: number
  framesPerSecond: number
  particleCount: number
  frame: number
}>

export type M5EmberFrame = Readonly<{
  drawCount: number
  stride: number
  startIndex: number
}>

export type M5EmberFrameOutput = {
  drawCount: number
  stride: number
  startIndex: number
}

export type M5PearlVisualProfile = Readonly<{
  shape: 'droplet' | 'clump' | 'spike'
  motion: 'swim' | 'tumble' | 'jitter'
  surface: 'glossy' | 'rough' | 'smoky'
}>

export type M5PearlVisualStyle = Readonly<{
  shape: M5PearlVisualProfile['shape']
  motion: M5PearlVisualProfile['motion']
  surface: M5PearlVisualProfile['surface']
  pointCount: number
}>

export type M5DebrisFrameInput = Readonly<{
  debrisRatePerSecond: number
  framesPerSecond: number
  dissolvedRatio: number
  frame: number
  maximumVisible: number
}>

export type M5DebrisFrame = Readonly<{
  emittedCount: number
  visibleCount: number
}>

export type M5DebrisFrameOutput = {
  emittedCount: number
  visibleCount: number
}

export type M5DebrisLifetimeWindowConfig = Readonly<{
  capacity: number
  lifetimeFrames: number
}>

export type M5DebrisLifetimeVisitor = (
  slotIndex: number,
  ownerId: string,
  lifeProgress: number,
) => void

/**
 * 用墙钟增量累计任意每秒速率。实例可在渲染循环中复用，
 * sample/reset 都只更新数值字段，不产生逐帧对象。
 */
export class M5WallClockRateAccumulator {
  #lastTimestampMilliseconds = Number.NaN
  #remainder = 0

  reset(timestampMilliseconds = Number.NaN): void {
    this.#lastTimestampMilliseconds = Number.isFinite(timestampMilliseconds)
      ? timestampMilliseconds
      : Number.NaN
    this.#remainder = 0
  }

  sample(ratePerSecond: number, timestampMilliseconds: number): number {
    if (!Number.isFinite(timestampMilliseconds)) {
      this.reset()
      return 0
    }
    const rate = Math.max(0, Number.isFinite(ratePerSecond) ? ratePerSecond : 0)
    if (rate === 0) {
      this.reset(timestampMilliseconds)
      return 0
    }
    if (
      !Number.isFinite(this.#lastTimestampMilliseconds) ||
      timestampMilliseconds < this.#lastTimestampMilliseconds
    ) {
      this.reset(timestampMilliseconds)
      return 0
    }

    const elapsedSeconds =
      (timestampMilliseconds - this.#lastTimestampMilliseconds) / 1_000
    this.#lastTimestampMilliseconds = timestampMilliseconds
    const accumulated = this.#remainder + elapsedSeconds * rate
    const emittedCount = Math.floor(accumulated + 1e-9)
    this.#remainder = Math.max(0, accumulated - emittedCount)
    return emittedCount
  }
}

/**
 * 按容量与寿命管理已实际发射的碎屑。内部使用固定槽位，
 * 满载时覆盖最早的槽位，不会因持续渲染而增长内存。
 */
export class M5DebrisLifetimeWindow {
  readonly #capacity: number
  readonly #lifetimeFrames: number
  readonly #birthFrames: Int32Array
  readonly #ownerIds: (string | null)[]
  #nextSlot = 0
  #activeCount = 0

  constructor(config: M5DebrisLifetimeWindowConfig) {
    this.#capacity = Math.max(0, Math.floor(config.capacity))
    this.#lifetimeFrames = Math.max(1, Math.ceil(config.lifetimeFrames))
    this.#birthFrames = new Int32Array(this.#capacity)
    this.#ownerIds = new Array<string | null>(this.#capacity).fill(null)
    this.#birthFrames.fill(-1)
  }

  get activeCount(): number {
    return this.#activeCount
  }

  reset(): void {
    this.#birthFrames.fill(-1)
    this.#ownerIds.fill(null)
    this.#nextSlot = 0
    this.#activeCount = 0
  }

  advance(frame: number): void {
    const currentFrame = Math.max(0, Math.floor(frame))
    for (let slot = 0; slot < this.#capacity; slot += 1) {
      if (this.#ownerIds[slot] === null) continue
      if (currentFrame - this.#birthFrames[slot]! < this.#lifetimeFrames) {
        continue
      }
      this.#ownerIds[slot] = null
      this.#birthFrames[slot] = -1
      this.#activeCount -= 1
    }
  }

  emit(ownerId: string, frame: number, emittedCount: number): number {
    const acceptedCount = Math.min(
      this.#capacity,
      Math.max(0, Math.floor(emittedCount)),
    )
    if (acceptedCount === 0) return 0
    const birthFrame = Math.max(0, Math.floor(frame))
    for (let emission = 0; emission < acceptedCount; emission += 1) {
      let slot = this.#nextSlot
      for (let scan = 0; scan < this.#capacity; scan += 1) {
        const candidate = (this.#nextSlot + scan) % this.#capacity
        if (this.#ownerIds[candidate] === null) {
          slot = candidate
          break
        }
      }
      if (this.#ownerIds[slot] === null) this.#activeCount += 1
      this.#ownerIds[slot] = ownerId
      this.#birthFrames[slot] = birthFrame
      this.#nextSlot = (slot + 1) % this.#capacity
    }
    return acceptedCount
  }

  forEachActive(frame: number, visitor: M5DebrisLifetimeVisitor): void {
    const currentFrame = Math.max(0, Math.floor(frame))
    for (let slot = 0; slot < this.#capacity; slot += 1) {
      const ownerId = this.#ownerIds[slot]
      if (ownerId === null) continue
      const lifeProgress = Math.max(
        0,
        Math.min(
          1,
          (currentFrame - this.#birthFrames[slot]!) / this.#lifetimeFrames,
        ),
      )
      visitor(slot, ownerId, lifeProgress)
    }
  }
}

function cumulativeEmissionCount(
  ratePerSecond: number,
  framesPerSecond: number,
  frame: number,
): number {
  return (
    Math.floor(((frame + 1) * ratePerSecond) / framesPerSecond) -
    Math.floor((frame * ratePerSecond) / framesPerSecond)
  )
}

/**
 * 将每秒速率确定性映射为当前表现帧的粒子采样，避免低速率被强制成每帧至少一颗。
 */
export function deriveM5EmberFrame(
  input: M5EmberFrameInput,
  output?: M5EmberFrameOutput,
): M5EmberFrame {
  const rate = Math.max(0, input.ratePerSecond)
  const framesPerSecond = Math.max(Number.EPSILON, input.framesPerSecond)
  const particleCount = Math.max(0, Math.floor(input.particleCount))
  const frame = Math.max(0, Math.floor(input.frame))
  const drawCount = Math.min(
    particleCount,
    cumulativeEmissionCount(rate, framesPerSecond, frame),
  )
  if (drawCount === 0 || particleCount === 0) {
    if (output !== undefined) {
      output.drawCount = 0
      output.stride = 0
      output.startIndex = 0
      return output
    }
    return Object.freeze({ drawCount: 0, stride: 0, startIndex: 0 })
  }
  const stride = Math.max(1, Math.floor(particleCount / drawCount))
  const startIndex = (frame * 97) % particleCount
  if (output !== undefined) {
    output.drawCount = drawCount
    output.stride = stride
    output.startIndex = startIndex
    return output
  }
  return Object.freeze({ drawCount, stride, startIndex })
}

/** 把配置中的珠子 shape/motion/surface 变成场景可直接消费的绘制策略。 */
export function deriveM5PearlVisualStyle(
  profile: M5PearlVisualProfile,
): M5PearlVisualStyle {
  return Object.freeze({
    shape: profile.shape,
    motion: profile.motion,
    surface: profile.surface,
    pointCount:
      profile.shape === 'droplet' ? 0 : profile.shape === 'clump' ? 7 : 12,
  })
}

/**
 * 只从规则只读的已溶比例派生当帧碎屑发射数。visibleCount
 * 仅保留旧调用结构，与 emittedCount 一致；跨帧可见性由有界寿命窗口管理。
 */
export function deriveM5DebrisFrame(
  input: M5DebrisFrameInput,
  output?: M5DebrisFrameOutput,
): M5DebrisFrame {
  const framesPerSecond = Math.max(Number.EPSILON, input.framesPerSecond)
  const effectiveRate =
    Math.max(0, input.debrisRatePerSecond) *
    Math.max(0, Math.min(1, input.dissolvedRatio))
  const frame = Math.max(0, Math.floor(input.frame))
  const maximumVisible = Math.max(0, Math.floor(input.maximumVisible))
  if (effectiveRate === 0 || maximumVisible === 0) {
    if (output !== undefined) {
      output.emittedCount = 0
      output.visibleCount = 0
      return output
    }
    return Object.freeze({ emittedCount: 0, visibleCount: 0 })
  }
  const emittedCount = cumulativeEmissionCount(
    effectiveRate,
    framesPerSecond,
    frame,
  )
  const visibleCount = Math.min(maximumVisible, emittedCount)
  if (output !== undefined) {
    output.emittedCount = emittedCount
    output.visibleCount = visibleCount
    return output
  }
  return Object.freeze({ emittedCount, visibleCount })
}
