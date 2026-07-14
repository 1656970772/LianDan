import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  validateM1RuntimeCompatibility,
  type M1FireFlowFixture,
} from '../../config/index.ts'
import { validateAndNormalizeConfigSet } from '../../config/validate.ts'
import { loadTestSchemaBundle } from './schema-fixture.ts'

function readJson(relativeUrl: string): unknown {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

function loadProductionInputs() {
  const validated = validateAndNormalizeConfigSet(
    {
      configSet: {
        filePath: '/config/config-set.json',
        value: readJson('../../../public/config/config-set.json'),
      },
      parameters: {
        filePath: '/config/parameters.json',
        value: readJson('../../../public/config/parameters.json'),
      },
      materials: [
        {
          filePath: '/config/materials/prototype-herb.json',
          value: readJson(
            '../../../public/config/materials/prototype-herb.json',
          ),
        },
      ],
    },
    loadTestSchemaBundle(),
  )
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues))
  return {
    config: validated.config,
    fixture: readJson(
      '../../../public/config/performance/m1-fire-flow.json',
    ) as M1FireFlowFixture,
  }
}

const logicalWorld = { width: 1600, height: 900 }

describe('M1 runtime 配置跨边界兼容性', () => {
  it('接受真实默认 config/fixture/画布契约', () => {
    const { config, fixture } = loadProductionInputs()

    expect(
      validateM1RuntimeCompatibility(config, fixture, logicalWorld),
    ).toEqual([])
  })

  it('稳定拒绝网格尺寸与 tickHz 跨边界不一致', () => {
    const { config, fixture } = loadProductionInputs()
    const incompatibleConfig = structuredClone(config)
    ;(incompatibleConfig.parameters.flowField as { gridColumns: number })
      .gridColumns = 79
    ;(incompatibleConfig.parameters.simulation as { fixedStepHz: number })
      .fixedStepHz = 60

    expect(
      validateM1RuntimeCompatibility(
        incompatibleConfig,
        fixture,
        logicalWorld,
      ),
    ).toEqual([
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/parameters.json',
        fieldPath: '/flowField/gridColumns',
        messageZh: 'M1 火流网格宽度 1580 与场景世界宽度 1600 不一致',
      },
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/parameters.json',
        fieldPath: '/simulation/fixedStepHz',
        messageZh: 'M1 固定步进频率 60 与性能协议期望频率 30 不一致',
      },
    ])
  })

  it('稳定拒绝 fixture 世界与固定画布不一致', () => {
    const { config, fixture } = loadProductionInputs()
    const incompatibleFixture = structuredClone(fixture)
    ;(incompatibleFixture.world as { width: number; height: number }).width =
      1580
    ;(incompatibleFixture.world as { width: number; height: number }).height =
      880

    expect(
      validateM1RuntimeCompatibility(
        config,
        incompatibleFixture,
        logicalWorld,
      ),
    ).toEqual([
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/performance/m1-fire-flow.json',
        fieldPath: '/world/width',
        messageZh: 'M1 场景世界宽度 1580 与画布逻辑宽度 1600 不一致',
      },
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/performance/m1-fire-flow.json',
        fieldPath: '/world/height',
        messageZh: 'M1 场景世界高度 880 与画布逻辑高度 900 不一致',
      },
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/parameters.json',
        fieldPath: '/flowField/gridColumns',
        messageZh: 'M1 火流网格宽度 1600 与场景世界宽度 1580 不一致',
      },
      {
        code: 'CONFIG_RUNTIME_INCOMPATIBLE',
        filePath: '/config/parameters.json',
        fieldPath: '/flowField/gridRows',
        messageZh: 'M1 火流网格高度 900 与场景世界高度 880 不一致',
      },
    ])
  })
})
