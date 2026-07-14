export interface JsonFingerprintRecord {
  readonly recordType: string
  logicalKey: string
  sourcePath?: string
  value: unknown
}

export interface RgbaFingerprintRecord {
  readonly recordType: string
  logicalKey: string
  sourcePath?: string
  readonly width: number
  readonly height: number
  rgba: Uint8Array
}

export interface FingerprintInput {
  readonly jsonRecords: JsonFingerprintRecord[]
  readonly rgbaRecords: RgbaFingerprintRecord[]
}

export interface FingerprintRecordResult {
  readonly recordType: string
  readonly logicalKey: string
  readonly payloadHex: string
}

export const FINGERPRINT_SPEC = Object.freeze({
  magicAscii: 'LDFP',
  framingVersion: 1,
  integerEncoding: 'u32be',
  recordOrder: 'logicalKey UTF-8 bytewise, then recordType UTF-8 bytewise',
  recordLayout:
    'u32be(typeUtf8Length) || typeUtf8 || u32be(logicalKeyUtf8Length) || logicalKeyUtf8 || u32be(payloadLength) || payload',
  rgbaPayload: 'u32be(width=64) || u32be(height=64) || 16384 RGBA bytes',
} as const)

export interface FingerprintResult {
  readonly spec: typeof FINGERPRINT_SPEC
  readonly records: readonly FingerprintRecordResult[]
  readonly frameHex: string
  readonly simulationContentFingerprint: string
}

const textEncoder = new TextEncoder()
const MAGIC = textEncoder.encode(FINGERPRINT_SPEC.magicAscii)
const UINT32_MAX = 0xffff_ffff

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        throw new TypeError('JCS 不接受孤立 UTF-16 surrogate')
      }
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('JCS 不接受孤立 UTF-16 surrogate')
      }
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError('JCS 不接受孤立 UTF-16 surrogate')
    }
  }
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    assertValidUnicode(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS 不接受非有限数')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }
  if (typeof value !== 'object') {
    throw new TypeError(`JCS 不接受 ${typeof value}`)
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('JCS 只接受 JSON 对象')
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys
    .map((key) => {
      assertValidUnicode(key)
      return `${JSON.stringify(key)}:${canonicalize(object[key])}`
    })
    .join(',')}}`
}

export function canonicalizeJson(value: unknown): string {
  return canonicalize(value)
}

function uint32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError('framing 整数必须是 uint32')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (length > UINT32_MAX) throw new RangeError('fingerprint frame 过大')
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function toHex(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

interface PreparedRecord {
  readonly recordType: string
  readonly logicalKey: string
  readonly typeBytes: Uint8Array
  readonly logicalKeyBytes: Uint8Array
  readonly payload: Uint8Array
}

function prepareJsonRecord(record: JsonFingerprintRecord): PreparedRecord {
  assertValidUnicode(record.recordType)
  assertValidUnicode(record.logicalKey)
  return {
    recordType: record.recordType,
    logicalKey: record.logicalKey,
    typeBytes: textEncoder.encode(record.recordType),
    logicalKeyBytes: textEncoder.encode(record.logicalKey),
    payload: textEncoder.encode(canonicalizeJson(record.value)),
  }
}

function prepareRgbaRecord(record: RgbaFingerprintRecord): PreparedRecord {
  assertValidUnicode(record.recordType)
  assertValidUnicode(record.logicalKey)
  if (record.width !== 64 || record.height !== 64 || record.rgba.length !== 64 * 64 * 4) {
    throw new RangeError('fingerprint RGBA 记录必须是 64×64×4 字节')
  }
  return {
    recordType: record.recordType,
    logicalKey: record.logicalKey,
    typeBytes: textEncoder.encode(record.recordType),
    logicalKeyBytes: textEncoder.encode(record.logicalKey),
    payload: concatenate([uint32be(record.width), uint32be(record.height), record.rgba]),
  }
}

function encodeFrame(records: readonly PreparedRecord[]): Uint8Array {
  const chunks: Uint8Array[] = [MAGIC, uint32be(FINGERPRINT_SPEC.framingVersion), uint32be(records.length)]
  for (const record of records) {
    chunks.push(
      uint32be(record.typeBytes.length),
      record.typeBytes,
      uint32be(record.logicalKeyBytes.length),
      record.logicalKeyBytes,
      uint32be(record.payload.length),
      record.payload,
    )
  }
  return concatenate(chunks)
}

export async function computeSimulationContentFingerprint(
  input: FingerprintInput,
): Promise<FingerprintResult> {
  const records = [
    ...input.jsonRecords.map(prepareJsonRecord),
    ...input.rgbaRecords.map(prepareRgbaRecord),
  ].sort((left, right) => {
    const keyOrder = compareBytes(left.logicalKeyBytes, right.logicalKeyBytes)
    return keyOrder !== 0 ? keyOrder : compareBytes(left.typeBytes, right.typeBytes)
  })

  const identities = new Set<string>()
  for (const record of records) {
    const identity = `${record.recordType}\u0000${record.logicalKey}`
    if (identities.has(identity)) {
      throw new Error(`fingerprint 记录重复：${record.recordType}/${record.logicalKey}`)
    }
    identities.add(identity)
  }

  const frame = encodeFrame(records)
  const digestInput = new Uint8Array(frame.length)
  digestInput.set(frame)
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', digestInput),
  )
  return Object.freeze({
    spec: FINGERPRINT_SPEC,
    records: Object.freeze(
      records.map((record) =>
        Object.freeze({
          recordType: record.recordType,
          logicalKey: record.logicalKey,
          payloadHex: toHex(record.payload),
        }),
      ),
    ),
    frameHex: toHex(frame),
    simulationContentFingerprint: toHex(digest),
  })
}
