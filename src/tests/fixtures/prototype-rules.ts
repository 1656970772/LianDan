import type { PrototypeRules } from '../../domain/index.ts'

export const prototypeRules: PrototypeRules = {
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
