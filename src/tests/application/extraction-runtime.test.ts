import { describe, expect, it } from 'vitest'

import {
  ExtractionRuntime,
  type ExtractionSimulationPhase,
  type ExtractionSimulationPort,
} from '../../application/extraction-runtime.ts'
import type { DomainState, PrototypeRules } from '../../domain/index.ts'
import type { SimulationDelta } from '../../simulation/index.ts'

const rules: PrototypeRules = {
  fixedDeltaSeconds: 1 / 30,
  availableFireSourceIds: ['fire.basic'],
  fireSources: [
    {
      id: 'fire.basic',
      baseTemperature: 8,
      maximumTemperature: 100,
      heatingRatePerSecond: 24,
      coolingRatePerSecond: 10,
      temperatureCurve: 'linear',
    },
  ],
  initialFireSize: 30,
  initialFireDirection: { x: 0, y: -1 },
  inventoryBatches: [
    {
      batchId: 'batch.herb',
      materialDefinitionId: 'material.herb',
      servings: 1,
      volumePerServing: 1,
      medicinalLiquidVolumePerServing: 1,
    },
  ],
  settlement: {
    warningThresholds: [0.5, 0.65],
    failureThreshold: 0.7,
    slagUnitVolume: 100,
  },
}

class FakeSimulation implements ExtractionSimulationPort<Readonly<{ generation: number }>> {
  generation = 0
  begunTicks: number[] = []
  phases: number[] = []
  commits = 0
  rollbacks = 0
  resets = 0
  invalidDelta = false
  throwOnCommit = false

  beginTick(input: Readonly<{ tick: number; domainState: DomainState }>): void {
    this.begunTicks.push(input.tick)
  }

  runPhase(phase: ExtractionSimulationPhase, _state: DomainState): void {
    this.phases.push(phase)
  }

  buildCandidate(): SimulationDelta {
    const tick = this.begunTicks.at(-1) ?? 0
    return {
      tick: this.invalidDelta ? tick + 1 : tick,
      dissolutions: [],
      births: [],
      pearlVolumeChanges: [],
      terminalOutcomes: [],
      naturalLosses: [],
      inheritedLosses: [],
    }
  }

  commitTick(): void {
    this.commits += 1
    if (this.throwOnCommit) throw new Error('SIM_COMMIT_FAILED')
    this.generation += 1
  }

  rollbackTick(): void {
    this.rollbacks += 1
  }

  reset(): void {
    this.resets += 1
    this.generation = 0
  }

  read(): Readonly<{ generation: number }> {
    return { generation: this.generation }
  }
}

describe('M2 application/simulation 运行时编排', () => {
  it('无可见状态变化时复用已冻结的 snapshot 及空事件视图', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })

    const first = runtime.snapshot()
    const second = runtime.snapshot()

    expect(second).toBe(first)
    expect(second.application).toBe(first.application)
    expect(second.simulation).toBe(first.simulation)
    expect(second.events).toBe(first.events)
    expect(second.clock).toBe(first.clock)
    expect(Object.isFrozen(second)).toBe(true)
    expect(Object.isFrozen(second.events)).toBe(true)

    for (let frame = 0; frame < 10_000; frame += 1) runtime.frame(0)
    const rebased = runtime.snapshot()
    expect(rebased).toBe(first)
    expect(runtime.snapshot()).toBe(rebased)

    runtime.frame(34)
    const advanced = runtime.snapshot()
    expect(advanced).not.toBe(rebased)
    expect(runtime.snapshot()).toBe(advanced)
  })

  it('固定步只在 application 成功提交后提交 simulation 候选', () => {
    const simulation = new FakeSimulation()
    const commits: number[] = []
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
      onCommitted: (snapshot) => commits.push(snapshot.application.nextTick),
    })

    runtime.frame(0)
    runtime.frame(34)

    expect(simulation.begunTicks).toEqual([0])
    expect(simulation.phases).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(simulation.commits).toBe(1)
    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 1, paused: false },
      simulation: { generation: 1 },
    })
    expect(commits).toEqual([1])
  })

  it('Pause 停 tick 后仍能由 control pump Resume，并立即完成已准备边界', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    runtime.frame(34)
    runtime.captureControl({ type: 'Pause', payload: {} })
    runtime.frame(68)

    expect(runtime.snapshot().application).toMatchObject({
      nextTick: 1,
      paused: true,
      pauseReasons: ['manual'],
    })
    expect(simulation.commits).toBe(1)

    runtime.captureControl({ type: 'Resume', payload: {} })
    runtime.frame(69)

    expect(runtime.snapshot().application).toMatchObject({
      nextTick: 2,
      paused: false,
    })
    expect(simulation.commits).toBe(2)
  })

  it('确认重开在停 tick 时原子 reset simulation，并建立新 session', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    runtime.frame(34)
    runtime.captureControl({ type: 'RequestRestart', payload: {} })
    runtime.frame(68)
    expect(runtime.snapshot().application.restartConfirmation).toBe('open')

    runtime.captureControl({
      type: 'ConfirmRestart',
      payload: {
        lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' },
      },
    })
    runtime.frame(69)

    expect(simulation.resets).toBe(1)
    expect(runtime.snapshot()).toMatchObject({
      application: {
        sessionId: 'session-000002',
        nextTick: 0,
        restartConfirmation: 'closed',
        paused: false,
      },
      simulation: { generation: 0 },
    })
    expect(runtime.getSessionArchives()).toHaveLength(1)
    expect('getApplication' in runtime).toBe(false)
  })

  it('连续三次重开原子清空命令队列、clock、实体、装备、库存与台账基线', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    let frameTime = 0
    const initial = runtime.snapshot()
    const { sessionId: _initialSessionId, ...initialApplicationBaseline } =
      initial.application
    const sessionIds = new Set([initial.application.sessionId])

    for (let restartIndex = 0; restartIndex < 3; restartIndex += 1) {
      const targetTick = runtime.snapshot().application.nextTick
      runtime.captureRuleCommand({
        type: 'SelectFireSource',
        payload: { fireSourceId: 'fire.basic' },
        targetTick,
      })
      runtime.captureRuleCommand({
        type: 'SetFireSize',
        payload: { size: 80 },
        targetTick,
      })
      runtime.captureRuleCommand({
        type: 'SetFlameThrust',
        payload: { enabled: true },
        targetTick,
      })
      runtime.captureRuleCommand({
        type: 'PreselectMaterial',
        payload: { inventoryBatchId: 'batch.herb' },
        targetTick,
      })
      runtime.captureRuleCommand({
        type: 'AddSelectedMaterial',
        payload: {},
        targetTick,
      })

      for (let frame = 0; frame < 2; frame += 1) {
        if (runtime.snapshot().application.nextTick > targetTick) break
        frameTime += 34
        runtime.frame(frameTime)
      }
      expect(runtime.snapshot()).toMatchObject({
        application: {
          equippedFireSourceId: 'fire.basic',
          fireSize: 80,
          nextTick: 1,
        },
        domain: {
          flameThrustEnabled: true,
          inventory: { 'batch.herb': 0 },
          materialInstances: [{ inventoryBatchId: 'batch.herb' }],
          status: 'extracting',
        },
        clock: { totalAdvancedTickCount: 1 },
        simulation: { generation: 1 },
      })

      runtime.captureRuleCommand({
        type: 'SetFireSize',
        payload: { size: 99 },
        targetTick: runtime.snapshot().application.nextTick + 10,
      })
      runtime.captureControl({ type: 'RequestRestart', payload: {} })
      frameTime += 34
      runtime.frame(frameTime)
      expect(runtime.snapshot().application.restartConfirmation).toBe('open')

      runtime.captureControl({
        type: 'ConfirmRestart',
        payload: {
          lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' },
        },
      })
      frameTime += 1
      runtime.frame(frameTime)

      const restarted = runtime.snapshot()
      const { sessionId, ...applicationBaseline } = restarted.application
      expect(sessionIds.has(sessionId)).toBe(false)
      sessionIds.add(sessionId)
      expect(applicationBaseline).toEqual(initialApplicationBaseline)
      expect(restarted.domain).toEqual(initial.domain)
      expect(restarted.simulation).toEqual(initial.simulation)
      expect(restarted.events).toEqual([])
      expect(restarted.clock).toEqual({
        droppedTickCount: 0,
        totalAdvancedTickCount: 0,
      })
      expect(runtime.getSessionArchives()).toHaveLength(restartIndex + 1)
      expect(
        runtime
          .getSessionArchives()
          .at(-1)!
          .results.map(({ outcome }) => outcome),
      ).toContain('discardedByReset')
    }

    expect(simulation.resets).toBe(3)
    expect(sessionIds.size).toBe(4)
  })

  it('phase 8 拒绝 delta 时 rollback simulation，application 保持同一 prepared tick', () => {
    const simulation = new FakeSimulation()
    simulation.invalidDelta = true
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)

    expect(() => runtime.frame(34)).toThrow('SIM_DELTA_INVALID_TICK')
    expect(simulation.commits).toBe(0)
    expect(simulation.rollbacks).toBe(1)
    expect(runtime.snapshot().application.nextTick).toBe(0)
  })

  it('simulation 最终提交抛错时 application 与 simulation 一起回滚到 tick 前', () => {
    const simulation = new FakeSimulation()
    simulation.throwOnCommit = true
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    runtime.captureRuleCommand({
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
      targetTick: 0,
    })
    runtime.captureRuleCommand({
      type: 'AddSelectedMaterial',
      payload: {},
      targetTick: 0,
    })

    expect(() => runtime.frame(34)).toThrow('SIM_COMMIT_FAILED')
    expect(simulation).toMatchObject({ commits: 1, rollbacks: 1, generation: 0 })
    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 0 },
      domain: { materialInstances: [] },
      simulation: { generation: 0 },
      clock: { totalAdvancedTickCount: 0 },
    })
  })

  it('catch-up 中首个提交后 Pause 时只计真实提交且暂停不记 dropped', () => {
    const simulation = new FakeSimulation()
    let runtime!: ExtractionRuntime<Readonly<{ generation: number }>>
    runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
      onCommitted: (snapshot) => {
        if (snapshot.application.nextTick === 1) {
          runtime.captureControl({ type: 'Pause', payload: {} })
        }
      },
    })
    runtime.frame(0)

    runtime.frame(1_000)

    expect(simulation.commits).toBe(1)
    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 1, paused: true },
      clock: { totalAdvancedTickCount: 1, droppedTickCount: 0 },
    })
  })

  it('生命周期 hidden/visible 在无 frame 窗口内往返时重建时钟基线', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    runtime.frame(34)

    runtime.captureControl({
      type: 'VisibilityChanged',
      payload: {
        lifecycleSnapshot: { hasFocus: false, visibilityState: 'hidden' },
      },
    })
    runtime.captureControl({
      type: 'VisibilityChanged',
      payload: {
        lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' },
      },
    })

    runtime.frame(10_034)

    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 1, paused: false },
      clock: { totalAdvancedTickCount: 1, droppedTickCount: 0 },
    })
    expect(simulation.commits).toBe(1)

    runtime.frame(10_068)

    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 2, paused: false },
      clock: { totalAdvancedTickCount: 2, droppedTickCount: 0 },
    })
    expect(simulation.commits).toBe(2)
  })

  it('生命周期恢复后不自动重启喷火', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)
    runtime.captureRuleCommand({
      type: 'SelectFireSource',
      payload: { fireSourceId: 'fire.basic' },
      targetTick: 0,
    })
    runtime.frame(34)
    runtime.captureRuleCommand({
      type: 'SetSpraying',
      payload: { spraying: true },
      targetTick: 1,
    })
    runtime.frame(68)
    expect(runtime.snapshot().application.isSpraying).toBe(true)

    runtime.captureControl({
      type: 'VisibilityChanged',
      payload: {
        lifecycleSnapshot: { hasFocus: false, visibilityState: 'hidden' },
      },
    })
    runtime.captureControl({
      type: 'VisibilityChanged',
      payload: {
        lifecycleSnapshot: { hasFocus: true, visibilityState: 'visible' },
      },
    })
    runtime.frame(10_068)
    runtime.frame(10_102)

    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 3, paused: false, isSpraying: false },
      clock: { totalAdvancedTickCount: 3, droppedTickCount: 0 },
    })
    expect(simulation.commits).toBe(3)
  })

  it('非生命周期 control 不重建时钟基线', () => {
    const simulation = new FakeSimulation()
    const runtime = new ExtractionRuntime({
      rules,
      simulation,
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })
    runtime.frame(0)

    runtime.captureControl({ type: 'Resume', payload: {} })
    runtime.frame(34)

    expect(runtime.snapshot()).toMatchObject({
      application: { nextTick: 1, paused: false },
      clock: { totalAdvancedTickCount: 1, droppedTickCount: 0 },
    })
    expect(simulation.commits).toBe(1)
  })
})
