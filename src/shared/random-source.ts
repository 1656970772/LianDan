export const RANDOM_ALGORITHM_VERSION = 'xorshift32-v1' as const

export type RandomStreamName = 'rules' | 'visual'

export interface RandomSource {
  readonly algorithm: typeof RANDOM_ALGORITHM_VERSION
  readonly rootSeed: number
  readonly stream: RandomStreamName
  readonly initialSeed: number
  nextUint32(): number
  nextFloat(): number
  snapshot(): number
  restore(state: number): void
}

export interface SessionRandomStreams {
  readonly rules: RandomSource
  readonly visual: RandomSource
}

export const ZERO_SEED_SUBSTITUTE = 0x6d2b79f5

const STREAM_SALTS: Readonly<Record<RandomStreamName, number>> = Object.freeze({
  rules: 0xa341316c,
  visual: 0xc8013ea4,
})

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} 必须是 uint32`)
  }
}

function normalizeRootSeed(rootSeed: number): number {
  assertUint32(rootSeed, 'rootSeed')
  return rootSeed === 0 ? ZERO_SEED_SUBSTITUTE : rootSeed >>> 0
}

export function deriveStreamSeed(rootSeed: number, stream: RandomStreamName): number {
  const normalizedRootSeed = normalizeRootSeed(rootSeed)
  const derived = (normalizedRootSeed ^ STREAM_SALTS[stream]) >>> 0
  return derived === 0 ? ZERO_SEED_SUBSTITUTE : derived
}

class XorShift32RandomSource implements RandomSource {
  readonly algorithm = RANDOM_ALGORITHM_VERSION
  readonly rootSeed: number
  readonly initialSeed: number

  private state: number

  constructor(rootSeed: number, readonly stream: RandomStreamName) {
    this.rootSeed = normalizeRootSeed(rootSeed)
    this.initialSeed = deriveStreamSeed(this.rootSeed, stream)
    this.state = this.initialSeed
  }

  nextUint32(): number {
    let next = this.state
    next ^= next << 13
    next ^= next >>> 17
    next ^= next << 5
    this.state = next >>> 0
    return this.state
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000
  }

  snapshot(): number {
    return this.state
  }

  restore(state: number): void {
    assertUint32(state, 'state')
    if (state === 0) throw new RangeError('xorshift32 状态不能为 0')
    this.state = state >>> 0
  }
}

export function createRandomSource(
  rootSeed: number,
  stream: RandomStreamName,
): RandomSource {
  return new XorShift32RandomSource(rootSeed, stream)
}

export function createSessionRandomStreams(rootSeed: number): SessionRandomStreams {
  return Object.freeze({
    rules: createRandomSource(rootSeed, 'rules'),
    visual: createRandomSource(rootSeed, 'visual'),
  })
}
