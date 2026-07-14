import { readFileSync } from 'node:fs'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
} from '../../config/m1-fire-flow-fixture'

function readJson(relativeUrl: string): unknown {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

function loadFixture(): M1FireFlowFixture {
  return readJson(
    '../../../public/config/performance/m1-fire-flow.json',
  ) as M1FireFlowFixture
}

describe('M1 火流技术与性能 fixture', () => {
  it('通过独立 JSON Schema 且拒绝未知字段', () => {
    const schema = readJson(
      '../../../schemas/config/m1-fire-flow-performance.schema.json',
    ) as Record<string, unknown>
    const fixture = loadFixture()
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictNumbers: true,
      validateSchema: true,
    })
    const validate = ajv.compile(schema)

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...fixture, undocumentedRule: true })).toBe(false)
  })

  it('满足世界、协议、唯一场景和边界语义', () => {
    const fixture = loadFixture()

    expect(validateM1FireFlowFixtureSemantics(fixture)).toEqual([])
    expect(fixture.world).toEqual({ width: 1600, height: 900 })
    expect(fixture.protocol).toEqual({
      warmupSeconds: 10,
      sampleSeconds: 60,
      expectedTickHz: 30,
      expectedDroppedTickCount: 0,
      totalTickTolerance: 1,
      fullSecondTickMinimum: 29,
      fullSecondTickMaximum: 31,
    })
  })

  it('精确登记 900/2400 场景数量、门限和固定障碍引用', () => {
    const fixture = loadFixture()
    const byCount = new Map(
      fixture.performanceScenarios.map((scenario) => [
        scenario.activePearlCount,
        scenario,
      ]),
    )

    expect([...byCount.keys()].sort((left, right) => left - right)).toEqual([
      900,
      2400,
    ])
    expect(byCount.get(900)).toMatchObject({
      id: 'm1-900',
      fullObstacleFixtureId: fixture.performanceFullObstacleFixture.id,
      thresholds: {
        fireFlowUpdateP95Ms: 6,
        fireFlowUpdateMaxMs: 10,
        minimumFpsPerFullSecond: 59,
      },
    })
    expect(byCount.get(2400)).toMatchObject({
      id: 'm1-2400',
      fullObstacleFixtureId: fixture.performanceFullObstacleFixture.id,
      thresholds: {
        fireFlowUpdateP95Ms: 8,
        fireFlowUpdateMaxMs: 12,
        minimumFpsPerFullSecond: 45,
      },
    })
    expect(new Set(fixture.performanceScenarios.map(({ id }) => id)).size).toBe(
      fixture.performanceScenarios.length,
    )
    expect(
      new Set(
        fixture.performanceScenarios.map(({ activePearlCount }) =>
          String(activePearlCount),
        ),
      ).size,
    ).toBe(fixture.performanceScenarios.length)
  })

  it('配置 pillar/gap/crowd 三个可视 probe 的完整几何输入', () => {
    const fixture = loadFixture()
    const probeIds = fixture.technicalProbes.map(({ id }) => id).sort()

    expect(probeIds).toEqual(['crowd', 'gap', 'pillar'])
    for (const probe of fixture.technicalProbes) {
      expect(probe).toEqual(
        expect.objectContaining({
          seed: expect.any(Number),
          source: expect.any(Object),
          fullObstacleRects: expect.any(Array),
          circleCount: expect.any(Number),
          circleSpawnArea: expect.any(Object),
          radius: expect.any(Number),
          velocity: expect.any(Object),
        }),
      )
    }
  })

  it('正常珠群使用 64px 高的水滴珠尺度，不复用性能基准的小圆云', () => {
    const fixture = loadFixture()
    const crowd = fixture.technicalProbes.find(({ id }) => id === 'crowd')!
    const occupiedArea = crowd.circleCount * Math.PI * crowd.radius ** 2
    const spawnArea = crowd.circleSpawnArea.width * crowd.circleSpawnArea.height

    expect(crowd.radius).toBe(32)
    expect(crowd.circleCount).toBeGreaterThan(0)
    expect(crowd.circleCount).toBeLessThanOrEqual(12)
    expect(occupiedArea / spawnArea).toBeLessThanOrEqual(0.3)

    expect(
      fixture.performanceScenarios.map(({ radius }) => radius),
      '900/2400 性能基准继续使用独立的小圆代理，不反向污染正常展示',
    ).toEqual([6, 4])
  })

  it('语义校验拒绝重复场景 ID/数量以及缺失基准场景', () => {
    const duplicate = structuredClone(loadFixture())
    duplicate.performanceScenarios[1] = {
      ...duplicate.performanceScenarios[1]!,
      id: duplicate.performanceScenarios[0]!.id,
      activePearlCount:
        duplicate.performanceScenarios[0]!.activePearlCount,
    }

    expect(validateM1FireFlowFixtureSemantics(duplicate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'M1_FIXTURE_DUPLICATE_SCENARIO_ID' }),
        expect.objectContaining({ code: 'M1_FIXTURE_DUPLICATE_PEARL_COUNT' }),
        expect.objectContaining({ code: 'M1_FIXTURE_REQUIRED_SCENARIO_MISSING' }),
      ]),
    )
  })

  it.each([
    ['technicalProbes', 0, '/technicalProbes/0/circleSpawnArea'],
    ['performanceScenarios', 0, '/performanceScenarios/0/circleSpawnArea'],
  ] as const)(
    '拒绝 %s 中无法容纳圆直径的 spawnArea',
    (collection, index, fieldPath) => {
      const fixture = structuredClone(loadFixture())
      const scenario = fixture[collection][index]!
      const invalidSpawnArea = {
        ...scenario.circleSpawnArea,
        width: scenario.radius * 2 - 0.01,
      }
      if (collection === 'technicalProbes') {
        fixture.technicalProbes[index] = {
          ...fixture.technicalProbes[index]!,
          circleSpawnArea: invalidSpawnArea,
        }
      } else {
        fixture.performanceScenarios[index] = {
          ...fixture.performanceScenarios[index]!,
          circleSpawnArea: invalidSpawnArea,
        }
      }

      expect(validateM1FireFlowFixtureSemantics(fixture)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'M1_FIXTURE_SPAWN_AREA_TOO_SMALL',
            fieldPath,
            messageZh: '圆形障碍生成区域宽高必须均不小于圆直径',
          }),
        ]),
      )
    },
  )
})
