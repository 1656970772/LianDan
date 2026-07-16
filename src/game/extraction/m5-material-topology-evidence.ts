import {
  EXTRACTION_COMPOSITION_GRID_SIZE,
  type ExtractionMaterialPlacement,
  type ExtractionSimulationReadView,
} from '../../simulation/index.ts'
import { deriveMaterialContentRectangle } from '../../shared/material-content-geometry.ts'

export type M5MaterialTopologyEvidence = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: ExtractionMaterialPlacement
  contentPlacement: ExtractionMaterialPlacement
  gridWidth: number
  gridHeight: number
  initialVolume: number
  remainingVolume: number
  composition: readonly number[]
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
}>

/**
 * Evidence grids are deliberately copied only when the external evidence API
 * asks for them. They never become part of the normal per-frame snapshot or
 * canvas dataset.
 */
export function copyM5MaterialTopologyEvidence(
  view: ExtractionSimulationReadView,
): readonly M5MaterialTopologyEvidence[] {
  return view.materials.map((material) => {
    const contentRectangle = deriveMaterialContentRectangle(
      material.placement,
      material.composition,
    )
    return {
      materialInstanceId: material.materialInstanceId,
      materialDefinitionId: material.materialDefinitionId,
      inventoryBatchId: material.inventoryBatchId,
      placement: {
        ...material.placement,
        center: { ...material.placement.center },
      },
      contentPlacement: {
        ...contentRectangle,
        center: { ...contentRectangle.center },
        layer: material.placement.layer,
      },
      gridWidth: EXTRACTION_COMPOSITION_GRID_SIZE,
      gridHeight: EXTRACTION_COMPOSITION_GRID_SIZE,
      initialVolume: material.initialVolume,
      remainingVolume: material.remainingVolume,
      composition: [...material.composition],
      initialCellVolumes: [...material.initialCellVolumes],
      remainingCellVolumes: [...material.remainingCellVolumes],
    }
  })
}
