import { FIRE_SIZE_MAX, FIRE_SIZE_MIN } from '../../domain/index.ts'

export type InputVector2 = Readonly<{ x: number; y: number }>

export type ClientBounds = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalized(vector: InputVector2): InputVector2 {
  const length = Math.hypot(vector.x, vector.y)
  if (!Number.isFinite(length) || length <= 1e-9) return { x: 0, y: -1 }
  return { x: vector.x / length, y: vector.y / length }
}

export function clientPointToLogical(
  clientX: number,
  clientY: number,
  bounds: ClientBounds,
  logicalWidth: number,
  logicalHeight: number,
): InputVector2 {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(logicalWidth) ||
    !Number.isFinite(logicalHeight) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0
  ) {
    throw new RangeError('M2_INPUT_GEOMETRY_INVALID')
  }
  return {
    x: clamp(
      ((clientX - bounds.left) / bounds.width) * logicalWidth,
      0,
      logicalWidth,
    ),
    y: clamp(
      ((clientY - bounds.top) / bounds.height) * logicalHeight,
      0,
      logicalHeight,
    ),
  }
}

export function clampDirectionToCone(
  origin: InputVector2,
  target: InputVector2,
  centerDirection: InputVector2,
  halfAngleDegrees: number,
): InputVector2 {
  if (
    !Number.isFinite(halfAngleDegrees) ||
    halfAngleDegrees < 0 ||
    halfAngleDegrees > 180
  ) {
    throw new RangeError('M2_FIRE_DIRECTION_CONE_INVALID')
  }
  const center = normalized(centerDirection)
  const targetDelta = { x: target.x - origin.x, y: target.y - origin.y }
  if (Math.hypot(targetDelta.x, targetDelta.y) <= 1e-9) return center

  const direction = normalized(targetDelta)
  const cross = center.x * direction.y - center.y * direction.x
  const dot = clamp(center.x * direction.x + center.y * direction.y, -1, 1)
  const signedAngle = Math.atan2(cross, dot)
  const maximumAngle = (halfAngleDegrees * Math.PI) / 180
  const clampedAngle = clamp(signedAngle, -maximumAngle, maximumAngle)
  const cosine = Math.cos(clampedAngle)
  const sine = Math.sin(clampedAngle)
  return normalized({
    x: center.x * cosine - center.y * sine,
    y: center.x * sine + center.y * cosine,
  })
}

export function adjustFireSizeFromWheel(
  currentSize: number,
  deltaY: number,
  step: number,
): number {
  if (!Number.isFinite(currentSize) || !Number.isFinite(deltaY) || !Number.isFinite(step)) {
    throw new RangeError('M2_FIRE_SIZE_INPUT_INVALID')
  }
  if (deltaY === 0) return clamp(currentSize, FIRE_SIZE_MIN, FIRE_SIZE_MAX)
  const direction = deltaY < 0 ? 1 : -1
  return clamp(currentSize + direction * Math.abs(step), FIRE_SIZE_MIN, FIRE_SIZE_MAX)
}

export function resolveContainerAxis(leftPressed: boolean, rightPressed: boolean): number {
  if (leftPressed === rightPressed) return 0
  return leftPressed ? -1 : 1
}
