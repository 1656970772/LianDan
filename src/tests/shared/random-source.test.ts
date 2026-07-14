import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  createRandomSource,
  createSessionRandomStreams,
  RANDOM_ALGORITHM_VERSION,
} from '../../shared/random-source'

interface RngGolden {
  algorithm: string
  rootSeed: number
  zeroSeedSubstitute: number
  isolationProbe: {
    extraVisualDraws: number
    rulesUint32AfterVisualDraws: number[]
  }
  streams: {
    rules: { derivedSeed: number; uint32: number[]; floats: number[] }
    visual: { derivedSeed: number; uint32: number[]; floats: number[] }
  }
}

function readGolden(): RngGolden {
  const url = new URL('../../../test-vectors/rng/xorshift32-v1.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as RngGolden
}

describe('xorshift32-v1 RandomSource', () => {
  it('匹配跨语言 golden vector', () => {
    const golden = readGolden()
    expect(RANDOM_ALGORITHM_VERSION).toBe(golden.algorithm)

    for (const streamName of ['rules', 'visual'] as const) {
      const uintSource = createRandomSource(golden.rootSeed, streamName)
      const floatSource = createRandomSource(golden.rootSeed, streamName)
      expect(uintSource.initialSeed).toBe(golden.streams[streamName].derivedSeed)
      expect(golden.streams[streamName].uint32.map(() => uintSource.nextUint32())).toEqual(
        golden.streams[streamName].uint32,
      )
      expect(golden.streams[streamName].floats.map(() => floatSource.nextFloat())).toEqual(
        golden.streams[streamName].floats,
      )
    }
  })

  it('把零种子映射到固定非零状态', () => {
    const golden = readGolden()
    const source = createRandomSource(0, 'rules')
    expect(source.rootSeed).toBe(golden.zeroSeedSubstitute)
    expect(source.nextUint32()).not.toBe(0)
  })

  it('规则流与视觉流隔离，多消费视觉随机不改变规则结果', () => {
    const golden = readGolden()
    const left = createSessionRandomStreams(golden.rootSeed)
    const right = createSessionRandomStreams(golden.rootSeed)

    for (let index = 0; index < golden.isolationProbe.extraVisualDraws; index += 1) {
      left.visual.nextUint32()
    }
    const afterVisualDraws = golden.isolationProbe.rulesUint32AfterVisualDraws.map(() =>
      left.rules.nextUint32(),
    )
    expect(afterVisualDraws).toEqual(golden.isolationProbe.rulesUint32AfterVisualDraws)
    expect(afterVisualDraws).toEqual(afterVisualDraws.map(() => right.rules.nextUint32()))
  })

  it('快照恢复只接受 uint32', () => {
    const source = createRandomSource(42, 'rules')
    source.restore(0xffff_ffff)
    expect(source.snapshot()).toBe(0xffff_ffff)
    expect(() => source.restore(-1)).toThrow()
    expect(() => source.restore(2 ** 32)).toThrow()
  })
})
