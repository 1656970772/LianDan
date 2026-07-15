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
      ...gameplay.pearlTypes.map((pearlType) => ({
        recordType: 'rules-json',
        logicalKey: `m2-pearl-type:${pearlType.id}`,
        value: {
          schemaVersion: gameplay.schemaVersion,
          id: pearlType.id,
          pearlType: pearlType.pearlType,
          standardRadius: pearlType.standardRadius,
          spawnVelocity: pearlType.spawnVelocity,
          gravity: pearlType.gravity,
          drift: pearlType.drift,
          maxSpeed: pearlType.maxSpeed,
          materialRestitution: pearlType.materialRestitution,
          wallRestitution: pearlType.wallRestitution,
          fireProtectionSeconds: pearlType.fireProtectionSeconds,
          resetProtectionOnExit: pearlType.resetProtectionOnExit,
          burnDurationSeconds: pearlType.burnDurationSeconds,
          thrustAcceleration: pearlType.thrustAcceleration,
        },
      })),
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
