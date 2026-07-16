import type { FireFlowGridGeometry, FireFlowReadView } from '../fire-flow/index.ts'
import {
  EXTRACTION_COMPOSITION_GRID_SIZE,
  type ExtractionMaterialPlacement,
  type ExtractionVector,
} from './contracts.ts'

export type MaterialGeometryState = Readonly<{
  placement: ExtractionMaterialPlacement
  remainingCellVolumes: ArrayLike<number>
}>

const GRID_SIZE = EXTRACTION_COMPOSITION_GRID_SIZE

function rotateWorldToLocal(
  placement: ExtractionMaterialPlacement,
  point: ExtractionVector,
): ExtractionVector {
  const deltaX = point.x - placement.center.x
  const deltaY = point.y - placement.center.y
  const cosine = Math.cos(placement.rotationRadians)
  const sine = Math.sin(placement.rotationRadians)
  return {
    x: deltaX * cosine + deltaY * sine,
    y: -deltaX * sine + deltaY * cosine,
  }
}

function rotateLocalToWorld(
  placement: ExtractionMaterialPlacement,
  localX: number,
  localY: number,
): ExtractionVector {
  const cosine = Math.cos(placement.rotationRadians)
  const sine = Math.sin(placement.rotationRadians)
  return {
    x: placement.center.x + localX * cosine - localY * sine,
    y: placement.center.y + localX * sine + localY * cosine,
  }
}

export function materialCellWorldPosition(
  material: MaterialGeometryState,
  cellIndex: number,
): ExtractionVector {
  const column = cellIndex % GRID_SIZE
  const row = Math.floor(cellIndex / GRID_SIZE)
  const localX = ((column + 0.5) / GRID_SIZE - 0.5) * material.placement.width
  const localY = ((row + 0.5) / GRID_SIZE - 0.5) * material.placement.height
  return rotateLocalToWorld(material.placement, localX, localY)
}

function materialCellWorldSample(
  material: MaterialGeometryState,
  cellIndex: number,
  columnRatio: number,
  rowRatio: number,
): ExtractionVector {
  const column = cellIndex % GRID_SIZE
  const row = Math.floor(cellIndex / GRID_SIZE)
  const localX = ((column + columnRatio) / GRID_SIZE - 0.5) * material.placement.width
  const localY = ((row + rowRatio) / GRID_SIZE - 0.5) * material.placement.height
  return rotateLocalToWorld(material.placement, localX, localY)
}

export function materialWorldToCellIndex(
  material: MaterialGeometryState,
  point: ExtractionVector,
): number | null {
  const { x: localX, y: localY } = rotateWorldToLocal(material.placement, point)
  const normalizedX = localX / material.placement.width + 0.5
  const normalizedY = localY / material.placement.height + 0.5
  if (
    normalizedX < 0 ||
    normalizedX >= 1 ||
    normalizedY < 0 ||
    normalizedY >= 1
  ) {
    return null
  }
  const column = Math.floor(normalizedX * GRID_SIZE)
  const row = Math.floor(normalizedY * GRID_SIZE)
  return row * GRID_SIZE + column
}

function segmentIntersectsAxisAlignedBox(
  start: ExtractionVector,
  end: ExtractionVector,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const interiorEpsilon =
    Math.max(1, right - left, bottom - top) * 1e-9
  left += interiorEpsilon
  top += interiorEpsilon
  right -= interiorEpsilon
  bottom -= interiorEpsilon
  if (left >= right || top >= bottom) return false
  let minimumTime = 0
  let maximumTime = 1
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  for (const [origin, delta, minimum, maximum] of [
    [start.x, deltaX, left, right],
    [start.y, deltaY, top, bottom],
  ] as const) {
    if (Math.abs(delta) <= Number.EPSILON) {
      if (origin < minimum || origin > maximum) return false
      continue
    }
    const first = (minimum - origin) / delta
    const second = (maximum - origin) / delta
    minimumTime = Math.max(minimumTime, Math.min(first, second))
    maximumTime = Math.min(maximumTime, Math.max(first, second))
    if (minimumTime > maximumTime) return false
  }
  return true
}

export function segmentIntersectsRemainingMaterial(
  materials: readonly MaterialGeometryState[],
  start: ExtractionVector,
  end: ExtractionVector,
  ignored?: Readonly<{ material: MaterialGeometryState; cellIndex: number }>,
): boolean {
  for (const material of materials) {
    const localStart = rotateWorldToLocal(material.placement, start)
    const localEnd = rotateWorldToLocal(material.placement, end)
    const cellWidth = material.placement.width / GRID_SIZE
    const cellHeight = material.placement.height / GRID_SIZE
    const halfWidth = material.placement.width * 0.5
    const halfHeight = material.placement.height * 0.5
    const minimumColumn = Math.max(
      0,
      Math.floor((Math.min(localStart.x, localEnd.x) + halfWidth) / cellWidth),
    )
    const maximumColumn = Math.min(
      GRID_SIZE - 1,
      Math.floor((Math.max(localStart.x, localEnd.x) + halfWidth) / cellWidth),
    )
    const minimumRow = Math.max(
      0,
      Math.floor((Math.min(localStart.y, localEnd.y) + halfHeight) / cellHeight),
    )
    const maximumRow = Math.min(
      GRID_SIZE - 1,
      Math.floor((Math.max(localStart.y, localEnd.y) + halfHeight) / cellHeight),
    )
    if (minimumColumn > maximumColumn || minimumRow > maximumRow) continue

    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const top = -halfHeight + row * cellHeight
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const cellIndex = row * GRID_SIZE + column
        if (
          ignored !== undefined &&
          ignored.material === material &&
          ignored.cellIndex === cellIndex
        ) {
          continue
        }
        if ((material.remainingCellVolumes[cellIndex] ?? 0) <= 0) continue
        const left = -halfWidth + column * cellWidth
        if (
          segmentIntersectsAxisAlignedBox(
            localStart,
            localEnd,
            left,
            top,
            left + cellWidth,
            top + cellHeight,
          )
        ) {
          return true
        }
      }
    }
  }
  return false
}

export function pointInsideRemainingMaterial(
  materials: readonly MaterialGeometryState[],
  point: ExtractionVector,
  ignored?: Readonly<{ material: MaterialGeometryState; cellIndex: number }>,
): boolean {
  for (const material of materials) {
    const cellIndex = materialWorldToCellIndex(material, point)
    if (cellIndex === null) continue
    if (
      ignored !== undefined &&
      ignored.material === material &&
      ignored.cellIndex === cellIndex
    ) {
      continue
    }
    if ((material.remainingCellVolumes[cellIndex] ?? 0) > 0) return true
  }
  return false
}

export function circleIntersectsRemainingMaterial(
  materials: readonly MaterialGeometryState[],
  center: ExtractionVector,
  radius: number,
): boolean {
  const radiusSquared = radius * radius
  for (const material of materials) {
    const localCenter = rotateWorldToLocal(material.placement, center)
    const cellWidth = material.placement.width / GRID_SIZE
    const cellHeight = material.placement.height / GRID_SIZE
    const halfWidth = material.placement.width * 0.5
    const halfHeight = material.placement.height * 0.5
    const minimumColumn = Math.max(
      0,
      Math.floor((localCenter.x - radius + halfWidth) / cellWidth),
    )
    const maximumColumn = Math.min(
      GRID_SIZE - 1,
      Math.floor((localCenter.x + radius + halfWidth) / cellWidth),
    )
    const minimumRow = Math.max(
      0,
      Math.floor((localCenter.y - radius + halfHeight) / cellHeight),
    )
    const maximumRow = Math.min(
      GRID_SIZE - 1,
      Math.floor((localCenter.y + radius + halfHeight) / cellHeight),
    )
    if (minimumColumn > maximumColumn || minimumRow > maximumRow) continue

    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const top = -halfHeight + row * cellHeight
      const bottom = top + cellHeight
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const cellIndex = row * GRID_SIZE + column
        if ((material.remainingCellVolumes[cellIndex] ?? 0) <= 0) continue
        const left = -halfWidth + column * cellWidth
        const right = left + cellWidth
        const closestX = Math.max(left, Math.min(right, localCenter.x))
        const closestY = Math.max(top, Math.min(bottom, localCenter.y))
        const deltaX = localCenter.x - closestX
        const deltaY = localCenter.y - closestY
        if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) return true
      }
    }
  }
  return false
}

/**
 * 返回圆与剩余材料格最深接触处、由材料指向圆心的世界法线。
 * 相同穿透量按材料与 cell 的稳定遍历顺序取首个，保证 replay 确定性。
 */
export function circleRemainingMaterialCollisionNormal(
  materials: readonly MaterialGeometryState[],
  center: ExtractionVector,
  radius: number,
): ExtractionVector | null {
  const radiusSquared = radius * radius
  let deepestPenetration = -1
  let collisionNormal: ExtractionVector | null = null
  for (const material of materials) {
    const localCenter = rotateWorldToLocal(material.placement, center)
    const cellWidth = material.placement.width / GRID_SIZE
    const cellHeight = material.placement.height / GRID_SIZE
    const halfWidth = material.placement.width * 0.5
    const halfHeight = material.placement.height * 0.5
    const minimumColumn = Math.max(
      0,
      Math.floor((localCenter.x - radius + halfWidth) / cellWidth),
    )
    const maximumColumn = Math.min(
      GRID_SIZE - 1,
      Math.floor((localCenter.x + radius + halfWidth) / cellWidth),
    )
    const minimumRow = Math.max(
      0,
      Math.floor((localCenter.y - radius + halfHeight) / cellHeight),
    )
    const maximumRow = Math.min(
      GRID_SIZE - 1,
      Math.floor((localCenter.y + radius + halfHeight) / cellHeight),
    )
    if (minimumColumn > maximumColumn || minimumRow > maximumRow) continue

    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const top = -halfHeight + row * cellHeight
      const bottom = top + cellHeight
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const cellIndex = row * GRID_SIZE + column
        if ((material.remainingCellVolumes[cellIndex] ?? 0) <= 0) continue
        const left = -halfWidth + column * cellWidth
        const right = left + cellWidth
        const closestX = Math.max(left, Math.min(right, localCenter.x))
        const closestY = Math.max(top, Math.min(bottom, localCenter.y))
        const deltaX = localCenter.x - closestX
        const deltaY = localCenter.y - closestY
        const distanceSquared = deltaX * deltaX + deltaY * deltaY
        if (distanceSquared > radiusSquared) continue

        let localNormalX: number
        let localNormalY: number
        let penetration: number
        if (distanceSquared > Number.EPSILON) {
          const distance = Math.sqrt(distanceSquared)
          localNormalX = deltaX / distance
          localNormalY = deltaY / distance
          penetration = radius - distance
        } else {
          const edgeDistances = [
            { distance: localCenter.x - left, x: -1, y: 0 },
            { distance: right - localCenter.x, x: 1, y: 0 },
            { distance: localCenter.y - top, x: 0, y: -1 },
            { distance: bottom - localCenter.y, x: 0, y: 1 },
          ]
          const nearestEdge = edgeDistances.reduce((nearest, candidate) =>
            candidate.distance < nearest.distance ? candidate : nearest,
          )
          localNormalX = nearestEdge.x
          localNormalY = nearestEdge.y
          penetration = radius + nearestEdge.distance
        }
        if (penetration <= deepestPenetration) continue
        const cosine = Math.cos(material.placement.rotationRadians)
        const sine = Math.sin(material.placement.rotationRadians)
        deepestPenetration = penetration
        collisionNormal = {
          x: localNormalX * cosine - localNormalY * sine,
          y: localNormalX * sine + localNormalY * cosine,
        }
      }
    }
  }
  return collisionNormal
}

function markFlowCell(
  result: Uint8Array,
  geometry: FireFlowGridGeometry,
  point: ExtractionVector,
): void {
  const column = Math.floor((point.x - geometry.originX) / geometry.cellSize)
  const row = Math.floor((point.y - geometry.originY) / geometry.cellSize)
  if (column < 0 || column >= geometry.columns || row < 0 || row >= geometry.rows) return
  result[row * geometry.columns + column] = 1
}

export function rasterizeRemainingMaterials(
  materials: readonly MaterialGeometryState[],
  geometry: FireFlowGridGeometry,
): Uint8Array {
  const result = new Uint8Array(geometry.columns * geometry.rows)
  const samples = [0.05, 0.5, 0.95] as const
  for (const material of materials) {
    for (let index = 0; index < material.remainingCellVolumes.length; index += 1) {
      if ((material.remainingCellVolumes[index] ?? 0) <= 0) continue
      for (const rowRatio of samples) {
        for (const columnRatio of samples) {
          markFlowCell(
            result,
            geometry,
            materialCellWorldSample(material, index, columnRatio, rowRatio),
          )
        }
      }
    }
  }
  return result
}

export function sampleFireFlowIntensity(
  view: FireFlowReadView,
  point: ExtractionVector,
): number {
  const column = Math.floor((point.x - view.originX) / view.cellSize)
  const row = Math.floor((point.y - view.originY) / view.cellSize)
  if (column < 0 || column >= view.columns || row < 0 || row >= view.rows) return 0
  return view.intensity[row * view.columns + column] ?? 0
}

export function normalizeAndClampFireDirection(
  direction: ExtractionVector,
  halfAngleRadians: number,
): ExtractionVector {
  const length = Math.hypot(direction.x, direction.y)
  const normalizedX = length > 0 ? direction.x / length : 0
  const normalizedY = length > 0 ? direction.y / length : -1
  const angleFromUp = Math.atan2(normalizedX, -normalizedY)
  const clamped = Math.max(-halfAngleRadians, Math.min(halfAngleRadians, angleFromUp))
  return { x: Math.sin(clamped), y: -Math.cos(clamped) }
}
