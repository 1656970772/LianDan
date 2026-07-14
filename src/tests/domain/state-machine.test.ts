import { describe, expect, it } from 'vitest'

import {
  applyRuleCommand,
  createDomainState,
  deriveCanFinish,
  enterFailed,
  isRuleCommandAllowed,
  validateRuleCommandPayload,
  type DomainState,
  type RuleCommand,
} from '../../domain/index.ts'
import { prototypeRules } from '../fixtures/prototype-rules.ts'

function command<T extends RuleCommand['type']>(
  type: T,
  payload: Extract<RuleCommand, { type: T }>['payload'],
): Extract<RuleCommand, { type: T }> {
  return { type, payload } as Extract<RuleCommand, { type: T }>
}

describe('最小领域状态机', () => {
  it('canFinish 只由四个事实派生，不保存可失真的缓存', () => {
    const ready = createDomainState(prototypeRules)
    expect(deriveCanFinish(ready)).toBe(false)

    const extractingWithoutMaterial: DomainState = { ...ready, status: 'extracting' }
    expect(deriveCanFinish(extractingWithoutMaterial)).toBe(false)

    const materialRemaining: DomainState = {
      ...extractingWithoutMaterial,
      materialInstances: [
        {
          materialInstanceId: 'material-instance-1',
          materialDefinitionId: 'material.herb',
          inventoryBatchId: 'batch.herb',
          initialVolume: 10,
          remainingVolume: 1,
        },
      ],
    }
    expect(deriveCanFinish(materialRemaining)).toBe(false)

    const dissolvedButPearlActive: DomainState = {
      ...materialRemaining,
      materialInstances: [{ ...materialRemaining.materialInstances[0]!, remainingVolume: 0 }],
      ledger: {
        ...materialRemaining.ledger,
        pearlVolumes: { 'pearl-1': 1 },
      },
    }
    expect(deriveCanFinish(dissolvedButPearlActive)).toBe(false)

    const finishable: DomainState = {
      ...dissolvedButPearlActive,
      ledger: {
        ...dissolvedButPearlActive.ledger,
        terminalPearls: { 'pearl-1': 'caught' },
      },
    }
    expect(deriveCanFinish(finishable)).toBe(true)
    expect(Object.hasOwn(finishable, 'canFinish')).toBe(false)
  })

  it('首次投药进入 extracting；结束请求只记录意图，不绕过 phase 9', () => {
    let state = createDomainState(prototypeRules)
    state = applyRuleCommand(
      state,
      command('PreselectMaterial', { inventoryBatchId: 'batch.herb' }),
      prototypeRules,
    ).state
    const added = applyRuleCommand(state, command('AddSelectedMaterial', {}), prototypeRules)

    expect(added.ok).toBe(true)
    expect(added.state.status).toBe('extracting')
    expect(added.state.inventory['batch.herb']).toBe(1)
    expect(added.state.materialInstances).toHaveLength(1)
  })

  it('failed 只允许由 extracting 进入，ready 与终态调用保持原引用', () => {
    const ready = createDomainState(prototypeRules)
    const extracting: DomainState = { ...ready, status: 'extracting' }
    const completed: DomainState = { ...ready, status: 'completed' }

    expect(enterFailed(ready)).toBe(ready)
    expect(enterFailed(completed)).toBe(completed)
    expect(enterFailed(extracting)).toMatchObject({ status: 'failed', isSpraying: false })
  })

  it.each([
    { size: 0, accepted: true },
    { size: 100, accepted: true },
    { size: -0.01, accepted: false },
    { size: 100.01, accepted: false },
  ])('火焰大小 $size 的领域单位范围判定为 $accepted', ({ size, accepted }) => {
    const start = createDomainState(prototypeRules)
    const setSize = command('SetFireSize', { size })

    expect(validateRuleCommandPayload(setSize)).toBe(accepted)
    expect(applyRuleCommand(start, setSize, prototypeRules).ok).toBe(accepted)
  })
})

describe('火种语义与表驱动许可矩阵', () => {
  const activeStates = ['ready', 'extracting'] as const
  const terminalStates = ['failed', 'completed'] as const

  it.each(activeStates)('%s 中首次装备只装备，不点火也不改火焰大小', (status) => {
    const start: DomainState = { ...createDomainState(prototypeRules), status }
    const selected = applyRuleCommand(
      start,
      command('SelectFireSource', { fireSourceId: 'fire.basic' }),
      prototypeRules,
    )

    expect(selected.ok).toBe(true)
    expect(selected.state.equippedFireSourceId).toBe('fire.basic')
    expect(selected.state.isSpraying).toBe(false)
    expect(selected.state.fireSize).toBe(prototypeRules.initialFireSize)
    expect(
      isRuleCommandAllowed(
        selected.state,
        command('SelectFireSource', { fireSourceId: 'fire.basic' }),
        prototypeRules,
      ),
    ).toBe(false)
  })

  it.each(activeStates)('%s 中未装备时 true 被拒绝且不潜伏，false 幂等允许', (status) => {
    const start: DomainState = { ...createDomainState(prototypeRules), status }
    const startSpraying = command('SetSpraying', { spraying: true })
    const stopSpraying = command('SetSpraying', { spraying: false })

    expect(isRuleCommandAllowed(start, startSpraying, prototypeRules)).toBe(false)
    expect(isRuleCommandAllowed(start, stopSpraying, prototypeRules)).toBe(true)
    expect(applyRuleCommand(start, stopSpraying, prototypeRules).state.isSpraying).toBe(false)

    const equipped = applyRuleCommand(
      start,
      command('SelectFireSource', { fireSourceId: 'fire.basic' }),
      prototypeRules,
    ).state
    expect(equipped.isSpraying).toBe(false)
    expect(applyRuleCommand(equipped, startSpraying, prototypeRules).state.isSpraying).toBe(true)
  })

  it.each(terminalStates)('%s 中所有规则命令均不允许', (status) => {
    const state: DomainState = { ...createDomainState(prototypeRules), status }
    const commands: readonly RuleCommand[] = [
      command('PreselectMaterial', { inventoryBatchId: 'batch.herb' }),
      command('CancelMaterialSelection', {}),
      command('AddSelectedMaterial', {}),
      command('SelectFireSource', { fireSourceId: 'fire.basic' }),
      command('SetSpraying', { spraying: false }),
      command('SetFireDirection', { x: 1, y: 0 }),
      command('SetFireSize', { size: 0.8 }),
      command('SetContainerAxis', { axis: 0 }),
      command('SetFlameThrust', { enabled: false }),
      command('RequestFinish', {}),
    ]

    expect(commands.every((entry) => !isRuleCommandAllowed(state, entry, prototypeRules))).toBe(true)
  })

  const permissionRows: readonly Readonly<{
    command: RuleCommand
    ready: boolean
    extracting: boolean
    failed: boolean
    completed: boolean
  }>[] = [
    {
      command: command('PreselectMaterial', { inventoryBatchId: 'batch.herb' }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('CancelMaterialSelection', {}),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('AddSelectedMaterial', {}),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SelectFireSource', { fireSourceId: 'fire.basic' }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SetSpraying', { spraying: true }),
      ready: false,
      extracting: false,
      failed: false,
      completed: false,
    },
    {
      command: command('SetSpraying', { spraying: false }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SetFireDirection', { x: 1, y: 0 }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SetFireSize', { size: 0.6 }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SetContainerAxis', { axis: 0 }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('SetFlameThrust', { enabled: true }),
      ready: true,
      extracting: true,
      failed: false,
      completed: false,
    },
    {
      command: command('RequestFinish', {}),
      ready: false,
      extracting: false,
      failed: false,
      completed: false,
    },
  ]

  it.each(permissionRows)('完整矩阵：$command.type', (row) => {
    for (const status of ['ready', 'extracting', 'failed', 'completed'] as const) {
      const state: DomainState = { ...createDomainState(prototypeRules), status }
      expect(isRuleCommandAllowed(state, row.command, prototypeRules)).toBe(row[status])
    }
  })

  it('RequestFinish 只在 extracting 且 canFinish 时允许', () => {
    const finishable: DomainState = {
      ...createDomainState(prototypeRules),
      status: 'extracting',
      materialInstances: [
        {
          materialInstanceId: 'material-instance-1',
          materialDefinitionId: 'material.herb',
          inventoryBatchId: 'batch.herb',
          initialVolume: 10,
          remainingVolume: 0,
        },
      ],
    }
    expect(
      isRuleCommandAllowed(finishable, command('RequestFinish', {}), prototypeRules),
    ).toBe(true)
  })
})
