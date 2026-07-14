import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, readdir, mkdir, unlink, writeFile } from 'node:fs/promises'
import { cpus, totalmem, platform, release, version as osVersion, arch } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import {
  type M1FireFlowFixture,
  type M1PerformanceScenario,
} from '../src/config/m1-fire-flow-fixture.ts'
import { loadAndValidatePublicConfig } from '../src/config/node-loader.ts'
import type { M1BrowserApi, M1Snapshot } from '../src/game/m1/contracts.ts'
import {
  evaluateM1PerformanceGate,
  summarizeM1PerformanceSample,
  type M1PerformanceGate,
  type M1PerformanceSample,
  type M1PerformanceSummary,
  type M1PerformanceThresholds,
} from '../src/game/m1/performance-metrics.ts'
import {
  buildM1ScenarioUrl,
  assertM1TcpPortAvailable,
  computeFramedContentSha256,
  evaluateM1PreviewProbe,
  evaluateM1SampleConsistency,
  evaluateM1ScenarioPassed,
  isM1DevicePixelRatioOne,
  isM1TickRateInsideConfiguredWindow,
  parseAndValidateM1FixtureJson,
  resolveM1RunTiming,
  type M1EvidenceCheck,
  type M1RunTiming,
  type M1SampleConsistencyResult,
} from './m1-perf-support.ts'

const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = process.cwd()
const HOST = '127.0.0.1'
const DEFAULT_PORT = 4174
const VIEWPORT = Object.freeze({ width: 1_600, height: 900 })
const REQUIRED_SCENARIO_IDS = Object.freeze(['m1-900', 'm1-2400'] as const)
const RAF_END_BOUNDARY_UPDATE_TOLERANCE = 1

interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

interface PageEnvironmentEvidence {
  readonly innerWidth: number
  readonly innerHeight: number
  readonly devicePixelRatio: number
  readonly visibilityState: DocumentVisibilityState
  readonly hasFocus: boolean
  readonly userAgent: string
  readonly hardwareConcurrency: number
  readonly deviceMemoryGiB: number | null
  readonly webglVendor: string | null
  readonly webglRenderer: string | null
  readonly canvases: readonly Readonly<{
    width: number
    height: number
    cssWidth: number
    cssHeight: number
  }>[]
}

interface LifecycleEventEvidence {
  readonly type: 'blur' | 'focus' | 'visibilitychange'
  readonly timestampMilliseconds: number
  readonly visibilityState: DocumentVisibilityState
  readonly hasFocus: boolean
}

interface BrowserSamplingEvidence {
  readonly before: M1Snapshot
  readonly sample: M1PerformanceSample
  readonly after: M1Snapshot
  readonly startEnvironment: PageEnvironmentEvidence
  readonly endEnvironment: PageEnvironmentEvidence
  readonly lifecycleEvents: readonly LifecycleEventEvidence[]
}

interface ScenarioRawEvidence {
  readonly reportVersion: 1
  readonly scenarioId: string
  readonly formal: boolean
  readonly timing: M1RunTiming
  readonly boundaryUpdateTolerance: number
  readonly boundaryUpdateReason: 'rAF_END_BOUNDARY_ONLY'
  readonly scenarioConfig: M1PerformanceScenario
  readonly fixtureContext: Readonly<{
    world: M1FireFlowFixture['world']
    protocol: M1FireFlowFixture['protocol']
    source: M1FireFlowFixture['performanceSource']
    fullObstacles: M1FireFlowFixture['performanceFullObstacleFixture']
  }>
  readonly url: string
  readonly sampleEvidence?: BrowserSamplingEvidence
  readonly pageConsoleErrors: readonly string[]
  readonly pageErrors: readonly string[]
  readonly failedRequests: readonly string[]
  readonly failedResponses: readonly string[]
  readonly environmentChecks: readonly M1EvidenceCheck[]
  readonly consistency?: M1SampleConsistencyResult
  readonly summary?: M1PerformanceSummary
  readonly gate?: M1PerformanceGate
  readonly passed: boolean
  readonly screenshotPath?: string
  readonly error?: SerializedError
}

interface ScenarioSummaryEvidence {
  readonly scenarioId: string
  readonly activePearlCount: number
  readonly rawEvidencePath: string
  readonly screenshotPath?: string
  readonly passed: boolean
  readonly summary?: M1PerformanceSummary
  readonly environmentChecks: readonly M1EvidenceCheck[]
  readonly consistencyChecks: readonly M1EvidenceCheck[]
  readonly gateChecks: M1PerformanceGate['checks']
  readonly error?: SerializedError
}

interface M1RunReport {
  readonly reportVersion: 1
  readonly startedAt: string
  finishedAt?: string
  readonly outputDirectory: string
  formal: boolean
  timing?: M1RunTiming
  fixture?: Readonly<{
    path: string
    sha256: string
    schemaPath: string
    schemaSha256: string
    strictJsonValidated: true
    schemaValidated: true
    semanticsValidated: true
    simulationContentFingerprint?: string
  }>
  build?: Readonly<{
    distPath: string
    distContentSha256: string
    distFileCount: number
    gitCommit: string
    gitDirty: boolean
    gitStatusEntryCount: number
  }>
  machine?: Readonly<{
    os: string
    osRelease: string
    osVersion: string
    architecture: string
    cpuModel: string
    logicalCpuCount: number
    totalMemoryBytes: number
  }>
  browser?: Readonly<{
    engine: 'chromium'
    headed: true
    version: string
    executablePath: string
    playwrightVersion: string
    viewport: typeof VIEWPORT
    deviceScaleFactor: 1
  }>
  preview?: Readonly<{
    url: string
    port: number
    portPreflightPassed: boolean
    pid: number | null
    readyMarkerSeen: boolean
    childAliveAfterBinding: boolean | null
    childExitedAfterCleanup: boolean | null
    binding?: Readonly<{
      path: string
      url: string
      distContentSha256: string
      tokenSha256: string
      expectedBodySha256: string
      servedBodySha256?: string
      httpStatus?: number
      passed: boolean
      checks: readonly M1EvidenceCheck[]
    }>
    stdout: string
    stderr: string
  }>
  scenarios: ScenarioSummaryEvidence[]
  fatalErrors: SerializedError[]
  executionPassed: boolean
  formalGatePassed: boolean | null
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
  }
  return { name: 'UnknownError', message: String(error) }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function timestampDirectoryName(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function repositoryRelative(absolutePath: string): string {
  return relative(REPOSITORY_ROOT, absolutePath).split(sep).join('/')
}

async function collectFiles(root: string, current = root): Promise<readonly {
  path: string
  bytes: Uint8Array
}[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: { path: string; bytes: Uint8Array }[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const absolutePath = resolve(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolutePath)))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`M1_PERF_DIST_ENTRY_INVALID: ${absolutePath}`)
    }
    files.push({
      path: relative(root, absolutePath).split(sep).join('/'),
      bytes: await readFile(absolutePath),
    })
  }
  return files
}

async function loadStrictM1Fixture(): Promise<Readonly<{
  fixturePath: string
  fixtureBytes: Buffer
  fixture: M1FireFlowFixture
  schemaPath: string
  schemaBytes: Buffer
}>> {
  const fixturePath = resolve(
    REPOSITORY_ROOT,
    'public/config/performance/m1-fire-flow.json',
  )
  const schemaPath = resolve(
    REPOSITORY_ROOT,
    'schemas/config/m1-fire-flow-performance.schema.json',
  )
  const [fixtureBytes, schemaBytes] = await Promise.all([
    readFile(fixturePath),
    readFile(schemaPath),
  ])
  const fixture = parseAndValidateM1FixtureJson(
    fixtureBytes.toString('utf8'),
    schemaBytes.toString('utf8'),
  )
  return { fixturePath, fixtureBytes, fixture, schemaPath, schemaBytes }
}

async function readGitEvidence(): Promise<Readonly<{
  commit: string
  dirty: boolean
  statusEntryCount: number
}>> {
  let commit = 'UNBORN'
  try {
    const result = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    })
    commit = result.stdout.trim()
  } catch {
    commit = 'UNBORN'
  }

  const status = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  const entries = status.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trimEnd())
    .filter(Boolean)
  return { commit, dirty: entries.length > 0, statusEntryCount: entries.length }
}

function readPort(): number {
  const raw = process.env.M1_PERF_PORT
  if (raw === undefined) return DEFAULT_PORT
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error('M1_PERF_ENV_INVALID: M1_PERF_PORT')
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > 65_535) {
    throw new Error('M1_PERF_ENV_INVALID: M1_PERF_PORT')
  }
  return value
}

function appendCapped(current: string, chunk: Uint8Array | string): string {
  const next = current + chunk.toString()
  return next.length <= 32_000 ? next : next.slice(next.length - 32_000)
}

interface PreviewProcess {
  child: ChildProcess
  readonly pid: number | null
  getStdout(): string
  getStderr(): string
  getReadyMarkerSeen(): boolean
  hasExited(): boolean
  getExitDescription(): string
}

interface PreviewBindingArtifact {
  readonly absolutePath: string
  readonly relativePath: string
  readonly url: string
  readonly body: string
  readonly distContentSha256: string
  readonly tokenSha256: string
  readonly expectedBodySha256: string
}

interface PreviewBindingProbeEvidence {
  readonly httpStatus?: number
  readonly servedBodySha256?: string
  readonly result: ReturnType<typeof evaluateM1PreviewProbe>
}

function withoutAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

async function createPreviewBinding(
  distPath: string,
  baseUrl: string,
  distContentSha256: string,
): Promise<PreviewBindingArtifact> {
  const token = randomBytes(32).toString('hex')
  const fileName = `m1-preview-binding-${token.slice(0, 24)}.json`
  const absolutePath = resolve(distPath, fileName)
  const body = json({
    protocol: 'LIANDAN_M1_PREVIEW_BINDING_V1',
    token,
    distContentSha256,
  })
  await writeFile(absolutePath, body, { encoding: 'utf8', flag: 'wx' })
  return {
    absolutePath,
    relativePath: repositoryRelative(absolutePath),
    url: new URL(fileName, `${baseUrl}/`).toString(),
    body,
    distContentSha256,
    tokenSha256: createHash('sha256').update(token, 'utf8').digest('hex'),
    expectedBodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  }
}

function startPreview(port: number, baseUrl: string): PreviewProcess {
  const viteEntry = resolve(REPOSITORY_ROOT, 'node_modules/vite/bin/vite.js')
  let stdout = ''
  let stderr = ''
  let exited = false
  let spawnError: Error | undefined
  const child = spawn(
    process.execPath,
    [viteEntry, 'preview', '--host', HOST, '--port', String(port), '--strictPort'],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        NO_PROXY: [process.env.NO_PROXY, HOST, 'localhost'].filter(Boolean).join(','),
        no_proxy: [process.env.no_proxy, HOST, 'localhost'].filter(Boolean).join(','),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  child.stdout?.on('data', (chunk: Uint8Array | string) => {
    stdout = appendCapped(stdout, chunk)
  })
  child.stderr?.on('data', (chunk: Uint8Array | string) => {
    stderr = appendCapped(stderr, chunk)
  })
  child.once('error', (error) => {
    spawnError = error
  })
  child.once('exit', () => {
    exited = true
  })
  return {
    child,
    pid: child.pid ?? null,
    getStdout: () => stdout,
    getStderr: () => stderr,
    getReadyMarkerSeen: () => {
      const output = withoutAnsi(`${stdout}\n${stderr}`)
      return output.includes('Local:') && output.includes(`${baseUrl}/`)
    },
    hasExited: () =>
      exited ||
      spawnError !== undefined ||
      child.exitCode !== null ||
      child.signalCode !== null,
    getExitDescription: () =>
      spawnError?.message ??
      `exitCode=${String(child.exitCode)}, signal=${String(child.signalCode)}`,
  }
}

async function waitForPreview(
  preview: PreviewProcess,
  binding: PreviewBindingArtifact,
  onProbe: (evidence: PreviewBindingProbeEvidence) => void,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const readyMarkerSeen = preview.getReadyMarkerSeen()
    if (preview.hasExited()) {
      onProbe({
        result: evaluateM1PreviewProbe({
          childPid: preview.pid,
          childExited: true,
          readyMarkerSeen,
          responseOk: false,
          expectedBindingBody: binding.body,
        }),
      })
      throw new Error(`M1_PERF_PREVIEW_EXITED: ${preview.getExitDescription()}`)
    }

    if (readyMarkerSeen) {
      try {
        const response = await fetch(binding.url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(2_000),
        })
        const servedBody = await response.text()
        const result = evaluateM1PreviewProbe({
          childPid: preview.pid,
          childExited: preview.hasExited(),
          readyMarkerSeen: preview.getReadyMarkerSeen(),
          responseOk: response.ok,
          expectedBindingBody: binding.body,
          servedBindingBody: servedBody,
        })
        onProbe({
          httpStatus: response.status,
          servedBodySha256: createHash('sha256').update(servedBody, 'utf8').digest('hex'),
          result,
        })
        if (result.passed) return
        if (preview.hasExited()) {
          throw new Error(`M1_PERF_PREVIEW_EXITED: ${preview.getExitDescription()}`)
        }
        throw new Error(
          `M1_PERF_PREVIEW_BINDING_MISMATCH: HTTP ${response.status} ${binding.url}`,
        )
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith('M1_PERF_PREVIEW_') || preview.hasExited())
        ) {
          throw error
        }
        // The child declared itself ready, but the socket may need one more turn.
      }
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('M1_PERF_PREVIEW_TIMEOUT')
}

export interface PreviewStopOptions {
  readonly termTimeoutMilliseconds?: number
  readonly killTimeoutMilliseconds?: number
}

export interface PreviewCleanupResult {
  readonly childExitedAfterCleanup: boolean | null
  readonly errors: readonly Error[]
}

export interface M1RunOutcome {
  readonly executionPassed: boolean
  readonly formalGatePassed: boolean | null
  readonly exitCode: 0 | 1
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function cleanupTimeout(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`M1_PERF_PREVIEW_CLEANUP_TIMEOUT_INVALID: ${String(resolved)}`)
  }
  return resolved
}

async function waitForChildExit(child: ChildProcess, timeoutMilliseconds: number): Promise<boolean> {
  if (hasChildExited(child)) return true
  return new Promise<boolean>((resolveExit) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const onExit = (): void => finish(true)
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      child.off?.('exit', onExit)
      resolveExit(exited || hasChildExited(child))
    }
    child.once('exit', onExit)
    timer = setTimeout(() => finish(false), timeoutMilliseconds)
    if (hasChildExited(child)) finish(true)
  })
}

function sendPreviewSignal(child: ChildProcess, signal: NodeJS.Signals): Readonly<{
  sent: boolean
  error?: string
}> {
  try {
    return { sent: child.kill(signal) }
  } catch (error) {
    return { sent: false, error: serializeError(error).message }
  }
}

export async function stopPreview(
  child: ChildProcess | undefined,
  options: PreviewStopOptions = {},
): Promise<void> {
  if (child === undefined || hasChildExited(child)) return
  const termTimeoutMilliseconds = cleanupTimeout(options.termTimeoutMilliseconds, 5_000)
  const killTimeoutMilliseconds = cleanupTimeout(options.killTimeoutMilliseconds, 2_000)
  const term = sendPreviewSignal(child, 'SIGTERM')
  if (await waitForChildExit(child, termTimeoutMilliseconds)) return
  const kill = sendPreviewSignal(child, 'SIGKILL')
  if (await waitForChildExit(child, killTimeoutMilliseconds)) return
  throw new Error(
    `M1_PERF_PREVIEW_CLEANUP_FAILED: TERM sent=${term.sent}${term.error === undefined ? '' : ` error=${term.error}`}; KILL sent=${kill.sent}${kill.error === undefined ? '' : ` error=${kill.error}`}; exitCode=${String(child.exitCode)}, signal=${String(child.signalCode)}`,
  )
}

export async function cleanupPreviewResources(
  input: Readonly<{
    child: ChildProcess | undefined
    bindingPath: string | undefined
    stopOptions?: PreviewStopOptions
  }>,
  dependencies: Readonly<{
    stop?: typeof stopPreview
    removeBinding?: (path: string) => Promise<void>
  }> = {},
): Promise<PreviewCleanupResult> {
  const errors: Error[] = []
  const stop = dependencies.stop ?? stopPreview
  const removeBinding = dependencies.removeBinding ?? unlink
  let stopVerifiedExit = false
  try {
    await stop(input.child, input.stopOptions)
    stopVerifiedExit = input.child !== undefined
  } catch (error) {
    const serialized = serializeError(error)
    errors.push(
      serialized.message.startsWith('M1_PERF_PREVIEW_CLEANUP_')
        ? new Error(serialized.message)
        : new Error(`M1_PERF_PREVIEW_CLEANUP_FAILED: ${serialized.message}`),
    )
  }

  const childExitedAfterCleanup =
    input.child === undefined ? null : stopVerifiedExit || hasChildExited(input.child)
  if (input.bindingPath !== undefined) {
    try {
      await removeBinding(input.bindingPath)
    } catch (error) {
      errors.push(
        new Error(`M1_PERF_BINDING_CLEANUP_FAILED: ${serializeError(error).message}`),
      )
    }
  }
  return { childExitedAfterCleanup, errors }
}

export function evaluateM1RunOutcome(input: Readonly<{
  formal: boolean
  fatalErrorCount: number
  requiredScenarioCount: number
  scenarioPassed: readonly boolean[]
}>): M1RunOutcome {
  const executionPassed =
    input.fatalErrorCount === 0 &&
    input.scenarioPassed.length === input.requiredScenarioCount &&
    input.scenarioPassed.every(Boolean)
  return {
    executionPassed,
    formalGatePassed: input.formal ? executionPassed : null,
    exitCode: executionPassed ? 0 : 1,
  }
}

function sampleThresholds(
  fixture: M1FireFlowFixture,
  scenario: M1PerformanceScenario,
): M1PerformanceThresholds {
  return {
    flowP95Milliseconds: scenario.thresholds.fireFlowUpdateP95Ms,
    flowMaxMilliseconds: scenario.thresholds.fireFlowUpdateMaxMs,
    minimumFramesPerSecond: scenario.thresholds.minimumFpsPerFullSecond,
    expectedTickRateHz: fixture.protocol.expectedTickHz,
    minimumTicksPerSecond: fixture.protocol.fullSecondTickMinimum,
    maximumTicksPerSecond: fixture.protocol.fullSecondTickMaximum,
    allowedTotalTickError: fixture.protocol.totalTickTolerance,
    expectedDroppedTickCount: fixture.protocol.expectedDroppedTickCount,
    expectedActivePearlCount: scenario.activePearlCount,
  }
}

function pageEnvironmentChecks(
  evidence: BrowserSamplingEvidence,
  scenario: M1PerformanceScenario,
  tickWindow: Readonly<{ minimum: number; maximum: number }>,
  diagnostics: Readonly<{
    consoleErrors: readonly string[]
    pageErrors: readonly string[]
    failedRequests: readonly string[]
    failedResponses: readonly string[]
  }>,
): readonly M1EvidenceCheck[] {
  const start = evidence.startEnvironment
  const end = evidence.endEnvironment
  const correctStartCanvases = start.canvases.filter(
    (canvas) => canvas.width === VIEWPORT.width && canvas.height === VIEWPORT.height,
  ).length
  const correctEndCanvases = end.canvases.filter(
    (canvas) => canvas.width === VIEWPORT.width && canvas.height === VIEWPORT.height,
  ).length
  const lifecycleViolations = evidence.lifecycleEvents.filter(
    (event) => event.type === 'blur' || event.visibilityState !== 'visible',
  )
  const sharedBefore =
    evidence.before.fieldGeneration === evidence.before.renderedGeneration &&
    JSON.stringify(evidence.before.ruleSample) === JSON.stringify(evidence.before.renderSample)
  const sharedAfter =
    evidence.after.fieldGeneration === evidence.after.renderedGeneration &&
    JSON.stringify(evidence.after.ruleSample) === JSON.stringify(evidence.after.renderSample)
  return [
    {
      id: 'scenario-id',
      passed:
        evidence.before.scenarioId === scenario.id &&
        evidence.after.scenarioId === scenario.id,
      actual: `${evidence.before.scenarioId}/${evidence.after.scenarioId}`,
      expected: scenario.id,
    },
    {
      id: 'scenario-ready',
      passed: evidence.before.ready && evidence.after.ready,
      actual: `${evidence.before.ready}/${evidence.after.ready}`,
      expected: true,
    },
    {
      id: 'overlay-none',
      passed:
        evidence.before.overlayMode === 'none' && evidence.after.overlayMode === 'none',
      actual: `${evidence.before.overlayMode}/${evidence.after.overlayMode}`,
      expected: 'none',
    },
    {
      id: 'viewport',
      passed:
        start.innerWidth === VIEWPORT.width &&
        start.innerHeight === VIEWPORT.height &&
        end.innerWidth === VIEWPORT.width &&
        end.innerHeight === VIEWPORT.height,
      actual: `${start.innerWidth}x${start.innerHeight}/${end.innerWidth}x${end.innerHeight}`,
      expected: `${VIEWPORT.width}x${VIEWPORT.height}`,
    },
    {
      id: 'device-pixel-ratio',
      passed:
        isM1DevicePixelRatioOne(start.devicePixelRatio) &&
        isM1DevicePixelRatioOne(end.devicePixelRatio),
      actual: `${start.devicePixelRatio}/${end.devicePixelRatio}`,
      expected: '1 +/- 1e-6',
    },
    {
      id: 'canvas-output',
      passed:
        start.canvases.length > 0 &&
        end.canvases.length > 0 &&
        correctStartCanvases === start.canvases.length &&
        correctEndCanvases === end.canvases.length,
      actual: `${correctStartCanvases}/${start.canvases.length} -> ${correctEndCanvases}/${end.canvases.length}`,
      expected: `全部 Canvas ${VIEWPORT.width}x${VIEWPORT.height}`,
    },
    {
      id: 'foreground-start-end',
      passed:
        start.visibilityState === 'visible' &&
        start.hasFocus &&
        end.visibilityState === 'visible' &&
        end.hasFocus,
      actual: `${start.visibilityState}/${start.hasFocus} -> ${end.visibilityState}/${end.hasFocus}`,
      expected: 'visible/true -> visible/true',
    },
    {
      id: 'foreground-throughout',
      passed: lifecycleViolations.length === 0,
      actual: lifecycleViolations.length,
      expected: 0,
    },
    {
      id: 'shared-flow-output',
      passed: sharedBefore && sharedAfter,
      actual: `${sharedBefore}/${sharedAfter}`,
      expected: true,
    },
    {
      id: 'tick-rate',
      passed:
        isM1TickRateInsideConfiguredWindow(
          evidence.before.tickHz,
          tickWindow.minimum,
          tickWindow.maximum,
        ) &&
        isM1TickRateInsideConfiguredWindow(
          evidence.after.tickHz,
          tickWindow.minimum,
          tickWindow.maximum,
        ),
      actual: `${evidence.before.tickHz}/${evidence.after.tickHz}`,
      expected: `${tickWindow.minimum}..${tickWindow.maximum}`,
    },
    {
      id: 'fingerprint-stable',
      passed:
        evidence.before.simulationContentFingerprint.length > 0 &&
        evidence.before.simulationContentFingerprint ===
          evidence.after.simulationContentFingerprint,
      actual: `${evidence.before.simulationContentFingerprint}/${evidence.after.simulationContentFingerprint}`,
      expected: '同一非空 simulationContentFingerprint',
    },
    {
      id: 'console-errors',
      passed: diagnostics.consoleErrors.length === 0,
      actual: diagnostics.consoleErrors.length,
      expected: 0,
    },
    {
      id: 'page-errors',
      passed: diagnostics.pageErrors.length === 0,
      actual: diagnostics.pageErrors.length,
      expected: 0,
    },
    {
      id: 'failed-requests',
      passed: diagnostics.failedRequests.length === 0,
      actual: diagnostics.failedRequests.length,
      expected: 0,
    },
    {
      id: 'failed-responses',
      passed: diagnostics.failedResponses.length === 0,
      actual: diagnostics.failedResponses.length,
      expected: 0,
    },
  ]
}

async function focusPage(page: Page): Promise<void> {
  await page.bringToFront()
  await page.evaluate(() => window.focus())
}

async function runScenario(input: Readonly<{
  browser: Browser
  baseUrl: string
  outputDirectory: string
  fixture: M1FireFlowFixture
  scenario: M1PerformanceScenario
  timing: M1RunTiming
  boundaryUpdateTolerance: number
}>): Promise<Readonly<{ raw: ScenarioRawEvidence; summary: ScenarioSummaryEvidence }>> {
  const { scenario, fixture, timing } = input
  const url = buildM1ScenarioUrl(input.baseUrl, scenario.id)
  const rawPath = resolve(input.outputDirectory, `raw-${scenario.id}.json`)
  const screenshotPath = resolve(input.outputDirectory, `failure-${scenario.id}.png`)
  const pageConsoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const failedResponses: string[] = []
  let page: Page | undefined
  let sampleEvidence: BrowserSamplingEvidence | undefined
  let environmentChecks: readonly M1EvidenceCheck[] = []
  let consistency: M1SampleConsistencyResult | undefined
  let summary: M1PerformanceSummary | undefined
  let gate: M1PerformanceGate | undefined
  let error: SerializedError | undefined
  let failureScreenshot: string | undefined
  let context: BrowserContext | undefined

  try {
    context = await input.browser.newContext({
      viewport: VIEWPORT,
      screen: VIEWPORT,
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      colorScheme: 'dark',
    })
    page = await context.newPage()
    page.setDefaultTimeout(120_000)
    page.on('console', (message) => {
      if (message.type() === 'error') pageConsoleErrors.push(message.text())
    })
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
      }
    })

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const api = (window as unknown as { readonly __LIANDAN_M1__?: M1BrowserApi })
        .__LIANDAN_M1__
      return api?.getSnapshot().ready === true
    })
    await focusPage(page)
    await page.waitForTimeout(timing.warmupMilliseconds)
    await focusPage(page)
    sampleEvidence = await page.evaluate(
      async (durationMilliseconds): Promise<BrowserSamplingEvidence> => {
        const api = (
          window as unknown as Window & {
            readonly __LIANDAN_M1__?: M1BrowserApi
          }
        ).__LIANDAN_M1__
        if (api === undefined) throw new Error('M1_BROWSER_API_MISSING')
        const lifecycleEvents: LifecycleEventEvidence[] = []
        const eventController = new AbortController()
        window.addEventListener(
          'blur',
          () => {
            lifecycleEvents.push({
              type: 'blur',
              timestampMilliseconds: performance.now(),
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
            })
          },
          { signal: eventController.signal },
        )
        window.addEventListener(
          'focus',
          () => {
            lifecycleEvents.push({
              type: 'focus',
              timestampMilliseconds: performance.now(),
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
            })
          },
          { signal: eventController.signal },
        )
        document.addEventListener(
          'visibilitychange',
          () => {
            lifecycleEvents.push({
              type: 'visibilitychange',
              timestampMilliseconds: performance.now(),
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
            })
          },
          { signal: eventController.signal },
        )
        try {
          const startCanvases = [
            ...document.querySelectorAll<HTMLCanvasElement>('canvas'),
          ].map((canvas) => {
            const rect = canvas.getBoundingClientRect()
            return {
              width: canvas.width,
              height: canvas.height,
              cssWidth: rect.width,
              cssHeight: rect.height,
            }
          })
          const startProbeCanvas = document.createElement('canvas')
          const startGl =
            startProbeCanvas.getContext('webgl2') ??
            startProbeCanvas.getContext('webgl')
          const startDebugInfo =
            startGl?.getExtension('WEBGL_debug_renderer_info') ?? null
          const navigatorWithMemory = navigator as Navigator & {
            readonly deviceMemory?: number
          }
          const startEnvironment: PageEnvironmentEvidence = {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
            webglVendor:
              startGl === null || startDebugInfo === null
                ? null
                : String(
                    startGl.getParameter(startDebugInfo.UNMASKED_VENDOR_WEBGL),
                  ),
            webglRenderer:
              startGl === null || startDebugInfo === null
                ? null
                : String(
                    startGl.getParameter(startDebugInfo.UNMASKED_RENDERER_WEBGL),
                  ),
            canvases: startCanvases,
          }
          const before = api.getSnapshot()
          const sample = await api.startSample(durationMilliseconds)
          const after = api.getSnapshot()
          const endCanvases = [
            ...document.querySelectorAll<HTMLCanvasElement>('canvas'),
          ].map((canvas) => {
            const rect = canvas.getBoundingClientRect()
            return {
              width: canvas.width,
              height: canvas.height,
              cssWidth: rect.width,
              cssHeight: rect.height,
            }
          })
          const endProbeCanvas = document.createElement('canvas')
          const endGl =
            endProbeCanvas.getContext('webgl2') ?? endProbeCanvas.getContext('webgl')
          const endDebugInfo =
            endGl?.getExtension('WEBGL_debug_renderer_info') ?? null
          const endEnvironment: PageEnvironmentEvidence = {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
            webglVendor:
              endGl === null || endDebugInfo === null
                ? null
                : String(endGl.getParameter(endDebugInfo.UNMASKED_VENDOR_WEBGL)),
            webglRenderer:
              endGl === null || endDebugInfo === null
                ? null
                : String(endGl.getParameter(endDebugInfo.UNMASKED_RENDERER_WEBGL)),
            canvases: endCanvases,
          }
          return {
            before,
            sample,
            after,
            startEnvironment,
            endEnvironment,
            lifecycleEvents,
          }
        } finally {
          eventController.abort()
        }
      },
      timing.sampleMilliseconds,
    )

    consistency = evaluateM1SampleConsistency({
      requestedDurationMilliseconds: timing.sampleMilliseconds,
      expectedActivePearlCount: scenario.activePearlCount,
      expectedTickRateHz: fixture.protocol.expectedTickHz,
      allowedTotalTickError: fixture.protocol.totalTickTolerance,
      allowedBoundaryUpdateError: input.boundaryUpdateTolerance,
      sample: sampleEvidence.sample,
      before: sampleEvidence.before,
      after: sampleEvidence.after,
    })
    summary = summarizeM1PerformanceSample(sampleEvidence.sample)
    gate = evaluateM1PerformanceGate(summary, sampleThresholds(fixture, scenario))
    environmentChecks = pageEnvironmentChecks(
      sampleEvidence,
      scenario,
      {
        minimum: fixture.protocol.fullSecondTickMinimum,
        maximum: fixture.protocol.fullSecondTickMaximum,
      },
      {
      consoleErrors: pageConsoleErrors,
      pageErrors,
      failedRequests,
      failedResponses,
      },
    )
  } catch (scenarioError) {
    error = serializeError(scenarioError)
  }

  const evaluatePassed = (): boolean =>
    evaluateM1ScenarioPassed({
      errorPresent: error !== undefined,
      consistencyPassed: consistency?.passed === true,
      gatePassed: gate?.passed === true,
      environmentChecks,
      consoleErrorCount: pageConsoleErrors.length,
      pageErrorCount: pageErrors.length,
      failedRequestCount: failedRequests.length,
      failedResponseCount: failedResponses.length,
    })

  const passedBeforeClose = evaluatePassed()
  if (!passedBeforeClose && page !== undefined) {
    try {
      await page.screenshot({ path: screenshotPath, type: 'png' })
      failureScreenshot = repositoryRelative(screenshotPath)
    } catch (screenshotError) {
      const screenshotMessage = serializeError(screenshotError).message
      pageErrors.push(`失败截图保存失败：${screenshotMessage}`)
    }
  }

  if (context !== undefined) {
    try {
      await context.close()
    } catch (closeError) {
      pageErrors.push(`浏览器上下文清理失败：${serializeError(closeError).message}`)
    }
  }

  if (sampleEvidence !== undefined) {
    environmentChecks = pageEnvironmentChecks(
      sampleEvidence,
      scenario,
      {
        minimum: fixture.protocol.fullSecondTickMinimum,
        maximum: fixture.protocol.fullSecondTickMaximum,
      },
      {
        consoleErrors: pageConsoleErrors,
        pageErrors,
        failedRequests,
        failedResponses,
      },
    )
  }
  const passed = evaluatePassed()
  if (!passed && passedBeforeClose && page !== undefined) {
    try {
      await page.screenshot({ path: screenshotPath, type: 'png' })
      failureScreenshot = repositoryRelative(screenshotPath)
    } catch (screenshotError) {
      pageErrors.push(`失败截图保存失败：${serializeError(screenshotError).message}`)
    }
  }

  const raw: ScenarioRawEvidence = {
    reportVersion: 1,
    scenarioId: scenario.id,
    formal: timing.formal,
    timing,
    boundaryUpdateTolerance: input.boundaryUpdateTolerance,
    boundaryUpdateReason: 'rAF_END_BOUNDARY_ONLY',
    scenarioConfig: scenario,
    fixtureContext: {
      world: fixture.world,
      protocol: fixture.protocol,
      source: fixture.performanceSource,
      fullObstacles: fixture.performanceFullObstacleFixture,
    },
    url,
    ...(sampleEvidence === undefined ? {} : { sampleEvidence }),
    pageConsoleErrors,
    pageErrors,
    failedRequests,
    failedResponses,
    environmentChecks,
    ...(consistency === undefined ? {} : { consistency }),
    ...(summary === undefined ? {} : { summary }),
    ...(gate === undefined ? {} : { gate }),
    passed,
    ...(failureScreenshot === undefined ? {} : { screenshotPath: failureScreenshot }),
    ...(error === undefined ? {} : { error }),
  }
  await writeFile(rawPath, json(raw), 'utf8')

  return {
    raw,
    summary: {
      scenarioId: scenario.id,
      activePearlCount: scenario.activePearlCount,
      rawEvidencePath: repositoryRelative(rawPath),
      ...(failureScreenshot === undefined ? {} : { screenshotPath: failureScreenshot }),
      passed,
      ...(summary === undefined ? {} : { summary }),
      environmentChecks,
      consistencyChecks: consistency?.checks ?? [],
      gateChecks: gate?.checks ?? [],
      ...(error === undefined ? {} : { error }),
    },
  }
}

function formatActual(value: M1EvidenceCheck['actual']): string {
  if (!Array.isArray(value)) return String(value)
  if (value.length <= 12) return value.join(', ')
  const minimum = Math.min(...value)
  const maximum = Math.max(...value)
  return `${value.length} 项，min=${minimum}，max=${maximum}`
}

function markdownCheckRows(
  checks: readonly Readonly<{
    id: string
    passed: boolean
    actual: number | string | boolean | readonly number[]
    expected: number | string | boolean
  }>[],
): string {
  if (checks.length === 0) return '_无可用检查结果_\n'
  return [
    '| 检查 | 结果 | 实际值 | 期望值 |',
    '| --- | --- | --- | --- |',
    ...checks.map(
      (check) =>
        `| ${check.id} | ${check.passed ? 'PASS' : 'FAIL'} | ${formatActual(check.actual).replaceAll('|', '\\|')} | ${String(check.expected).replaceAll('|', '\\|')} |`,
    ),
  ].join('\n')
}

function renderChineseMarkdown(report: M1RunReport): string {
  const lines = [
    '# M1 火流生产性能门禁报告',
    '',
    `- 开始时间：${report.startedAt}`,
    `- 完成时间：${report.finishedAt ?? '未完成'}`,
    `- 运行性质：${report.formal ? '正式 10 秒预热 + 60 秒采样' : '烟测，不能作为正式门禁证据'}`,
    `- 执行结果：${report.executionPassed ? 'PASS' : 'FAIL'}`,
    `- 正式门禁：${report.formalGatePassed === null ? '不适用' : report.formalGatePassed ? 'PASS' : 'FAIL'}`,
    '',
    '## 构建与基准环境',
    '',
    `- Git commit：${report.build?.gitCommit ?? '不可用'}`,
    `- 工作树：${report.build?.gitDirty === true ? `dirty（${report.build.gitStatusEntryCount} 项）` : 'clean'}`,
    `- dist 内容 SHA-256：${report.build?.distContentSha256 ?? '不可用'}`,
    `- fixture SHA-256：${report.fixture?.sha256 ?? '不可用'}`,
    `- fixture Schema SHA-256：${report.fixture?.schemaSha256 ?? '不可用'}`,
    `- fixture 校验：${report.fixture === undefined ? '不可用' : 'strict JSON / Schema / semantics PASS'}`,
    `- simulationContentFingerprint：${report.fixture?.simulationContentFingerprint ?? '不可用'}`,
    `- OS：${report.machine === undefined ? '不可用' : `${report.machine.os} ${report.machine.osRelease} (${report.machine.architecture})`}`,
    `- CPU：${report.machine?.cpuModel ?? '不可用'}，${report.machine?.logicalCpuCount ?? 0} 逻辑核`,
    `- 内存：${report.machine === undefined ? '不可用' : `${(report.machine.totalMemoryBytes / 1024 ** 3).toFixed(2)} GiB`}`,
    `- Chromium：${report.browser?.version ?? '不可用'}`,
    `- 浏览器可执行文件：${report.browser?.executablePath ?? '不可用'}`,
    `- Preview 端口预检：${report.preview?.portPreflightPassed === true ? 'PASS' : 'FAIL'}`,
    `- Preview PID / ready：${report.preview?.pid ?? '不可用'} / ${report.preview?.readyMarkerSeen === true ? 'PASS' : 'FAIL'}`,
    `- Preview dist 绑定：${report.preview?.binding?.passed === true ? 'PASS' : 'FAIL'}`,
    `- Preview 清理退出：${report.preview?.childExitedAfterCleanup === true ? 'PASS' : 'FAIL'}`,
    '',
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `## ${scenario.scenarioId}（${scenario.activePearlCount} 珠）`,
      '',
      `结果：${scenario.passed ? 'PASS' : 'FAIL'}`,
      '',
      `原始证据：${scenario.rawEvidencePath}`,
      ...(scenario.screenshotPath === undefined
        ? []
        : ['', `失败截图：${scenario.screenshotPath}`]),
      '',
    )
    if (scenario.summary !== undefined) {
      lines.push(
        `- FireFlow mean / median / p95 / max：${scenario.summary.flowDuration.meanMilliseconds.toFixed(3)} / ${scenario.summary.flowDuration.medianMilliseconds.toFixed(3)} / ${scenario.summary.flowDuration.p95Milliseconds.toFixed(3)} / ${scenario.summary.flowDuration.maxMilliseconds.toFixed(3)} ms`,
        `- 最低完整秒 FPS：${scenario.summary.minimumFramesPerSecond}`,
        `- 总帧 / 总 tick / 流场调用：${scenario.summary.totalFrameCount} / ${scenario.summary.totalTickCount} / ${scenario.summary.flowUpdateCount}`,
        `- dropped tick / 活动珠 / 互动：${scenario.summary.droppedTickCount} / ${scenario.summary.activePearlCount} / ${scenario.summary.interactionCount}`,
        '',
      )
    }
    lines.push(
      '### 环境与运行时证明',
      '',
      markdownCheckRows(scenario.environmentChecks),
      '',
      '### 原始样本一致性',
      '',
      markdownCheckRows(scenario.consistencyChecks),
      '',
      '### 数值门禁',
      '',
      markdownCheckRows(scenario.gateChecks),
      '',
    )
  }

  if (report.fatalErrors.length > 0) {
    lines.push(
      '## 致命错误',
      '',
      ...report.fatalErrors.map((fatalError) => `- ${fatalError.name}: ${fatalError.message}`),
      '',
    )
  }
  lines.push(
    '## 口径说明',
    '',
    '- 两个场景在同一锁定 Playwright Chromium 中顺序执行，分别使用独立浏览器上下文。',
    '- 采样期只调用一次页面内 startSample；采样前后 snapshot 与 raw sample 在同一次页面求值中取得，不使用外部轮询。',
    '- snapshot 边界只容许最多 1 次 rAF 结束帧竞态，不使用 maxCatchUpSteps 放宽 raw flow 或 committed tick 证据。',
    '- Preview 启动前独占检查端口；成功后必须同时匹配本次子进程 ready marker 和 dist 内唯一绑定文件。',
    '- 失败截图只在门禁或环境校验失败后生成，不参与采样期。',
    '',
  )
  return lines.join('\n')
}

async function readPlaywrightVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(resolve(REPOSITORY_ROOT, 'node_modules/@playwright/test/package.json'), 'utf8'),
  ) as { readonly version?: unknown }
  if (typeof packageJson.version !== 'string') throw new Error('M1_PERF_PLAYWRIGHT_VERSION_INVALID')
  return packageJson.version
}

async function execute(report: M1RunReport): Promise<void> {
  const {
    fixturePath,
    fixtureBytes,
    fixture,
    schemaPath,
    schemaBytes,
  } = await loadStrictM1Fixture()
  const timing = resolveM1RunTiming(fixture.protocol, process.env)
  report.timing = timing
  report.formal = timing.formal
  if (!timing.overridden && !timing.formal) {
    throw new Error('M1_PERF_FORMAL_PROTOCOL_INVALID: 正式门禁必须使用 10 秒预热与 60 秒采样')
  }
  const configResult = loadAndValidatePublicConfig(REPOSITORY_ROOT)
  if (!configResult.ok) {
    throw new Error(`M1_PERF_CONFIG_INVALID: ${JSON.stringify(configResult.issues)}`)
  }
  const boundaryUpdateTolerance = RAF_END_BOUNDARY_UPDATE_TOLERANCE

  const distPath = resolve(REPOSITORY_ROOT, 'dist')
  const distFiles = await collectFiles(distPath)
  if (distFiles.length === 0) throw new Error('M1_PERF_DIST_EMPTY')
  const distContentSha256 = computeFramedContentSha256(distFiles)
  const git = await readGitEvidence()
  report.fixture = {
    path: repositoryRelative(fixturePath),
    sha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    schemaPath: repositoryRelative(schemaPath),
    schemaSha256: createHash('sha256').update(schemaBytes).digest('hex'),
    strictJsonValidated: true,
    schemaValidated: true,
    semanticsValidated: true,
  }
  report.build = {
    distPath: repositoryRelative(distPath),
    distContentSha256,
    distFileCount: distFiles.length,
    gitCommit: git.commit,
    gitDirty: git.dirty,
    gitStatusEntryCount: git.statusEntryCount,
  }
  const cpuList = cpus()
  report.machine = {
    os: platform(),
    osRelease: release(),
    osVersion: osVersion(),
    architecture: arch(),
    cpuModel: cpuList[0]?.model ?? 'UNKNOWN',
    logicalCpuCount: cpuList.length,
    totalMemoryBytes: totalmem(),
  }

  const port = readPort()
  const baseUrl = `http://${HOST}:${port}`
  report.preview = {
    url: baseUrl,
    port,
    portPreflightPassed: false,
    pid: null,
    readyMarkerSeen: false,
    childAliveAfterBinding: null,
    childExitedAfterCleanup: null,
    stdout: '',
    stderr: '',
  }
  await assertM1TcpPortAvailable(HOST, port)
  report.preview = { ...report.preview, portPreflightPassed: true }

  let preview: PreviewProcess | undefined
  let binding: PreviewBindingArtifact | undefined
  let bindingProbe: PreviewBindingProbeEvidence | undefined
  let browser: Browser | undefined
  try {
    binding = await createPreviewBinding(distPath, baseUrl, distContentSha256)
    preview = startPreview(port, baseUrl)
    await waitForPreview(preview, binding, (evidence) => {
      bindingProbe = evidence
    })
    const executablePath = chromium.executablePath()
    if (!executablePath.toLowerCase().includes(`${sep}ms-playwright${sep}chromium-`)) {
      throw new Error(`M1_PERF_CHROMIUM_NOT_LOCKED: ${executablePath}`)
    }
    browser = await chromium.launch({
      headless: false,
      executablePath,
    })
    report.browser = {
      engine: 'chromium',
      headed: true,
      version: browser.version(),
      executablePath,
      playwrightVersion: await readPlaywrightVersion(),
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
    }

    for (const scenarioId of REQUIRED_SCENARIO_IDS) {
      const scenario = fixture.performanceScenarios.find(
        (candidate) => candidate.id === scenarioId,
      )
      if (scenario === undefined) {
        throw new Error(`M1_PERF_SCENARIO_MISSING: ${scenarioId}`)
      }
      process.stdout.write(
        `[M1 PERF] ${scenario.id}: 预热 ${timing.warmupMilliseconds} ms，采样 ${timing.sampleMilliseconds} ms\n`,
      )
      const result = await runScenario({
        browser,
        baseUrl,
        outputDirectory: report.outputDirectory,
        fixture,
        scenario,
        timing,
        boundaryUpdateTolerance,
      })
      report.scenarios.push(result.summary)
      const fingerprint = result.raw.sampleEvidence?.after.simulationContentFingerprint
      if (fingerprint !== undefined) {
        const prior: string | undefined = report.fixture?.simulationContentFingerprint
        if (prior !== undefined && prior !== fingerprint) {
          report.fatalErrors.push(
            serializeError(new Error('M1_PERF_FINGERPRINT_CHANGED_BETWEEN_SCENARIOS')),
          )
        }
        if (report.fixture === undefined) {
          throw new Error('M1_PERF_FIXTURE_EVIDENCE_MISSING')
        }
        report.fixture = { ...report.fixture, simulationContentFingerprint: fingerprint }
      }
      process.stdout.write(
        `[M1 PERF] ${scenario.id}: ${result.summary.passed ? 'PASS' : 'FAIL'}\n`,
      )
    }
  } finally {
    if (browser !== undefined) {
      try {
        await browser.close()
      } catch (error) {
        report.fatalErrors.push(
          serializeError(new Error(`M1_PERF_BROWSER_CLOSE_FAILED: ${serializeError(error).message}`)),
        )
      }
    }
    const cleanup = await cleanupPreviewResources({
      child: preview?.child,
      bindingPath: binding?.absolutePath,
    })
    report.fatalErrors.push(...cleanup.errors.map(serializeError))
    if (binding !== undefined && preview !== undefined && bindingProbe === undefined) {
      bindingProbe = {
        result: evaluateM1PreviewProbe({
          childPid: preview.pid,
          childExited: preview.hasExited(),
          readyMarkerSeen: preview.getReadyMarkerSeen(),
          responseOk: false,
          expectedBindingBody: binding.body,
        }),
      }
    }
    const childAliveCheck = bindingProbe?.result.checks.find(
      (check) => check.id === 'preview-child-alive',
    )
    report.preview = {
      url: baseUrl,
      port,
      portPreflightPassed: true,
      pid: preview?.pid ?? null,
      readyMarkerSeen: preview?.getReadyMarkerSeen() ?? false,
      childAliveAfterBinding:
        childAliveCheck === undefined ? null : childAliveCheck.passed,
      childExitedAfterCleanup: cleanup.childExitedAfterCleanup,
      ...(binding === undefined
        ? {}
        : {
            binding: {
              path: binding.relativePath,
              url: binding.url,
              distContentSha256: binding.distContentSha256,
              tokenSha256: binding.tokenSha256,
              expectedBodySha256: binding.expectedBodySha256,
              ...(bindingProbe?.servedBodySha256 === undefined
                ? {}
                : { servedBodySha256: bindingProbe.servedBodySha256 }),
              ...(bindingProbe?.httpStatus === undefined
                ? {}
                : { httpStatus: bindingProbe.httpStatus }),
              passed: bindingProbe?.result.passed ?? false,
              checks: bindingProbe?.result.checks ?? [],
            },
          }),
      stdout: preview?.getStdout() ?? '',
      stderr: preview?.getStderr() ?? '',
    }
  }
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const outputDirectory = resolve(
    REPOSITORY_ROOT,
    'output/performance/m1',
    timestampDirectoryName(startedAt),
  )
  await mkdir(outputDirectory, { recursive: true })
  const report: M1RunReport = {
    reportVersion: 1,
    startedAt: startedAt.toISOString(),
    outputDirectory,
    formal: false,
    scenarios: [],
    fatalErrors: [],
    executionPassed: false,
    formalGatePassed: null,
  }

  try {
    await execute(report)
  } catch (error) {
    report.fatalErrors.push(serializeError(error))
  } finally {
    report.finishedAt = new Date().toISOString()
    const outcome = evaluateM1RunOutcome({
      formal: report.formal,
      fatalErrorCount: report.fatalErrors.length,
      requiredScenarioCount: REQUIRED_SCENARIO_IDS.length,
      scenarioPassed: report.scenarios.map((scenario) => scenario.passed),
    })
    report.executionPassed = outcome.executionPassed
    report.formalGatePassed = outcome.formalGatePassed
    const summaryJsonPath = resolve(outputDirectory, 'summary.json')
    const summaryMarkdownPath = resolve(outputDirectory, 'summary.md')
    await writeFile(summaryJsonPath, json(report), 'utf8')
    await writeFile(summaryMarkdownPath, renderChineseMarkdown(report), 'utf8')
    process.stdout.write(`[M1 PERF] 报告：${summaryMarkdownPath}\n`)
    process.stdout.write(
      `[M1 PERF] ${report.formal ? '正式门禁' : '烟测'}：${report.executionPassed ? 'PASS' : 'FAIL'}\n`,
    )
    process.exitCode = outcome.exitCode
  }
}

const entryPath = process.argv[1]
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  void main()
}
