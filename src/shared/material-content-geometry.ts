import type { OrientedMaterialRectangle } from './material-placement-geometry.ts'

export const MATERIAL_COMPOSITION_GRID_SIZE = 64
export const MATERIAL_COMPOSITION_CELL_COUNT =
  MATERIAL_COMPOSITION_GRID_SIZE * MATERIAL_COMPOSITION_GRID_SIZE

export type MaterialContentBounds = Readonly<{
  leftColumn: number
  topRow: number
  rightColumn: number
  bottomRow: number
  widthCells: number
  heightCells: number
}>

export type MaterialFrameLayout = Readonly<{
  frameWidth: number
  frameHeight: number
  contentWidth: number
  contentHeight: number
  localContentCenter: Readonly<{ x: number; y: number }>
  bounds: MaterialContentBounds
}>

type MaterialFramePlacement = Readonly<{
  center: Readonly<{ x: number; y: number }>
  width: number
  height: number
  rotationRadians: number
}>

export function deriveMaterialContentBounds(
  composition: ArrayLike<number>,
): MaterialContentBounds {
  if (composition.length !== MATERIAL_COMPOSITION_CELL_COUNT) {
    throw new RangeError('MATERIAL_CONTENT_COMPOSITION_SIZE_INVALID')
  }
  let leftColumn = MATERIAL_COMPOSITION_GRID_SIZE
  let topRow = MATERIAL_COMPOSITION_GRID_SIZE
  let rightColumn = 0
  let bottomRow = 0
  for (let index = 0; index < composition.length; index += 1) {
    if ((composition[index] ?? 0) === 0) continue
    const column = index % MATERIAL_COMPOSITION_GRID_SIZE
    const row = Math.floor(index / MATERIAL_COMPOSITION_GRID_SIZE)
    leftColumn = Math.min(leftColumn, column)
    topRow = Math.min(topRow, row)
    rightColumn = Math.max(rightColumn, column + 1)
    bottomRow = Math.max(bottomRow, row + 1)
  }
  if (rightColumn <= leftColumn || bottomRow <= topRow) {
    throw new RangeError('MATERIAL_CONTENT_COMPOSITION_EMPTY')
  }
  return {
    leftColumn,
    topRow,
    rightColumn,
    bottomRow,
    widthCells: rightColumn - leftColumn,
    heightCells: bottomRow - topRow,
  }
}

export function deriveMaterialFrameLayout(
  composition: ArrayLike<number>,
  visibleLongEdge: number,
): MaterialFrameLayout {
  if (!Number.isFinite(visibleLongEdge) || visibleLongEdge <= 0) {
    throw new RangeError('MATERIAL_CONTENT_VISIBLE_LONG_EDGE_INVALID')
  }
  const bounds = deriveMaterialContentBounds(composition)
  const scale =
    visibleLongEdge / Math.max(bounds.widthCells, bounds.heightCells)
  const frameWidth = MATERIAL_COMPOSITION_GRID_SIZE * scale
  const frameHeight = MATERIAL_COMPOSITION_GRID_SIZE * scale
  return {
    frameWidth,
    frameHeight,
    contentWidth: bounds.widthCells * scale,
    contentHeight: bounds.heightCells * scale,
    localContentCenter: {
      x:
        ((bounds.leftColumn + bounds.rightColumn) * 0.5 -
          MATERIAL_COMPOSITION_GRID_SIZE * 0.5) *
        scale,
      y:
        ((bounds.topRow + bounds.bottomRow) * 0.5 -
          MATERIAL_COMPOSITION_GRID_SIZE * 0.5) *
        scale,
    },
    bounds,
  }
}

export function alignMaterialFrameToContentCenter(
  contentCenter: Readonly<{ x: number; y: number }>,
  rotationRadians: number,
  layout: MaterialFrameLayout,
): Readonly<{ x: number; y: number }> {
  const cosine = Math.cos(rotationRadians)
  const sine = Math.sin(rotationRadians)
  const offsetX =
    layout.localContentCenter.x * cosine -
    layout.localContentCenter.y * sine
  const offsetY =
    layout.localContentCenter.x * sine +
    layout.localContentCenter.y * cosine
  return {
    x: contentCenter.x - offsetX,
    y: contentCenter.y - offsetY,
  }
}

export function deriveMaterialContentRectangle(
  placement: MaterialFramePlacement,
  composition: ArrayLike<number>,
): OrientedMaterialRectangle {
  const bounds = deriveMaterialContentBounds(composition)
  const cellWidth = placement.width / MATERIAL_COMPOSITION_GRID_SIZE
  const cellHeight = placement.height / MATERIAL_COMPOSITION_GRID_SIZE
  const localCenterX =
    ((bounds.leftColumn + bounds.rightColumn) * 0.5 -
      MATERIAL_COMPOSITION_GRID_SIZE * 0.5) *
    cellWidth
  const localCenterY =
    ((bounds.topRow + bounds.bottomRow) * 0.5 -
      MATERIAL_COMPOSITION_GRID_SIZE * 0.5) *
    cellHeight
  const cosine = Math.cos(placement.rotationRadians)
  const sine = Math.sin(placement.rotationRadians)
  return {
    center: {
      x:
        placement.center.x +
        localCenterX * cosine -
        localCenterY * sine,
      y:
        placement.center.y +
        localCenterX * sine +
        localCenterY * cosine,
    },
    width: bounds.widthCells * cellWidth,
    height: bounds.heightCells * cellHeight,
    rotationRadians: placement.rotationRadians,
  }
}
