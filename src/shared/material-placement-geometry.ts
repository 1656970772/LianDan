export type MaterialPlacementVector = Readonly<{ x: number; y: number }>

export type MaterialPlacementBounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export type OrientedMaterialRectangle = Readonly<{
  center: MaterialPlacementVector
  width: number
  height: number
  rotationRadians: number
}>

const GEOMETRY_EPSILON_FACTOR = 1e-10

function scaledEpsilon(values: readonly number[]): number {
  return (
    Math.max(1, ...values.map((value) => Math.abs(value))) *
    GEOMETRY_EPSILON_FACTOR
  )
}

function localAxes(
  rectangle: OrientedMaterialRectangle,
): readonly [MaterialPlacementVector, MaterialPlacementVector] {
  const cosine = Math.cos(rectangle.rotationRadians)
  const sine = Math.sin(rectangle.rotationRadians)
  return [
    { x: cosine, y: sine },
    { x: -sine, y: cosine },
  ]
}

function projectionRadius(
  rectangle: OrientedMaterialRectangle,
  axis: MaterialPlacementVector,
): number {
  const [localX, localY] = localAxes(rectangle)
  return (
    Math.abs(axis.x * localX.x + axis.y * localX.y) * rectangle.width * 0.5 +
    Math.abs(axis.x * localY.x + axis.y * localY.y) * rectangle.height * 0.5
  )
}

/**
 * Uses the separating-axis theorem. Positive-area intersection is rejected,
 * while exact edge or corner contact remains legal.
 */
export function orientedMaterialRectanglesHaveInteriorIntersection(
  first: OrientedMaterialRectangle,
  second: OrientedMaterialRectangle,
): boolean {
  const centerDelta = {
    x: second.center.x - first.center.x,
    y: second.center.y - first.center.y,
  }
  const epsilon = scaledEpsilon([
    first.center.x,
    first.center.y,
    first.width,
    first.height,
    second.center.x,
    second.center.y,
    second.width,
    second.height,
  ])
  const axes = [...localAxes(first), ...localAxes(second)]
  return axes.every((axis) => {
    const centerDistance = Math.abs(
      centerDelta.x * axis.x + centerDelta.y * axis.y,
    )
    const combinedRadius =
      projectionRadius(first, axis) + projectionRadius(second, axis)
    return combinedRadius - centerDistance > epsilon
  })
}

export function orientedMaterialRectangleIsWithinBounds(
  rectangle: OrientedMaterialRectangle,
  bounds: MaterialPlacementBounds,
): boolean {
  const [localX, localY] = localAxes(rectangle)
  const halfExtentX =
    Math.abs(localX.x) * rectangle.width * 0.5 +
    Math.abs(localY.x) * rectangle.height * 0.5
  const halfExtentY =
    Math.abs(localX.y) * rectangle.width * 0.5 +
    Math.abs(localY.y) * rectangle.height * 0.5
  const epsilon = scaledEpsilon([
    rectangle.center.x,
    rectangle.center.y,
    rectangle.width,
    rectangle.height,
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom,
  ])
  return (
    rectangle.center.x - halfExtentX >= bounds.left - epsilon &&
    rectangle.center.x + halfExtentX <= bounds.right + epsilon &&
    rectangle.center.y - halfExtentY >= bounds.top - epsilon &&
    rectangle.center.y + halfExtentY <= bounds.bottom + epsilon
  )
}
