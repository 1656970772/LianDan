import { describe, expect, it } from 'vitest'

import {
  createDomainState,
  deriveLossRate,
  deriveNormalSlagQuantity,
  evaluateExtractionState,
  type DomainState,
  type PrototypeRules,
} from '../../domain/index.ts'

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
  inventoryBatches: [],
  settlement: {
    warningThresholds: [0.5, 0.65],
    failureThreshold: 0.7,
    slagUnitVolume: 4,
  },
}

function extractingAtLoss(lossVolume: number): DomainState {
  const state = createDomainState(rules)
  return {
    ...state,
    status: 'extracting',
    materialInstances: [
      {
        materialInstanceId: 'material-instance-1',
        materialDefinitionId: 'material.herb',
        inventoryBatchId: 'batch.herb',
        initialVolume: 10,
        remainingVolume: 3,
      },
    ],
    ledger: {
      ...state.ledger,
      theoreticalMedicinalVolumes: { 'material-instance-1': 10 },
      naturalLossVolume: lossVolume,
      pearlVolumes: {
        caught: 2,
        active: 1,
        missed: 1,
        burned: 0,
      },
      terminalPearls: {
        caught: 'caught',
        missed: 'missed',
        burned: 'burned',
      },
      slagPoolVolumes: {
        medicinalLiquid: 1,
        slag: 2,
        impurity: 1,
      },
    },
  }
}

describe('M3 统一体积台账与阈值', () => {
  it.each([
    { loss: 4.999, warning: 0, status: 'extracting' },
    { loss: 5, warning: 1, status: 'extracting' },
    { loss: 6.5, warning: 2, status: 'extracting' },
    { loss: 7, warning: 2, status: 'extracting' },
    { loss: 7.000_001, warning: 2, status: 'failed' },
  ] as const)(
    '理论药液 10、损失 $loss 时警告 $warning 且状态为 $status',
    ({ loss, warning, status }) => {
      const before = extractingAtLoss(loss)
      const after = evaluateExtractionState(before, rules)

      expect(deriveLossRate(after)).toBeCloseTo(Math.min(1, loss / 10), 8)
      expect(after.lossWarningLevel).toBe(warning)
      expect(after.status).toBe(status)
      if (status === 'failed') {
        expect(after.failureResult).toEqual({
          reason: 'excessiveMedicinalLoss',
          remainingEntityVolume: 6,
          slagQuantity: 1,
        })
      } else {
        expect(after.failureResult).toBeNull()
      }
    },
  )

  it('正常药渣只换算炉底池，同一落空体积不会重复结算', () => {
    const state = extractingAtLoss(2)

    expect(deriveNormalSlagQuantity(state, rules)).toBe(1)
    expect(
      state.ledger.slagPoolVolumes.medicinalLiquid +
        state.ledger.slagPoolVolumes.slag +
        state.ledger.slagPoolVolumes.impurity,
    ).toBe(4)
  })
})
