import { describe, expect, it } from 'vitest'

import type { NormalizedConfig } from '../../config/model'
import {
  validateAndNormalizeM2GameplayConfig,
  type RawM2GameplayConfig,
} from '../../config/m2-gameplay-validate'
import { loadM2GameplayTestSchemaBundle } from './schema-fixture'
import { validM5Presentation } from '../fixtures/m5-presentation'

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
    spawnClearance: 2,
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
        presentation: '/config/m2/presentation.json',
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
          visibleLongEdge: 180,
          minimumGap: 0,
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
    presentation: {
      filePath: '/config/m2/presentation.json',
      value: validM5Presentation(),
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
            slots: [
              { centerX: 800, centerY: 300, rotationDegrees: 0 },
              { centerX: 1000, centerY: 300, rotationDegrees: 2 },
              { centerX: 1200, centerY: 300, rotationDegrees: 4 },
            ],
          },
          inventoryBatches: [{ materialDefinitionId: 'moon-leaf' }],
        },
        fireSources: [
          {
            id: 'basic-fire',
            descriptionZh: '丹炉常用的基础火种。',
            baseTemperature: 8,
            maximumTemperature: 100,
            heatingRatePerSecond: 24,
            coolingRatePerSecond: 10,
            temperatureCurve: 'linear',
          },
        ],
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
      expect(Object.isFrozen(result.config.prototype.materialPlacement.usableRegion)).toBe(true)
      expect(Object.isFrozen(result.config.prototype.materialPlacement.slots)).toBe(true)
      expect(Object.isFrozen(result.config.prototype.materialPlacement.slots[0])).toBe(true)
      expect(Object.isFrozen(result.config.prototype.theme.colors)).toBe(true)
      expect(Object.isFrozen(result.config.fireSources[0])).toBe(true)
    }
  })

  it.each([
    ['fireSizeWheelStep', 0, '/fireSizeWheelStep'],
    ['materialRestitution', 1.01, '/pearlTypes/0/materialRestitution'],
    ['spawnClearance', -0.01, '/pearlTypes/0/spawnClearance'],
  ] as const)('拒绝越界的 %s', (field, value, fieldPath) => {
    const raw = rawM2()
    if (field === 'fireSizeWheelStep') {
      ;(raw.prototype.value as { fireSizeWheelStep: number }).fireSizeWheelStep = value
    } else if (field === 'materialRestitution') {
      ;(raw.pearlTypes.value as {
        pearlTypes: Array<{ materialRestitution: number }>
      }).pearlTypes[0]!.materialRestitution = value
    } else {
      ;(raw.pearlTypes.value as {
        pearlTypes: Array<{ spawnClearance: number }>
      }).pearlTypes[0]!.spawnClearance = value
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

  it('拒绝缺失的 spawnClearance，不在运行时静默补默认值', () => {
    const raw = rawM2()
    delete (raw.pearlTypes.value as {
      pearlTypes: Array<{ spawnClearance?: number }>
    }).pearlTypes[0]!.spawnClearance

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
          code: 'CONFIG_REQUIRED_FIELD',
          fieldPath: '/pearlTypes/0/spawnClearance',
        }),
      ],
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

  it('拒绝多份材料的权威摆放发生内部相交', () => {
    const raw = rawM2()
    const prototype = raw.prototype.value as {
      materialPlacement: {
        slots: Array<{
          centerX: number
          centerY: number
          rotationDegrees: number
        }>
      }
    }
    prototype.materialPlacement.slots[1] = {
      centerX: 900,
      centerY: 300,
      rotationDegrees: 0,
    }

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
          fieldPath: '/materialPlacement/slots/1',
        }),
      ],
    })
  })

  it('轴对齐槽位允许中心距等于 size，减去 epsilon 后拒绝', () => {
    const raw = rawM2()
    const placement = (raw.prototype.value as {
      materialPlacement: {
        visibleLongEdge: number
        slots: Array<{
          centerX: number
          centerY: number
          rotationDegrees: number
        }>
      }
    }).materialPlacement
    placement.slots = [
      { centerX: 800, centerY: 300, rotationDegrees: 0 },
      {
        centerX: 800 + placement.visibleLongEdge,
        centerY: 300,
        rotationDegrees: 0,
      },
      {
        centerX: 800 + placement.visibleLongEdge * 2,
        centerY: 300,
        rotationDegrees: 0,
      },
    ]

    expect(
      validateAndNormalizeM2GameplayConfig(
        raw,
        loadM2GameplayTestSchemaBundle(),
        baseConfig,
        '/config/config-set.json',
      ),
    ).toMatchObject({ ok: true })

    placement.slots[1]!.centerX -= 1e-6
    expect(
      validateAndNormalizeM2GameplayConfig(
        raw,
        loadM2GameplayTestSchemaBundle(),
        baseConfig,
        '/config/config-set.json',
      ),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          fieldPath: '/materialPlacement/slots/1',
        }),
      ],
    })
  })

  it('旋转槽位允许 OBB 精确接触，向内移动 epsilon 后拒绝', () => {
    const raw = rawM2()
    const placement = (raw.prototype.value as {
      materialPlacement: {
        visibleLongEdge: number
        slots: Array<{
          centerX: number
          centerY: number
          rotationDegrees: number
        }>
      }
    }).materialPlacement
    const contactDistance =
      placement.visibleLongEdge * 0.5 +
      placement.visibleLongEdge * 0.5 * Math.SQRT2
    placement.slots = [
      { centerX: 400, centerY: 300, rotationDegrees: 0 },
      {
        centerX: 400 + contactDistance,
        centerY: 300,
        rotationDegrees: 45,
      },
      { centerX: 1100, centerY: 300, rotationDegrees: 0 },
    ]

    expect(
      validateAndNormalizeM2GameplayConfig(
        raw,
        loadM2GameplayTestSchemaBundle(),
        baseConfig,
        '/config/config-set.json',
      ),
    ).toMatchObject({ ok: true })

    placement.slots[1]!.centerX -= 1e-6
    expect(
      validateAndNormalizeM2GameplayConfig(
        raw,
        loadM2GameplayTestSchemaBundle(),
        baseConfig,
        '/config/config-set.json',
      ),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          fieldPath: '/materialPlacement/slots/1',
        }),
      ],
    })
  })

  it('拒绝槽位数少于库存总份数', () => {
    const raw = rawM2()
    const slots = (raw.prototype.value as {
      materialPlacement: { slots: unknown[] }
    }).materialPlacement.slots
    slots.pop()

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
          fieldPath: '/materialPlacement/slots',
          messageZh: expect.stringContaining('库存共 3 份'),
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
        slots: Array<{
          centerX: number
          centerY: number
          rotationDegrees: number
        }>
      }
    }).materialPlacement
    placement.slots[0] = {
      centerX: 100,
      centerY: 100,
      rotationDegrees: 45,
    }

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
          fieldPath: '/materialPlacement/slots/0',
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

  it.each([
    ['空说明', 'descriptionZh', '', '/fireSources/0/descriptionZh'],
    ['负基础温度', 'baseTemperature', -1, '/fireSources/0/baseTemperature'],
    ['基础温度超过标准化上限', 'baseTemperature', 101, '/fireSources/0/baseTemperature'],
    ['最高温度超过标准化上限', 'maximumTemperature', 101, '/fireSources/0/maximumTemperature'],
    ['零升温速率', 'heatingRatePerSecond', 0, '/fireSources/0/heatingRatePerSecond'],
    ['升温速率超过标准化上限', 'heatingRatePerSecond', 101, '/fireSources/0/heatingRatePerSecond'],
    ['零降温速率', 'coolingRatePerSecond', 0, '/fireSources/0/coolingRatePerSecond'],
    ['降温速率超过标准化上限', 'coolingRatePerSecond', 101, '/fireSources/0/coolingRatePerSecond'],
    ['未知温度曲线', 'temperatureCurve', 'quadratic', '/fireSources/0/temperatureCurve'],
  ] as const)('拒绝火种%s', (_name, field, value, fieldPath) => {
    const raw = rawM2()
    const source = (raw.fireSources.value as {
      fireSources: Array<Record<string, unknown>>
    }).fireSources[0]!
    source[field] = value

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

  it('拒绝不高于基础温度的最高温度', () => {
    const raw = rawM2()
    const source = (raw.fireSources.value as {
      fireSources: Array<{ baseTemperature: number; maximumTemperature: number }>
    }).fireSources[0]!
    source.maximumTemperature = source.baseTemperature

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
          fieldPath: '/fireSources/0/maximumTemperature',
        }),
      ],
    })
  })
})
