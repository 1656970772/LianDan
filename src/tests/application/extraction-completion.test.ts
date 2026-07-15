import { describe, expect, it } from 'vitest'

import { ExtractionRuntime } from '../../application/extraction-runtime.ts'
import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader.ts'
import type { PrototypeRules } from '../../domain/index.ts'
import { createM2RuntimeConfiguration } from '../../game/extraction/runtime-config.ts'
import {
  ExtractionSimulation,
  type ExtractionSimulationConfig,
} from '../../simulation/index.ts'

const rules: PrototypeRules = {
  availableFireSourceIds: ['fire.basic'],
  initialFireSize: 100,
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

function simulationConfig(): ExtractionSimulationConfig {
  const composition = new Uint8Array(64 * 64)
  composition[32 * 64 + 31] = 1
  composition[32 * 64 + 32] = 1
  composition[32 * 64 + 33] = 1
  const pearlPhysics = {
    radiusAtStandardVolume: 2,
    spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    gravity: 0,
    driftX: 0,
    maxSpeed: 40,
    materialRestitution: 0.2,
    wallRestitution: 0.2,
    fireProtectionSeconds: 10,
    resetProtectionOnExit: true,
    burnDurationSeconds: 60,
    thrustAcceleration: 0,
  }
  return {
    seed: 42,
    standardPearlVolume: 1,
    fixedDeltaSeconds: 1 / 30,
    dissolutionVolumePerTick: 0.1,
    exposureProbeDistance: 2,
    naturalLossRatePerMinute: 0,
    safeZoneY: 112,
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
    materials: [{ id: 'material.herb', targetPearlCount: 1, composition }],
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
      medicinalLiquid: pearlPhysics,
      slag: pearlPhysics,
      impurity: pearlPhysics,
    },
    collector: {
      initialCenter: { x: 64, y: 50 },
      width: 40,
      height: 20,
      trackMinX: 24,
      trackMaxX: 104,
      acceleration: 120,
      deceleration: 160,
      maxSpeed: 50,
    },
    worldBounds: { left: 0, top: 0, right: 128, bottom: 128 },
  }
}

describe('M2 application + ExtractionSimulation 完成闭环', () => {
  it('M3 正式三成分图在自然损耗后不会让领域与模拟材料余量分叉', async () => {
    const loaded = await loadAndValidatePublicM2GameplayConfig(process.cwd())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
    const production = createM2RuntimeConfiguration(
      loaded.config,
      loaded.compositionMaps,
    )
    const runtime = new ExtractionRuntime({
      rules: production.rules,
      simulation: new ExtractionSimulation(production.simulation),
      tickRateHz: loaded.config.base.parameters.simulation.fixedStepHz,
      maxCatchUpSteps:
        loaded.config.base.parameters.simulation.maxCatchUpSteps,
    })

    runtime.frame(0)
    let frameTime = 34
    for (let frame = 0; frame < 60; frame += 1) {
      runtime.frame(frameTime)
      frameTime += 34
    }
    const targetTick = runtime.snapshot().application.nextTick
    runtime.captureRuleCommand({
      type: 'PreselectMaterial',
      payload: { inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10' },
      targetTick,
    })
    runtime.captureRuleCommand({
      type: 'AddSelectedMaterial',
      payload: {},
      targetTick,
    })
    runtime.frame(frameTime)
    frameTime += 34
    const afterAddition = runtime.snapshot()
    expect(afterAddition.domain.materialInstances).toHaveLength(1)
    expect(afterAddition.simulation.materials[0]!.remainingVolume).toBe(
      afterAddition.domain.materialInstances[0]!.remainingVolume,
    )

    expect(() => runtime.frame(frameTime)).not.toThrow()
    expect(runtime.snapshot().application.nextTick).toBeGreaterThan(targetTick + 1)
  })

  it('M3 自然损耗提交后下一 tick 仍能同步同一材料并继续推进', () => {
    const baseConfig = simulationConfig()
    const runtime = new ExtractionRuntime({
      rules,
      simulation: new ExtractionSimulation({
        ...baseConfig,
        naturalLossRatePerMinute: 0.01,
      }),
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
    runtime.frame(34)
    const afterFirstLoss = runtime.snapshot().domain.materialInstances[0]!

    expect(afterFirstLoss.remainingVolume).toBeLessThan(1)
    expect(() => runtime.frame(68)).not.toThrow()
    expect(runtime.snapshot().application.nextTick).toBeGreaterThan(1)
    expect(
      runtime.snapshot().domain.materialInstances[0]!.remainingVolume,
    ).toBeLessThan(afterFirstLoss.remainingVolume)
  })

  it('材料格清空且珠全部终结后，把权威材料体积归零并开放结束', () => {
    const simulation = new ExtractionSimulation(simulationConfig())
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

    let frameTime = 68
    for (let frame = 0; frame < 100; frame += 1) {
      runtime.frame(frameTime)
      frameTime += 34
      const snapshot = runtime.snapshot()
      const activePearlCount = Object.keys(snapshot.domain.ledger.pearlVolumes).filter(
        (pearlId) => snapshot.domain.ledger.terminalPearls[pearlId] === undefined,
      ).length
      if (
        snapshot.simulation.materials[0]?.remainingCellVolumes.every(
          (volume) => volume === 0,
        ) &&
        activePearlCount === 0
      ) {
        break
      }
    }

    const snapshot = runtime.snapshot()
    expect(snapshot.simulation.materials[0]).toMatchObject({
      remainingVolume: 0,
      remainingCellVolumes: expect.arrayContaining([0]),
    })
    expect(snapshot.domain.materialInstances[0]?.remainingVolume).toBe(0)
    expect(
      Object.keys(snapshot.domain.ledger.pearlVolumes).filter(
        (pearlId) => snapshot.domain.ledger.terminalPearls[pearlId] === undefined,
      ),
    ).toHaveLength(0)
    expect(snapshot.application.canFinish).toBe(true)
  })

  it('1e-10 总体积经 4096 格累计舍入后仍能完整烧尽并开放结束', () => {
    const tinyVolume = 1e-10
    const tinyComposition = new Uint8Array(64 * 64).fill(1)
    const tinyRules: PrototypeRules = {
      ...rules,
      inventoryBatches: [
        {
          ...rules.inventoryBatches[0]!,
          volumePerServing: tinyVolume,
          medicinalLiquidVolumePerServing: tinyVolume,
        },
      ],
    }
    const baseConfig = simulationConfig()
    const simulation = new ExtractionSimulation({
      ...baseConfig,
      standardPearlVolume: tinyVolume,
      dissolutionVolumePerTick: 1e-11,
      materials: [
        {
          id: 'material.herb',
          targetPearlCount: 1,
          composition: tinyComposition,
        },
      ],
    })
    const runtime = new ExtractionRuntime({
      rules: tinyRules,
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

    let frameTime = 68
    for (let frame = 0; frame < 100; frame += 1) {
      runtime.frame(frameTime)
      frameTime += 34
      if (runtime.snapshot().application.canFinish) break
    }

    const snapshot = runtime.snapshot()
    const activePearlIds = Object.keys(snapshot.domain.ledger.pearlVolumes).filter(
      (pearlId) => snapshot.domain.ledger.terminalPearls[pearlId] === undefined,
    )
    expect(snapshot.simulation.materials[0]?.remainingVolume).toBe(0)
    expect(snapshot.domain.materialInstances[0]?.remainingVolume).toBe(0)
    expect(activePearlIds).toHaveLength(0)
    expect(snapshot.application.canFinish).toBe(true)
  })
})
