import type { PrototypeRules } from '../../domain/index.ts'

export const prototypeRules: PrototypeRules = {
  availableFireSourceIds: ['fire.basic'],
  initialFireSize: 30,
  initialFireDirection: { x: 0, y: -1 },
  inventoryBatches: [
    {
      batchId: 'batch.herb',
      materialDefinitionId: 'material.herb',
      servings: 2,
      volumePerServing: 10,
      medicinalLiquidVolumePerServing: 10,
    },
  ],
  settlement: {
    warningThresholds: [0.5, 0.65],
    failureThreshold: 0.7,
    slagUnitVolume: 100,
  },
}
