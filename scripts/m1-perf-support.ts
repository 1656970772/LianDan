import { createHash } from 'node:crypto'
import { createServer } from 'node:net'

import Ajv2020 from 'ajv/dist/2020.js'

import {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
} from '../src/config/m1-fire-flow-fixture.ts'
import { parseStrictJson } from '../src/config/strict-json.ts'
import type { M1PerformanceSample } from '../src/game/m1/performance-metrics.ts'

const FORMAL_WARMUP_MILLISECONDS = 10_000
const FORMAL_SAMPLE_MILLISECONDS = 60_000
const DEVICE_PIXEL_RATIO_TOLERANCE = 1e-6

export interface M1RunTiming {
  readonly warmupMilliseconds: number
  readonly sampleMilliseconds: number
  readonly formal: boolean
  readonly overridden: boolean
}

export interface M1SamplingBoundarySnapshot {
  readonly fieldUpdateCount: number
  readonly lastCommittedTick: number
  readonly droppedTickCount: number
  readonly activePearlCount: number
}

export interface M1EvidenceCheck {
  readonly id: string
  readonly passed: boolean
  readonly actual: number | string | boolean | readonly number[]
  readonly expected: number | string | boolean
}

export interface M1SampleConsistencyResult {
  readonly passed: boolean
  readonly checks: readonly M1EvidenceCheck[]
}

export interface M1FramedFile {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface M1PreviewProbeInput {
  readonly childPid: number | null | undefined
  readonly childExited: boolean
  readonly readyMarkerSeen: boolean
  readonly responseOk: boolean
  readonly expectedBindingBody: string
  readonly servedBindingBody?: string
}

export interface M1PreviewProbeResult {
  readonly passed: boolean
  readonly checks: readonly M1EvidenceCheck[]
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function parseAndValidateM1FixtureJson(
  fixtureText: string,
  schemaText: string,
): M1FireFlowFixture {
  const parsedFixture = parseStrictJson(fixtureText)
  if (!parsedFixture.ok) {
    const duplicate =
      'duplicateKey' in parsedFixture ? ` duplicateKey=${parsedFixture.duplicateKey}` : ''
    throw new Error(`M1_PERF_FIXTURE_STRICT_JSON_INVALID:${duplicate}`)
  }
  const parsedSchema = parseStrictJson(schemaText)
  if (!parsedSchema.ok) throw new Error('M1_PERF_FIXTURE_SCHEMA_JSON_INVALID')

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    validateSchema: true,
  })
  const validateFixtureSchema = ajv.compile(parsedSchema.value as object)
  if (!validateFixtureSchema(parsedFixture.value)) {
    throw new Error(
      `M1_PERF_FIXTURE_SCHEMA_INVALID: ${JSON.stringify(validateFixtureSchema.errors ?? [])}`,
    )
  }

  const fixture = parsedFixture.value as M1FireFlowFixture
  const semanticIssues = validateM1FireFlowFixtureSemantics(fixture)
  if (semanticIssues.length > 0) {
    throw new Error(
      `M1_PERF_FIXTURE_SEMANTICS_INVALID: ${JSON.stringify(semanticIssues)}`,
    )
  }
  return fixture
}

export async function assertM1TcpPortAvailable(host: string, port: number): Promise<void> {
  if (host.length === 0 || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`M1_PERF_PORT_INVALID: ${host}:${port}`)
  }

  const server = createServer()
  server.unref()
  await new Promise<void>((resolveAvailable, rejectUnavailable) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      const category = error.code === 'EADDRINUSE' ? 'IN_USE' : 'UNAVAILABLE'
      rejectUnavailable(
        new Error(`M1_PERF_PORT_${category}: ${host}:${port} (${error.code ?? 'UNKNOWN'})`, {
          cause: error,
        }),
      )
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error === undefined) {
          resolveAvailable()
          return
        }
        rejectUnavailable(
          new Error(`M1_PERF_PORT_RELEASE_FAILED: ${host}:${port}`, { cause: error }),
        )
      })
    })
  })
}

export function evaluateM1PreviewProbe(input: M1PreviewProbeInput): M1PreviewProbeResult {
  const childPidValid =
    Number.isSafeInteger(input.childPid) && (input.childPid as number) > 0
  const servedBindingBody = input.servedBindingBody ?? ''
  const checks: M1EvidenceCheck[] = [
    {
      id: 'preview-child-pid',
      passed: childPidValid,
      actual: input.childPid ?? 'missing',
      expected: '本次 preview 子进程 PID',
    },
    {
      id: 'preview-child-alive',
      passed: !input.childExited,
      actual: !input.childExited,
      expected: true,
    },
    {
      id: 'preview-ready-marker',
      passed: input.readyMarkerSeen,
      actual: input.readyMarkerSeen,
      expected: true,
    },
    {
      id: 'preview-binding-http',
      passed: input.responseOk,
      actual: input.responseOk,
      expected: true,
    },
    {
      id: 'preview-binding-body',
      passed:
        input.responseOk &&
        servedBindingBody.length > 0 &&
        servedBindingBody === input.expectedBindingBody,
      actual: sha256Text(servedBindingBody),
      expected: sha256Text(input.expectedBindingBody),
    },
  ]

  return {
    passed: checks.every((check) => check.passed),
    checks,
  }
}

export function evaluateM1ScenarioPassed(input: Readonly<{
  errorPresent: boolean
  consistencyPassed: boolean
  gatePassed: boolean
  environmentChecks: readonly Readonly<{ id: string; passed: boolean }>[]
  consoleErrorCount: number
  pageErrorCount: number
  failedRequestCount: number
  failedResponseCount: number
}>): boolean {
  return (
    !input.errorPresent &&
    input.consistencyPassed &&
    input.gatePassed &&
    input.environmentChecks.every((check) => check.passed) &&
    input.consoleErrorCount === 0 &&
    input.pageErrorCount === 0 &&
    input.failedRequestCount === 0 &&
    input.failedResponseCount === 0
  )
}

function parseEnvironmentMilliseconds(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`M1_PERF_ENV_INVALID: ${name} 必须是十进制非负整数`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`M1_PERF_ENV_INVALID: ${name} 必须 >= ${minimum}`)
  }
  return parsed
}

export function resolveM1RunTiming(
  protocol: Readonly<{ warmupSeconds: number; sampleSeconds: number }>,
  environment: Readonly<Record<string, string | undefined>>,
): M1RunTiming {
  const defaultWarmupMilliseconds = protocol.warmupSeconds * 1_000
  const defaultSampleMilliseconds = protocol.sampleSeconds * 1_000
  if (
    !Number.isSafeInteger(defaultWarmupMilliseconds) ||
    defaultWarmupMilliseconds < 0 ||
    !Number.isSafeInteger(defaultSampleMilliseconds) ||
    defaultSampleMilliseconds < 1_000
  ) {
    throw new Error('M1_PERF_PROTOCOL_INVALID')
  }

  const warmupOverride = environment.M1_PERF_WARMUP_MS
  const sampleOverride = environment.M1_PERF_SAMPLE_MS
  const overridden = warmupOverride !== undefined || sampleOverride !== undefined
  const warmupMilliseconds = parseEnvironmentMilliseconds(
    'M1_PERF_WARMUP_MS',
    warmupOverride,
    defaultWarmupMilliseconds,
    0,
  )
  const sampleMilliseconds = parseEnvironmentMilliseconds(
    'M1_PERF_SAMPLE_MS',
    sampleOverride,
    defaultSampleMilliseconds,
    1_000,
  )

  return {
    warmupMilliseconds,
    sampleMilliseconds,
    formal:
      !overridden &&
      warmupMilliseconds === FORMAL_WARMUP_MILLISECONDS &&
      sampleMilliseconds === FORMAL_SAMPLE_MILLISECONDS,
    overridden,
  }
}

export function buildM1ScenarioUrl(baseUrl: string, scenarioId: string): string {
  const url = new URL('/', baseUrl)
  url.searchParams.set('scenario', scenarioId)
  url.searchParams.set('overlay', 'none')
  return url.toString()
}

export function isM1DevicePixelRatioOne(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - 1) <= DEVICE_PIXEL_RATIO_TOLERANCE
}

export function isM1TickRateInsideConfiguredWindow(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isFinite(value) &&
    Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    minimum <= maximum &&
    value >= minimum &&
    value <= maximum
  )
}

function uint32Frame(value: number): Buffer {
  const frame = Buffer.allocUnsafe(4)
  frame.writeUInt32BE(value)
  return frame
}

function uint64Frame(value: number): Buffer {
  const frame = Buffer.allocUnsafe(8)
  frame.writeBigUInt64BE(BigInt(value))
  return frame
}

function normalizeFramedPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`M1_PERF_HASH_PATH_INVALID: ${value}`)
  }
  return normalized
}

export function computeFramedContentSha256(files: readonly M1FramedFile[]): string {
  const normalized = files
    .map((file) => ({ ...file, path: normalizeFramedPath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const seen = new Set<string>()
  const hash = createHash('sha256')
  hash.update('LIANDAN_M1_DIST_HASH_V1\0', 'utf8')

  for (const file of normalized) {
    if (seen.has(file.path)) {
      throw new Error(`M1_PERF_HASH_PATH_DUPLICATE: ${file.path}`)
    }
    seen.add(file.path)
    const pathBytes = Buffer.from(file.path, 'utf8')
    hash.update(uint32Frame(pathBytes.length))
    hash.update(pathBytes)
    hash.update(uint64Frame(file.bytes.byteLength))
    hash.update(file.bytes)
  }
  return hash.digest('hex')
}

function timestampsAreInsideSample(
  timestamps: readonly number[],
  start: number,
  duration: number,
): boolean {
  const end = start + duration
  if (
    timestamps.length === 0 ||
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(end)
  ) {
    return false
  }
  let previous = Number.NEGATIVE_INFINITY
  return timestamps.every((timestamp) => {
    const valid =
      Number.isFinite(timestamp) &&
      timestamp >= start &&
      timestamp < end &&
      timestamp > previous
    previous = timestamp
    return valid
  })
}

export function evaluateM1SampleConsistency(input: Readonly<{
  requestedDurationMilliseconds: number
  expectedActivePearlCount: number
  expectedTickRateHz: number
  allowedTotalTickError: number
  allowedBoundaryUpdateError: number
  sample: M1PerformanceSample
  before: M1SamplingBoundarySnapshot
  after: M1SamplingBoundarySnapshot
}>): M1SampleConsistencyResult {
  const { sample, before, after } = input
  const flowCount = sample.flowTimestamps.length
  const expectedFlowCount = Math.round(
    (input.requestedDurationMilliseconds / 1_000) * input.expectedTickRateHz,
  )
  const fieldUpdateDelta = after.fieldUpdateCount - before.fieldUpdateCount
  const committedTickDelta = after.lastCommittedTick - before.lastCommittedTick
  const droppedTickDelta = after.droppedTickCount - before.droppedTickCount
  const maximumBoundaryUpdateCount = flowCount + input.allowedBoundaryUpdateError
  const checks: M1EvidenceCheck[] = [
    {
      id: 'sample-duration',
      passed: sample.sampleDurationMilliseconds === input.requestedDurationMilliseconds,
      actual: sample.sampleDurationMilliseconds,
      expected: input.requestedDurationMilliseconds,
    },
    {
      id: 'flow-pairs',
      passed: flowCount === sample.flowDurationsMilliseconds.length,
      actual: `${flowCount}/${sample.flowDurationsMilliseconds.length}`,
      expected: 'flow timestamps 与 durations 数量相等',
    },
    {
      id: 'flow-count',
      passed:
        Math.abs(flowCount - expectedFlowCount) <= input.allowedTotalTickError,
      actual: flowCount,
      expected: `${expectedFlowCount} +/- ${input.allowedTotalTickError}`,
    },
    {
      id: 'flow-update-delta',
      passed:
        fieldUpdateDelta >= flowCount &&
        fieldUpdateDelta <= maximumBoundaryUpdateCount,
      actual: fieldUpdateDelta,
      expected: `${flowCount}..${maximumBoundaryUpdateCount}`,
    },
    {
      id: 'committed-tick-delta',
      passed:
        committedTickDelta >= flowCount &&
        committedTickDelta <= maximumBoundaryUpdateCount,
      actual: committedTickDelta,
      expected: `${flowCount}..${maximumBoundaryUpdateCount}`,
    },
    {
      id: 'dropped-tick-delta',
      passed: droppedTickDelta === sample.droppedTickCount,
      actual: droppedTickDelta,
      expected: sample.droppedTickCount,
    },
    {
      id: 'flow-timestamp-window',
      passed: timestampsAreInsideSample(
        sample.flowTimestamps,
        sample.sampleStartMilliseconds,
        sample.sampleDurationMilliseconds,
      ),
      actual: flowCount,
      expected: '全部单调且位于采样窗口内',
    },
    {
      id: 'frame-timestamp-window',
      passed: timestampsAreInsideSample(
        sample.frameTimestamps,
        sample.sampleStartMilliseconds,
        sample.sampleDurationMilliseconds,
      ),
      actual: sample.frameTimestamps.length,
      expected: '全部单调且位于采样窗口内',
    },
    {
      id: 'active-before',
      passed: before.activePearlCount === input.expectedActivePearlCount,
      actual: before.activePearlCount,
      expected: input.expectedActivePearlCount,
    },
    {
      id: 'active-sample',
      passed: sample.activePearlCount === input.expectedActivePearlCount,
      actual: sample.activePearlCount,
      expected: input.expectedActivePearlCount,
    },
    {
      id: 'active-after',
      passed: after.activePearlCount === input.expectedActivePearlCount,
      actual: after.activePearlCount,
      expected: input.expectedActivePearlCount,
    },
  ]

  return {
    passed: checks.every((check) => check.passed),
    checks,
  }
}
