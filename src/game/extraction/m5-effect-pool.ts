import type { M5EffectKind } from './m5-feedback-mapper.ts'

export type M5EffectAnchorPoint = Readonly<{
  x: number
  y: number
  secondaryX?: number
  secondaryY?: number
}>

export type M5EffectVisitor = (
  kind: M5EffectKind,
  x: number,
  y: number,
  secondaryX: number,
  secondaryY: number,
  progress: number,
  slotIndex: number,
) => void

export type M5EffectPoolDiagnostics = Readonly<{
  activeCount: number
  capacity: number
  maximumCapacity: number
  highWaterMark: number
  droppedCount: number
  overflowPolicy: 'drop-newest'
}>

type EffectSlot = {
  active: boolean
  kind: M5EffectKind
  x: number
  y: number
  secondaryX: number
  secondaryY: number
  startedAtMilliseconds: number
  durationMilliseconds: number
}

function createEffectSlot(): EffectSlot {
  return {
    active: false,
    kind: 'birth',
    x: 0,
    y: 0,
    secondaryX: 0,
    secondaryY: 0,
    startedAtMilliseconds: 0,
    durationMilliseconds: 1,
  }
}

function requireFinite(value: number, errorCode: string): void {
  if (!Number.isFinite(value)) throw new RangeError(errorCode)
}

/**
 * Reusable active-effect storage. It can grow in initial-capacity pages up to
 * an explicit hard ceiling. Once full, the deterministic `drop-newest` policy
 * preserves existing effects and exposes every rejected spawn in diagnostics.
 * Omitting the ceiling keeps the pool fixed-size; it never opts into unbounded
 * allocation implicitly.
 */
export class M5EffectPool {
  readonly #slots: EffectSlot[]
  readonly #growthCapacity: number
  readonly #maximumCapacity: number
  #activeCount = 0
  #highWaterMark = 0
  #droppedCount = 0

  constructor(capacity: number, maximumCapacity = capacity) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('M5_EFFECT_POOL_CAPACITY_INVALID')
    }
    if (
      !Number.isSafeInteger(maximumCapacity) ||
      maximumCapacity < capacity
    ) {
      throw new RangeError('M5_EFFECT_POOL_MAX_CAPACITY_INVALID')
    }
    this.#growthCapacity = capacity
    this.#maximumCapacity = maximumCapacity
    this.#slots = Array.from({ length: capacity }, createEffectSlot)
  }

  spawn(
    kind: M5EffectKind,
    anchor: M5EffectAnchorPoint,
    timestampMilliseconds: number,
    durationMilliseconds: number,
  ): boolean {
    requireFinite(timestampMilliseconds, 'M5_EFFECT_POOL_TIMING_INVALID')
    requireFinite(durationMilliseconds, 'M5_EFFECT_POOL_TIMING_INVALID')
    requireFinite(anchor.x, 'M5_EFFECT_POOL_ANCHOR_INVALID')
    requireFinite(anchor.y, 'M5_EFFECT_POOL_ANCHOR_INVALID')
    if (durationMilliseconds <= 0) {
      throw new RangeError('M5_EFFECT_POOL_TIMING_INVALID')
    }
    if (anchor.secondaryX !== undefined) {
      requireFinite(anchor.secondaryX, 'M5_EFFECT_POOL_ANCHOR_INVALID')
    }
    if (anchor.secondaryY !== undefined) {
      requireFinite(anchor.secondaryY, 'M5_EFFECT_POOL_ANCHOR_INVALID')
    }

    this.#expire(timestampMilliseconds)
    let slotIndex = -1
    for (let index = 0; index < this.#slots.length; index += 1) {
      if (!this.#slots[index]!.active) {
        slotIndex = index
        break
      }
    }
    if (
      slotIndex < 0 &&
      this.#slots.length < this.#maximumCapacity
    ) {
      slotIndex = this.#slots.length
      const growth = Math.min(
        this.#growthCapacity,
        this.#maximumCapacity - this.#slots.length,
      )
      for (let index = 0; index < growth; index += 1) {
        this.#slots.push(createEffectSlot())
      }
    }
    if (slotIndex < 0) {
      this.#droppedCount += 1
      return false
    }
    const slot = this.#slots[slotIndex]!
    slot.active = true
    slot.kind = kind
    slot.x = anchor.x
    slot.y = anchor.y
    slot.secondaryX = anchor.secondaryX ?? anchor.x
    slot.secondaryY = anchor.secondaryY ?? anchor.y
    slot.startedAtMilliseconds = timestampMilliseconds
    slot.durationMilliseconds = durationMilliseconds
    this.#activeCount += 1
    this.#highWaterMark = Math.max(this.#highWaterMark, this.#activeCount)
    return true
  }

  forEachActive(
    timestampMilliseconds: number,
    visitor: M5EffectVisitor,
  ): void {
    requireFinite(timestampMilliseconds, 'M5_EFFECT_POOL_TIMING_INVALID')
    this.#expire(timestampMilliseconds)
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index]!
      if (!slot.active) continue
      const progress = Math.max(
        0,
        Math.min(
          1,
          (timestampMilliseconds - slot.startedAtMilliseconds) /
            slot.durationMilliseconds,
        ),
      )
      visitor(
        slot.kind,
        slot.x,
        slot.y,
        slot.secondaryX,
        slot.secondaryY,
        progress,
        index,
      )
    }
  }

  reset(): void {
    for (let index = 0; index < this.#slots.length; index += 1) {
      this.#slots[index]!.active = false
    }
    this.#activeCount = 0
    this.#highWaterMark = 0
    this.#droppedCount = 0
  }

  /** 逐帧无分配读取；完整 diagnostics 只用于采样边界与调试快照。 */
  get capacity(): number {
    return this.#slots.length
  }

  getDiagnostics(): M5EffectPoolDiagnostics {
    return {
      activeCount: this.#activeCount,
      capacity: this.#slots.length,
      maximumCapacity: this.#maximumCapacity,
      highWaterMark: this.#highWaterMark,
      droppedCount: this.#droppedCount,
      overflowPolicy: 'drop-newest',
    }
  }

  /** Evidence-only allocation boundary; normal rendering uses forEachActive. */
  copyActiveKinds(): readonly M5EffectKind[] {
    const kinds: M5EffectKind[] = []
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index]!
      if (!slot.active || kinds.includes(slot.kind)) continue
      kinds.push(slot.kind)
    }
    return kinds
  }

  #expire(timestampMilliseconds: number): void {
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index]!
      if (
        slot.active &&
        timestampMilliseconds - slot.startedAtMilliseconds >=
          slot.durationMilliseconds
      ) {
        slot.active = false
        this.#activeCount -= 1
      }
    }
  }
}
