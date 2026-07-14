import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  canonicalizeJson,
  computeSimulationContentFingerprint,
  type FingerprintInput,
} from '../../config/fingerprint'

function compositionPixels(): Uint8Array {
  const rgba = new Uint8Array(64 * 64 * 4)
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 4
      if ((x + y) % 11 === 0) rgba.set([0x00, 0xff, 0xff, 0xff], offset)
      else if ((x * 3 + y) % 17 === 0) rgba.set([0x80, 0x80, 0x80, 0xff], offset)
      else if ((x + y * 5) % 29 === 0) rgba.set([0x80, 0x00, 0x80, 0xff], offset)
    }
  }
  return rgba
}

function input(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    jsonRecords: [
      {
        recordType: 'rules-json',
        logicalKey: 'material:prototype-herb',
        sourcePath: '/config/materials/prototype-herb.json',
        value: {
          schemaVersion: 1,
          id: 'prototype-herb',
          targetPearlCount: 300,
          behaviorOrder: ['dissolve', 'spawn'],
        },
      },
    ],
    rgbaRecords: [
      {
        recordType: 'composition-rgba',
        logicalKey: 'material:prototype-herb',
        sourcePath: '/assets/masks/prototype-herb-components.png',
        width: 64,
        height: 64,
        rgba: compositionPixels(),
      },
    ],
    ...overrides,
  }
}

describe('RFC 8785/JCS', () => {
  it('按 UTF-16 键序输出规范 JSON 且保留数组顺序', () => {
    expect(canonicalizeJson({ z: 1, a: [3, 2, 1], nested: { b: true, a: null } })).toBe(
      '{"a":[3,2,1],"nested":{"a":null,"b":true},"z":1}',
    )
  })

  it('拒绝非 JSON 数值和孤立 surrogate', () => {
    expect(() => canonicalizeJson({ value: Number.NaN })).toThrow()
    expect(() => canonicalizeJson({ value: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => canonicalizeJson({ value: '\ud800' })).toThrow()
  })
})

describe('simulationContentFingerprint v1', () => {
  it('在 golden 中固定 magic/version/u32BE framing、canonical hex 与 SHA-256', async () => {
    const golden = await import('../../../test-vectors/fingerprint/v1-golden.json', {
      with: { type: 'json' },
    }).then((module) => module.default)
    const result = await computeSimulationContentFingerprint(input())

    expect(result.spec).toEqual(golden.spec)
    expect(result.records.map(({ recordType, logicalKey, payloadHex }) => ({ recordType, logicalKey, payloadHex }))).toEqual(
      golden.records,
    )
    expect(
      result.records.find((record) => record.recordType === 'rules-json')?.payloadHex,
    ).toBe(golden.canonicalJsonHex['material:prototype-herb'])
    expect(result.frameHex).toBe(golden.frameHex)
    expect(result.simulationContentFingerprint).toBe(golden.sha256)
  })

  it('不受 JSON 键序/文件路径和 PNG 压缩编码影响', async () => {
    const base = input()
    const reordered = input({
      jsonRecords: [
        {
          recordType: 'rules-json',
          logicalKey: 'material:prototype-herb',
          sourcePath: '/renamed/rule.json',
          value: JSON.parse(
            '{ "targetPearlCount": 300, "behaviorOrder": ["dissolve", "spawn"], "id": "prototype-herb", "schemaVersion": 1 }',
          ),
        },
      ],
    })
    reordered.rgbaRecords[0]!.sourcePath = '/renamed/reencoded.png'

    const pixels = compositionPixels()
    const imageA = new PNG({ width: 64, height: 64 })
    const imageB = new PNG({ width: 64, height: 64 })
    imageA.data.set(pixels)
    imageB.data.set(pixels)
    const pngA = PNG.sync.write(imageA, { deflateLevel: 0 })
    const pngB = PNG.sync.write(imageB, { deflateLevel: 9 })
    expect(pngA.equals(pngB)).toBe(false)
    const decodedA = PNG.sync.read(pngA)
    const decodedB = PNG.sync.read(pngB)
    base.rgbaRecords[0]!.rgba = new Uint8Array(decodedA.data)
    reordered.rgbaRecords[0]!.rgba = new Uint8Array(decodedB.data)

    const [left, right] = await Promise.all([
      computeSimulationContentFingerprint(base),
      computeSimulationContentFingerprint(reordered),
    ])
    expect(left.simulationContentFingerprint).toBe(right.simulationContentFingerprint)
  })

  it.each(['rule', 'stable-id', 'array-order', 'rgba'] as const)(
    '对 %s 语义改动敏感',
    async (mutation) => {
      const base = input()
      const changed = input()
      const value = changed.jsonRecords[0]!.value as {
        id: string
        targetPearlCount: number
        behaviorOrder: string[]
      }
      if (mutation === 'rule') value.targetPearlCount += 1
      if (mutation === 'stable-id') {
        value.id = 'another-herb'
        changed.jsonRecords[0]!.logicalKey = 'material:another-herb'
        changed.rgbaRecords[0]!.logicalKey = 'material:another-herb'
      }
      if (mutation === 'array-order') value.behaviorOrder.reverse()
      if (mutation === 'rgba') changed.rgbaRecords[0]!.rgba[0] ^= 0xff

      const [left, right] = await Promise.all([
        computeSimulationContentFingerprint(base),
        computeSimulationContentFingerprint(changed),
      ])
      expect(left.simulationContentFingerprint).not.toBe(right.simulationContentFingerprint)
    },
  )
})
