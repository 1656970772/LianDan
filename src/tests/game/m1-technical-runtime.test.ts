import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { M1FireFlowFixture } from '../../config/m1-fire-flow-fixture.ts'
import { validateAndNormalizeConfigSet } from '../../config/validate.ts'
import { sampleM1FlowView } from '../../game/m1/scenario-runtime.ts'
import { M1TechnicalRuntime } from '../../game/m1/technical-runtime.ts'
import { loadTestSchemaBundle } from '../config/schema-fixture.ts'

function readJson(relativeUrl: string): unknown {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

function createRuntime(): M1TechnicalRuntime {
  const validated = validateAndNormalizeConfigSet(
    {
      configSet: {
        filePath: '/config/config-set.json',
        value: readJson('../../../public/config/config-set.json'),
      },
      parameters: {
        filePath: '/config/parameters.json',
        value: readJson('../../../public/config/parameters.json'),
      },
      materials: [
        {
          filePath: '/config/materials/prototype-herb.json',
          value: readJson(
            '../../../public/config/materials/prototype-herb.json',
          ),
        },
      ],
    },
    loadTestSchemaBundle(),
  )
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues))
  return new M1TechnicalRuntime({
    config: validated.config,
    fixture: readJson(
      '../../../public/config/performance/m1-fire-flow.json',
    ) as M1FireFlowFixture,
    simulationContentFingerprint: 'test-fingerprint',
    initialScenarioId: 'm1-900',
    initialOverlayMode: 'reachable',
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('M1 technical runtime 与 application 事务边界', () => {
  it.each([8, 9] as const)(
    'phase %i 抛错后不发布圆移动、field generation 或 update 证据，retry 只提交一次',
    (failedPhase) => {
      const runtime = createRuntime()
      const before = runtime.snapshot(0)
      const beforeY = runtime.circles.y[0]!
      const beforeIntensity = runtime.view.intensity.slice()

      expect(() =>
        runtime.advanceTick({
          onPhase: (phase) => {
            if (phase === failedPhase) throw new Error(`PROBE_PHASE${phase}`)
          },
        }),
      ).toThrowError(`PROBE_PHASE${failedPhase}`)

      const failed = runtime.snapshot(0)
      expect(runtime.circles.y[0]).toBe(beforeY)
      expect(runtime.view.intensity).toEqual(beforeIntensity)
      expect(failed).toMatchObject({
        tick: before.tick,
        nextTick: before.nextTick,
        lastCommittedTick: before.lastCommittedTick,
        fieldGeneration: before.fieldGeneration,
        fieldUpdateCount: before.fieldUpdateCount,
        flowDigest: before.flowDigest,
      })

      runtime.advanceTick()

      expect(runtime.circles.y[0]).toBeCloseTo(beforeY - 0.4, 4)
      expect(runtime.snapshot(0)).toMatchObject({
        tick: 0,
        nextTick: 1,
        lastCommittedTick: 0,
        fieldGeneration: 1,
        fieldUpdateCount: 1,
      })
    },
  )

  it('失败尝试不进 raw sample，正常 tick 的规则与渲染共用同一提交输出', async () => {
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const runtime = createRuntime()
    const samplePromise = runtime.startSample(10)

    now = 101
    expect(() =>
      runtime.advanceTick({
        onPhase: (phase) => {
          if (phase === 8) throw new Error('PROBE_PHASE8')
        },
      }),
    ).toThrowError('PROBE_PHASE8')

    now = 102
    runtime.advanceTick()
    const sharedSample = sampleM1FlowView(runtime.view, runtime.samplePosition())
    runtime.markRendered(sharedSample)
    now = 111
    runtime.frame(0, now)
    const sample = await samplePromise

    expect(sample.flowTimestamps).toHaveLength(1)
    expect(sample.flowDurationsMilliseconds).toHaveLength(1)
    expect(sample.activePearlCount).toBe(900)
    expect(runtime.snapshot(now)).toMatchObject({
      fieldGeneration: 1,
      renderedGeneration: 1,
      fieldUpdateCount: 1,
      ruleSample: sharedSample,
      renderSample: sharedSample,
    })
  })

  it('snapshot 与 raw sample 均以 eligible 数量作为活动珠证据', async () => {
    let now = 200
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const runtime = createRuntime()
    runtime.circles.eligible[0] = 0
    const samplePromise = runtime.startSample(10)

    expect(runtime.snapshot(now).activePearlCount).toBe(899)
    now = 211
    runtime.frame(0, now)

    await expect(samplePromise).resolves.toMatchObject({
      activePearlCount: 899,
    })
  })
})
