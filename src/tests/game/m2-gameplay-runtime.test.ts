import { describe, expect, it } from 'vitest'

import { M2GameplayRuntime } from '../../game/extraction/gameplay-runtime.ts'
import type { PrototypeRules } from '../../domain/index.ts'
import type { ExtractionSimulationConfig } from '../../simulation/index.ts'

const rules: PrototypeRules = {
  availableFireSourceIds: ['fire.basic'],
  initialFireSize: 30,
  initialFireDirection: { x: 0, y: -1 },
  inventoryBatches: [
    {
      batchId: 'batch.herb',
      materialDefinitionId: 'material.herb',
      servings: 1,
      volumePerServing: 1,
    },
  ],
}

function simulationConfig(): ExtractionSimulationConfig {
  const composition = new Uint8Array(64 * 64)
  composition[32 * 64 + 32] = 1
  return {
    seed: 42,
    standardPearlVolume: 1,
    fixedDeltaSeconds: 1 / 30,
    dissolutionVolumePerTick: 1,
    exposureProbeDistance: 2,
    fireFlow: {
      geometry: {
        columns: 16,
        rows: 16,
        cellSize: 8,
        originX: 0,
        originY: 0,
      },
      solver: {
        circleCoverageSamplesPerAxis: 2,
        lateralSpread: 0.35,
        obstacleDeflection: 0.8,
        partialObstaclePenalty: 0.45,
        mergeRate: 0.35,
        fullObstacleThreshold: 0.98,
      },
    },
    materials: [
      {
        id: 'material.herb',
        targetPearlCount: 1,
        composition,
      },
    ],
    materialPlacement: {
      center: { x: 64, y: 48 },
      width: 8,
      height: 8,
      offsetPerInstance: { x: 0, y: 0 },
      rotationRadiansPerInstance: 0,
    },
    fireSource: {
      origin: { x: 64, y: 112 },
      halfAngleRadians: Math.PI / 3,
      minWidth: 8,
      maxWidth: 48,
    },
    pearlPhysics: {
      medicinalLiquid: {
        radiusAtStandardVolume: 3,
        spawnVelocity: { minX: 0, maxX: 0, minY: 40, maxY: 40 },
        gravity: 0,
        driftX: 0,
        maxSpeed: 100,
        materialRestitution: 0.25,
      },
      slag: {
        radiusAtStandardVolume: 3,
        spawnVelocity: { minX: 0, maxX: 0, minY: 40, maxY: 40 },
        gravity: 0,
        driftX: 0,
        maxSpeed: 100,
        materialRestitution: 0.25,
      },
      impurity: {
        radiusAtStandardVolume: 3,
        spawnVelocity: { minX: 0, maxX: 0, minY: 40, maxY: 40 },
        gravity: 0,
        driftX: 0,
        maxSpeed: 100,
        materialRestitution: 0.25,
      },
    },
    collector: {
      initialCenter: { x: 64, y: 120 },
      width: 40,
      height: 8,
      trackMinX: 24,
      trackMaxX: 104,
      acceleration: 120,
      deceleration: 160,
      maxSpeed: 50,
    },
    worldBounds: { left: 0, top: 0, right: 128, bottom: 128 },
  }
}

describe('M2 玩法运行时适配器', () => {
  it('把规则命令送到下一 tick，并只向 Phaser 排出一次已提交事件', () => {
    const runtime = new M2GameplayRuntime({
      rules,
      simulationConfig: simulationConfig(),
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })

    runtime.frame(0)
    runtime.captureRuleCommand({
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'batch.herb' },
    })
    runtime.captureRuleCommand({ type: 'AddSelectedMaterial', payload: {} })
    runtime.frame(34)

    expect(runtime.snapshot().domain.materialInstances).toHaveLength(1)
    expect(runtime.drainDomainEvents()).toEqual([
      expect.objectContaining({
        type: 'MaterialAdded',
        tick: 0,
        materialInstanceId: 'material-instance-1',
      }),
    ])
    expect(runtime.drainDomainEvents()).toEqual([])
    expect(runtime.getSessionArchives()).toEqual([])
    expect('getApplication' in runtime).toBe(false)
  })

  it('控制命令保留 control pump 语义并能在暂停时恢复', () => {
    const runtime = new M2GameplayRuntime({
      rules,
      simulationConfig: simulationConfig(),
      tickRateHz: 30,
      maxCatchUpSteps: 5,
    })

    runtime.frame(0)
    runtime.frame(34)
    runtime.captureControl({ type: 'Pause', payload: {} })
    runtime.frame(68)
    expect(runtime.snapshot().application.paused).toBe(true)

    runtime.captureControl({ type: 'Resume', payload: {} })
    runtime.frame(69)
    expect(runtime.snapshot().application).toMatchObject({
      paused: false,
      nextTick: 2,
    })
  })
})
