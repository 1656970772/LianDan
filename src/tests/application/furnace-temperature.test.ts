import { describe, expect, it } from 'vitest'

import { ExtractionApplication } from '../../application/index.ts'
import { createDomainState } from '../../domain/index.ts'
import { prototypeRules } from '../fixtures/prototype-rules.ts'

function readTemperature(app: ExtractionApplication): number | undefined {
  return Reflect.get(app.getReadModel(), 'furnaceTemperature') as number | undefined
}

describe('权威炉温 application 闭环', () => {
  it('每个已提交 tick 推进一次；暂停边界不推进，恢复后停火冷却', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({
      targetTick: 0,
      type: 'SelectFireSource',
      payload: { fireSourceId: 'fire.basic' },
    })
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 50 } })

    expect(app.beforePhase0(0).canAdvance).toBe(true)
    app.runPreparedTick()
    expect(readTemperature(app)).toBe(8)

    app.captureRuleCommand({ targetTick: 1, type: 'SetSpraying', payload: { spraying: true } })
    expect(app.beforePhase0(1).canAdvance).toBe(true)
    app.runPreparedTick()
    expect(readTemperature(app)).toBeCloseTo(8.8)

    app.captureApplicationControl({ type: 'Pause', payload: {} })
    expect(app.beforePhase0(2).canAdvance).toBe(false)
    expect(readTemperature(app)).toBeCloseTo(8.8)

    app.captureApplicationControl({ type: 'Resume', payload: {} })
    expect(app.beforePhase0(2).canAdvance).toBe(true)
    app.runPreparedTick()
    expect(readTemperature(app)).toBeCloseTo(8.8 - 10 / 30)
  })

  it('reset 重建领域状态并恢复火种基础温度', () => {
    const heatedState = {
      ...createDomainState(prototypeRules),
      status: 'failed' as const,
      furnaceTemperature: 80,
    }
    const app = new ExtractionApplication(prototypeRules, { domainState: heatedState })
    app.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })

    expect(app.beforePhase0(0)).toMatchObject({ accepted: true, resetCutover: true })
    expect(readTemperature(app)).toBe(8)
  })
})
