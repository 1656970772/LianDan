import { createSimulationFingerprintInput } from './fingerprint-input'
import type { FingerprintInput } from './fingerprint'
import type { NormalizedM2GameplayConfig } from './m2-gameplay-model'
import type { DecodedCompositionMap, NormalizedConfig } from './model'

export function createM2SimulationFingerprintInput(
  baseConfig: NormalizedConfig,
  gameplay: NormalizedM2GameplayConfig,
  compositionMaps: readonly DecodedCompositionMap[],
): FingerprintInput {
  const base = createSimulationFingerprintInput(baseConfig, compositionMaps)
  return {
    jsonRecords: [
      ...base.jsonRecords,
      {
        recordType: 'rules-json',
        logicalKey: 'm2-prototype:global',
        value: {
          schemaVersion: gameplay.schemaVersion,
          seed: gameplay.prototype.seed,
          logicalWidth: gameplay.prototype.logicalWidth,
          logicalHeight: gameplay.prototype.logicalHeight,
          materialPlacement: gameplay.prototype.materialPlacement,
          availableFireSourceIds: gameplay.prototype.availableFireSourceIds,
          initialFireSize: gameplay.prototype.initialFireSize,
          fireSizeWheelStep: gameplay.prototype.fireSizeWheelStep,
          initialFireDirection: gameplay.prototype.initialFireDirection,
          inventoryBatches: gameplay.prototype.inventoryBatches,
        },
      },
      ...gameplay.fireSources.map((source) => ({
        recordType: 'rules-json',
        logicalKey: `m2-fire-source:${source.id}`,
        value: {
          schemaVersion: gameplay.schemaVersion,
          id: source.id,
          origin: source.origin,
          halfAngleDegrees: source.halfAngleDegrees,
          minWidth: source.minWidth,
          maxWidth: source.maxWidth,
        },
      })),
      {
        recordType: 'rules-json',
        logicalKey: `m2-pearl-type:${gameplay.pearlType.id}`,
        value: {
          schemaVersion: gameplay.schemaVersion,
          id: gameplay.pearlType.id,
          pearlType: gameplay.pearlType.pearlType,
          standardRadius: gameplay.pearlType.standardRadius,
          spawnVelocity: gameplay.pearlType.spawnVelocity,
          gravity: gameplay.pearlType.gravity,
          drift: gameplay.pearlType.drift,
          maxSpeed: gameplay.pearlType.maxSpeed,
          materialRestitution: gameplay.pearlType.materialRestitution,
        },
      },
      {
        recordType: 'rules-json',
        logicalKey: 'm2-collector:global',
        value: {
          schemaVersion: gameplay.schemaVersion,
          initialX: gameplay.collector.initialX,
          y: gameplay.collector.y,
          width: gameplay.collector.width,
          height: gameplay.collector.height,
          minX: gameplay.collector.minX,
          maxX: gameplay.collector.maxX,
          acceleration: gameplay.collector.acceleration,
          deceleration: gameplay.collector.deceleration,
          maxSpeed: gameplay.collector.maxSpeed,
        },
      },
    ],
    rgbaRecords: base.rgbaRecords,
  }
}
