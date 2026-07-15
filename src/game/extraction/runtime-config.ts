import type {
  DecodedCompositionMap,
  NormalizedM2Config,
} from '../../config/index.ts'
import type { PrototypeRules } from '../../domain/index.ts'
import type {
  ExtractionPearlPhysicsConfig,
  ExtractionSimulationConfig,
} from '../../simulation/index.ts'

export type M2RuntimeConfiguration = Readonly<{
  rules: PrototypeRules
  simulation: ExtractionSimulationConfig
}>

function compositionCodes(map: DecodedCompositionMap): Uint8Array {
  if (map.width !== 64 || map.height !== 64 || map.rgba.length !== 64 * 64 * 4) {
    throw new Error(`M2_COMPOSITION_MAP_INVALID:${map.filePath}`)
  }
  const result = new Uint8Array(64 * 64)
  const rgba = map.rgba
  for (let index = 0; index < result.length; index += 1) {
    const offset = index * 4
    const red = rgba[offset]!
    const green = rgba[offset + 1]!
    const blue = rgba[offset + 2]!
    const alpha = rgba[offset + 3]!
    if (red === 0 && green === 0 && blue === 0 && alpha === 0) {
      result[index] = 0
      continue
    }
    if (red === 0 && green === 255 && blue === 255 && alpha === 255) {
      result[index] = 1
      continue
    }
    const x = index % 64
    const y = Math.floor(index / 64)
    throw new Error(
      `M2_COMPOSITION_MAP_UNSUPPORTED_COLOR:${map.filePath}:/pixels/${y}/${x}`,
    )
  }
  return result
}

export function createM2RuntimeConfiguration(
  config: NormalizedM2Config,
  compositionMaps: readonly DecodedCompositionMap[],
): M2RuntimeConfiguration {
  const { base, gameplay } = config
  const prototype = gameplay.prototype
  const fireSource = gameplay.fireSources.find((candidate) =>
    prototype.availableFireSourceIds.includes(candidate.id),
  )
  if (fireSource === undefined) throw new Error('M2_FIRE_SOURCE_NOT_FOUND')

  const materialById = new Map(
    base.materials.map((material) => [material.id, material] as const),
  )
  const mapByPath = new Map(
    compositionMaps.map((map) => [map.filePath, map] as const),
  )

  const materials = base.materials.map((material) => {
    const map = mapByPath.get(material.compositionMapPath)
    if (map === undefined) {
      throw new Error(`M2_COMPOSITION_MAP_MISSING:${material.compositionMapPath}`)
    }
    return {
      id: material.id,
      targetPearlCount: material.targetPearlCount,
      composition: compositionCodes(map),
    }
  })

  const inventoryBatches = prototype.inventoryBatches.map((batch) => {
    const material = materialById.get(batch.materialDefinitionId)
    if (material === undefined) {
      throw new Error(`M2_MATERIAL_DEFINITION_NOT_FOUND:${batch.materialDefinitionId}`)
    }
    return {
      ...batch,
      volumePerServing:
        material.targetPearlCount * base.parameters.standardPearlVolume,
    }
  })

  const pearlType = gameplay.pearlType
  const pearlPhysics: ExtractionPearlPhysicsConfig = {
    radiusAtStandardVolume: pearlType.standardRadius,
    spawnVelocity: { ...pearlType.spawnVelocity },
    gravity: pearlType.gravity,
    driftX: pearlType.drift,
    maxSpeed: pearlType.maxSpeed,
    materialRestitution: pearlType.materialRestitution,
  }
  const flow = base.parameters.flowField
  const collector = gameplay.collector

  return {
    rules: {
      availableFireSourceIds: [...prototype.availableFireSourceIds],
      initialFireSize: prototype.initialFireSize,
      initialFireDirection: { ...prototype.initialFireDirection },
      inventoryBatches,
    },
    simulation: {
      seed: prototype.seed,
      standardPearlVolume: base.parameters.standardPearlVolume,
      fixedDeltaSeconds: 1 / base.parameters.simulation.fixedStepHz,
      dissolutionVolumePerTick: base.parameters.dissolution.volumePerTick,
      exposureProbeDistance: base.parameters.dissolution.exposureProbeDistance,
      fireFlow: {
        geometry: {
          columns: flow.gridColumns,
          rows: flow.gridRows,
          cellSize: flow.cellSize,
          originX: 0,
          originY: 0,
        },
        solver: {
          circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
          lateralSpread: flow.lateralSpread,
          obstacleDeflection: flow.obstacleDeflection,
          partialObstaclePenalty: flow.partialObstaclePenalty,
          mergeRate: flow.mergeRate,
          fullObstacleThreshold: flow.fullObstacleThreshold,
        },
      },
      materials,
      materialPlacement: {
        center: {
          x: prototype.materialPlacement.centerX,
          y: prototype.materialPlacement.centerY,
        },
        width: prototype.materialPlacement.size,
        height: prototype.materialPlacement.size,
        offsetPerInstance: { ...prototype.materialPlacement.offsetPerInstance },
        rotationRadiansPerInstance:
          (prototype.materialPlacement.rotationDegreesPerInstance * Math.PI) / 180,
      },
      fireSource: {
        origin: { ...fireSource.origin },
        halfAngleRadians: (fireSource.halfAngleDegrees * Math.PI) / 180,
        minWidth: fireSource.minWidth,
        maxWidth: fireSource.maxWidth,
      },
      pearlPhysics: {
        medicinalLiquid: pearlPhysics,
        slag: pearlPhysics,
        impurity: pearlPhysics,
      },
      collector: {
        initialCenter: { x: collector.initialX, y: collector.y },
        width: collector.width,
        height: collector.height,
        trackMinX: collector.minX,
        trackMaxX: collector.maxX,
        acceleration: collector.acceleration,
        deceleration: collector.deceleration,
        maxSpeed: collector.maxSpeed,
      },
      worldBounds: {
        left: 0,
        top: 0,
        right: prototype.logicalWidth,
        bottom: prototype.logicalHeight,
      },
    },
  }
}
