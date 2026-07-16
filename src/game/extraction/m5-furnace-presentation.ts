import type { M2WorkbenchStatus } from '../../ui/createM2Workbench.ts'

export type M5FurnaceSourceTemperature = Readonly<{
  baseTemperature: number
  maximumTemperature: number
}>

export type M5FurnacePresentationInput = Readonly<{
  currentTemperature: number
  fireSize: number
  isSpraying: boolean
  paused: boolean
  status: M2WorkbenchStatus
  source: M5FurnaceSourceTemperature
}>

export type M5FurnacePresentation = Readonly<{
  range: Readonly<{ min: number; max: number }>
  targetTemperature: number
  trend: 'heating' | 'cooling' | 'steady'
}>

const TEMPERATURE_EPSILON = 1e-6

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * Derives presentation-only furnace direction from the authoritative source
 * range and the same fire-size target used by the domain. It never integrates
 * temperature itself.
 */
export function deriveM5FurnacePresentation(
  input: M5FurnacePresentationInput,
): M5FurnacePresentation {
  const minimum = input.source.baseTemperature
  const maximum = input.source.maximumTemperature
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum <= minimum ||
    !Number.isFinite(input.currentTemperature) ||
    !Number.isFinite(input.fireSize)
  ) {
    throw new RangeError('M5_FURNACE_PRESENTATION_INPUT_INVALID')
  }

  const active =
    !input.paused &&
    (input.status === 'ready' || input.status === 'extracting')
  const targetTemperature =
    active && input.isSpraying
      ? minimum +
        (maximum - minimum) * (clamp(input.fireSize, 0, 100) / 100)
      : minimum
  let trend: M5FurnacePresentation['trend'] = 'steady'
  if (active) {
    if (input.currentTemperature < targetTemperature - TEMPERATURE_EPSILON) {
      trend = 'heating'
    } else if (
      input.currentTemperature >
      targetTemperature + TEMPERATURE_EPSILON
    ) {
      trend = 'cooling'
    }
  }

  return Object.freeze({
    range: Object.freeze({ min: minimum, max: maximum }),
    targetTemperature,
    trend,
  })
}
