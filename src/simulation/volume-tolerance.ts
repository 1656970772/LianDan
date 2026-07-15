const VOLUME_ULP_TOLERANCE = 256

export function volumeTolerance(...references: readonly number[]): number {
  const scale = references.reduce(
    (largest, value) => Math.max(largest, Math.abs(value)),
    0,
  )
  return scale * Number.EPSILON * VOLUME_ULP_TOLERANCE
}

export function volumesApproximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= volumeTolerance(left, right)
}

export function clampVolumeToZero(value: number, referenceVolume: number): number {
  return value <= volumeTolerance(referenceVolume) ? 0 : value
}
