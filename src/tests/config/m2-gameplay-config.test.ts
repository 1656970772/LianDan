import { describe, expect, it } from 'vitest'

import type { NormalizedConfig } from '../../config/model'
import {
  validateAndNormalizeM2GameplayConfig,
  type RawM2GameplayConfig,
} from '../../config/m2-gameplay-validate'
import { loadM2GameplayTestSchemaBundle } from './schema-fixture'

const baseConfig: NormalizedConfig = {
  schemaVersion: 1,
  parameters: {
    standardPearlVolume: 1,
    slagUnitVolume: 100,
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
    loss: {
      naturalRatePerMinute: 0.01,
      warningThresholds: [0.5, 0.65],
      failureThreshold: 0.7,
    },
  },
  materials: [
    {
      id: 'moon-leaf',
      nameZh: '月露叶',
      targetPearlCount: 24,
      compositionMapPath: '/assets/masks/moon-leaf-components.png',
      appearancePath: '/assets/materials/moon-leaf.png',
    },
  ],
}

function validPearlTypes() {
  const shared = {
    color: '#78E6D0',
    outlineColor: '#D9FFF6',
    spawnVelocity: { minX: -45, maxX: 45, minY: 60, maxY: 120 },
    gravity: 350,
    drift: 12,
    maxSpeed: 500,
    materialRestitution: 0.25,
    wallRestitution: 0.5,
    fireProtectionSeconds: 0.5,
    resetProtectionOnExit: true,
    burnDurationSeconds: 2.5,
    thrustAcceleration: 500,
  }
  return [
    { ...shared, id: 'medicinal-liquid', pearlType: 'medicinalLiquid', standardRadius: 24 },
    { ...shared, id: 'slag', pearlType: 'slag', standardRadius: 22 },
    { ...shared, id: 'impurity', pearlType: 'impurity', standardRadius: 20 },
  ]
}

function rawM2(): RawM2GameplayConfig {
  return {
    manifest: {
      filePath: '/config/m2-config-set.json',
      value: {
        schemaVersion: 1,
        baseConfigSet: '/config/config-set.json',
        prototype: '/config/m2/prototype.json',
        fireSources: '/config/m2/fire-sources.json',
        pearlTypes: '/config/m2/pearl-types.json',
        collector: '/config/m2/collector.json',
      },
    },
    prototype: {
      filePath: '/config/m2/prototype.json',
      value: {
        schemaVersion: 1,
        seed: 123,
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
            batchId: 'moon-leaf-batch',
            materialDefinitionId: 'moon-leaf',
            servings: 3,
          },
        ],
      },
    },
    fireSources: {
      filePath: '/config/m2/fire-sources.json',
      value: {
        schemaVersion: 1,
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
      },
    },
    pearlTypes: {
      filePath: '/config/m2/pearl-types.json',
      value: {
        schemaVersion: 1,
        pearlTypes: validPearlTypes(),
      },
    },
    collector: {
      filePath: '/config/m2/collector.json',
      value: {
        schemaVersion: 1,
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
}

describe('validateAndNormalizeM2GameplayConfig', () => {
  it('跨文件校验并深冻结通用稳定 ID 配置', () => {
    const result = validateAndNormalizeM2GameplayConfig(
      rawM2(),
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: true,
      config: {
        prototype: {
          availableFireSourceIds: ['basic-fire'],
          fireSizeWheelStep: 4,
          materialPlacement: {
            offsetPerInstance: { x: 200, y: 0 },
            rotationDegreesPerInstance: 2,
          },
          inventoryBatches: [{ materialDefinitionId: 'moon-leaf' }],
        },
        fireSources: [{ id: 'basic-fire' }],
        pearlTypes: expect.any(Array),
        collector: { initialX: 800 },
      },
    })
    if (result.ok) {
      expect(result.config.pearlTypes.map(({ pearlType }) => pearlType)).toEqual([
        'medicinalLiquid',
        'slag',
        'impurity',
      ])
      expect(result.config.pearlTypes[0]?.materialRestitution).toBe(0.25)
    }
    if (result.ok) {
      expect(Object.isFrozen(result.config)).toBe(true)
      expect(Object.isFrozen(result.config.prototype.materialPlacement)).toBe(true)
      expect(Object.isFrozen(result.config.prototype.materialPlacement.offsetPerInstance)).toBe(true)
      expect(Object.isFrozen(result.config.prototype.theme.colors)).toBe(true)
      expect(Object.isFrozen(result.config.fireSources[0])).toBe(true)
    }
  })

  it.each([
    ['fireSizeWheelStep', 0, '/fireSizeWheelStep'],
    ['materialRestitution', 1.01, '/pearlTypes/0/materialRestitution'],
  ] as const)('拒绝越界的 %s', (field, value, fieldPath) => {
    const raw = rawM2()
    if (field === 'fireSizeWheelStep') {
      ;(raw.prototype.value as { fireSizeWheelStep: number }).fireSizeWheelStep = value
    } else {
      ;(raw.pearlTypes.value as {
        pearlTypes: Array<{ materialRestitution: number }>
      }).pearlTypes[0]!.materialRestitution = value
    }

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'CONFIG_VALUE_OUT_OF_RANGE', fieldPath })],
    })
  })

  it.each([
    ['material', 'unknown-material', '/inventoryBatches/0/materialDefinitionId'],
    ['fire', 'unknown-fire', '/availableFireSourceIds/0'],
  ] as const)('拒绝不存在的 %s 稳定 ID 引用', (kind, id, fieldPath) => {
    const raw = rawM2()
    if (kind === 'material') {
      const prototype = raw.prototype.value as {
        inventoryBatches: Array<{ materialDefinitionId: string }>
      }
      prototype.inventoryBatches[0]!.materialDefinitionId = id
    } else {
      const prototype = raw.prototype.value as { availableFireSourceIds: string[] }
      prototype.availableFireSourceIds[0] = id
    }

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'CONFIG_REFERENCE_NOT_FOUND', fieldPath })],
    })
  })

  it('拒绝重复 fire source 稳定 ID', () => {
    const raw = rawM2()
    const fireSources = raw.fireSources.value as { fireSources: unknown[] }
    fireSources.fireSources.push(structuredClone(fireSources.fireSources[0]))

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'CONFIG_DUPLICATE_LOGICAL_KEY' })],
    })
  })

  it('拒绝重复珠类型，保证三类配置各有且仅有一项', () => {
    const raw = rawM2()
    const pearlTypes = raw.pearlTypes.value as {
      pearlTypes: Array<{ pearlType: string }>
    }
    pearlTypes.pearlTypes[1]!.pearlType = 'medicinalLiquid'

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'CONFIG_SCHEMA_VIOLATION',
            fieldPath: '/pearlTypes/1/pearlType',
          }),
          expect.objectContaining({
            code: 'CONFIG_SCHEMA_VIOLATION',
            fieldPath: '/pearlTypes',
          }),
        ]),
      )
    }
  })

  it('wheel 步长不限制连续滑条可表达的初始火力', () => {
    const raw = rawM2()
    const prototype = raw.prototype.value as {
      initialFireSize: number
      fireSizeWheelStep: number
    }
    prototype.initialFireSize = 30
    prototype.fireSizeWheelStep = 6

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({ ok: true })
  })

  it('允许有意义的部分堆叠，但拒绝多份材料完全同位', () => {
    const raw = rawM2()
    const prototype = raw.prototype.value as {
      materialPlacement: {
        offsetPerInstance: { x: number; y: number }
        rotationDegreesPerInstance: number
      }
    }
    prototype.materialPlacement.offsetPerInstance = { x: 120, y: 0 }

    expect(
      validateAndNormalizeM2GameplayConfig(
        raw,
        loadM2GameplayTestSchemaBundle(),
        baseConfig,
        '/config/config-set.json',
      ),
    ).toMatchObject({ ok: true })

    prototype.materialPlacement.offsetPerInstance = { x: 0, y: 0 }
    prototype.materialPlacement.rotationDegreesPerInstance = 0

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          fieldPath: '/materialPlacement/offsetPerInstance',
        }),
      ],
    })
  })

  it.each([
    [
      '轨道左端',
      (collector: Record<string, number>) => {
        collector.minX = 50
      },
      '/minX',
    ],
    [
      '轨道右端',
      (collector: Record<string, number>) => {
        collector.maxX = 1550
      },
      '/maxX',
    ],
    [
      '纵向上沿',
      (collector: Record<string, number>) => {
        collector.y = 10
      },
      '/y',
    ],
    [
      '纵向下沿',
      (collector: Record<string, number>) => {
        collector.y = 890
      },
      '/y',
    ],
  ] as const)('拒绝让接液容器从%s越出逻辑世界', (_name, mutate, fieldPath) => {
    const raw = rawM2()
    mutate(raw.collector.value as Record<string, number>)

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: '/config/m2/collector.json',
          fieldPath,
        }),
      ],
    })
  })

  it('材料逐实例旋转后的外接范围仍必须完整位于逻辑世界内', () => {
    const raw = rawM2()
    const placement = (raw.prototype.value as {
      materialPlacement: {
        centerX: number
        centerY: number
        offsetPerInstance: { x: number; y: number }
        rotationDegreesPerInstance: number
      }
    }).materialPlacement
    placement.centerX = 100
    placement.centerY = 100
    placement.offsetPerInstance = { x: 0, y: 0 }
    placement.rotationDegreesPerInstance = 45

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          filePath: '/config/m2/prototype.json',
          fieldPath: '/materialPlacement',
        }),
      ],
    })
  })

  it('M2 原型只允许一个可选火种，避免 UI 与模拟火源失真', () => {
    const raw = rawM2()
    const fireSources = raw.fireSources.value as {
      fireSources: Array<Record<string, unknown>>
    }
    fireSources.fireSources.push({
      ...structuredClone(fireSources.fireSources[0]),
      id: 'second-fire',
      origin: { x: 400, y: 650 },
      minWidth: 12,
      maxWidth: 140,
    })
    ;(raw.prototype.value as { availableFireSourceIds: string[] })
      .availableFireSourceIds.push('second-fire')

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: '/config/m2/prototype.json',
          fieldPath: '/availableFireSourceIds',
        }),
      ],
    })
  })

  it('额外登记但未启用的火种不进入 M2 标准化运行配置', () => {
    const raw = rawM2()
    const fireSources = raw.fireSources.value as {
      fireSources: Array<Record<string, unknown>>
    }
    fireSources.fireSources.push({
      ...structuredClone(fireSources.fireSources[0]),
      id: 'future-fire',
      origin: { x: 400, y: 650 },
      minWidth: 12,
      maxWidth: 140,
    })

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: true,
      config: { fireSources: [{ id: 'basic-fire' }] },
    })
    if (result.ok) expect(result.config.fireSources).toHaveLength(1)
  })

  it.each([
    [
      '最小宽度大于最大宽度',
      (source: { minWidth: number; origin: { x: number } }) => {
        source.minWidth = 300
      },
      '/fireSources/0/minWidth',
    ],
    [
      '原点越出逻辑世界',
      (source: { minWidth: number; origin: { x: number } }) => {
        source.origin.x = 1601
      },
      '/fireSources/0/origin',
    ],
  ] as const)('在配置边界结构化拒绝火源%s', (_name, mutate, fieldPath) => {
    const raw = rawM2()
    const source = (raw.fireSources.value as {
      fireSources: Array<{ minWidth: number; origin: { x: number } }>
    }).fireSources[0]!
    mutate(source)

    const result = validateAndNormalizeM2GameplayConfig(
      raw,
      loadM2GameplayTestSchemaBundle(),
      baseConfig,
      '/config/config-set.json',
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ fieldPath })],
    })
  })
})
