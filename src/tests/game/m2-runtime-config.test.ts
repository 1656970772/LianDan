import { describe, expect, it } from 'vitest'

import type {
  DecodedCompositionMap,
  NormalizedM2Config,
} from '../../config/index.ts'
import { createM2RuntimeConfiguration } from '../../game/extraction/runtime-config.ts'
import { createDomainState } from '../../domain/index.ts'
import { ExtractionSimulation } from '../../simulation/index.ts'

const config: NormalizedM2Config = {
  schemaVersion: 1,
  base: {
    schemaVersion: 1,
    parameters: {
      standardPearlVolume: 2,
      slagUnitVolume: 200,
      simulation: { fixedStepHz: 30, maxCatchUpSteps: 5 },
      flowField: {
        gridColumns: 80,
        gridRows: 45,
        cellSize: 20,
        circleCoverageSamplesPerAxis: 4,
        lateralSpread: 0.35,
        obstacleDeflection: 0.75,
        partialObstaclePenalty: 0.5,
        mergeRate: 0.15,
        fullObstacleThreshold: 0.95,
      },
      dissolution: { volumePerTick: 0.18, exposureProbeDistance: 18 },
    },
    materials: [
      {
        id: 'prototype-herb',
        nameZh: '青岚草',
        appearancePath: '/assets/materials/prototype-herb.png',
        targetPearlCount: 3,
        compositionMapPath: '/assets/masks/prototype-herb-components.png',
      },
    ],
  },
  gameplay: {
    schemaVersion: 1,
    prototype: {
      seed: 42,
      logicalWidth: 1600,
      logicalHeight: 900,
      materialPlacement: {
        centerX: 800,
        centerY: 300,
        size: 180,
        offsetPerInstance: { x: 200, y: 0 },
        rotationDegreesPerInstance: 2,
      },
      availableFireSourceIds: ['basic-fire'],
      initialFireSize: 32,
      fireSizeWheelStep: 4,
      initialFireDirection: { x: 0, y: -1 },
      theme: {
        colors: {
          background: '#12100E',
          surface: '#201C18',
          surfaceRaised: '#2C2620',
          border: '#594B3D',
          text: '#F4EBDD',
          muted: '#B8AA98',
          accent: '#D19A45',
          danger: '#C65D4B',
          focus: '#F2C66D',
        },
        radius: 8,
      },
      inventoryBatches: [
        {
          batchId: 'prototype-herb-batch',
          materialDefinitionId: 'prototype-herb',
          servings: 3,
        },
      ],
    },
    fireSources: [
      {
        id: 'basic-fire',
        nameZh: '凡火',
        origin: { x: 800, y: 700 },
        halfAngleDegrees: 70,
        minWidth: 24,
        maxWidth: 280,
      },
    ],
    pearlType: {
      id: 'medicinal-liquid',
      pearlType: 'medicinalLiquid',
      standardRadius: 24,
      spawnVelocity: { minX: -40, maxX: 20, minY: 60, maxY: 120 },
      gravity: 350,
      drift: 12,
      maxSpeed: 500,
      materialRestitution: 0.25,
    },
    collector: {
      initialX: 800,
      y: 820,
      width: 180,
      height: 48,
      minX: 160,
      maxX: 1440,
      acceleration: 1200,
      deceleration: 1600,
      maxSpeed: 500,
    },
  },
}

function compositionMap(): DecodedCompositionMap {
  const rgba = new Uint8Array(64 * 64 * 4)
  rgba.set([0, 255, 255, 255], (32 * 64 + 32) * 4)
  return {
    filePath: '/assets/masks/prototype-herb-components.png',
    width: 64,
    height: 64,
    rgba,
  }
}

describe('M2 配置到权威运行时映射', () => {
  it('唯一体积来源、流场参数与 64x64 成分遮罩保持配置语义', () => {
    const result = createM2RuntimeConfiguration(config, [compositionMap()])

    expect(result.rules).toMatchObject({
      availableFireSourceIds: ['basic-fire'],
      initialFireSize: 32,
      inventoryBatches: [
        {
          batchId: 'prototype-herb-batch',
          materialDefinitionId: 'prototype-herb',
          servings: 3,
          volumePerServing: 6,
        },
      ],
    })
    expect(result.simulation).toMatchObject({
      seed: 42,
      standardPearlVolume: 2,
      fixedDeltaSeconds: 1 / 30,
      dissolutionVolumePerTick: 0.18,
      exposureProbeDistance: 18,
      fireFlow: {
        geometry: { columns: 80, rows: 45, cellSize: 20 },
      },
      materialPlacement: {
        center: { x: 800, y: 300 },
        width: 180,
        height: 180,
        offsetPerInstance: { x: 200, y: 0 },
        rotationRadiansPerInstance: (2 * Math.PI) / 180,
      },
      fireSource: {
        origin: { x: 800, y: 700 },
        halfAngleRadians: (70 * Math.PI) / 180,
      },
      pearlPhysics: {
        medicinalLiquid: {
          spawnVelocity: { minX: -40, maxX: 20, minY: 60, maxY: 120 },
          materialRestitution: 0.25,
        },
      },
      worldBounds: { left: 0, top: 0, right: 1600, bottom: 900 },
    })
    expect(result.simulation.materials[0]?.composition[32 * 64 + 32]).toBe(1)
    expect(result.simulation.materials[0]?.composition[0]).toBe(0)
  })

  it('缺少材料已登记的成分图时稳定拒绝，不用空遮罩继续运行', () => {
    expect(() => createM2RuntimeConfiguration(config, [])).toThrow(
      'M2_COMPOSITION_MAP_MISSING:/assets/masks/prototype-herb-components.png',
    )
  })

  it('防御性拒绝非药液青成分，不按 alpha 静默映射为药液', () => {
    const map = compositionMap()
    map.rgba.set([128, 0, 128, 255], (32 * 64 + 32) * 4)

    expect(() => createM2RuntimeConfiguration(config, [map])).toThrow(
      'M2_COMPOSITION_MAP_UNSUPPORTED_COLOR:/assets/masks/prototype-herb-components.png:/pixels/32/32',
    )
  })

  it('多份材料按映射后的 offset/rotation 分层摆放，流场障碍不再精确重合', () => {
    const runtime = createM2RuntimeConfiguration(config, [compositionMap()])
    const simulation = new ExtractionSimulation(runtime.simulation)
    const baseState = createDomainState(runtime.rules)
    const state = {
      ...baseState,
      status: 'extracting' as const,
      materialInstances: [0, 1, 2].map((index) => ({
        materialInstanceId: `material-${index}`,
        materialDefinitionId: 'prototype-herb',
        inventoryBatchId: 'prototype-herb-batch',
        initialVolume: 6,
        remainingVolume: 6,
      })),
    }
    simulation.beginTick({ tick: 0, domainState: state })
    for (let phase = 1; phase <= 7; phase += 1) {
      simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
    }
    simulation.buildCandidate()
    simulation.commitTick()

    expect(simulation.read().materials.map(({ placement }) => placement)).toMatchObject([
      { center: { x: 800, y: 300 }, rotationRadians: 0 },
      { center: { x: 1000, y: 300 }, rotationRadians: (2 * Math.PI) / 180 },
      { center: { x: 1200, y: 300 }, rotationRadians: (4 * Math.PI) / 180 },
    ])
    const obstacle = simulation.read().fireFlow.obstacle
    expect(obstacle[15 * 80 + 40]).toBeGreaterThan(0)
    expect(obstacle[15 * 80 + 50]).toBeGreaterThan(0)
    expect(obstacle[15 * 80 + 60]).toBeGreaterThan(0)
  })
})
