import { describe, expect, it } from 'vitest'

import { createDomainState, type DomainState } from '../../domain/index.ts'
import {
  activateNewbornForNextTick,
  commitSimulationDeltaCandidate,
  resolvePearlTerminalOutcome,
  type PearlEntity,
  type SimulationDelta,
} from '../../simulation/index.ts'
import { prototypeRules } from '../fixtures/prototype-rules.ts'

function extractingState(): DomainState {
  return {
    ...createDomainState(prototypeRules),
    status: 'extracting',
    materialInstances: [
      {
        materialInstanceId: 'material-instance-1',
        materialDefinitionId: 'material.herb',
        inventoryBatchId: 'batch.herb',
        initialVolume: 10,
        remainingVolume: 10,
      },
    ],
  }
}

function emptyDelta(overrides: Partial<SimulationDelta> = {}): SimulationDelta {
  return {
    tick: 0,
    dissolutions: [],
    births: [],
    pearlVolumeChanges: [],
    terminalOutcomes: [],
    naturalLosses: [],
    inheritedLosses: [],
    ...overrides,
  }
}

describe('SimulationDelta 原子提交', () => {
  it('合法候选一次生成新状态，原状态保持不变', () => {
    const original = extractingState()
    const delta = emptyDelta({
      dissolutions: [
        {
          materialDefinitionId: 'material.herb',
          materialInstanceId: 'material-instance-1',
          pearlType: 'medicinalLiquid',
          volume: 2,
        },
      ],
      births: [
        {
          pearlId: 'pearl-1',
          sourceMaterialDefinitionId: 'material.herb',
          sourceMaterialInstanceId: 'material-instance-1',
          pearlType: 'medicinalLiquid',
          volume: 2,
        },
      ],
    })

    const result = commitSimulationDeltaCandidate(original, delta)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).not.toBe(original)
    expect(result.state.materialInstances[0]?.remainingVolume).toBe(8)
    expect(result.state.ledger.pearlVolumes['pearl-1']).toBe(2)
    expect(original.materialInstances[0]?.remainingVolume).toBe(10)
    expect(original.ledger.pearlVolumes['pearl-1']).toBeUndefined()
  })

  it('后置项非法时拒绝整个候选，返回完全相同的原状态引用', () => {
    const original = extractingState()
    const delta = emptyDelta({
      dissolutions: [
        {
          materialDefinitionId: 'material.herb',
          materialInstanceId: 'material-instance-1',
          pearlType: 'medicinalLiquid',
          volume: 2,
        },
      ],
      births: [
        {
          pearlId: 'pearl-bad',
          sourceMaterialDefinitionId: 'material.herb',
          sourceMaterialInstanceId: 'missing-material',
          pearlType: 'medicinalLiquid',
          volume: 1,
        },
      ],
    })

    const result = commitSimulationDeltaCandidate(original, delta)

    expect(result).toMatchObject({ ok: false, error: 'SIM_DELTA_ENTITY_NOT_FOUND' })
    expect(result.state).toBe(original)
    expect(original.materialInstances[0]?.remainingVolume).toBe(10)
  })

  it('累计 dissolved 可暂存待产，后续 tick birth 只能消费同材料同类型余额', () => {
    const original = extractingState()
    const dissolved = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        dissolutions: [
          {
            materialDefinitionId: 'material.herb',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 2,
          },
        ],
      }),
    )
    expect(dissolved.ok).toBe(true)

    const born = commitSimulationDeltaCandidate(
      dissolved.state,
      emptyDelta({
        tick: 1,
        births: [
          {
            pearlId: 'pearl-delayed',
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 2,
          },
        ],
      }),
    )
    expect(born.ok).toBe(true)
    expect(born.state.ledger.pearlVolumes['pearl-delayed']).toBe(2)
  })

  it('拒绝无 dissolved 余额的 birth 和既有珠无来源增长，均保持原状态引用', () => {
    const original = extractingState()
    const bornWithoutDissolution = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        births: [
          {
            pearlId: 'pearl-new',
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 100,
          },
        ],
      }),
    )
    expect(bornWithoutDissolution).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_VOLUME_MISMATCH',
    })
    expect(bornWithoutDissolution.state).toBe(original)

    const withExisting: DomainState = {
      ...original,
      ledger: {
        ...original.ledger,
        pearlVolumes: { 'pearl-existing': 1 },
        pearlSources: {
          'pearl-existing': {
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
          },
        },
      },
    }
    const increased = commitSimulationDeltaCandidate(
      withExisting,
      emptyDelta({
        pearlVolumeChanges: [
          { pearlId: 'pearl-existing', previousVolume: 1, currentVolume: 5 },
        ],
      }),
    )
    expect(increased).toMatchObject({ ok: false, error: 'SIM_DELTA_VOLUME_MISMATCH' })
    expect(increased.state).toBe(withExisting)
  })

  it('phase 7 natural loss 排除同 tick terminal 与 newborn，且原子拒绝', () => {
    const original: DomainState = {
      ...extractingState(),
      ledger: {
        ...extractingState().ledger,
        pearlVolumes: { 'pearl-existing': 1 },
        pearlSources: {
          'pearl-existing': {
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
          },
        },
      },
    }
    const terminalAndLoss = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        terminalOutcomes: [{ pearlId: 'pearl-existing', outcome: 'caught' }],
        naturalLosses: [
          {
            sourceKind: 'pearl',
            stableEntityId: 'pearl-existing',
            pearlId: 'pearl-existing',
            volume: 0.5,
          },
        ],
      }),
    )
    expect(terminalAndLoss).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE',
    })
    expect(terminalAndLoss.state).toBe(original)

    const newbornAndLoss = commitSimulationDeltaCandidate(
      extractingState(),
      emptyDelta({
        births: [
          {
            pearlId: 'pearl-newborn',
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1,
          },
        ],
        naturalLosses: [
          {
            sourceKind: 'pearl',
            stableEntityId: 'pearl-newborn',
            pearlId: 'pearl-newborn',
            volume: 0.5,
          },
        ],
      }),
    )
    expect(newbornAndLoss).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE',
    })
    expect(newbornAndLoss.state.materialInstances[0]?.remainingVolume).toBe(10)
  })

  it('药液珠自然流失归零与同 delta 唯一 burned 终态原子提交', () => {
    const original: DomainState = {
      ...extractingState(),
      ledger: {
        ...extractingState().ledger,
        pearlVolumes: { 'pearl-liquid': 1 },
        pearlSources: {
          'pearl-liquid': {
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
          },
        },
      },
    }

    const result = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'pearl',
            stableEntityId: 'pearl:pearl-liquid',
            pearlId: 'pearl-liquid',
            volume: 1,
          },
        ],
        terminalOutcomes: [{ pearlId: 'pearl-liquid', outcome: 'burned' }],
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.state).not.toBe(original)
    expect(result.state.ledger.pearlVolumes['pearl-liquid']).toBe(0)
    expect(result.state.ledger.terminalPearls['pearl-liquid']).toBe('burned')
    expect(result.state.ledger.naturalLossVolume).toBe(1)
  })

  it('大体积超扣不能被相对舍入容差吞掉，且候选保持原子拒绝', () => {
    const materialState: DomainState = {
      ...extractingState(),
      materialInstances: [
        {
          ...extractingState().materialInstances[0]!,
          initialVolume: 1e12,
          remainingVolume: 1e12,
        },
      ],
    }
    const materialOverdraw = commitSimulationDeltaCandidate(
      materialState,
      emptyDelta({
        dissolutions: [
          {
            materialDefinitionId: 'material.herb',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1e12 + 500,
          },
        ],
      }),
    )

    expect(materialOverdraw).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_NEGATIVE_VOLUME',
    })
    expect(materialOverdraw.state).toBe(materialState)
    expect(materialState.materialInstances[0]?.remainingVolume).toBe(1e12)

    const pearlState: DomainState = {
      ...materialState,
      ledger: {
        ...materialState.ledger,
        pearlVolumes: { p: 1e12 },
        pearlSources: {
          p: {
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
          },
        },
      },
    }
    const pearlOverdraw = commitSimulationDeltaCandidate(
      pearlState,
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'pearl',
            stableEntityId: 'pearl:p',
            pearlId: 'p',
            volume: 1e12 + 500,
          },
        ],
        terminalOutcomes: [{ pearlId: 'p', outcome: 'burned' }],
      }),
    )

    expect(pearlOverdraw).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_NEGATIVE_VOLUME',
    })
    expect(pearlOverdraw.state).toBe(pearlState)
    expect(pearlState.ledger.pearlVolumes.p).toBe(1e12)
    expect(pearlState.ledger.naturalLossVolume).toBe(0)
  })

  it('newborn 不得在出生 tick 进入 volumeChanges', () => {
    const original = extractingState()
    const result = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        dissolutions: [
          {
            materialDefinitionId: 'material.herb',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1,
          },
        ],
        births: [
          {
            pearlId: 'pearl-newborn',
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1,
          },
        ],
        pearlVolumeChanges: [
          { pearlId: 'pearl-newborn', previousVolume: 1, currentVolume: 0.5 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.state).toBe(original)
    expect(original.materialInstances[0]?.remainingVolume).toBe(10)
    expect(original.ledger.pearlVolumes['pearl-newborn']).toBeUndefined()
  })

  it.each(['slag', 'impurity'] as const)(
    '非药液珠 %s 不得进入自然流失',
    (pearlType) => {
      const original: DomainState = {
        ...extractingState(),
        ledger: {
          ...extractingState().ledger,
          pearlVolumes: { 'pearl-non-liquid': 1 },
          pearlSources: {
            'pearl-non-liquid': {
              sourceMaterialDefinitionId: 'material.herb',
              sourceMaterialInstanceId: 'material-instance-1',
              pearlType,
            },
          },
        },
      }

      const result = commitSimulationDeltaCandidate(
        original,
        emptyDelta({
          naturalLosses: [
            {
              sourceKind: 'pearl',
              stableEntityId: 'pearl:pearl-non-liquid',
              pearlId: 'pearl-non-liquid',
              volume: 0.5,
            },
          ],
        }),
      )

      expect(result).toMatchObject({
        ok: false,
        error: 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE',
      })
      expect(result.state).toBe(original)
    },
  )

  it('材料格自然流失必须显式证明来自药液成分', () => {
    const original = extractingState()
    const result = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'materialCell',
            stableEntityId: 'cell:material-instance-1:0',
            materialInstanceId: 'material-instance-1',
            pearlType: 'slag',
            volume: 0.5,
          },
        ],
      } as unknown as Partial<SimulationDelta>),
    )

    expect(result).toMatchObject({
      ok: false,
      error: 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE',
    })
    expect(result.state).toBe(original)
  })

  it('材料药液格可自然流失，继承损失独立入账且任一后置失败保持原引用', () => {
    const original = extractingState()
    const committed = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'materialCell',
            stableEntityId: 'cell:material-instance-1:0',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1,
          },
        ],
        inheritedLosses: [{ materialInstanceId: 'material-instance-1', volume: 2 }],
      }),
    )

    expect(committed.ok).toBe(true)
    expect(committed.state.materialInstances[0]?.remainingVolume).toBe(7)
    expect(committed.state.ledger.naturalLossVolume).toBe(1)
    expect(committed.state.ledger.inheritedLossVolume).toBe(2)
    expect(original.materialInstances[0]?.remainingVolume).toBe(10)

    const rejected = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'materialCell',
            stableEntityId: 'cell:material-instance-1:0',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 1,
          },
        ],
        inheritedLosses: [{ materialInstanceId: 'missing-material', volume: 2 }],
      }),
    )
    expect(rejected).toMatchObject({ ok: false, error: 'SIM_DELTA_ENTITY_NOT_FOUND' })
    expect(rejected.state).toBe(original)
    expect(original.materialInstances[0]?.remainingVolume).toBe(10)
  })

  it('已有 phase 6 终态、归零缺 burned、未归零却携 burned 均拒绝自然流失', () => {
    const active: DomainState = {
      ...extractingState(),
      ledger: {
        ...extractingState().ledger,
        pearlVolumes: { 'pearl-liquid': 1 },
        pearlSources: {
          'pearl-liquid': {
            sourceMaterialDefinitionId: 'material.herb',
            sourceMaterialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
          },
        },
      },
    }
    const terminal: DomainState = {
      ...active,
      ledger: {
        ...active.ledger,
        terminalPearls: { 'pearl-liquid': 'burned' },
      },
    }
    const loss = (volume: number, burned: boolean): SimulationDelta =>
      emptyDelta({
        naturalLosses: [
          {
            sourceKind: 'pearl',
            stableEntityId: 'pearl:pearl-liquid',
            pearlId: 'pearl-liquid',
            volume,
          },
        ],
        terminalOutcomes: burned
          ? [{ pearlId: 'pearl-liquid', outcome: 'burned' }]
          : [],
      })

    for (const [state, delta] of [
      [terminal, loss(0.5, false)],
      [active, loss(1, false)],
      [active, loss(0.5, true)],
    ] as const) {
      const result = commitSimulationDeltaCandidate(state, delta)
      expect(result).toMatchObject({
        ok: false,
        error: 'SIM_DELTA_NATURAL_LOSS_NOT_ELIGIBLE',
      })
      expect(result.state).toBe(state)
    }
  })
})

describe('PearlEntity 完整边界', () => {
  it('保留来源、标签、配置引用、运动、伤害、互动和安全区语义', () => {
    const pearl: PearlEntity = {
      pearlId: 'pearl-1',
      sourceMaterialDefinitionId: 'material.herb',
      sourceMaterialInstanceId: 'material-instance-1',
      type: 'medicinalLiquid',
      tags: ['tag.warm'],
      configRef: { pearlTypeId: 'pearl.liquid', interactionProfileIds: ['interaction.fight'] },
      currentVolume: 1,
      radius: 4,
      position: { x: 2, y: 3 },
      velocity: { x: 0, y: -1 },
      state: 'newborn',
      shield: { active: false, remainingTicks: 0 },
      damage: { accumulated: 0, protectionTicks: 0 },
      interactionTimers: { fight: 0 },
      safeZone: { entered: false, enteredTick: null },
    }

    expect(pearl.sourceMaterialDefinitionId).toBe('material.herb')
    expect(pearl.sourceMaterialInstanceId).toBe('material-instance-1')
    expect(pearl.safeZone.enteredTick).toBeNull()
  })

  it('newborn 只在提交视图后进入下一 tick 的 active 集合', () => {
    const newborn: PearlEntity = {
      pearlId: 'pearl-newborn',
      sourceMaterialDefinitionId: 'material.herb',
      sourceMaterialInstanceId: 'material-instance-1',
      type: 'medicinalLiquid',
      tags: [],
      configRef: { pearlTypeId: 'pearl.liquid', interactionProfileIds: [] },
      currentVolume: 1,
      radius: 4,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      state: 'newborn',
      shield: { active: false, remainingTicks: 0 },
      damage: { accumulated: 0, protectionTicks: 0 },
      interactionTimers: {},
      safeZone: { entered: false, enteredTick: null },
    }
    const beforeCommit = { active: [], newborn: [newborn] } as const

    expect(beforeCommit.active).toHaveLength(0)
    const nextTick = activateNewbornForNextTick(beforeCommit)
    expect(nextTick.newborn).toEqual([])
    expect(nextTick.active).toMatchObject([{ pearlId: 'pearl-newborn', state: 'active' }])
    expect(beforeCommit.newborn[0]?.state).toBe('newborn')
  })

  it('同 tick 终态冲突固定为 burned > caught > missed', () => {
    expect(resolvePearlTerminalOutcome(['missed', 'caught', 'burned'])).toBe('burned')
    expect(resolvePearlTerminalOutcome(['missed', 'caught'])).toBe('caught')

    const original: DomainState = {
      ...extractingState(),
      ledger: {
        ...extractingState().ledger,
        pearlVolumes: { 'pearl-1': 1 },
      },
    }
    const result = commitSimulationDeltaCandidate(
      original,
      emptyDelta({
        terminalOutcomes: [
          { pearlId: 'pearl-1', outcome: 'caught' },
          { pearlId: 'pearl-1', outcome: 'burned' },
          { pearlId: 'pearl-1', outcome: 'missed' },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.state.ledger.terminalPearls['pearl-1']).toBe('burned')
  })
})
