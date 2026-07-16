import { describe, expect, test } from 'vitest'

import { copyM5MaterialTopologyEvidence } from '../../game/extraction/m5-material-topology-evidence.ts'
import type { ExtractionSimulationReadView } from '../../simulation/index.ts'
import { orientedMaterialRectanglesHaveInteriorIntersection } from '../../shared/material-placement-geometry.ts'

function readView(): ExtractionSimulationReadView {
  const initial = Array.from({ length: 64 * 64 }, () => 1)
  const remaining = [...initial]
  return {
    tick: 7,
    materials: [
      {
        materialInstanceId: 'material-1',
        materialDefinitionId: 'red_whisker_ginseng',
        inventoryBatchId: 'batch-1',
        placement: {
          center: { x: 600, y: 285 },
          width: 160,
          height: 150,
          rotationRadians: 0.1,
          layer: 2,
        },
        initialVolume: 4_096,
        remainingVolume: 4_095,
        initialVolumeByType: {
          medicinalLiquid: 4_096,
          slag: 0,
          impurity: 0,
        },
        composition: initial,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
      },
    ],
    pearls: [],
    collector: {
      center: { x: 600, y: 820 },
      width: 180,
      height: 36,
      velocityX: 0,
    },
    fireFlow: {
      generation: 1,
      tick: 7,
      columns: 1,
      rows: 1,
      cellSize: 1,
      originX: 0,
      originY: 0,
      obstacle: new Float32Array(1),
      flowX: new Float32Array(1),
      flowY: new Float32Array(1),
      intensity: new Uint8Array(1),
    },
    effectiveFireSource: null,
    activeInteractions: [],
    interactionCount: 0,
  }
}

function rectangularComposition(
  firstColumn: number,
  lastColumnExclusive: number,
  firstRow: number,
  lastRowExclusive: number,
): number[] {
  const composition = Array.from({ length: 64 * 64 }, () => 0)
  for (let row = firstRow; row < lastRowExclusive; row += 1) {
    for (let column = firstColumn; column < lastColumnExclusive; column += 1) {
      composition[row * 64 + column] = 1
    }
  }
  return composition
}

function contentAwarePairReadView(): ExtractionSimulationReadView {
  const redComposition = rectangularComposition(9, 55, 6, 57)
  const azureComposition = rectangularComposition(13, 51, 2, 62)
  const base = readView()
  const template = base.materials[0]!
  const material = (
    materialInstanceId: string,
    materialDefinitionId: string,
    inventoryBatchId: string,
    placement: typeof template.placement,
    composition: readonly number[],
  ) => ({
    ...template,
    materialInstanceId,
    materialDefinitionId,
    inventoryBatchId,
    placement,
    composition,
    initialCellVolumes: composition,
    remainingCellVolumes: composition,
    initialVolume: composition.reduce((total, code) => total + code, 0),
    remainingVolume: composition.reduce((total, code) => total + code, 0),
  })
  return {
    ...base,
    materials: [
      material(
        'material-red',
        'red_whisker_ginseng',
        'batch-red',
        {
          center: { x: 711, y: 526.666_666_666_7 },
          width: 213.333_333_333_3,
          height: 213.333_333_333_3,
          rotationRadians: 0,
          layer: 0,
        },
        redComposition,
      ),
      material(
        'material-azure',
        'azure_dew_leaf',
        'batch-azure',
        {
          center: { x: 885, y: 525 },
          width: 181.333_333_333_3,
          height: 181.333_333_333_3,
          rotationRadians: 0,
          layer: 1,
        },
        azureComposition,
      ),
    ],
  }
}

describe('M5 材料拓扑证据按需副本', () => {
  test('完整复制权威网格与放置数据，且调用结果深隔离', () => {
    const view = readView()
    const first = copyM5MaterialTopologyEvidence(view)
    const second = copyM5MaterialTopologyEvidence(view)

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      materialInstanceId: 'material-1',
      materialDefinitionId: 'red_whisker_ginseng',
      inventoryBatchId: 'batch-1',
      gridWidth: 64,
      gridHeight: 64,
      initialVolume: 4_096,
      remainingVolume: 4_095,
      placement: { center: { x: 600, y: 285 } },
    })
    expect(first[0]!.initialCellVolumes).toHaveLength(4_096)
    expect(first[0]!.remainingCellVolumes).toHaveLength(4_096)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first[0]!.placement).not.toBe(second[0]!.placement)
    expect(first[0]!.placement.center).not.toBe(second[0]!.placement.center)
    expect(first[0]!.initialCellVolumes).not.toBe(
      second[0]!.initialCellVolumes,
    )

    ;(first[0]!.placement.center as { x: number }).x = -1
    ;(first[0]!.initialCellVolumes as number[])[0] = -1
    ;(first[0]!.remainingCellVolumes as number[])[0] = -1
    const third = copyM5MaterialTopologyEvidence(view)
    expect(third[0]!.placement.center.x).toBe(600)
    expect(third[0]!.initialCellVolumes[0]).toBe(1)
    expect(third[0]!.remainingCellVolumes[0]).toBe(1)
  })

  test('公开深复制的内容 OBB，透明 full frame 相交时仍能证明真实内容不相交', () => {
    const first = copyM5MaterialTopologyEvidence(contentAwarePairReadView())
    const second = copyM5MaterialTopologyEvidence(contentAwarePairReadView())

    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        first[0]!.placement,
        first[1]!.placement,
      ),
    ).toBe(true)
    expect(
      orientedMaterialRectanglesHaveInteriorIntersection(
        first[0]!.contentPlacement,
        first[1]!.contentPlacement,
      ),
    ).toBe(false)
    expect(first[0]!.contentPlacement).not.toBe(second[0]!.contentPlacement)
    expect(first[0]!.contentPlacement.center).not.toBe(
      second[0]!.contentPlacement.center,
    )
  })
})
