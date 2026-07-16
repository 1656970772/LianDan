import { describe, expect, it } from 'vitest'

import type {
  DecodedCompositionMap,
  NormalizedM2Config,
} from '../../config/index.ts'
import { createM2RuntimeConfiguration } from '../../game/extraction/runtime-config.ts'
import { createDomainState } from '../../domain/index.ts'
import { ExtractionSimulation } from '../../simulation/index.ts'
import { deriveMaterialContentRectangle } from '../../shared/material-content-geometry.ts'
import { validM5Presentation } from '../fixtures/m5-presentation.ts'

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
      dissolution: {
        volumePerTick: 0.18,
        exposureProbeDistance: 18,
        frontLaneWidthCells: 1,
      },
      loss: {
        naturalRatePerMinute: 0.01,
        warningThresholds: [0.5, 0.65],
        failureThreshold: 0.7,
      },
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
        visibleLongEdge: 170,
        minimumGap: 4,
        usableRegion: { left: 0, top: 0, right: 1600, bottom: 900 },
        slots: [
          { centerX: 800, centerY: 300, rotationDegrees: 0 },
          { centerX: 1000, centerY: 300, rotationDegrees: 2 },
          { centerX: 1200, centerY: 300, rotationDegrees: 4 },
        ],
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
        descriptionZh: '丹炉常用的基础火种。',
        origin: { x: 800, y: 700 },
        halfAngleDegrees: 70,
        minWidth: 24,
        maxWidth: 280,
        baseTemperature: 8,
        maximumTemperature: 100,
        heatingRatePerSecond: 24,
        coolingRatePerSecond: 10,
        temperatureCurve: 'linear',
      },
    ],
    pearlTypes: [
      {
        id: 'medicinal-liquid',
        pearlType: 'medicinalLiquid',
        standardRadius: 24,
        spawnClearance: 2,
        color: '#78E6D0',
        outlineColor: '#D9FFF6',
        spawnVelocity: { minX: -40, maxX: 20, minY: 60, maxY: 120 },
        gravity: 350,
        drift: 12,
        maxSpeed: 500,
        materialRestitution: 0.25,
        wallRestitution: 0.5,
        fireProtectionSeconds: 0.5,
        resetProtectionOnExit: true,
        burnDurationSeconds: 2.5,
        thrustAcceleration: 500,
      },
      {
        id: 'slag',
        pearlType: 'slag',
        standardRadius: 22,
        spawnClearance: 2,
        color: '#8E7C68',
        outlineColor: '#D0BDA6',
        spawnVelocity: { minX: -30, maxX: 30, minY: 60, maxY: 120 },
        gravity: 400,
        drift: 8,
        maxSpeed: 480,
        materialRestitution: 0.2,
        wallRestitution: 0.4,
        fireProtectionSeconds: 0.5,
        resetProtectionOnExit: true,
        burnDurationSeconds: 2,
        thrustAcceleration: 420,
      },
      {
        id: 'impurity',
        pearlType: 'impurity',
        standardRadius: 20,
        spawnClearance: 2,
        color: '#B56F9D',
        outlineColor: '#F0B9DA',
        spawnVelocity: { minX: -50, maxX: 50, minY: 60, maxY: 120 },
        gravity: 320,
        drift: 20,
        maxSpeed: 520,
        materialRestitution: 0.3,
        wallRestitution: 0.6,
        fireProtectionSeconds: 0.5,
        resetProtectionOnExit: true,
        burnDurationSeconds: 2.2,
        thrustAcceleration: 620,
      },
    ],
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
  presentation: validM5Presentation(),
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
      fixedDeltaSeconds: 1 / 30,
      availableFireSourceIds: ['basic-fire'],
      fireSources: [
        {
          id: 'basic-fire',
          baseTemperature: 8,
          maximumTemperature: 100,
          heatingRatePerSecond: 24,
          coolingRatePerSecond: 10,
          temperatureCurve: 'linear',
        },
      ],
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
      frontLaneWidthCells: 1,
      fireFlow: {
        geometry: { columns: 80, rows: 45, cellSize: 20 },
      },
      materialPlacement: {
        visibleLongEdge: 170,
        minimumGap: 4,
        usableRegion: { left: 0, top: 0, right: 1600, bottom: 900 },
        slots: [
          { center: { x: 800, y: 300 }, rotationRadians: 0 },
          { center: { x: 1000, y: 300 }, rotationRadians: (2 * Math.PI) / 180 },
          { center: { x: 1200, y: 300 }, rotationRadians: (4 * Math.PI) / 180 },
        ],
      },
      fireSource: {
        origin: { x: 800, y: 700 },
        halfAngleRadians: (70 * Math.PI) / 180,
      },
      pearlPhysics: {
        medicinalLiquid: {
          spawnClearance: 2,
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

  it('防御性拒绝未登记成分颜色，不按 alpha 静默映射为药液', () => {
    const map = compositionMap()
    map.rgba.set([255, 0, 0, 255], (32 * 64 + 32) * 4)

    expect(() => createM2RuntimeConfiguration(config, [map])).toThrow(
      'M2_COMPOSITION_MAP_UNSUPPORTED_COLOR:/assets/masks/prototype-herb-components.png:/pixels/32/32',
    )
  })

  it('多份材料按映射后的显式槽位确定性摆放，流场障碍不重合', () => {
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

    const contentRectangles = simulation.read().materials.map((material) =>
      deriveMaterialContentRectangle(
        material.placement,
        material.composition,
      ),
    )
    ;[
      { center: { x: 800, y: 300 }, rotationRadians: 0 },
      { center: { x: 1000, y: 300 }, rotationRadians: (2 * Math.PI) / 180 },
      { center: { x: 1200, y: 300 }, rotationRadians: (4 * Math.PI) / 180 },
    ].forEach((expected, index) => {
      expect(contentRectangles[index]!.center.x).toBeCloseTo(
        expected.center.x,
        9,
      )
      expect(contentRectangles[index]!.center.y).toBeCloseTo(
        expected.center.y,
        9,
      )
      expect(contentRectangles[index]!.rotationRadians).toBeCloseTo(
        expected.rotationRadians,
        12,
      )
    })
    const obstacle = simulation.read().fireFlow.obstacle
    expect(obstacle[15 * 80 + 40]).toBeGreaterThan(0)
    expect(obstacle[15 * 80 + 50]).toBeGreaterThan(0)
    expect(obstacle[15 * 80 + 60]).toBeGreaterThan(0)
  })

  it('材料按初始非空 composition bounds 固定放大到 170 逻辑像素并以内容中心对齐槽位', () => {
    const runtime = createM2RuntimeConfiguration(config, [compositionMap()])
    const simulation = new ExtractionSimulation(runtime.simulation)
    const baseState = createDomainState(runtime.rules)
    const state = {
      ...baseState,
      status: 'extracting' as const,
      materialInstances: [
        {
          materialInstanceId: 'material-0',
          materialDefinitionId: 'prototype-herb',
          inventoryBatchId: 'prototype-herb-batch',
          initialVolume: 6,
          remainingVolume: 6,
        },
      ],
    }

    simulation.beginTick({ tick: 0, domainState: state })
    for (let phase = 1; phase <= 7; phase += 1) {
      simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
    }
    simulation.buildCandidate()
    simulation.commitTick()

    const material = simulation.read().materials[0]!
    const visibleCellLongEdge = material.placement.width / 64
    const localContentCenterX =
      ((32.5 / 64) - 0.5) * material.placement.width
    const localContentCenterY =
      ((32.5 / 64) - 0.5) * material.placement.height

    expect(visibleCellLongEdge).toBeCloseTo(170, 9)
    expect({
      x: material.placement.center.x + localContentCenterX,
      y: material.placement.center.y + localContentCenterY,
    }).toEqual({ x: 800, y: 300 })
  })
})
