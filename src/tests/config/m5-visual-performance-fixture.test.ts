import { readFileSync } from 'node:fs'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  validateM5VisualPerformanceFixtureSemantics,
  type M5VisualPerformanceFixture,
} from '../../config/m5-visual-performance-fixture.ts'
import { parseStrictJson } from '../../config/strict-json.ts'

function readText(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')
}

function loadFixture(): M5VisualPerformanceFixture {
  const parsed = parseStrictJson(
    readText('../../../public/config/performance/m5-visual.json'),
  )
  if (!parsed.ok) throw new Error('测试 fixture 不是 strict JSON')
  return parsed.value as M5VisualPerformanceFixture
}

describe('M5 正式表现性能 fixture', () => {
  it('通过独立 strict JSON + JSON Schema，且拒绝未知字段', () => {
    const fixture = loadFixture()
    const schema = JSON.parse(
      readText(
        '../../../schemas/config/m5-visual-performance.schema.json',
      ),
    ) as Record<string, unknown>
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      strictNumbers: true,
      validateSchema: true,
    }).compile(schema)

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...fixture, hiddenShortcut: true })).toBe(false)

    const duplicateKey = readText(
      '../../../public/config/performance/m5-visual.json',
    ).replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "schemaVersion": 1,',
    )
    expect(parseStrictJson(duplicateKey).ok).toBe(false)
  })

  it('登记 1600x900 DPR1、10+60 秒和 visual-normal/stress 硬门限', () => {
    const fixture = loadFixture()
    const scenarios = new Map(
      fixture.scenarios.map((scenario) => [scenario.id, scenario]),
    )

    expect(fixture.protocol).toEqual({
      warmupSeconds: 10,
      sampleSeconds: 60,
      viewportWidth: 1600,
      viewportHeight: 900,
      deviceScaleFactor: 1,
      maximumRecordedFramesPerSecond: 240,
    })
    expect(scenarios.get('visual-normal')).toMatchObject({
      activePearlCount: 300,
      fireSize: 100,
      interactionGroupCount: 4,
      thresholds: { minimumFramesPerCompleteSecond: 59 },
    })
    expect(scenarios.get('visual-stress')).toMatchObject({
      activePearlCount: 900,
      fireSize: 100,
      interactionGroupCount: 4,
      thresholds: { minimumFramesPerCompleteSecond: 45 },
    })
    expect(validateM5VisualPerformanceFixtureSemantics(fixture)).toEqual([])
  })

  it('每场要求三类正常尺寸珠、蒸汽/护盾/受伤/争斗、voice 与有界池证据', () => {
    for (const scenario of loadFixture().scenarios) {
      expect(scenario.pearlTypeWeights).toEqual({
        medicinalLiquid: expect.any(Number),
        slag: expect.any(Number),
        impurity: expect.any(Number),
      })
      expect(Object.values(scenario.pearlTypeWeights).every((value) => value > 0)).toBe(
        true,
      )
      expect(scenario.requiredEffectKinds).toEqual(
        expect.arrayContaining(['steam', 'shield', 'damage', 'fight']),
      )
      expect(scenario.audio.enabled).toBe(true)
      expect(scenario.thresholds.minimumAudioVoiceHighWaterMark).toBeGreaterThanOrEqual(1)
      expect(scenario.effectPool.initialCapacity).toBeLessThanOrEqual(
        scenario.effectPool.maximumCapacity,
      )
      expect(scenario.thresholds.maximumDroppedEffectCount).toBe(0)
      expect(scenario.thresholds.maximumTrackedFrameAllocationCount).toBe(0)
    }
  })

  it('语义校验拒绝重复 ID、缺少正式场景、争斗不足和无界池', () => {
    const fixture = structuredClone(loadFixture())
    fixture.scenarios[1] = {
      ...fixture.scenarios[1]!,
      id: fixture.scenarios[0]!.id,
      interactionGroupCount: 3,
      effectPool: {
        initialCapacity: 2048,
        maximumCapacity: 1024,
      },
    }

    expect(validateM5VisualPerformanceFixtureSemantics(fixture)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'M5_VISUAL_DUPLICATE_SCENARIO_ID' }),
        expect.objectContaining({ code: 'M5_VISUAL_REQUIRED_SCENARIO_MISSING' }),
        expect.objectContaining({ code: 'M5_VISUAL_INTERACTION_GROUPS_INSUFFICIENT' }),
        expect.objectContaining({ code: 'M5_VISUAL_EFFECT_POOL_CAPACITY_INVALID' }),
      ]),
    )
  })
})
