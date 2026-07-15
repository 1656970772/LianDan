import { describe, expect, it } from 'vitest'

import {
  validateAndNormalizeConfigSet,
  type RawConfigSet,
} from '../../config/validate'
import { loadTestSchemaBundle } from './schema-fixture'

function validRawConfigSet(): RawConfigSet {
  return {
    configSet: {
      filePath: '/config/config-set.json',
      value: {
        schemaVersion: 1,
        parameters: '/config/parameters.json',
        materials: ['/config/materials/prototype-herb.json'],
      },
    },
    parameters: {
      filePath: '/config/parameters.json',
      value: { schemaVersion: 1 },
    },
    materials: [
      {
        filePath: '/config/materials/prototype-herb.json',
        value: {
          schemaVersion: 1,
          id: 'prototype-herb',
          nameZh: '原型药材',
          compositionMapPath: '/assets/masks/prototype-herb-components.png',
        },
      },
    ],
  }
}

function expectSuccess(raw: RawConfigSet) {
  const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues))
  }
  return result.config
}

describe('validateAndNormalizeConfigSet', () => {
  it('仅从 Schema 补全参数默认值并深冻结正式配置', () => {
    const config = expectSuccess(validRawConfigSet())

    expect(config.parameters).toEqual({
      standardPearlVolume: 1,
      slagUnitVolume: 100,
      simulation: {
        fixedStepHz: 30,
        maxCatchUpSteps: 5,
      },
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
      },
    })
    expect(config.materials[0]?.targetPearlCount).toBe(300)
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.parameters)).toBe(true)
    expect(Object.isFrozen(config.parameters.simulation)).toBe(true)
    expect(Object.isFrozen(config.parameters.flowField)).toBe(true)
    expect(Object.isFrozen(config.materials)).toBe(true)
    expect(Object.isFrozen(config.materials[0])).toBe(true)
  })

  it('把 Schema annotation 作为唯一默认源', () => {
    const schemas = structuredClone(loadTestSchemaBundle())
    const parameterProperties = schemas.parameters.properties as Record<
      string,
      Record<string, unknown>
    >
    const materialProperties = schemas.material.properties as Record<
      string,
      Record<string, unknown>
    >
    parameterProperties.standardPearlVolume!.default = 2
    parameterProperties.slagUnitVolume!['x-defaultMultiplier'] = {
      source: 'standardPearlVolume',
      factor: 25,
    }
    const simulationProperties = (
      parameterProperties.simulation!.properties as Record<
        string,
        Record<string, unknown>
      >
    )
    const flowFieldProperties = (
      parameterProperties.flowField!.properties as Record<
        string,
        Record<string, unknown>
      >
    )
    const dissolutionProperties = (
      parameterProperties.dissolution!.properties as Record<
        string,
        Record<string, unknown>
      >
    )
    simulationProperties.fixedStepHz!.default = 25
    simulationProperties.maxCatchUpSteps!.default = 7
    flowFieldProperties.gridColumns!.default = 64
    flowFieldProperties.gridRows!.default = 36
    flowFieldProperties.cellSize!.default = 25
    flowFieldProperties.circleCoverageSamplesPerAxis!.default = 3
    flowFieldProperties.lateralSpread!.default = 0.4
    flowFieldProperties.obstacleDeflection!.default = 0.8
    flowFieldProperties.partialObstaclePenalty!.default = 0.45
    flowFieldProperties.mergeRate!.default = 0.2
    flowFieldProperties.fullObstacleThreshold!.default = 0.9
    dissolutionProperties.volumePerTick!.default = 0.25
    dissolutionProperties.exposureProbeDistance!.default = 24
    materialProperties.targetPearlCount!.default = 450

    const result = validateAndNormalizeConfigSet(validRawConfigSet(), schemas)
    expect(result).toMatchObject({
      ok: true,
      config: {
        parameters: {
          standardPearlVolume: 2,
          slagUnitVolume: 50,
          simulation: { fixedStepHz: 25, maxCatchUpSteps: 7 },
          flowField: {
            gridColumns: 64,
            gridRows: 36,
            cellSize: 25,
            circleCoverageSamplesPerAxis: 3,
            lateralSpread: 0.4,
            obstacleDeflection: 0.8,
            partialObstaclePenalty: 0.45,
            mergeRate: 0.2,
            fullObstacleThreshold: 0.9,
          },
          dissolution: {
            volumePerTick: 0.25,
            exposureProbeDistance: 24,
          },
        },
        materials: [{ targetPearlCount: 450 }],
      },
    })
  })

  it('允许在各自所有者中显式覆盖', () => {
    const raw = validRawConfigSet()
    raw.parameters.value = {
      schemaVersion: 1,
      standardPearlVolume: 2.5,
      slagUnitVolume: 180,
      simulation: {
        fixedStepHz: 60,
        maxCatchUpSteps: 8,
      },
      flowField: {
        gridColumns: 100,
        gridRows: 50,
        cellSize: 16,
        circleCoverageSamplesPerAxis: 4,
        lateralSpread: 0.6,
        obstacleDeflection: 0.9,
        partialObstaclePenalty: 0.25,
        mergeRate: 0.3,
        fullObstacleThreshold: 0.85,
      },
      dissolution: {
        volumePerTick: 0.3,
        exposureProbeDistance: 12,
      },
    }
    raw.materials[0]!.value = {
      ...(raw.materials[0]!.value as object),
      targetPearlCount: 720,
    }

    const config = expectSuccess(raw)
    expect(config.parameters).toEqual({
      standardPearlVolume: 2.5,
      slagUnitVolume: 180,
      simulation: {
        fixedStepHz: 60,
        maxCatchUpSteps: 8,
      },
      flowField: {
        gridColumns: 100,
        gridRows: 50,
        cellSize: 16,
        circleCoverageSamplesPerAxis: 4,
        lateralSpread: 0.6,
        obstacleDeflection: 0.9,
        partialObstaclePenalty: 0.25,
        mergeRate: 0.3,
        fullObstacleThreshold: 0.85,
      },
      dissolution: {
        volumePerTick: 0.3,
        exposureProbeDistance: 12,
      },
    })
    expect(config.materials[0]?.targetPearlCount).toBe(720)
  })

  it.each([
    [0, 'CONFIG_VALUE_OUT_OF_RANGE', '/standardPearlVolume', '标准珠体积必须是有限正数'],
    [-1, 'CONFIG_VALUE_OUT_OF_RANGE', '/standardPearlVolume', '标准珠体积必须是有限正数'],
  ])('拒绝越界 standardPearlVolume=%s', (value, code, fieldPath, messageZh) => {
    const raw = validRawConfigSet()
    raw.parameters.value = { schemaVersion: 1, standardPearlVolume: value }

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code,
          filePath: '/config/parameters.json',
          fieldPath,
          messageZh,
        }),
      ],
    })
  })

  it.each([0, -1])('拒绝越界 slagUnitVolume=%s', (value) => {
    const raw = validRawConfigSet()
    raw.parameters.value = { schemaVersion: 1, slagUnitVolume: value }

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          fieldPath: '/slagUnitVolume',
          messageZh: '药渣单位体积必须是有限正数',
        },
      ],
    })
  })

  it.each([
    ['simulation', 'fixedStepHz', 0],
    ['simulation', 'fixedStepHz', 241],
    ['simulation', 'fixedStepHz', 30.5],
    ['simulation', 'maxCatchUpSteps', 0],
    ['simulation', 'maxCatchUpSteps', 61],
    ['flowField', 'gridColumns', 7],
    ['flowField', 'gridRows', 7],
    ['flowField', 'cellSize', 0],
    ['flowField', 'circleCoverageSamplesPerAxis', 0],
    ['flowField', 'circleCoverageSamplesPerAxis', 9],
    ['flowField', 'lateralSpread', -0.01],
    ['flowField', 'obstacleDeflection', 1.01],
    ['flowField', 'partialObstaclePenalty', -0.01],
    ['flowField', 'mergeRate', 1.01],
    ['flowField', 'fullObstacleThreshold', 0],
    ['flowField', 'fullObstacleThreshold', 1.01],
    ['dissolution', 'volumePerTick', 0],
    ['dissolution', 'exposureProbeDistance', -0.01],
  ] as const)(
    '拒绝越界 %s.%s=%s',
    (group, field, value) => {
      const raw = validRawConfigSet()
      raw.parameters.value = {
        schemaVersion: 1,
        [group]: { [field]: value },
      }

      const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'CONFIG_VALUE_OUT_OF_RANGE',
            fieldPath: `/${group}/${field}`,
          },
        ],
      })
    },
  )

  it.each(['simulation', 'flowField', 'dissolution'] as const)(
    '拒绝 %s 中的未知字段',
    (group) => {
      const raw = validRawConfigSet()
      raw.parameters.value = {
        schemaVersion: 1,
        [group]: { undocumentedRule: 1 },
      }

      const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'CONFIG_UNKNOWN_FIELD',
            fieldPath: `/${group}/undocumentedRule`,
          },
        ],
      })
    },
  )

  it('拒绝依赖默认计算溢出的 slagUnitVolume', () => {
    const raw = validRawConfigSet()
    raw.parameters.value = { schemaVersion: 1, standardPearlVolume: 1e308 }

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          fieldPath: '/slagUnitVolume',
          messageZh: '药渣单位体积必须是有限正数',
        },
      ],
    })
  })

  it.each([0, 100_001, 1.5])('拒绝越界 targetPearlCount=%s', (value) => {
    const raw = validRawConfigSet()
    raw.materials[0]!.value = {
      ...(raw.materials[0]!.value as object),
      targetPearlCount: value,
    }

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          fieldPath: '/targetPearlCount',
          messageZh: '目标珠数必须是 1..100000 的整数',
        },
      ],
    })
  })

  it('通过 additionalProperties=false 拒绝跨所有者覆盖', () => {
    const materialOverride = validRawConfigSet()
    materialOverride.materials[0]!.value = {
      ...(materialOverride.materials[0]!.value as object),
      standardPearlVolume: 9,
    }
    const parameterOverride = validRawConfigSet()
    parameterOverride.parameters.value = {
      schemaVersion: 1,
      targetPearlCount: 999,
    }

    for (const raw of [materialOverride, parameterOverride]) {
      const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
      expect(result).toMatchObject({
        ok: false,
        issues: [{ code: 'CONFIG_UNKNOWN_FIELD' }],
      })
    }
  })

  it('拒绝重复材料稳定 ID', () => {
    const raw = validRawConfigSet()
    raw.configSet.value = {
      schemaVersion: 1,
      parameters: '/config/parameters.json',
      materials: [
        '/config/materials/prototype-herb.json',
        '/config/materials/renamed.json',
      ],
    }
    raw.materials.push({
      filePath: '/config/materials/renamed.json',
      value: structuredClone(raw.materials[0]!.value),
    })

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: 'CONFIG_DUPLICATE_LOGICAL_KEY', fieldPath: '/id' }],
    })
  })

  it('允许省略纯表现外观图，也会标准化合法外观图路径', () => {
    const omitted = expectSuccess(validRawConfigSet())
    expect(omitted.materials[0]).not.toHaveProperty('appearancePath')

    const withAppearance = validRawConfigSet()
    withAppearance.materials[0]!.value = {
      ...(withAppearance.materials[0]!.value as object),
      appearancePath: '/assets/materials/moon-leaf.png',
    }
    expect(expectSuccess(withAppearance).materials[0]?.appearancePath).toBe(
      '/assets/materials/moon-leaf.png',
    )
  })

  it('拒绝越出材料外观资源目录的 appearancePath', () => {
    const raw = validRawConfigSet()
    raw.materials[0]!.value = {
      ...(raw.materials[0]!.value as object),
      appearancePath: '/assets/masks/not-an-appearance.png',
    }

    const result = validateAndNormalizeConfigSet(raw, loadTestSchemaBundle())
    expect(result).toMatchObject({
      ok: false,
      issues: [{ filePath: '/config/materials/prototype-herb.json', fieldPath: '/appearancePath' }],
    })
  })
})
