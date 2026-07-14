export type EmptyPayload = Readonly<Record<string, never>>

export const FIRE_SIZE_MIN = 0
export const FIRE_SIZE_MAX = 100

export type RuleCommand =
  | Readonly<{
      type: 'PreselectMaterial'
      payload: Readonly<{ inventoryBatchId: string }>
    }>
  | Readonly<{
      type: 'CancelMaterialSelection'
      payload: EmptyPayload
    }>
  | Readonly<{
      type: 'AddSelectedMaterial'
      payload: EmptyPayload
    }>
  | Readonly<{
      type: 'SelectFireSource'
      payload: Readonly<{ fireSourceId: string }>
    }>
  | Readonly<{
      type: 'SetSpraying'
      payload: Readonly<{ spraying: boolean }>
    }>
  | Readonly<{
      type: 'SetFireDirection'
      payload: Readonly<{ x: number; y: number }>
    }>
  | Readonly<{
      type: 'SetFireSize'
      payload: Readonly<{ size: number }>
    }>
  | Readonly<{
      type: 'SetContainerAxis'
      payload: Readonly<{ axis: number }>
    }>
  | Readonly<{
      type: 'SetFlameThrust'
      payload: Readonly<{ enabled: boolean }>
    }>
  | Readonly<{
      type: 'RequestFinish'
      payload: EmptyPayload
    }>

export type RuleCommandType = RuleCommand['type']

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateRuleCommandPayload(command: unknown): command is RuleCommand {
  if (!isRecord(command) || typeof command.type !== 'string') return false
  const payload = command.payload

  switch (command.type) {
    case 'PreselectMaterial':
      return (
        hasExactKeys(payload, ['inventoryBatchId']) &&
        typeof payload.inventoryBatchId === 'string' &&
        payload.inventoryBatchId.length > 0
      )
    case 'CancelMaterialSelection':
    case 'AddSelectedMaterial':
    case 'RequestFinish':
      return hasExactKeys(payload, [])
    case 'SelectFireSource':
      return (
        hasExactKeys(payload, ['fireSourceId']) &&
        typeof payload.fireSourceId === 'string' &&
        payload.fireSourceId.length > 0
      )
    case 'SetSpraying':
      return hasExactKeys(payload, ['spraying']) && typeof payload.spraying === 'boolean'
    case 'SetFireDirection':
      return (
        hasExactKeys(payload, ['x', 'y']) &&
        isFiniteNumber(payload.x) &&
        isFiniteNumber(payload.y)
      )
    case 'SetFireSize':
      return (
        hasExactKeys(payload, ['size']) &&
        isFiniteNumber(payload.size) &&
        payload.size >= FIRE_SIZE_MIN &&
        payload.size <= FIRE_SIZE_MAX
      )
    case 'SetContainerAxis':
      return (
        hasExactKeys(payload, ['axis']) &&
        isFiniteNumber(payload.axis) &&
        Math.abs(payload.axis) <= 1
      )
    case 'SetFlameThrust':
      return hasExactKeys(payload, ['enabled']) && typeof payload.enabled === 'boolean'
    default:
      return false
  }
}
