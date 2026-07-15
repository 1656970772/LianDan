import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  ExtractionApplication,
  TICK_PHASES,
  type CapturedInput,
  type InputLogEntry,
  type ResetCutoverFixture,
  type RuleCommandDraft,
} from '../../application/index.ts'
import {
  createDomainState,
  enterFailed,
  type DomainState,
  type PrototypeRules,
} from '../../domain/index.ts'
import type { SimulationDelta } from '../../simulation/index.ts'
import { prototypeRules } from '../fixtures/prototype-rules.ts'

function failedState(lastCommittedTick = -1): DomainState {
  return { ...createDomainState(prototypeRules), status: 'failed', lastCommittedTick }
}

function extractingState(lastCommittedTick = -1): DomainState {
  return { ...createDomainState(prototypeRules), status: 'extracting', lastCommittedTick }
}

describe('共享 sequence 与 beforePhase0', () => {
  it('畸形 replay 结构整批稳定拒绝，不抛异常且不污染任何运行状态', () => {
    const malformedEntries: readonly Readonly<{ name: string; entries: unknown }>[] = [
      { name: 'entries-null', entries: null },
      { name: 'entry-null', entries: [null] },
      { name: 'entry-number', entries: [1] },
      { name: 'entry-empty', entries: [{}] },
      { name: 'missing-envelope', entries: [{ channel: 'rule' }] },
      { name: 'envelope-null', entries: [{ channel: 'rule', envelope: null }] },
      { name: 'envelope-array', entries: [{ channel: 'rule', envelope: [] }] },
      { name: 'envelope-empty', entries: [{ channel: 'rule', envelope: {} }] },
      {
        name: 'unknown-channel',
        entries: [
          { channel: 'bogus', envelope: { sequence: 1, type: 'Pause', payload: {} } },
        ],
      },
      {
        name: 'missing-sequence',
        entries: [{ channel: 'control', envelope: { type: 'Pause', payload: {} } }],
      },
      {
        name: 'sequence-string',
        entries: [
          { channel: 'control', envelope: { sequence: '1', type: 'Pause', payload: {} } },
        ],
      },
      {
        name: 'sequence-fraction',
        entries: [
          { channel: 'control', envelope: { sequence: 1.5, type: 'Pause', payload: {} } },
        ],
      },
      {
        name: 'sequence-unsafe',
        entries: [
          {
            channel: 'control',
            envelope: { sequence: Number.MAX_SAFE_INTEGER + 1, type: 'Pause', payload: {} },
          },
        ],
      },
      {
        name: 'missing-type',
        entries: [{ channel: 'rule', envelope: { sequence: 1, targetTick: 0, payload: {} } }],
      },
      {
        name: 'type-number',
        entries: [
          { channel: 'control', envelope: { sequence: 1, type: 1, payload: {} } },
        ],
      },
      {
        name: 'missing-payload',
        entries: [
          { channel: 'rule', envelope: { sequence: 1, targetTick: 0, type: 'SetFireSize' } },
        ],
      },
      {
        name: 'payload-null',
        entries: [
          { channel: 'control', envelope: { sequence: 1, type: 'Resume', payload: null } },
        ],
      },
      {
        name: 'payload-array',
        entries: [
          { channel: 'control', envelope: { sequence: 1, type: 'Resume', payload: [] } },
        ],
      },
      {
        name: 'missing-target',
        entries: [
          {
            channel: 'rule',
            envelope: { sequence: 1, type: 'SetFireSize', payload: { size: 0.5 } },
          },
        ],
      },
      {
        name: 'target-string',
        entries: [
          {
            channel: 'rule',
            envelope: {
              sequence: 1,
              targetTick: '0',
              type: 'SetFireSize',
              payload: { size: 0.5 },
            },
          },
        ],
      },
      {
        name: 'valid-prefix-then-invalid',
        entries: [
          { channel: 'control', envelope: { sequence: 1, type: 'Pause', payload: {} } },
          { channel: 'rule', envelope: { sequence: 2, type: 'SetFireSize', payload: {} } },
        ],
      },
    ]

    for (const { name, entries } of malformedEntries) {
      const initial: DomainState = {
        ...createDomainState(prototypeRules),
        equippedFireSourceId: 'fire.basic',
      }
      const app = new ExtractionApplication(prototypeRules, {
        domainState: initial,
        pauseReasons: ['hidden'],
      })
      const queueBefore = app.getQueuedCommands()
      const pauseBefore = app.getPauseReasons()

      expect(() => {
        const result = app.injectReplayBoundary(0, entries as never)
        expect(result).toMatchObject({
          accepted: false,
          error: 'APP_BOUNDARY_INVALID',
          canAdvance: false,
          resetCutover: false,
        })
      }, name).not.toThrow()
      expect(app.getDomainState(), name).toBe(initial)
      expect(app.getQueuedCommands(), name).toEqual(queueBefore)
      expect(app.getPauseReasons(), name).toEqual(pauseBefore)
      expect(app.getExecutionMode(), name).toBe('idle')
      expect(app.getInputLog(), name).toEqual([])
      expect(app.getInputResults(), name).toEqual([])
      expect(app.getExecutionTrace(), name).toEqual([])
      expect(app.getSessionArchives(), name).toEqual([])
      expect(app.getNextCaptureSequence(), name).toBe(1)
    }
  })

  it('结构合法但 payload 非法的 replay 仍使用命令错误码', () => {
    const app = new ExtractionApplication(prototypeRules)

    const result = app.injectReplayBoundary(0, [
      {
        channel: 'control',
        envelope: { sequence: 1, type: 'Pause', payload: { unexpected: true } },
      } as unknown as CapturedInput,
    ])

    expect(result.accepted).toBe(true)
    expect(app.getInputResults().map(({ outcome }) => outcome)).toEqual([
      'APP_COMMAND_PAYLOAD_INVALID',
    ])
    expect(app.getExecutionMode()).toBe('idle')
  })

  it('结构合法的 safe-integer sequence 缺口仍进入预检并返回 sequence 错误码', () => {
    const app = new ExtractionApplication(prototypeRules)

    const result = app.injectReplayBoundary(0, [
      { channel: 'control', envelope: { sequence: 2, type: 'Pause', payload: {} } },
    ])

    expect(result.accepted).toBe(true)
    expect(app.getInputLog()).toHaveLength(1)
    expect(app.getInputResults().map(({ outcome }) => outcome)).toEqual([
      'APP_COMMAND_SEQUENCE_INVALID',
    ])
    expect(app.getPauseReasons()).toEqual([])
  })

  it('capture API 的运行时非法 draft 只记 payload 拒绝，不污染 domain/queue/pause/mode', () => {
    const app = new ExtractionApplication(prototypeRules, { pauseReasons: ['hidden'] })
    const initial = app.getDomainState()

    expect(() => app.captureRuleCommand(null as never)).not.toThrow()
    expect(() => app.captureApplicationControl(1 as never)).not.toThrow()
    expect(app.beforePhase0(0)).toMatchObject({ accepted: true, canAdvance: false })

    expect(app.getInputResults().map(({ outcome }) => outcome)).toEqual([
      'APP_COMMAND_PAYLOAD_INVALID',
      'APP_COMMAND_PAYLOAD_INVALID',
    ])
    expect(app.getDomainState()).toBe(initial)
    expect(app.getQueuedCommands()).toEqual([])
    expect(app.getPauseReasons()).toEqual(['hidden'])
    expect(app.getExecutionMode()).toBe('idle')
  })

  it.each([
    {
      name: 'deliveryBoundaryTick mismatch',
      entry: {
        channel: 'control',
        envelope: { sequence: 1, type: 'Pause', payload: {} },
        deliveryBoundaryTick: 1,
      },
    },
    {
      name: 'sessionId mismatch',
      entry: {
        channel: 'control',
        envelope: { sequence: 1, type: 'Pause', payload: {} },
        sessionId: 'session-999999',
      },
    },
  ])('replay $name 不进入预检且不改状态', ({ entry }) => {
    const app = new ExtractionApplication(prototypeRules)
    const initial = app.getDomainState()

    expect(app.injectReplayBoundary(0, [entry])).toMatchObject({
      accepted: false,
      error: 'APP_BOUNDARY_INVALID',
    })
    expect(app.getDomainState()).toBe(initial)
    expect(app.getInputLog()).toEqual([])
    expect(app.getQueuedCommands()).toEqual([])
    expect(app.getPauseReasons()).toEqual([])
    expect(app.getExecutionMode()).toBe('idle')
  })

  it('规则和控制共享捕获 sequence，并在边界统一写原始日志', () => {
    const app = new ExtractionApplication(prototypeRules)
    const rule = app.captureRuleCommand({
      targetTick: 0,
      type: 'SetFireSize',
      payload: { size: 0.6 },
    })
    const pause = app.captureApplicationControl({ type: 'Pause', payload: {} })

    expect([rule.sequence, pause.sequence]).toEqual([1, 2])
    expect(app.getInputLog()).toEqual([])

    const boundary = app.beforePhase0(0)

    expect(boundary.accepted).toBe(true)
    expect(boundary.canAdvance).toBe(false)
    expect(app.getInputLog().map((entry) => [entry.sequence, entry.deliveryBoundaryTick])).toEqual([
      [1, 0],
      [2, 0],
    ])
    expect(app.getPauseReasons()).toEqual(['manual'])
    expect(app.getQueuedCommands()).toHaveLength(1)
  })

  it('整批预检后才按总序处理，错误优先级为 sequence invalid > late > not allowed', () => {
    const app = new ExtractionApplication(prototypeRules, {
      domainState: failedState(7),
      nextTick: 8,
      nextSequence: 10,
    })
    const inputs: readonly CapturedInput[] = [
      {
        channel: 'rule',
        envelope: {
          sequence: 10,
          targetTick: 7,
          type: 'SetFireSize',
          payload: { size: 0.5 },
        },
      },
      {
        channel: 'rule',
        envelope: {
          sequence: 10,
          targetTick: 7,
          type: 'SetFireSize',
          payload: { size: 0.7 },
        },
      },
      {
        channel: 'rule',
        envelope: {
          sequence: 11,
          targetTick: 8,
          type: 'SetFireSize',
          payload: { size: 0.9 },
        },
      },
    ]

    app.injectReplayBoundary(8, inputs)

    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'APP_COMMAND_LATE',
      'APP_COMMAND_SEQUENCE_INVALID',
      'APP_COMMAND_NOT_ALLOWED',
    ])
    expect(app.getInputLog().every((entry) => entry.deliveryBoundaryTick === 8)).toBe(true)
  })

  it('targetTick + sequence 排队，同 tick 连续值以最后一写为准', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.3 } })
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 0.5 } })
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 0.8 } })

    expect(app.beforePhase0(0).canAdvance).toBe(true)
    app.runPreparedTick()
    expect(app.getReadModel().fireSize).toBe(0.8)
    expect(app.getQueuedCommands().map((entry) => [entry.targetTick, entry.sequence])).toEqual([[1, 1]])

    expect(app.beforePhase0(1).canAdvance).toBe(true)
    app.runPreparedTick()
    expect(app.getReadModel().fireSize).toBe(0.3)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '拒绝非法 targetTick %s，且不留下悬挂队列',
    (targetTick) => {
      const app = new ExtractionApplication(prototypeRules)
      const original = app.getDomainState()

      const boundary = app.injectReplayBoundary(0, [
        {
          channel: 'rule',
          envelope: {
            sequence: 1,
            targetTick,
            type: 'SetFireSize',
            payload: { size: 0.7 },
          },
        },
      ])
      if (boundary.canAdvance) app.runPreparedTick()

      expect(app.getInputResults().map((result) => result.outcome)).toEqual([
        'APP_COMMAND_PAYLOAD_INVALID',
      ])
      expect(app.getQueuedCommands()).toEqual([])
      expect(app.getDomainState()).toEqual({
        ...original,
        lastCommittedTick: 0,
      })
      expect(app.getDomainState().ledger).toEqual(original.ledger)
    },
  )

  it('SetFireSize 运行时边界接受 0/100，拒绝小于 0 或大于 100', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.injectReplayBoundary(0, [
      {
        channel: 'rule',
        envelope: { sequence: 1, targetTick: 0, type: 'SetFireSize', payload: { size: 0 } },
      },
      {
        channel: 'rule',
        envelope: { sequence: 2, targetTick: 0, type: 'SetFireSize', payload: { size: 100 } },
      },
      {
        channel: 'rule',
        envelope: { sequence: 3, targetTick: 0, type: 'SetFireSize', payload: { size: -0.01 } },
      },
      {
        channel: 'rule',
        envelope: { sequence: 4, targetTick: 0, type: 'SetFireSize', payload: { size: 100.01 } },
      },
    ])

    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'queued',
      'queued',
      'APP_COMMAND_PAYLOAD_INVALID',
      'APP_COMMAND_PAYLOAD_INVALID',
    ])
    app.runPreparedTick()
    expect(app.getReadModel().fireSize).toBe(100)
  })

  const malformedRuleCommands = [
    { name: 'PreselectMaterial', command: { type: 'PreselectMaterial', payload: { inventoryBatchId: 42 } } },
    { name: 'CancelMaterialSelection', command: { type: 'CancelMaterialSelection', payload: { unexpected: true } } },
    { name: 'AddSelectedMaterial', command: { type: 'AddSelectedMaterial', payload: { unexpected: true } } },
    { name: 'SelectFireSource', command: { type: 'SelectFireSource', payload: { fireSourceId: 42 } } },
    { name: 'SetSpraying', command: { type: 'SetSpraying', payload: { spraying: 'yes' } } },
    { name: 'SetFireDirection', command: { type: 'SetFireDirection', payload: { x: Number.NaN, y: 0 } } },
    { name: 'SetFireSize', command: { type: 'SetFireSize', payload: { size: Number.NaN } } },
    { name: 'SetContainerAxis', command: { type: 'SetContainerAxis', payload: { axis: 2 } } },
    { name: 'SetFlameThrust', command: { type: 'SetFlameThrust', payload: { enabled: 'yes' } } },
    { name: 'RequestFinish', command: { type: 'RequestFinish', payload: { unexpected: true } } },
    { name: 'unknown command', command: { type: 'UnknownCommand', payload: {} } },
  ] as const

  it.each(malformedRuleCommands)(
    '重放边界对 $name 执行统一 runtime payload 校验',
    ({ command }) => {
      const initial: DomainState = {
        ...createDomainState(prototypeRules),
        equippedFireSourceId: 'fire.basic',
      }
      const app = new ExtractionApplication(prototypeRules, { domainState: initial })

      const boundary = app.injectReplayBoundary(0, [
        {
          channel: 'rule',
          envelope: { sequence: 1, targetTick: 0, ...command },
        } as unknown as CapturedInput,
      ])
      if (boundary.canAdvance) app.runPreparedTick()

      expect(app.getInputResults().map((result) => result.outcome)).toEqual([
        'APP_COMMAND_PAYLOAD_INVALID',
      ])
      expect(app.getQueuedCommands()).toEqual([])
      expect(app.getDomainState()).toEqual({
        ...initial,
        lastCommittedTick: 0,
      })
      expect(app.getDomainState().ledger).toEqual(initial.ledger)
    },
  )
})

describe('权威 tick phase 与原子账本提交', () => {
  const twoBatchRules: PrototypeRules = {
    ...prototypeRules,
    inventoryBatches: [
      ...prototypeRules.inventoryBatches,
      {
        batchId: 'batch.flower',
        materialDefinitionId: 'material.flower',
        servings: 2,
        volumePerServing: 8,
        medicinalLiquidVolumePerServing: 8,
      },
    ],
  }

  it('phase 0 只解析投药，phase 1 才扣库存、创建实例并进入 extracting', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({
      targetTick: 0,
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
    })
    app.captureRuleCommand({ targetTick: 0, type: 'AddSelectedMaterial', payload: {} })
    expect(app.beforePhase0(0).canAdvance).toBe(true)

    const observed: Array<Readonly<{
      phase: number
      status: DomainState['status']
      inventory: number
      materialCount: number
      outcomes: readonly string[]
    }>> = []
    app.runPreparedTick({
      onPhase(phase, state) {
        if (phase !== 0 && phase !== 1) return
        observed.push({
          phase,
          status: state.status,
          inventory: state.inventory['batch.herb']!,
          materialCount: state.materialInstances.length,
          outcomes: app.getInputResults().map((result) => result.outcome),
        })
      },
    })

    expect(observed).toEqual([
      {
        phase: 0,
        status: 'ready',
        inventory: 2,
        materialCount: 0,
        outcomes: ['applied', 'queued'],
      },
      {
        phase: 1,
        status: 'extracting',
        inventory: 1,
        materialCount: 1,
        outcomes: ['applied', 'applied'],
      },
    ])
  })

  it.each([
    {
      name: '切换批次后继续投入',
      tail: [
        {
          type: 'PreselectMaterial' as const,
          payload: { inventoryBatchId: 'batch.flower' },
        },
        { type: 'AddSelectedMaterial' as const, payload: {} },
      ],
      expectedBatchIds: ['batch.herb', 'batch.flower'],
      expectedSelection: 'batch.flower',
    },
    {
      name: '投入后取消选择',
      tail: [{ type: 'CancelMaterialSelection' as const, payload: {} }],
      expectedBatchIds: ['batch.herb'],
      expectedSelection: null,
    },
  ])('同 tick $name 不会在 phase 1 错用最终 selection', ({ tail, expectedBatchIds, expectedSelection }) => {
    const app = new ExtractionApplication(twoBatchRules)
    app.captureRuleCommand({
      targetTick: 0,
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
    })
    app.captureRuleCommand({ targetTick: 0, type: 'AddSelectedMaterial', payload: {} })
    for (const command of tail) {
      app.captureRuleCommand({ targetTick: 0, ...command } as RuleCommandDraft)
    }
    app.beforePhase0(0)
    app.runPreparedTick()

    expect(app.getDomainState().materialInstances.map((item) => item.inventoryBatchId)).toEqual(
      expectedBatchIds,
    )
    expect(app.getDomainState().selectedMaterialBatchId).toBe(expectedSelection)
    expect(app.getInputResults().every((result) => result.outcome === 'applied')).toBe(true)
  })

  it('phase 9 先应用 failed 判定，再尝试 settle completion', () => {
    const finishable: DomainState = {
      ...createDomainState(prototypeRules),
      status: 'extracting',
      finishRequested: true,
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
    const app = new ExtractionApplication(prototypeRules, { domainState: finishable })
    app.beforePhase0(0)
    app.runPreparedTick({
      onPhase(phase, state) {
        if (phase === 9) return enterFailed(state)
      },
    })

    expect(app.getReadModel().status).toBe('failed')
  })

  it('phase 8 默认提交空 delta，使 nextTick 与 lastCommittedTick 同步', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.beforePhase0(0)
    app.runPreparedTick()

    expect(app.getNextTick()).toBe(1)
    expect(app.getDomainState().lastCommittedTick).toBe(0)
  })

  it('phase 8 通过唯一 delta 构建入口原子提交模拟结果', () => {
    const initial: DomainState = {
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
    const app = new ExtractionApplication(prototypeRules, { domainState: initial })
    const remainingByPhase = new Map<number, number>()
    app.beforePhase0(0)
    app.runPreparedTick({
      buildSimulationDelta(tick): SimulationDelta {
        return {
          tick,
          dissolutions: [
            {
              materialDefinitionId: 'material.herb',
              materialInstanceId: 'material-instance-1',
              pearlType: 'medicinalLiquid',
              volume: 2,
            },
          ],
          births: [],
          pearlVolumeChanges: [],
          terminalOutcomes: [],
          naturalLosses: [],
          inheritedLosses: [],
        }
      },
      onPhase(phase, state) {
        if (phase === 7 || phase === 8) {
          remainingByPhase.set(phase, state.materialInstances[0]!.remainingVolume)
        }
      },
    })

    expect([...remainingByPhase]).toEqual([
      [7, 10],
      [8, 8],
    ])
    expect(app.getDomainState().ledger.dissolvedVolumes).toEqual({
      'material-instance-1': { medicinalLiquid: 2 },
    })
    expect(app.getDomainState().lastCommittedTick).toBe(0)
  })

  it('phase 10 每个成功 phase 8 只发布一次 commit/read-model，失败提交不发布', () => {
    const published: Array<Readonly<{ tick: number; nextTick: number; lastCommittedTick: number }>> = []
    const publicationOrder: string[] = []
    const app = new ExtractionApplication(prototypeRules)
    app.beforePhase0(0)
    app.runPreparedTick({
      onPhase(phase) {
        if (phase >= 8) publicationOrder.push(`phase:${phase}`)
      },
      onTickCommitted(commit) {
        publicationOrder.push('published')
        published.push({
          tick: commit.tick,
          nextTick: commit.readModel.nextTick,
          lastCommittedTick: commit.state.lastCommittedTick,
        })
      },
    })

    expect(published).toEqual([{ tick: 0, nextTick: 1, lastCommittedTick: 0 }])
    expect(publicationOrder).toEqual(['phase:8', 'phase:9', 'phase:10', 'published'])

    const rejectedPublications: number[] = []
    const rejected = new ExtractionApplication(prototypeRules)
    rejected.beforePhase0(0)
    expect(() =>
      rejected.runPreparedTick({
        buildSimulationDelta(): SimulationDelta {
          return {
            tick: 1,
            dissolutions: [],
            births: [],
            pearlVolumeChanges: [],
            terminalOutcomes: [],
            naturalLosses: [],
            inheritedLosses: [],
          }
        },
        onTickCommitted() {
          rejectedPublications.push(1)
        },
      }),
    ).toThrow('SIM_DELTA_INVALID_TICK')
    expect(rejectedPublications).toEqual([])
    expect(rejected.getDomainState().lastCommittedTick).toBe(-1)
  })

  it('phase 10 只发布已提交的材料、出生、接取、可结束与完成语义事件', () => {
    const app = new ExtractionApplication(prototypeRules)
    const published: Array<Readonly<{ tick: number; types: readonly string[] }>> = []
    const runTick = (delta: SimulationDelta): void => {
      const boundary = app.beforePhase0(app.getNextTick())
      expect(boundary).toMatchObject({ accepted: true, canAdvance: true })
      app.runPreparedTick({
        buildSimulationDelta: () => delta,
        onTickCommitted(commit) {
          published.push({
            tick: commit.tick,
            types: commit.events.map((event) => event.type),
          })
        },
      })
    }

    app.captureRuleCommand({
      targetTick: 0,
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
    })
    app.captureRuleCommand({
      targetTick: 0,
      type: 'AddSelectedMaterial',
      payload: {},
    })
    runTick({
      tick: 0,
      dissolutions: [],
      births: [],
      pearlVolumeChanges: [],
      terminalOutcomes: [],
      naturalLosses: [],
      inheritedLosses: [],
    })

    runTick({
      tick: 1,
      dissolutions: [
        {
          materialDefinitionId: 'material.herb',
          materialInstanceId: 'material-instance-1',
          pearlType: 'medicinalLiquid',
          volume: 10,
        },
      ],
      births: [
        {
          pearlId: 'pearl-1',
          sourceMaterialDefinitionId: 'material.herb',
          sourceMaterialInstanceId: 'material-instance-1',
          pearlType: 'medicinalLiquid',
          volume: 10,
        },
      ],
      pearlVolumeChanges: [],
      terminalOutcomes: [],
      naturalLosses: [],
      inheritedLosses: [],
    })

    runTick({
      tick: 2,
      dissolutions: [],
      births: [],
      pearlVolumeChanges: [],
      terminalOutcomes: [{ pearlId: 'pearl-1', outcome: 'caught' }],
      naturalLosses: [],
      inheritedLosses: [],
    })

    app.captureRuleCommand({
      targetTick: 3,
      type: 'RequestFinish',
      payload: {},
    })
    runTick({
      tick: 3,
      dissolutions: [],
      births: [],
      pearlVolumeChanges: [],
      terminalOutcomes: [],
      naturalLosses: [],
      inheritedLosses: [],
    })

    expect(published).toEqual([
      { tick: 0, types: ['MaterialAdded'] },
      { tick: 1, types: ['PearlBorn'] },
      { tick: 2, types: ['PearlCaught', 'CanFinish'] },
      { tick: 3, types: ['ExtractionCompleted'] },
    ])
  })

  it('M3 发布护盾、伤害、损耗警告与失败结算语义事件', () => {
    const shieldState = extractingState()
    const shieldApp = new ExtractionApplication(prototypeRules, {
      domainState: {
        ...shieldState,
        ledger: {
          ...shieldState.ledger,
          pearlVolumes: { 'pearl-1': 1 },
          pearlSources: {
            'pearl-1': {
              sourceMaterialDefinitionId: 'material.herb',
              sourceMaterialInstanceId: 'material-instance-1',
              pearlType: 'medicinalLiquid',
            },
          },
          theoreticalMedicinalVolumes: { 'material-instance-1': 10 },
        },
      },
    })
    const shieldEvents: string[] = []
    shieldApp.beforePhase0(0)
    shieldApp.runPreparedTick({
      buildSimulationDelta: () => ({
        tick: 0,
        dissolutions: [],
        births: [],
        pearlVolumeChanges: [
          { pearlId: 'pearl-1', previousVolume: 1, currentVolume: 0.5 },
        ],
        terminalOutcomes: [],
        naturalLosses: [],
        inheritedLosses: [],
        shieldActivations: [{ pearlId: 'pearl-1' }],
      }),
      onTickCommitted: (commit) => {
        shieldEvents.push(...commit.events.map(({ type }) => type))
      },
    })
    expect(shieldEvents).toEqual(['PearlShieldActivated', 'PearlDamaged'])

    const failureState = extractingState()
    const failureApp = new ExtractionApplication(prototypeRules, {
      domainState: {
        ...failureState,
        materialInstances: [
          {
            materialInstanceId: 'material-instance-1',
            materialDefinitionId: 'material.herb',
            inventoryBatchId: 'batch.herb',
            initialVolume: 10,
            remainingVolume: 10,
          },
        ],
        ledger: {
          ...failureState.ledger,
          theoreticalMedicinalVolumes: { 'material-instance-1': 10 },
        },
      },
    })
    let failureEvents: readonly string[] = []
    failureApp.beforePhase0(0)
    failureApp.runPreparedTick({
      buildSimulationDelta: () => ({
        tick: 0,
        dissolutions: [],
        births: [],
        pearlVolumeChanges: [],
        terminalOutcomes: [],
        naturalLosses: [
          {
            sourceKind: 'materialCell',
            stableEntityId: 'cell:material-instance-1:0000',
            materialInstanceId: 'material-instance-1',
            pearlType: 'medicinalLiquid',
            volume: 7.1,
          },
        ],
        inheritedLosses: [],
      }),
      onTickCommitted: (commit) => {
        failureEvents = commit.events.map(({ type }) => type)
      },
    })
    expect(failureEvents).toEqual(['LossWarningChanged', 'ExtractionFailed'])
    expect(failureApp.getReadModel()).toMatchObject({
      status: 'failed',
      lossWarningLevel: 2,
      failureResult: { reason: 'excessiveMedicinalLoss' },
    })
  })

  it('phase 0 投药回调抛错时回滚 tick 快照，并可在同一 prepared boundary 完整重试一次', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({
      targetTick: 0,
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
    })
    app.captureRuleCommand({ targetTick: 0, type: 'AddSelectedMaterial', payload: {} })
    app.beforePhase0(0)
    const domainBefore = app.getDomainState()
    const queueBefore = app.getQueuedCommands()
    const resultsBefore = app.getInputResults()
    const traceBefore = app.getExecutionTrace()

    expect(() =>
      app.runPreparedTick({
        onPhase(phase) {
          if (phase === 0) throw new Error('phase-0-failure')
        },
      }),
    ).toThrow('phase-0-failure')

    expect(app.getDomainState()).toBe(domainBefore)
    expect(app.getQueuedCommands()).toEqual(queueBefore)
    expect(app.getInputResults()).toEqual(resultsBefore)
    expect(app.getExecutionTrace()).toEqual(traceBefore)
    expect(app.getNextTick()).toBe(0)
    expect(app.getExecutionMode()).toBe('idle')

    app.runPreparedTick()

    expect(app.getNextTick()).toBe(1)
    expect(app.getQueuedCommands()).toEqual([])
    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'applied',
      'applied',
    ])
    expect(app.getDomainState().inventory['batch.herb']).toBe(1)
    expect(app.getDomainState().materialInstances).toHaveLength(1)
    expect(app.getExecutionTrace()).toEqual([
      ...traceBefore,
      ...TICK_PHASES.map((phase) => `phase:${phase}`),
    ])
  })

  it.each([9, 10] as const)(
    'phase %i 回调抛错时回滚 phase 8 与 terminal drain，并允许同 tick 重试',
    (throwingPhase) => {
      const initial = extractingState()
      const app = new ExtractionApplication(prototypeRules, { domainState: initial })
      app.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.2 } })
      app.beforePhase0(0)
      const queueBefore = app.getQueuedCommands()
      const resultsBefore = app.getInputResults()
      const traceBefore = app.getExecutionTrace()

      expect(() =>
        app.runPreparedTick({
          onPhase(phase, state) {
            if (phase === throwingPhase) throw new Error(`phase-${phase}-failure`)
            if (phase === 9) return enterFailed(state)
          },
        }),
      ).toThrow(`phase-${throwingPhase}-failure`)

      expect(app.getDomainState()).toBe(initial)
      expect(app.getDomainState().lastCommittedTick).toBe(-1)
      expect(app.getQueuedCommands()).toEqual(queueBefore)
      expect(app.getInputResults()).toEqual(resultsBefore)
      expect(app.getExecutionTrace()).toEqual(traceBefore)
      expect(app.getNextTick()).toBe(0)
      expect(app.getExecutionMode()).toBe('idle')

      app.runPreparedTick({
        onPhase(phase, state) {
          if (phase === 9) return enterFailed(state)
        },
      })

      expect(app.getNextTick()).toBe(1)
      expect(app.getDomainState()).toMatchObject({ status: 'failed', lastCommittedTick: 0 })
      expect(app.getQueuedCommands()).toEqual([])
      expect(app.getInputResults().map((result) => result.outcome)).toEqual([
        'APP_COMMAND_NOT_ALLOWED',
      ])
    },
  )

  it.each([
    {
      name: '返回 invalid delta',
      expectedError: 'SIM_DELTA_INVALID_TICK',
      build(tick: number): SimulationDelta {
        return {
          tick: tick + 1,
          dissolutions: [],
          births: [],
          pearlVolumeChanges: [],
          terminalOutcomes: [],
          naturalLosses: [],
          inheritedLosses: [],
        }
      },
    },
    {
      name: '直接抛错',
      expectedError: 'builder-failure',
      build(): SimulationDelta {
        throw new Error('builder-failure')
      },
    },
  ])('simulation delta builder $name 时回滚 phase 0/1 副作用并可重试', ({ build, expectedError }) => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 0.75 } })
    app.beforePhase0(0)
    const initial = app.getDomainState()
    const queueBefore = app.getQueuedCommands()
    const resultsBefore = app.getInputResults()
    const traceBefore = app.getExecutionTrace()

    expect(() => app.runPreparedTick({ buildSimulationDelta: build })).toThrow(expectedError)

    expect(app.getDomainState()).toBe(initial)
    expect(app.getQueuedCommands()).toEqual(queueBefore)
    expect(app.getInputResults()).toEqual(resultsBefore)
    expect(app.getExecutionTrace()).toEqual(traceBefore)
    expect(app.getNextTick()).toBe(0)
    expect(app.getExecutionMode()).toBe('idle')

    app.runPreparedTick()
    expect(app.getNextTick()).toBe(1)
    expect(app.getReadModel().fireSize).toBe(0.75)
    expect(app.getInputResults().map((result) => result.outcome)).toEqual(['applied'])
  })

  it('失败 phase 中捕获的外部输入与已分配 sequence 保留到重试成功后的下一边界', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.beforePhase0(0)
    const capturedSequences: number[] = []

    expect(() =>
      app.runPreparedTick({
        onPhase(phase) {
          if (phase !== 9) return
          capturedSequences.push(
            app.captureRuleCommand({
              targetTick: 1,
              type: 'SetFireSize',
              payload: { size: 0.6 },
            }).sequence,
          )
          capturedSequences.push(
            app.captureApplicationControl({ type: 'Pause', payload: {} }).sequence,
          )
          throw new Error('phase-capture-failure')
        },
      }),
    ).toThrow('phase-capture-failure')

    expect(capturedSequences).toEqual([1, 2])
    expect(app.getNextCaptureSequence()).toBe(3)
    expect(app.getInputLog()).toEqual([])
    expect(app.getNextTick()).toBe(0)

    app.runPreparedTick()
    expect(app.beforePhase0(1)).toMatchObject({ accepted: true, canAdvance: false })
    expect(app.getInputLog().map((entry) => entry.sequence)).toEqual([1, 2])
    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'queued',
      'applied',
    ])
    expect(app.getQueuedCommands().map((command) => command.sequence)).toEqual([1])
    expect(app.getPauseReasons()).toEqual(['manual'])
  })

  it('onTickCommitted 抛错前先最终化成功 tick，下一边界可继续且旧 tick 不重复发布', () => {
    const app = new ExtractionApplication(prototypeRules)
    const publishedTicks: number[] = []
    let modeDuringPublication: string | null = null
    app.beforePhase0(0)

    expect(() =>
      app.runPreparedTick({
        onTickCommitted(commit) {
          modeDuringPublication = app.getExecutionMode()
          publishedTicks.push(commit.tick)
          throw new Error('publication-failure')
        },
      }),
    ).toThrow('publication-failure')

    expect(modeDuringPublication).toBe('idle')
    expect(publishedTicks).toEqual([0])
    expect(app.getNextTick()).toBe(1)
    expect(app.getDomainState().lastCommittedTick).toBe(0)
    expect(app.getExecutionMode()).toBe('idle')
    expect(app.beforePhase0(1)).toMatchObject({ accepted: true, canAdvance: true })

    app.runPreparedTick({
      onTickCommitted(commit) {
        publishedTicks.push(commit.tick)
      },
    })
    expect(publishedTicks).toEqual([0, 1])
    expect(app.getNextTick()).toBe(2)
    expect(app.getDomainState().lastCommittedTick).toBe(1)
  })

  it('显式 domainState 的 lastCommittedTick 必须与 nextTick 对齐', () => {
    expect(
      () =>
        new ExtractionApplication(prototypeRules, {
          domainState: createDomainState(prototypeRules),
          nextTick: 7,
        }),
    ).toThrow('APP_BOUNDARY_INVALID')

    const aligned = new ExtractionApplication(prototypeRules, {
      domainState: { ...createDomainState(prototypeRules), lastCommittedTick: 6 },
      nextTick: 7,
    })
    expect(aligned.beforePhase0(7)).toMatchObject({ accepted: true, canAdvance: true })
  })
})

describe('control pump、暂停和 phase 互斥', () => {
  const malformedControls: readonly Readonly<{
    name: string
    control: Readonly<{ type: string; payload: unknown }>
    domainStatus?: DomainState['status']
    restartConfirmation?: 'open' | 'closed'
  }>[] = [
    { name: 'Pause', control: { type: 'Pause', payload: { unexpected: true } } },
    { name: 'Resume', control: { type: 'Resume', payload: { unexpected: true } } },
    {
      name: 'WindowBlur',
      control: {
        type: 'WindowBlur',
        payload: { lifecycleSnapshot: { hasFocus: 'yes', visibilityState: 'visible' } },
      },
    },
    {
      name: 'WindowFocus',
      control: {
        type: 'WindowFocus',
        payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'background' } },
      },
    },
    {
      name: 'VisibilityChanged',
      control: {
        type: 'VisibilityChanged',
        payload: { lifecycleSnapshot: { visibilityState: 'visible' } },
      },
    },
    { name: 'RequestRestart', control: { type: 'RequestRestart', payload: { unexpected: true } } },
    {
      name: 'ConfirmRestart',
      restartConfirmation: 'open',
      control: {
        type: 'ConfirmRestart',
        payload: { lifecycleSnapshot: { hasFocus: 1, visibilityState: 'visible' } },
      },
    },
    {
      name: 'CancelRestart',
      restartConfirmation: 'open',
      control: { type: 'CancelRestart', payload: { unexpected: true } },
    },
    {
      name: 'Again',
      domainStatus: 'failed',
      control: {
        type: 'Again',
        payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'background' } },
      },
    },
    { name: 'unknown control', control: { type: 'UnknownControl', payload: {} } },
  ]

  it.each(malformedControls)(
    '重放边界对 $name 执行统一 runtime payload 校验',
    ({ control, ...setup }) => {
      const initial: DomainState = {
        ...createDomainState(prototypeRules),
        status: setup.domainStatus ?? 'ready',
      }
      const app = new ExtractionApplication(prototypeRules, {
        domainState: initial,
        restartConfirmation: setup.restartConfirmation ?? 'closed',
      })
      const pauseReasonsBefore = app.getPauseReasons()

      app.injectReplayBoundary(0, [
        {
          channel: 'control',
          envelope: { sequence: 1, ...control },
        } as unknown as CapturedInput,
      ])

      expect(app.getInputResults().map((result) => result.outcome)).toEqual([
        'APP_COMMAND_PAYLOAD_INVALID',
      ])
      expect(app.getSessionArchives()).toEqual([])
      expect(app.getDomainState()).toBe(initial)
      expect(app.getPauseReasons()).toEqual(pauseReasonsBefore)
    },
  )

  it('暂停原因独立增删；弹板取消不清除仍有效的 hidden', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureApplicationControl({
      type: 'VisibilityChanged',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'hidden' } },
    })
    app.captureApplicationControl({ type: 'RequestRestart', payload: {} })
    app.beforePhase0(0)
    expect(app.getPauseReasons()).toEqual(['hidden', 'restartConfirmation'])

    app.captureApplicationControl({ type: 'CancelRestart', payload: {} })
    app.beforePhase0(0)
    expect(app.getPauseReasons()).toEqual(['hidden'])

    app.captureApplicationControl({
      type: 'VisibilityChanged',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    expect(app.beforePhase0(0).canAdvance).toBe(true)
  })

  it('phase 0～10 顺序唯一；phase 中可捕获但不能重入边界，输入只在下一边界交付', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.beforePhase0(0)
    const phases: number[] = []
    let nestedError: string | null = null

    app.runPreparedTick({
      onPhase(phase) {
        phases.push(phase)
        if (phase === 4) {
          app.captureApplicationControl({ type: 'Pause', payload: {} })
          const nested = app.beforePhase0(1)
          nestedError = nested.accepted ? null : nested.error
        }
      },
    })

    expect(phases).toEqual([...TICK_PHASES])
    expect(nestedError).toBe('APP_EXECUTION_REENTRANT')
    expect(app.getPauseReasons()).toEqual([])
    expect(app.beforePhase0(1).canAdvance).toBe(false)
    expect(app.getPauseReasons()).toEqual(['manual'])
  })

  it('control pump 自身非重入，并在返回总 sequence 流前同步完成', () => {
    let app: ExtractionApplication
    let nestedError: string | null = null
    app = new ExtractionApplication(prototypeRules, {
      onControlPump(stage) {
        if (stage !== 'start') return
        const nested = app.beforePhase0(0)
        nestedError = nested.accepted ? null : nested.error
      },
    })
    app.captureApplicationControl({ type: 'Pause', payload: {} })
    app.captureApplicationControl({ type: 'Resume', payload: {} })

    const result = app.beforePhase0(0)

    expect(result.canAdvance).toBe(true)
    expect(nestedError).toBe('APP_EXECUTION_REENTRANT')
    expect(app.getExecutionTrace()).toEqual([
      'boundary:0:preflight',
      'control:1:start',
      'control:1:end',
      'control:2:start',
      'control:2:end',
    ])
  })

  it('cancel 仅关闭确认与对应暂停原因，不改 domain、queue、tick 或运行 phase', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.2 } })
    app.captureApplicationControl({ type: 'RequestRestart', payload: {} })
    app.beforePhase0(0)
    const domainBeforeCancel = app.getDomainState()
    const queueBeforeCancel = app.getQueuedCommands()
    const traceBeforeCancel = app.getExecutionTrace()

    app.captureApplicationControl({ type: 'CancelRestart', payload: {} })
    const cancel = app.beforePhase0(0)

    expect(cancel.canAdvance).toBe(true)
    expect(app.getDomainState()).toBe(domainBeforeCancel)
    expect(app.getQueuedCommands()).toEqual(queueBeforeCancel)
    expect(app.getNextTick()).toBe(0)
    expect(app.getExecutionTrace().filter((entry) => entry.startsWith('phase:'))).toEqual([])
    expect(traceBeforeCancel.filter((entry) => entry.startsWith('phase:'))).toEqual([])
  })

  it('tick 7 phase 中捕获的 targetTick 7 与 Pause 都只在边界 8 生效，首次和重放一致', () => {
    const run = new ExtractionApplication(prototypeRules, { nextTick: 7, nextSequence: 10 })
    expect(run.beforePhase0(7).canAdvance).toBe(true)
    let pauseObservedDuringTick = false
    run.runPreparedTick({
      onPhase(phase) {
        if (phase === 4) {
          run.captureRuleCommand({
            targetTick: 7,
            type: 'SetFireSize',
            payload: { size: 0.9 },
          })
          run.captureApplicationControl({ type: 'Pause', payload: {} })
        }
        if (phase === 10) pauseObservedDuringTick = run.getReadModel().paused
      },
    })
    expect(pauseObservedDuringTick).toBe(false)
    run.beforePhase0(8)

    expect(run.getInputResults().map((result) => result.outcome)).toEqual([
      'APP_COMMAND_LATE',
      'applied',
    ])
    expect(run.getInputLog().map((entry) => entry.deliveryBoundaryTick)).toEqual([8, 8])

    const replay = new ExtractionApplication(prototypeRules, { nextTick: 8, nextSequence: 10 })
    replay.injectReplayBoundary(8, run.getInputLog())
    expect(replay.getInputLog()).toEqual(run.getInputLog())
    expect(replay.getInputResults()).toEqual(run.getInputResults())
    expect(replay.getPauseReasons()).toEqual(['manual'])
  })
})

describe('terminal 抽干与 reset cutover', () => {
  it('phase 10 抽干进入终态前 future，终态边界在 Again 前直接拒绝', () => {
    const app = new ExtractionApplication(prototypeRules, { domainState: extractingState() })
    app.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.2 } })
    app.beforePhase0(0)
    app.runPreparedTick({
      onPhase(phase) {
        if (phase === 9) return failedState()
      },
    })
    expect(app.getQueuedCommands()).toEqual([])
    expect(app.getInputResults()[0]?.outcome).toBe('APP_COMMAND_NOT_ALLOWED')

    app.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.7 } })
    app.beforePhase0(1)
    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'APP_COMMAND_NOT_ALLOWED',
      'APP_COMMAND_NOT_ALLOWED',
    ])
  })

  it('terminal future 抽干、下一边界拒绝与 Again 在首次和重放中一致', () => {
    const run = new ExtractionApplication(prototypeRules, { domainState: extractingState() })
    run.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.2 } })
    run.beforePhase0(0)
    run.runPreparedTick({
      onPhase(phase) {
        if (phase === 9) return failedState()
      },
    })
    run.captureRuleCommand({ targetTick: 1, type: 'SetFireSize', payload: { size: 0.7 } })
    run.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    run.beforePhase0(1)
    const archive = run.getSessionArchives()[0]!
    expect(archive.results.map((result) => result.outcome)).toEqual([
      'APP_COMMAND_NOT_ALLOWED',
      'APP_COMMAND_NOT_ALLOWED',
      'applied',
    ])

    const replay = new ExtractionApplication(prototypeRules, { domainState: extractingState() })
    replay.injectReplayBoundary(
      0,
      archive.inputLog.filter((entry) => entry.deliveryBoundaryTick === 0),
    )
    replay.runPreparedTick({
      onPhase(phase) {
        if (phase === 9) return failedState()
      },
    })
    replay.injectReplayBoundary(
      1,
      archive.inputLog.filter((entry) => entry.deliveryBoundaryTick === 1),
    )
    const replayArchive = replay.getSessionArchives()[0]!
    expect(replayArchive.inputLog).toEqual(archive.inputLog)
    expect(replayArchive.results).toEqual(archive.results)
    expect(replay.getQueuedCommands()).toEqual([])
  })

  it('失败的 confirm 不建立 cutover，后续规则仍继续按自身规则处理', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureApplicationControl({
      type: 'ConfirmRestart',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 0.75 } })
    app.beforePhase0(0)

    expect(app.getInputResults().map((result) => result.outcome)).toEqual([
      'APP_COMMAND_NOT_ALLOWED',
      'queued',
    ])
    app.runPreparedTick()
    expect(app.getReadModel().fireSize).toBe(0.75)
  })

  it('成功 reset 归档旧 session，按生命周期重建暂停原因，新 session 从 tick 0/sequence 1 开始', () => {
    const app = new ExtractionApplication(prototypeRules, {
      domainState: failedState(7),
      nextTick: 8,
      nextSequence: 20,
    })
    app.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'hidden' } },
    })
    app.captureRuleCommand({ targetTick: 8, type: 'SetFireSize', payload: { size: 0.9 } })
    app.beforePhase0(8)

    const archives = app.getSessionArchives()
    expect(archives).toHaveLength(1)
    expect(archives[0]).toMatchObject({
      sessionId: 'session-000001',
      lastCapturedSequence: 21,
      lastAppliedSequence: 20,
    })
    expect(archives[0]?.results.map((result) => result.outcome)).toEqual([
      'applied',
      'discardedByReset',
    ])
    expect(app.getSessionId()).toBe('session-000002')
    expect(app.getNextTick()).toBe(0)
    expect(app.getNextCaptureSequence()).toBe(1)
    expect(app.getInputLog()).toEqual([])
    expect(app.getPauseReasons()).toEqual(['hidden'])
    expect(app.getReadModel()).toMatchObject({
      status: 'ready',
      equippedFireSourceId: null,
      isSpraying: false,
    })
  })

  it('reset 丢弃此前已排队的 current 与 future 命令，并按 targetTick、sequence 归档', () => {
    const app = new ExtractionApplication(prototypeRules)
    app.captureRuleCommand({ targetTick: 0, type: 'SetFireSize', payload: { size: 0.4 } })
    app.captureRuleCommand({ targetTick: 2, type: 'SetFireSize', payload: { size: 0.8 } })
    app.captureApplicationControl({ type: 'RequestRestart', payload: {} })
    expect(app.beforePhase0(0).canAdvance).toBe(false)
    expect(app.getQueuedCommands().map(({ targetTick, sequence }) => [targetTick, sequence])).toEqual([
      [0, 1],
      [2, 2],
    ])

    app.captureApplicationControl({
      type: 'ConfirmRestart',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    app.beforePhase0(0)

    const archive = app.getSessionArchives()[0]!
    expect(archive.results.map((result) => result.outcome)).toEqual([
      'discardedByReset',
      'discardedByReset',
      'applied',
      'applied',
    ])
    expect(archive.discardedQueuedCommands).toEqual([
      { targetTick: 0, sequence: 1, type: 'SetFireSize' },
      { targetTick: 2, sequence: 2, type: 'SetFireSize' },
    ])
  })

  it('成功 cutover 后同批控制和 sequence-invalid 输入一律 discardedByReset', () => {
    const app = new ExtractionApplication(prototypeRules, {
      domainState: failedState(),
      nextSequence: 20,
    })

    app.injectReplayBoundary(0, [
      {
        channel: 'control',
        envelope: {
          sequence: 20,
          type: 'Again',
          payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
        },
      },
      { channel: 'control', envelope: { sequence: 21, type: 'Pause', payload: {} } },
      {
        channel: 'rule',
        envelope: {
          sequence: 21,
          targetTick: 0,
          type: 'SetFireSize',
          payload: { size: 0.9 },
        },
      },
    ])

    const archive = app.getSessionArchives()[0]!
    expect(archive.inputLog[2]?.sequenceValidation.valid).toBe(false)
    expect(archive.results.map((result) => result.outcome)).toEqual([
      'applied',
      'discardedByReset',
      'discardedByReset',
    ])
    expect(app.getPauseReasons()).toEqual([])
  })

  it('completed 终态可通过 Again 开始新 session', () => {
    const completed: DomainState = { ...createDomainState(prototypeRules), status: 'completed' }
    const app = new ExtractionApplication(prototypeRules, { domainState: completed })
    app.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })

    expect(app.beforePhase0(0)).toMatchObject({ resetCutover: true, canAdvance: false })
    expect(app.getReadModel()).toMatchObject({ status: 'ready', sessionId: 'session-000002' })
  })

  it('hidden reset 后 subsequent visible + focused 恢复可推进', () => {
    const app = new ExtractionApplication(prototypeRules, { domainState: failedState() })
    app.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'hidden' } },
    })
    app.beforePhase0(0)
    expect(app.getPauseReasons()).toEqual(['hidden'])

    app.captureApplicationControl({
      type: 'VisibilityChanged',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    expect(app.beforePhase0(0)).toMatchObject({ resetCutover: false, canAdvance: true })
    expect(app.getPauseReasons()).toEqual([])
  })

  it('visible + focused reset 后同一旧边界不推进，新 session 下一次 tick 0 可推进', () => {
    const app = new ExtractionApplication(prototypeRules, { domainState: failedState() })
    app.captureApplicationControl({
      type: 'Again',
      payload: { lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' } },
    })
    const cutover = app.beforePhase0(0)
    expect(cutover).toMatchObject({ canAdvance: false, resetCutover: true })
    expect(app.getPauseReasons()).toEqual([])
    expect(app.beforePhase0(0)).toMatchObject({ canAdvance: true, resetCutover: false })
  })

  it('三组具名 JSON cutover 向量首次运行与独立日志重放一致', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../../test-vectors/application/reset-cutover.json', import.meta.url),
        'utf8',
      ),
    ) as ResetCutoverFixture
    const vectors = fixture.vectors

    expect(fixture.schemaVersion).toBe(1)
    const fingerprintGolden = JSON.parse(
      readFileSync(
        new URL('../../../test-vectors/fingerprint/v1-golden.json', import.meta.url),
        'utf8',
      ),
    ) as Readonly<{ sha256: string }>
    expect(fixture.simulationContentFingerprint).toBe(fingerprintGolden.sha256)
    expect(Number.isSafeInteger(fixture.seed)).toBe(true)
    expect(fixture.criticalTicks).toHaveLength(3)
    expect(fixture.criticalTicks.map((entry) => entry.vectorName)).toEqual(
      vectors.map((vector) => vector.name),
    )
    expect(fixture.final).toHaveProperty('domainEvents')
    expect(fixture.final).toHaveProperty('settlement')

    expect(vectors.map((vector) => vector.name)).toEqual([
      'reset-cutover-active-batch',
      'reset-cutover-terminal-first',
      'reset-cutover-terminal-prefix',
    ])

    const actualCriticalTicks: ResetCutoverFixture['criticalTicks'][number][] = []
    const actualFinals: ResetCutoverFixture['final'][] = []

    for (const vector of vectors) {
      expect(vector.randomness).toEqual({ draws: 0, applicability: 'notApplicable' })
      const initialDomain =
        vector.initialStatus === 'failed'
          ? failedState(vector.deliveryBoundaryTick - 1)
          : extractingState(vector.deliveryBoundaryTick - 1)
      const run = new ExtractionApplication(prototypeRules, {
        domainState: initialDomain,
        nextTick: vector.deliveryBoundaryTick,
        nextSequence: vector.firstSequence,
        restartConfirmation: vector.restartConfirmation,
      })
      for (const input of vector.inputs) {
        if (input.channel === 'rule') {
          run.captureRuleCommand(input.envelope)
        } else {
          run.captureApplicationControl(input.envelope)
        }
      }
      run.beforePhase0(vector.deliveryBoundaryTick)
      const archive = run.getSessionArchives()[0]!

      expect(archive.results.map((result) => result.outcome)).toEqual(vector.expectedOutcomes)
      actualCriticalTicks.push({
        vectorName: vector.name,
        deliveryBoundaryTick: vector.deliveryBoundaryTick,
        state: {
          sessionId: run.getSessionId(),
          status: run.getReadModel().status,
          nextTick: run.getNextTick(),
          queuedCommandCount: run.getQueuedCommands().length,
        },
      })
      actualFinals.push({
        domainEvents: [],
        settlement: {
          status: run.getReadModel().status,
          archivedSessionCount: run.getSessionArchives().length,
          queuedCommandCount: run.getQueuedCommands().length,
        },
      })

      const replay = new ExtractionApplication(prototypeRules, {
        domainState: initialDomain,
        nextTick: vector.deliveryBoundaryTick,
        nextSequence: vector.firstSequence,
        restartConfirmation: vector.restartConfirmation,
      })
      replay.injectReplayBoundary(
        vector.deliveryBoundaryTick,
        archive.inputLog as readonly InputLogEntry[],
      )
      const replayArchive = replay.getSessionArchives()[0]!

      expect(replayArchive.inputLog).toEqual(archive.inputLog)
      expect(replayArchive.results).toEqual(archive.results)
    }

    expect(actualCriticalTicks).toEqual(fixture.criticalTicks)
    expect(actualFinals.every((actual) => JSON.stringify(actual) === JSON.stringify(fixture.final))).toBe(
      true,
    )

    const tamperedCriticalTicks = fixture.criticalTicks.map((item) => ({
      ...item,
      state: {
        sessionId: 'wrong-session',
        status: 'completed',
        nextTick: 999,
        queuedCommandCount: 999,
      },
    }))
    const tamperedFinal = {
      domainEvents: [{ type: 'WRONG', sequence: 999 }],
      settlement: {
        status: 'completed',
        archivedSessionCount: 999,
        queuedCommandCount: 999,
      },
    } as const
    expect(actualCriticalTicks).not.toEqual(tamperedCriticalTicks)
    expect(actualFinals).not.toContainEqual(tamperedFinal)
  })

})
