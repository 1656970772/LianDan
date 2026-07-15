import { describe, expect, it } from 'vitest'

import { computeSimulationContentFingerprint } from '../../config/fingerprint'
import { createSimulationFingerprintInput } from '../../config/fingerprint-input'
import type {
  DecodedCompositionMap,
  NormalizedConfig,
} from '../../config/model'

const FLOW_RULES = {
  gridColumns: 80,
  gridRows: 45,
  cellSize: 20,
  circleCoverageSamplesPerAxis: 2,
  lateralSpread: 0.35,
  obstacleDeflection: 0.75,
  partialObstaclePenalty: 0.5,
  mergeRate: 0.15,
  fullObstacleThreshold: 0.95,
} as const

function normalizedConfig(flowField: object = FLOW_RULES): NormalizedConfig {
  return {
    schemaVersion: 1,
    parameters: {
      standardPearlVolume: 1,
      slagUnitVolume: 100,
      simulation: { fixedStepHz: 30, maxCatchUpSteps: 5 },
      flowField,
      dissolution: { volumePerTick: 0.18, exposureProbeDistance: 18 },
    },
    materials: [
      {
        id: 'prototype-herb',
        nameZh: '原型药材',
        targetPearlCount: 300,
        compositionMapPath: '/assets/masks/prototype-herb-components.png',
        appearancePath: '/assets/materials/prototype-herb.png',
      },
    ],
  } as unknown as NormalizedConfig
}

function compositionMaps(): readonly DecodedCompositionMap[] {
  const rgba = new Uint8Array(64 * 64 * 4)
  rgba.set([0, 255, 255, 255], 0)
  return [
    {
      filePath: '/assets/masks/prototype-herb-components.png',
      width: 64,
      height: 64,
      rgba,
    },
  ]
}

async function fingerprint(config: NormalizedConfig): Promise<string> {
  const result = await computeSimulationContentFingerprint(
    createSimulationFingerprintInput(config, compositionMaps()),
  )
  return result.simulationContentFingerprint
}

describe('createSimulationFingerprintInput', () => {
  it('纳入全部标准化 simulation 与 flowField 规则', () => {
    const input = createSimulationFingerprintInput(
      normalizedConfig(),
      compositionMaps(),
    )

    expect(input.jsonRecords[0]?.value).toEqual({
      schemaVersion: 1,
      standardPearlVolume: 1,
      slagUnitVolume: 100,
      simulation: {
        fixedStepHz: 30,
        maxCatchUpSteps: 5,
      },
      flowField: FLOW_RULES,
      dissolution: {
        volumePerTick: 0.18,
        exposureProbeDistance: 18,
      },
    })
  })

  it('flowField 对象键序变化不改变 fingerprint', async () => {
    const reorderedFlowRules = Object.fromEntries(
      Object.entries(FLOW_RULES).reverse(),
    )

    await expect(
      Promise.all([
        fingerprint(normalizedConfig()),
        fingerprint(normalizedConfig(reorderedFlowRules)),
      ]),
    ).resolves.toSatisfy(([left, right]: [string, string]) => left === right)
  })

  it.each(Object.keys(FLOW_RULES) as (keyof typeof FLOW_RULES)[])(
    '任一 flowField 规则 %s 变化都会改变 fingerprint',
    async (field) => {
      const changed = { ...FLOW_RULES, [field]: FLOW_RULES[field] + 0.01 }
      const [left, right] = await Promise.all([
        fingerprint(normalizedConfig()),
        fingerprint(normalizedConfig(changed)),
      ])

      expect(left).not.toBe(right)
    },
  )

  it.each(['volumePerTick', 'exposureProbeDistance'] as const)(
    '任一 dissolution 规则 %s 变化都会改变 fingerprint',
    async (field) => {
      const base = normalizedConfig()
      const changed: NormalizedConfig = {
        ...base,
        parameters: {
          ...base.parameters,
          dissolution: {
            ...base.parameters.dissolution,
            [field]: base.parameters.dissolution[field] + 0.01,
          },
        },
      }

      expect(await fingerprint(base)).not.toBe(await fingerprint(changed))
    },
  )

  it('纯表现 appearancePath 与 nameZh 变化不改变 fingerprint', async () => {
    const base = normalizedConfig()
    const changed: NormalizedConfig = {
      ...base,
      materials: base.materials.map((material, index) =>
        index === 0
          ? {
              ...material,
              nameZh: '重命名药材',
              appearancePath: '/assets/materials/renamed.png',
            }
          : material,
      ),
    }

    expect(await fingerprint(base)).toBe(await fingerprint(changed))
  })
})
