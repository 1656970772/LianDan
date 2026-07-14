import type { DecodedCompositionMap, NormalizedConfig } from './model'
import type { FingerprintInput } from './fingerprint'

export function createSimulationFingerprintInput(
  config: NormalizedConfig,
  compositionMaps: readonly DecodedCompositionMap[],
): FingerprintInput {
  const mapsByPath = new Map(compositionMaps.map((map) => [map.filePath, map]))
  return {
    jsonRecords: [
      {
        recordType: 'rules-json',
        logicalKey: 'parameters:global',
        value: {
          schemaVersion: config.schemaVersion,
          standardPearlVolume: config.parameters.standardPearlVolume,
          slagUnitVolume: config.parameters.slagUnitVolume,
          simulation: {
            fixedStepHz: config.parameters.simulation.fixedStepHz,
            maxCatchUpSteps: config.parameters.simulation.maxCatchUpSteps,
          },
          flowField: {
            gridColumns: config.parameters.flowField.gridColumns,
            gridRows: config.parameters.flowField.gridRows,
            cellSize: config.parameters.flowField.cellSize,
            circleCoverageSamplesPerAxis:
              config.parameters.flowField.circleCoverageSamplesPerAxis,
            lateralSpread: config.parameters.flowField.lateralSpread,
            obstacleDeflection: config.parameters.flowField.obstacleDeflection,
            partialObstaclePenalty:
              config.parameters.flowField.partialObstaclePenalty,
            mergeRate: config.parameters.flowField.mergeRate,
            fullObstacleThreshold:
              config.parameters.flowField.fullObstacleThreshold,
          },
        },
      },
      ...config.materials.map((material) => ({
        recordType: 'rules-json',
        logicalKey: `material:${material.id}`,
        value: {
          schemaVersion: config.schemaVersion,
          id: material.id,
          targetPearlCount: material.targetPearlCount,
        },
      })),
    ],
    rgbaRecords: config.materials.map((material) => {
      const map = mapsByPath.get(material.compositionMapPath)
      if (map === undefined) {
        throw new Error(`材料 ${material.id} 缺少已解码成分图`)
      }
      return {
        recordType: 'composition-rgba',
        logicalKey: `material:${material.id}`,
        width: map.width,
        height: map.height,
        rgba: map.rgba,
      }
    }),
  }
}
