import { describe, expect, it } from 'vitest'

import * as domain from '../../domain/index.ts'
import type { DomainState } from '../../domain/index.ts'
import { prototypeRules } from '../fixtures/prototype-rules.ts'

function advance(state: DomainState): DomainState {
  const candidate = Reflect.get(domain, 'advanceFurnaceTemperature') as unknown
  if (typeof candidate !== 'function') {
    throw new Error('advanceFurnaceTemperature 尚未实现')
  }
  return candidate(state, prototypeRules) as DomainState
}

function furnaceTemperature(state: DomainState): number | undefined {
  return Reflect.get(state, 'furnaceTemperature') as number | undefined
}

describe('权威炉温领域规则', () => {
  it('以火种基础温度初始化，并按 fixed step 单调升温且不越过线性目标', () => {
    let state: DomainState = {
      ...domain.createDomainState(prototypeRules),
      equippedFireSourceId: 'fire.basic',
      fireSize: 50,
      isSpraying: true,
    }

    expect(furnaceTemperature(state)).toBe(8)
    state = advance(state)
    expect(furnaceTemperature(state)).toBeCloseTo(8.8)

    const observed = [furnaceTemperature(state)!]
    for (let index = 0; index < 200; index += 1) {
      state = advance(state)
      observed.push(furnaceTemperature(state)!)
    }
    expect(observed.every((value, index) => index === 0 || value >= observed[index - 1]!)).toBe(true)
    expect(furnaceTemperature(state)).toBeCloseTo(54)
  })

  it('停火后按冷却速率单调回到基础温度且不越界', () => {
    let state = {
      ...domain.createDomainState(prototypeRules),
      equippedFireSourceId: 'fire.basic',
      furnaceTemperature: 20,
      isSpraying: false,
    } as DomainState

    state = advance(state)
    expect(furnaceTemperature(state)).toBeCloseTo(20 - 10 / 30)
    const observed = [furnaceTemperature(state)!]
    for (let index = 0; index < 100; index += 1) {
      state = advance(state)
      observed.push(furnaceTemperature(state)!)
    }
    expect(observed.every((value, index) => index === 0 || value <= observed[index - 1]!)).toBe(true)
    expect(furnaceTemperature(state)).toBeCloseTo(8)
  })

  it.each(['failed', 'completed'] as const)('%s 终态不再推进炉温', (status) => {
    const state = {
      ...domain.createDomainState(prototypeRules),
      status,
      equippedFireSourceId: 'fire.basic',
      furnaceTemperature: 80,
      isSpraying: true,
    } as DomainState

    const result = advance(state)
    expect(result).toBe(state)
    expect(furnaceTemperature(result)).toBe(80)
  })

  it('炉温推进不修改材料溶解状态或自然流失账本', () => {
    const initial = domain.createDomainState(prototypeRules)
    const materialInstances = [
      {
        materialInstanceId: 'material-1',
        materialDefinitionId: 'material.herb',
        inventoryBatchId: 'batch.herb',
        initialVolume: 10,
        remainingVolume: 7,
      },
    ]
    const ledger = {
      ...initial.ledger,
      dissolvedVolumes: { 'material-1': { medicinalLiquid: 3 } },
      naturalLossVolume: 1.25,
    }
    const state = {
      ...initial,
      equippedFireSourceId: 'fire.basic',
      fireSize: 100,
      isSpraying: true,
      materialInstances,
      ledger,
    } as DomainState

    const result = advance(state)

    expect(result.materialInstances).toBe(materialInstances)
    expect(result.ledger).toBe(ledger)
    expect(result.materialInstances[0]?.remainingVolume).toBe(7)
    expect(result.ledger.dissolvedVolumes).toEqual({
      'material-1': { medicinalLiquid: 3 },
    })
    expect(result.ledger.naturalLossVolume).toBe(1.25)
  })
})
