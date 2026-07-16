import { createHash, randomUUID } from 'node:crypto'
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { arch, platform, release } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import {
  assertM5VisualFailureCaptureSequence,
  assertM5VisualEvidenceCellCoverage,
  assertM5VisualManualReviewPending,
  assertM5MaterialEvidenceTargetMatchesContentCenter,
  acquireM5VisualClockPause,
  captureM5VisualTransientWithClock,
  createM5VisualBrowserEnvironmentChecks,
  createM5VisualContactSheetContext,
  createM5VisualEvidenceContactSheet,
  createM5VisualEvidenceFailedRecord,
  createM5VisualFailurePhaseChecks,
  createM5VisualFirePhaseChecks,
  createM5VisualLayoutChecks,
  createM5VisualMaterialPairBoundaryChecks,
  createM5VisualMaterialTopologyBoundaryChecks,
  createM5VisualWarningBoundaryChecks,
  hasM5MaterialTopologyStopAuthority,
  classifyM5MaterialTopology,
  alignM5VisualCollector as alignCollectorWithMaterialEvidence,
  createM5VisualLateCleanupRegistry,
  createPendingM5VisualManualReview,
  drainM5VisualLateCleanupRegistry,
  evaluateM5VisualEvidenceBrowserLaunchAudit,
  expandM5VisualEvidenceMatrix,
  expectedM5VisualFailurePresentationState,
  inspectM5VisualEvidencePng,
  isM5VisualEvidenceInitialFailurePlaceholder,
  M5_VISUAL_IDENTITY_COLOR_MATRIX,
  M5_VISUAL_EVIDENCE_INITIAL_FAILURE_REASON_ZH,
  M5_VISUAL_LAYOUT_CORE_CONTROLS,
  m5VisualBrowserAudioMutedByLaunchArgs,
  parseAndValidateM5VisualEvidenceFixtureJson,
  runM5VisualEvidenceWithTimeout,
  requiresM5VisualContextQuarantine,
  serializeM5VisualEvidenceError as serializeError,
  sha256M5VisualEvidence,
  targetFailureProgress,
  validateM5VisualEvidenceCaptureRecord,
  writeM5VisualEvidenceFileAtomically,
  type M5VisualEvidenceBrowserFixture,
  type M5VisualEvidenceBrowserEnvironment,
  type M5VisualEvidenceCaptureContext,
  type M5VisualEvidenceCaptureRecord,
  type M5VisualEvidenceCheck,
  type M5VisualEvidenceExpectedCell,
  type M5VisualEvidenceFixture,
  type M5VisualEvidenceRecord,
  type M5VisualEvidenceSerializedError,
  type M5VisualEvidenceViewport,
  type M5VisualEvidenceVisionMode,
  type M5VisualEvidenceScreenshotMode,
  type M5MaterialTopologyMetrics,
  type M5VisualMaterialPairBoundaryObservation,
  type M5VisualFailureBoundaryObservation,
  type M5VisualClockPauseAudit,
  type M5VisualFailurePhaseThresholds,
  type M5VisualFirePhaseBoundaryObservation,
  type M5VisualWarningTransitionLatch,
} from './m5-visual-evidence-support.ts'
import {
  assertM5VisualVisionTransformPrepared,
  prepareM5VisualVisionTransform,
  type M5VisionTransformPreparedToken,
} from './m5-visual-evidence-vision.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'output', 'visual-evidence', 'm5')
const FIXTURE_PATH = resolve(
  REPOSITORY_ROOT,
  'public',
  'config',
  'evidence',
  'm5-visual-matrix.json',
)
const SCHEMA_PATH = resolve(
  REPOSITORY_ROOT,
  'schemas',
  'config',
  'm5-visual-evidence.schema.json',
)
const EARLY_AUDIT_TIMEOUT_MILLISECONDS = 10_000
const RUN_STARTED = new Date()
const RUN_ID = `${timestampDirectoryName(RUN_STARTED)}-${randomUUID()}`
const RUN_OUTPUT_DIRECTORY = resolve(OUTPUT_ROOT, RUN_ID)
const M5_VISUAL_LATE_CLEANUPS = createM5VisualLateCleanupRegistry()

type PageTelemetry = {
  consoleErrors: string[]
  pageErrors: string[]
  requestErrors: string[]
}

type BrowserRuntime = Readonly<{
  fixture: M5VisualEvidenceBrowserFixture
  browser: Browser
  version: string
  launchArgs: readonly string[]
  audioMutedByBrowser: boolean
}>

type SerializedEvidenceError = M5VisualEvidenceSerializedError

type M2BrowserEvidence = Readonly<{
  domainEvents: readonly string[]
  presentationState: string
  simulationFingerprint: string
  presentationFingerprint: string
  sessionId: string
  tick: number
  observableState: Readonly<Record<string, unknown>>
}>

type GalleryBrowserEvidence = Readonly<{
  domainEvents: readonly string[]
  presentationState: string
  simulationFingerprint: string
  presentationFingerprint: string
  sessionId: string
  tick: number
  observableState: Readonly<Record<string, unknown>>
}>

type EvidenceManifest = {
  reportVersion: 1
  evidenceKind: 'm5-formal-visual-candidate'
  disclaimerZh: string
  runId: string
  startedAt: string
  finishedAt?: string
  outputDirectory: string
  fixture: Readonly<{
    relativePath: string
    schemaRelativePath: string
    sourceSha256: string
    builtSha256?: string
    servedSha256?: string
  }>
  git: Readonly<{
    commit: string
    branch: string
    dirty: boolean
    status: string
  }>
  build?: Readonly<{
    distDirectory: string
    distSha256: string
    indexMtimeIso: string
    buildLogRelativePath: string
  }>
  preview?: Readonly<{
    baseUrl: string
    port: number
    pid: number | null
    bindingRelativePath: string
    bindingSha256: string
    servedBindingSha256: string
    exitedAfterCleanup: boolean
    portReleasedAfterCleanup: boolean
  }>
  browsers: Readonly<{
    id: string
    channel: string
    engine: 'chromium'
    version: string
    headed: true
    launchArgs: readonly string[]
    audioMutedByBrowser: boolean
  }>[]
  expectedCaseIds: string[]
  records: M5VisualEvidenceRecord[]
  fatalErrors: SerializedEvidenceError[]
  automatedGate: Readonly<{
    capturedCount: number
    manualBlockedCount: number
    failedCount: number
    allCapturedChecksPassed: boolean
    browserLaunchAuditPassed: boolean
    passed: boolean
    statusZh: string
  }>
  manualReview: ReturnType<typeof createPendingM5VisualManualReview>
}

function timestampDirectoryName(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function gitText(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: EARLY_AUDIT_TIMEOUT_MILLISECONDS,
  }).trim()
}

function gitMetadata(): EvidenceManifest['git'] {
  const status = gitText(['status', '--short'])
  return {
    commit: gitText(['rev-parse', 'HEAD']),
    branch: gitText(['branch', '--show-current']),
    dirty: status.length > 0,
    status,
  }
}

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('M5_VISUAL_EVIDENCE_PORT_INVALID')
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('M5_VISUAL_EVIDENCE_PORT_INVALID')
  }
  return port
}

function listFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(absolutePath))
    else if (entry.isFile()) files.push(absolutePath)
  }
  return files
}

function hashDirectory(directory: string): string {
  const hash = createHash('sha256')
  hash.update('LIANDAN_M5_VISUAL_EVIDENCE_DIST_V1\0')
  const files = listFiles(directory).sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  for (const filePath of files) {
    const relativePath = relative(directory, filePath).replaceAll('\\', '/')
    const bytes = readFileSync(filePath)
    hash.update(relativePath, 'utf8')
    hash.update('\0')
    hash.update(String(bytes.byteLength), 'utf8')
    hash.update('\0')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

function viteEntryPath(): string {
  return resolve(REPOSITORY_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
}

function buildProduction(
  distDirectory: string,
  timeoutMilliseconds: number,
): string {
  return execFileSync(
    process.execPath,
    [viteEntryPath(), 'build', '--outDir', distDirectory, '--emptyOutDir'],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
      timeout: timeoutMilliseconds,
    },
  )
}

function startPreview(
  host: string,
  port: number,
  distDirectory: string,
): Readonly<{
  child: ChildProcessWithoutNullStreams
  stdout: () => string
  stderr: () => string
}> {
  const child = spawn(
    process.execPath,
    [
      viteEntryPath(),
      'preview',
      '--outDir',
      distDirectory,
      '--host',
      host,
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  return { child, stdout: () => stdout, stderr: () => stderr }
}

async function assertPortAvailable(
  host: string,
  port: number,
  timeoutMilliseconds: number,
): Promise<void> {
  const server = createServer()
  server.unref()
  const operation = new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', (error) => rejectPromise(error))
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error === undefined) resolvePromise()
        else rejectPromise(error)
      })
    })
  })
  await runM5VisualEvidenceWithTimeout(
    operation,
    timeoutMilliseconds,
    'M5_VISUAL_EVIDENCE_PORT_PROBE_TIMEOUT',
  )
}

async function waitForPreview(
  child: ChildProcessWithoutNullStreams,
  bindingUrl: string,
  expectedBody: string,
  timeoutMilliseconds: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMilliseconds
  let lastError = 'not-started'
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `M5_VISUAL_EVIDENCE_PREVIEW_EXITED:${String(child.exitCode)}:${String(child.signalCode)}`,
      )
    }
    try {
      const response = await fetch(bindingUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2_000),
      })
      const body = await response.text()
      if (response.ok && body === expectedBody) return body
      lastError = `HTTP ${response.status}/${sha256M5VisualEvidence(body)}`
    } catch (error) {
      lastError = serializeError(error).message
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`M5_VISUAL_EVIDENCE_PREVIEW_TIMEOUT:${lastError}`)
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMilliseconds: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise<boolean>((resolvePromise) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      child.off('exit', onExit)
      resolvePromise(value)
    }
    const onExit = (): void => finish(true)
    child.once('exit', onExit)
    timer = setTimeout(
      () => finish(child.exitCode !== null || child.signalCode !== null),
      timeoutMilliseconds,
    )
  })
}

async function stopPreview(
  child: ChildProcessWithoutNullStreams | undefined,
  timeoutMilliseconds: number,
): Promise<void> {
  if (
    child === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return
  }
  child.kill('SIGTERM')
  if (await waitForChildExit(child, Math.floor(timeoutMilliseconds * 0.7)))
    return
  child.kill('SIGKILL')
  if (await waitForChildExit(child, Math.ceil(timeoutMilliseconds * 0.3)))
    return
  throw new Error('M5_VISUAL_EVIDENCE_PREVIEW_CLEANUP_FAILED')
}

function createTelemetry(page: Page): PageTelemetry {
  const telemetry: PageTelemetry = {
    consoleErrors: [],
    pageErrors: [],
    requestErrors: [],
  }
  page.on('console', (message) => {
    if (message.type() === 'error') telemetry.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => telemetry.pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    telemetry.requestErrors.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`,
    )
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      telemetry.requestErrors.push(
        `HTTP ${response.status()} ${response.request().method()} ${response.url()}`,
      )
    }
  })
  return telemetry
}

function m2EvidenceExpression(): string {
  return `(() => {
    const api = window.__LIANDAN_M2__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    const snapshot = api.getSnapshot();
    const canvas = document.querySelector('canvas[data-scene="m2-extraction"]');
    const actualEvents = Array.from(snapshot.lastDomainEventTypes ?? []);
    const domainEvents = actualEvents.length > 0
      ? actualEvents
      : [snapshot.status === 'ready' ? 'SessionReady:authoritative-state-binding' : 'DomainStatus:' + snapshot.status];
    return {
      domainEvents,
      presentationState: snapshot.firePresentationState + '/' + snapshot.failurePresentationState,
      simulationFingerprint: snapshot.simulationContentFingerprint,
      presentationFingerprint: snapshot.presentationContentFingerprint,
      sessionId: snapshot.sessionId,
      tick: snapshot.tick,
      observableState: {
        scene: snapshot.scene,
        ready: snapshot.ready,
        seed: snapshot.seed,
        domainStatus: snapshot.status,
        firePresentationState: snapshot.firePresentationState,
        fireVisualIntensity: snapshot.fireVisualIntensity,
        equippedFireSourceId: snapshot.equippedFireSourceId,
        fireSize: snapshot.fireSize,
        isSpraying: snapshot.isSpraying,
        audioMuted: snapshot.audioMuted,
        flameThrustEnabled: snapshot.flameThrustEnabled,
        furnaceTemperature: snapshot.furnaceTemperature,
        remainingMaterialCellCount: snapshot.remainingMaterialCellCount,
        activePearlCount: snapshot.activePearlCount,
        lossWarningLevel: snapshot.lossWarningLevel,
        failurePresentationState: snapshot.failurePresentationState,
        failurePresentationProgress: snapshot.failurePresentationProgress,
        failurePresentationComplete: snapshot.failurePresentationComplete,
        canvasDataset: canvas ? { ...canvas.dataset } : null,
        domainEventBindingSource: actualEvents.length > 0 ? 'snapshot.lastDomainEventTypes' : 'authoritative-state-inference'
      }
    };
  })()`
}

function galleryEvidenceExpression(): string {
  return `(() => {
    const api = window.__LIANDAN_M5_PERFORMANCE__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_GALLERY_API_MISSING');
    const snapshot = api.snapshot();
    const canvas = document.querySelector('canvas[data-scene="m5-visual-performance"]');
    return {
      domainEvents: ['NO_DOMAIN_EVENT_PRESENTATION_ONLY'],
      presentationState: snapshot.samplingState + '/maximum-fire-gallery',
      simulationFingerprint: snapshot.simulationContentFingerprint,
      presentationFingerprint: snapshot.presentationContentFingerprint,
      sessionId: 'presentation-only/' + snapshot.scenarioId,
      tick: snapshot.sampledFrameCount,
      observableState: {
        benchmarkKind: snapshot.benchmarkKind,
        scenarioId: snapshot.scenarioId,
        seed: snapshot.seed,
        activePearlCount: snapshot.activePearlCount,
        interactionGroupCount: snapshot.interactionGroupCount,
        fireSize: snapshot.fireSize,
        currentFrame: snapshot.currentFrame,
        observedEffectKinds: Array.from(snapshot.observedEffectKinds),
        rendererEvidence: snapshot.rendererEvidence,
        canvasDataset: canvas ? { ...canvas.dataset } : null,
        domainEventBindingSource: 'presentation-only-scene-has-no-domain-runtime'
      }
    };
  })()`
}

async function readM2Evidence(page: Page): Promise<M2BrowserEvidence> {
  return (await page.evaluate(m2EvidenceExpression())) as M2BrowserEvidence
}

async function readGalleryEvidence(
  page: Page,
): Promise<GalleryBrowserEvidence> {
  return (await page.evaluate(
    galleryEvidenceExpression(),
  )) as GalleryBrowserEvidence
}

async function openM2(
  page: Page,
  baseUrl: string,
  timeout: number,
): Promise<void> {
  await page.goto(new URL('/', baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
    timeout,
  })
  await page.waitForFunction(
    "document.body.dataset.appState === 'ready' && document.body.dataset.appMode === 'm2' && Boolean(window.__LIANDAN_M2__) && Boolean(document.querySelector('canvas[data-scene=\"m2-extraction\"]'))",
    undefined,
    { timeout },
  )
}

async function openGallery(
  page: Page,
  baseUrl: string,
  scenarioId: string,
  timeout: number,
): Promise<void> {
  const url = new URL('/', baseUrl)
  url.searchParams.set('mode', 'm5-performance')
  url.searchParams.set('scenario', scenarioId)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout })
  await page.waitForFunction(
    "document.body.dataset.appState === 'ready' && Boolean(window.__LIANDAN_M5_PERFORMANCE__) && Boolean(document.querySelector('canvas[data-scene=\"m5-visual-performance\"]'))",
    undefined,
    { timeout },
  )
}

async function createContext(
  runtime: BrowserRuntime,
  viewport: M5VisualEvidenceViewport,
  reducedMotion: boolean,
  timeoutMilliseconds: number,
): Promise<BrowserContext> {
  return runM5VisualEvidenceWithTimeout(
    runtime.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      screen: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      colorScheme: 'dark',
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    }),
    timeoutMilliseconds,
    `M5_VISUAL_EVIDENCE_CONTEXT_CREATE_TIMEOUT:${runtime.fixture.id}`,
    async (lateContext) => lateContext.close(),
    M5_VISUAL_LATE_CLEANUPS,
  )
}

async function createEvidencePage(
  context: BrowserContext,
  timeoutMilliseconds: number,
): Promise<Page> {
  const page = await runM5VisualEvidenceWithTimeout(
    context.newPage(),
    timeoutMilliseconds,
    'M5_VISUAL_EVIDENCE_PAGE_CREATE_TIMEOUT',
    async (latePage) => latePage.close(),
    M5_VISUAL_LATE_CLEANUPS,
  )
  page.setDefaultTimeout(timeoutMilliseconds)
  page.setDefaultNavigationTimeout(timeoutMilliseconds)
  return page
}

async function applyVisionTransform(
  page: Page,
  visionMode: M5VisualEvidenceVisionMode,
  colorMatrix: readonly number[],
): Promise<M5VisionTransformPreparedToken> {
  return prepareM5VisualVisionTransform(page, visionMode, colorMatrix)
}

async function readBrowserEnvironment(
  page: Page,
  audioMutedByBrowser: boolean,
): Promise<M5VisualEvidenceBrowserEnvironment> {
  return (await page.evaluate(`(() => {
    const app = document.getElementById('app');
    if (!app) throw new Error('M5_VISUAL_EVIDENCE_APP_ROOT_MISSING');
    const root = document.documentElement;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentClientWidth: root.clientWidth,
      documentClientHeight: root.clientHeight,
      documentScrollWidth: root.scrollWidth,
      documentScrollHeight: root.scrollHeight,
      devicePixelRatio: window.devicePixelRatio,
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      computedFilter: getComputedStyle(app).filter,
      visionModeDataset: app.dataset.evidenceVisionMode ?? '',
      colorMatrixDataset: app.dataset.evidenceColorMatrix ?? '',
      audioMutedByBrowser: ${JSON.stringify(audioMutedByBrowser)}
    };
  })()`)) as M5VisualEvidenceBrowserEnvironment
}

function safeCasePath(caseId: string): string {
  if (!/^[a-z0-9@./-]+$/.test(caseId) || caseId.includes('..')) {
    throw new Error(`M5_VISUAL_EVIDENCE_CASE_PATH_INVALID:${caseId}`)
  }
  return caseId
}

async function screenshotAtomically(
  page: Page,
  absolutePath: string,
  screenshotMode: M5VisualEvidenceScreenshotMode,
  timeoutMilliseconds: number,
): Promise<void> {
  mkdirSync(dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp.png`
  try {
    await page.screenshot({
      path: temporaryPath,
      fullPage: screenshotMode === 'full-page',
      animations: 'allow',
      caret: 'hide',
      type: 'png',
      timeout: timeoutMilliseconds,
    })
    renameSync(temporaryPath, absolutePath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function recordMapFromExpected(
  expected: readonly M5VisualEvidenceExpectedCell[],
): Map<string, M5VisualEvidenceRecord> {
  return new Map(
    expected.map((cell) => [
      cell.id,
      cell.expectedStatus === 'manual-blocked'
        ? {
            caseId: cell.id,
            section: cell.section,
            kind: cell.kind,
            status: 'manual-blocked' as const,
            reasonZh:
              cell.manualReasonZh ??
              '等待真实产品路径提供可复核的自动化观察点。',
          }
        : {
            caseId: cell.id,
            section: cell.section,
            kind: cell.kind,
            status: 'failed' as const,
            reasonZh: M5_VISUAL_EVIDENCE_INITIAL_FAILURE_REASON_ZH,
          },
    ]),
  )
}

function expectedCell(
  expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>,
  caseId: string,
): M5VisualEvidenceExpectedCell {
  const cell = expectedById.get(caseId)
  if (cell === undefined) {
    throw new Error(`M5_VISUAL_EVIDENCE_CASE_UNEXPECTED:${caseId}`)
  }
  return cell
}

function markFailed(
  records: Map<string, M5VisualEvidenceRecord>,
  expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>,
  caseId: string,
  error: unknown,
): void {
  const cell = expectedCell(expectedById, caseId)
  if (cell.expectedStatus === 'manual-blocked') return
  records.set(
    caseId,
    createM5VisualEvidenceFailedRecord({
      caseId,
      section: cell.section,
      kind: cell.kind,
      error,
    }),
  )
}

function markPlaceholderFailed(
  records: Map<string, M5VisualEvidenceRecord>,
  expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>,
  caseId: string,
  error: unknown,
): void {
  const current = records.get(caseId)
  if (!isM5VisualEvidenceInitialFailurePlaceholder(current)) return
  markFailed(records, expectedById, caseId, error)
}

type BrowserEvidenceState = M2BrowserEvidence | GalleryBrowserEvidence

type CaptureBoundaryTiming = Readonly<{
  screenshotStartedOffsetMilliseconds?: number
  screenshotFinishedOffsetMilliseconds?: number
}>

type CaptureClockInput =
  | Readonly<{
      mode: 'transient'
      installed: true
      visionTransformToken: M5VisionTransformPreparedToken
      maximumCaptureMilliseconds: number
      resumeReserveMilliseconds: number
      maximumPauseAttempts: number
      pause: () => Promise<M5VisualClockPauseAudit>
      resume: () => Promise<void>
      quarantine: () => Promise<void>
    }>
  | Readonly<{
      mode: 'sequence-held'
      installed: true
      paused: true
      visionTransformToken: M5VisionTransformPreparedToken
      resumeOwner: 'sequence-finally'
      maximumCaptureMilliseconds: number
    }>

type CaptureStateInput =
  | Readonly<{
      state: BrowserEvidenceState
      prepareBefore?: never
    }>
  | Readonly<{
      state?: never
      prepareBefore: () => Promise<BrowserEvidenceState>
    }>

type CaptureInput = Readonly<{
  page: Page
  telemetry: PageTelemetry
  runtime: BrowserRuntime
  viewport: M5VisualEvidenceViewport
  screenshotMode: M5VisualEvidenceScreenshotMode
  reducedMotion: boolean
  visionMode: M5VisualEvidenceVisionMode
  colorMatrix: readonly number[]
  caseId: string
  outputDirectory: string
  runId: string
  distSha256: string
  seed: number
  checks: readonly M5VisualEvidenceCheck[]
  prepareChecks?: (
    state: BrowserEvidenceState,
  ) =>
    | Promise<readonly M5VisualEvidenceCheck[]>
    | readonly M5VisualEvidenceCheck[]
  configuredSampleOffsetMilliseconds?: number
  timedSample?: Readonly<{
    phaseStartedAtMilliseconds: number
    readNowMilliseconds: () => Promise<number>
  }>
  captureBoundary?: Readonly<{
    readAfter: () => Promise<BrowserEvidenceState>
    checks: (
      before: BrowserEvidenceState,
      after: BrowserEvidenceState,
      timing: CaptureBoundaryTiming,
    ) => readonly M5VisualEvidenceCheck[]
  }>
  sourceCaseIds?: readonly string[]
  clockCapture?: CaptureClockInput
}> &
  CaptureStateInput

async function capturePage(
  input: CaptureInput,
  cell: M5VisualEvidenceExpectedCell,
): Promise<M5VisualEvidenceCaptureRecord> {
  const relativePath = `raw/${safeCasePath(input.caseId)}.png`
  const absolutePath = resolve(input.outputDirectory, relativePath)
  let captureState: BrowserEvidenceState | undefined
  let environment: M5VisualEvidenceBrowserEnvironment | undefined
  let afterState: BrowserEvidenceState | undefined
  let preparedChecks: readonly M5VisualEvidenceCheck[] = []
  let screenshotDurationMilliseconds = 0
  let screenshotStartedOffsetMilliseconds: number | undefined
  let screenshotFinishedOffsetMilliseconds: number | undefined
  if (input.clockCapture === undefined) {
    await applyVisionTransform(input.page, input.visionMode, input.colorMatrix)
  } else {
    assertM5VisualVisionTransformPrepared({
      token: input.clockCapture.visionTransformToken,
      page: input.page,
      visionMode: input.visionMode,
      colorMatrix: input.colorMatrix,
    })
  }
  const performCapture = async (timeoutMilliseconds: number): Promise<void> => {
    captureState =
      input.prepareBefore === undefined
        ? input.state
        : await input.prepareBefore()
    preparedChecks =
      input.prepareChecks === undefined
        ? []
        : await input.prepareChecks(captureState)
    environment = await readBrowserEnvironment(
      input.page,
      input.runtime.audioMutedByBrowser,
    )
    screenshotStartedOffsetMilliseconds =
      input.timedSample === undefined
        ? undefined
        : (await input.timedSample.readNowMilliseconds()) -
          input.timedSample.phaseStartedAtMilliseconds
    const screenshotStartedAt = performance.now()
    await screenshotAtomically(
      input.page,
      absolutePath,
      input.screenshotMode,
      timeoutMilliseconds,
    )
    screenshotDurationMilliseconds = performance.now() - screenshotStartedAt
    screenshotFinishedOffsetMilliseconds =
      input.timedSample === undefined
        ? undefined
        : (await input.timedSample.readNowMilliseconds()) -
          input.timedSample.phaseStartedAtMilliseconds
    afterState = await input.captureBoundary?.readAfter()
  }
  const clockAudit =
    input.clockCapture?.mode !== 'transient'
      ? undefined
      : (
          await captureM5VisualTransientWithClock({
            maximumCaptureMilliseconds:
              input.clockCapture.maximumCaptureMilliseconds,
            resumeReserveMilliseconds:
              input.clockCapture.resumeReserveMilliseconds,
            pause: input.clockCapture.pause,
            critical: performCapture,
            resume: input.clockCapture.resume,
            quarantine: input.clockCapture.quarantine,
          })
        ).audit
  if (input.clockCapture?.mode !== 'transient') {
    await performCapture(
      input.clockCapture?.maximumCaptureMilliseconds ?? 30_000,
    )
  }
  if (captureState === undefined || environment === undefined) {
    throw new Error('M5_VISUAL_EVIDENCE_CAPTURE_STATE_MISSING')
  }
  const artifact = inspectM5VisualEvidencePng(absolutePath)
  const pngPhysicalEvidence = {
    width: artifact.width,
    height: artifact.height,
    deviceScaleFactor: environment.devicePixelRatio,
  }
  const boundaryTiming: CaptureBoundaryTiming = {
    ...(screenshotStartedOffsetMilliseconds === undefined
      ? {}
      : { screenshotStartedOffsetMilliseconds }),
    ...(screenshotFinishedOffsetMilliseconds === undefined
      ? {}
      : { screenshotFinishedOffsetMilliseconds }),
  }
  const boundaryChecks =
    input.captureBoundary === undefined || afterState === undefined
      ? []
      : input.captureBoundary.checks(captureState, afterState, boundaryTiming)
  const environmentChecks = createM5VisualBrowserEnvironmentChecks({
    viewport: input.viewport,
    reducedMotion: input.reducedMotion,
    visionMode: input.visionMode,
    colorMatrix: input.colorMatrix,
    seed: input.seed,
    observedSeed: captureState.observableState.seed,
    environment,
    screenshotMode: input.screenshotMode,
    artifact,
  })
  const clockChecks: readonly M5VisualEvidenceCheck[] =
    input.clockCapture === undefined
      ? []
      : input.clockCapture.mode === 'transient'
        ? [
            {
              id: 'transient-clock-installed-paused',
              passed:
                input.clockCapture.installed && clockAudit?.paused === true,
              actual: `${input.clockCapture.installed}/${String(clockAudit?.paused)}`,
              expected: 'true/true',
            },
            {
              id: 'transient-clock-resumed-once',
              passed: clockAudit?.resumed === true,
              actual: String(clockAudit?.resumed),
              expected: true,
            },
            {
              id: 'transient-clock-pause-acquisition-audited',
              passed:
                clockAudit?.pauseAcquisition !== undefined &&
                clockAudit.pauseAcquisition.attemptCount >= 1 &&
                clockAudit.pauseAcquisition.attemptCount <=
                  input.clockCapture.maximumPauseAttempts &&
                clockAudit.pauseAcquisition.retryCount ===
                  clockAudit.pauseAcquisition.attemptCount - 1 &&
                Number.isFinite(clockAudit.pauseAcquisition.targetMilliseconds),
              actual:
                clockAudit?.pauseAcquisition === undefined
                  ? 'missing'
                  : `${clockAudit.pauseAcquisition.attemptCount}/${clockAudit.pauseAcquisition.retryCount}/${clockAudit.pauseAcquisition.targetMilliseconds}`,
              expected: `attempt=1..${input.clockCapture.maximumPauseAttempts}/retry=attempt-1/finite-target`,
            },
            {
              id: 'transient-clock-frozen-section-real-duration-bounded',
              passed:
                (clockAudit?.realDurationMilliseconds ??
                  Number.POSITIVE_INFINITY) <=
                input.clockCapture.maximumCaptureMilliseconds,
              actual:
                clockAudit?.realDurationMilliseconds ??
                Number.POSITIVE_INFINITY,
              expected: `<=${input.clockCapture.maximumCaptureMilliseconds}`,
            },
          ]
        : [
            {
              id: 'transient-clock-installed-paused',
              passed: input.clockCapture.installed && input.clockCapture.paused,
              actual: `${input.clockCapture.installed}/${input.clockCapture.paused}`,
              expected: 'true/true',
            },
            {
              id: 'sequence-clock-resume-owned-by-finally',
              passed: input.clockCapture.resumeOwner === 'sequence-finally',
              actual: input.clockCapture.resumeOwner,
              expected: 'sequence-finally',
            },
          ]
  const screenshotDurationCheck: readonly M5VisualEvidenceCheck[] =
    input.clockCapture === undefined
      ? []
      : [
          {
            id: 'transient-real-screenshot-duration-bounded',
            passed:
              screenshotDurationMilliseconds <=
              input.clockCapture.maximumCaptureMilliseconds,
            actual: screenshotDurationMilliseconds,
            expected: `<=${input.clockCapture.maximumCaptureMilliseconds}`,
          },
        ]
  const context: M5VisualEvidenceCaptureContext = {
    domainEvents: captureState.domainEvents,
    presentationState: captureState.presentationState,
    build: { runId: input.runId, distSha256: input.distSha256 },
    fingerprints: {
      simulation: captureState.simulationFingerprint,
      presentation: captureState.presentationFingerprint,
    },
    viewport: input.viewport,
    browser: {
      id: input.runtime.fixture.id,
      engine: 'chromium',
      channel: input.runtime.fixture.channel,
      version: input.runtime.version,
    },
    environment,
    screenshotMode: input.screenshotMode,
    os: { platform: platform(), release: release(), arch: arch() },
    reducedMotion: input.reducedMotion,
    visionMode: input.visionMode,
    colorMatrix: input.colorMatrix,
    seed: input.seed,
    sessionId: captureState.sessionId,
    tick: captureState.tick,
    consoleErrors: [...input.telemetry.consoleErrors],
    pageErrors: [...input.telemetry.pageErrors],
    requestErrors: [...input.telemetry.requestErrors],
    checks: [
      ...input.checks,
      ...preparedChecks,
      ...boundaryChecks,
      ...environmentChecks,
      ...clockChecks,
      ...screenshotDurationCheck,
    ],
    ...(input.configuredSampleOffsetMilliseconds === undefined
      ? {}
      : {
          configuredSampleOffsetMilliseconds:
            input.configuredSampleOffsetMilliseconds,
        }),
    ...(input.timedSample === undefined ||
    screenshotStartedOffsetMilliseconds === undefined
      ? {}
      : {
          actualSampleOffsetMilliseconds: screenshotStartedOffsetMilliseconds,
        }),
    ...(screenshotStartedOffsetMilliseconds === undefined
      ? {}
      : { screenshotStartedOffsetMilliseconds }),
    ...(screenshotFinishedOffsetMilliseconds === undefined
      ? {}
      : { screenshotFinishedOffsetMilliseconds }),
    observableState: {
      ...captureState.observableState,
      pngPhysicalEvidence,
      ...(input.clockCapture === undefined
        ? {}
        : {
            transientClockCapture: {
              mode: input.clockCapture.mode,
              installed: input.clockCapture.installed,
              paused:
                input.clockCapture.mode === 'transient'
                  ? clockAudit?.paused === true
                  : input.clockCapture.paused,
              ...(input.clockCapture.mode === 'transient'
                ? {
                    resumed: clockAudit?.resumed === true,
                    maximumPauseAttempts:
                      input.clockCapture.maximumPauseAttempts,
                    pauseAcquisition: clockAudit?.pauseAcquisition,
                    realFrozenSectionDurationMilliseconds:
                      clockAudit?.realDurationMilliseconds,
                  }
                : { resumeOwner: input.clockCapture.resumeOwner }),
              realScreenshotDurationMilliseconds:
                screenshotDurationMilliseconds,
            },
          }),
      ...(afterState === undefined
        ? {}
        : {
            screenshotBoundaryAfter: {
              presentationState: afterState.presentationState,
              tick: afterState.tick,
              observableState: afterState.observableState,
            },
          }),
    },
  }
  const record: M5VisualEvidenceCaptureRecord = {
    caseId: input.caseId,
    section: cell.section,
    kind: cell.kind,
    status: 'captured',
    capturedAt: new Date().toISOString(),
    artifact: { relativePath, ...artifact },
    ...(input.sourceCaseIds === undefined
      ? {}
      : { sourceCaseIds: input.sourceCaseIds }),
    context,
  }
  validateM5VisualEvidenceCaptureRecord(record, input.outputDirectory)
  return record
}

function checksPassed(checks: readonly M5VisualEvidenceCheck[]): boolean {
  return checks.every(({ passed }) => passed)
}

async function layoutChecks(
  page: Page,
  viewport: M5VisualEvidenceViewport,
  narrowMaximumWidth: number,
): Promise<readonly M5VisualEvidenceCheck[]> {
  const measured = (await page.evaluate(`(() => {
    const controlDefinitions = ${JSON.stringify(M5_VISUAL_LAYOUT_CORE_CONTROLS)};
    const shell = document.querySelector('[data-m2-shell]');
    const stage = document.querySelector('[data-m2-stage]');
    const canvas = document.querySelector('canvas[data-scene="m2-extraction"]');
    const isVisible = (element) => {
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number.parseFloat(style.opacity) <= 0) return false;
        current = current.parentElement;
      }
      return true;
    };
    const clippedByAncestor = (element, rectangle) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if ((clipsX && (rectangle.left < ancestorRect.left - 1 || rectangle.right > ancestorRect.right + 1)) ||
            (clipsY && (rectangle.top < ancestorRect.top - 1 || rectangle.bottom > ancestorRect.bottom + 1))) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    const controls = controlDefinitions.map(({ id, selector }) => {
      const elements = [...document.querySelectorAll(selector)];
      let visibleCount = 0;
      let nonZeroRectCount = 0;
      let reachableCount = 0;
      let hitTestCount = 0;
      let clippedByAncestorCount = 0;
      let disabledCount = 0;
      for (const element of elements) {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rectangle = element.getBoundingClientRect();
        const visible = isVisible(element);
        const nonZero = rectangle.width > 0 && rectangle.height > 0;
        const clipped = clippedByAncestor(element, rectangle);
        const inViewport = rectangle.left >= -1 && rectangle.right <= window.innerWidth + 1 && rectangle.top >= -1 && rectangle.bottom <= window.innerHeight + 1;
        const hit = document.elementFromPoint(
          rectangle.left + rectangle.width / 2,
          rectangle.top + rectangle.height / 2
        );
        const centerHit = hit === element || (hit !== null && element.contains(hit));
        if (visible) visibleCount += 1;
        if (nonZero) nonZeroRectCount += 1;
        if (clipped) clippedByAncestorCount += 1;
        if (visible && nonZero && !clipped && inViewport) reachableCount += 1;
        if (centerHit) hitTestCount += 1;
        if ('disabled' in element && element.disabled === true) disabledCount += 1;
      }
      return { id, matchCount: elements.length, visibleCount, nonZeroRectCount, reachableCount, hitTestCount, clippedByAncestorCount, disabledCount };
    });
    const stageRect = stage?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const hasCore = Boolean(shell && stageRect && canvasRect && stageRect.width > 0 && stageRect.height > 0 && canvasRect.width > 0 && canvasRect.height > 0);
    const stageContainsCanvas =
      Boolean(stageRect && canvasRect) &&
      canvasRect.left >= stageRect.left - 1 &&
      canvasRect.right <= stageRect.right + 1 &&
      canvasRect.top >= stageRect.top - 1 &&
      canvasRect.bottom <= stageRect.bottom + 1;
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const scrollHeight = document.documentElement.scrollHeight;
    const maximumScrollY = Math.max(0, scrollHeight - window.innerHeight);
    window.scrollTo(0, maximumScrollY);
    const observedMaximumScrollY = window.scrollY;
    window.scrollTo(0, 0);
    return {
      hasCore,
      stageContainsCanvas,
      horizontalOverflow,
      scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      maximumScrollY,
      observedMaximumScrollY,
      controls
    };
  })()`)) as {
    hasCore: boolean
    stageContainsCanvas: boolean
    horizontalOverflow: boolean
    scrollHeight: number
    innerWidth: number
    innerHeight: number
    maximumScrollY: number
    observedMaximumScrollY: number
    controls: readonly Readonly<{
      id: string
      matchCount: number
      visibleCount: number
      nonZeroRectCount: number
      reachableCount: number
      hitTestCount: number
      clippedByAncestorCount: number
      disabledCount: number
    }>[]
  }
  return createM5VisualLayoutChecks({
    viewport,
    narrowMaximumWidth,
    measured,
  })
}

async function runLayoutMatrix(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtimes: ReadonlyMap<string, BrowserRuntime>
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  const viewports = [
    ...input.fixture.layout.viewports.map(({ width, height }) => ({
      width,
      height,
      deviceScaleFactor: 1,
    })),
    input.fixture.layout.highDprViewport,
  ]
  for (const browserFixture of input.fixture.layout.browsers) {
    const runtime = input.runtimes.get(browserFixture.id)
    if (runtime === undefined) continue
    for (const viewport of viewports) {
      const caseId = `layout/${browserFixture.id}/${viewport.width}x${viewport.height}@dpr${viewport.deviceScaleFactor}`
      let context: BrowserContext | undefined
      try {
        context = await createContext(
          runtime,
          viewport,
          false,
          input.fixture.protocol.timeouts.browserOperationMilliseconds,
        )
        const page = await createEvidencePage(
          context,
          input.fixture.protocol.timeouts.browserOperationMilliseconds,
        )
        const telemetry = createTelemetry(page)
        await openM2(
          page,
          input.baseUrl,
          input.fixture.protocol.timeouts.browserOperationMilliseconds,
        )
        const checks = await layoutChecks(
          page,
          viewport,
          input.fixture.layout.narrowViewportMaximumWidth,
        )
        const state = await readM2Evidence(page)
        const record = await capturePage(
          {
            page,
            telemetry,
            runtime,
            viewport,
            screenshotMode: input.fixture.protocol.screenshotMode,
            reducedMotion: false,
            visionMode: 'normal',
            colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
            caseId,
            outputDirectory: input.outputDirectory,
            runId: input.runId,
            distSha256: input.distSha256,
            seed: input.fixture.protocol.deterministicSeed,
            state,
            checks,
          },
          expectedCell(input.expectedById, caseId),
        )
        input.records.set(caseId, record)
      } catch (error) {
        markFailed(input.records, input.expectedById, caseId, error)
      } finally {
        if (context !== undefined) {
          await runM5VisualEvidenceWithTimeout(
            context.close(),
            input.fixture.protocol.timeouts.cleanupMilliseconds,
            'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
          )
        }
      }
    }
  }
}

async function configureM2Fire(
  page: Page,
  fireSourceId: string,
  size: number,
  thrust: boolean,
  timeout: number,
): Promise<void> {
  await page.evaluate(`(() => {
    const api = window.__LIANDAN_M2__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    api.selectFireSource(${JSON.stringify(fireSourceId)});
    api.setFireSize(${JSON.stringify(size)});
    api.setFlameThrust(${JSON.stringify(thrust)});
  })()`)
  await page.waitForFunction(
    `(() => {
      const snapshot = window.__LIANDAN_M2__?.getSnapshot();
      return snapshot?.equippedFireSourceId === ${JSON.stringify(fireSourceId)} &&
        snapshot.fireSize === ${JSON.stringify(size)} &&
        snapshot.flameThrustEnabled === ${JSON.stringify(thrust)};
    })()`,
    undefined,
    { timeout },
  )
}

async function aimAtLogicalPoint(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
): Promise<void> {
  const canvas = page.locator('canvas[data-scene="m2-extraction"]')
  const bounds = await canvas.boundingBox()
  if (bounds === null) throw new Error('M5_VISUAL_EVIDENCE_CANVAS_NOT_VISIBLE')
  const logical = (await page.evaluate(`(() => {
    const snapshot = window.__LIANDAN_M2__?.getSnapshot();
    if (!snapshot) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    return { width: snapshot.logicalWidth, height: snapshot.logicalHeight };
  })()`)) as { width: number; height: number }
  await page.mouse.move(
    bounds.x + bounds.width * (point.x / logical.width),
    bounds.y + bounds.height * (point.y / logical.height),
  )
}

function fireChecks(
  state: M2BrowserEvidence,
  expectedSize: number,
  expectedThrust?: boolean,
): readonly M5VisualEvidenceCheck[] {
  const observable = state.observableState
  const intensity = Number(observable.fireVisualIntensity ?? 0)
  const size = Number(observable.fireSize ?? -1)
  const spraying = observable.isSpraying === true
  const checks: M5VisualEvidenceCheck[] = [
    {
      id: 'fire-size-authoritative',
      passed: size === expectedSize,
      actual: size,
      expected: expectedSize,
    },
    {
      id: 'fire-visible-or-afterglow',
      passed: intensity > 0,
      actual: intensity,
      expected: '> 0',
    },
    {
      id: 'spray-state-observed',
      passed:
        spraying || String(observable.firePresentationState) === 'cooling',
      actual: `${String(observable.isSpraying)}/${String(observable.firePresentationState)}`,
      expected: 'spraying or release',
    },
  ]
  if (expectedThrust !== undefined) {
    checks.push({
      id: 'flame-thrust-state',
      passed: observable.flameThrustEnabled === expectedThrust,
      actual: String(observable.flameThrustEnabled),
      expected: expectedThrust,
    })
  }
  return checks
}

async function runFireMatrix(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
  for (const size of input.fixture.fire.sizes) {
    for (const direction of input.fixture.fire.directions) {
      const caseId = `fire/matrix/${size}/${direction.id}`
      let context: BrowserContext | undefined
      try {
        context = await createContext(
          input.runtime,
          input.fixture.fire.viewport,
          false,
          timeout,
        )
        const page = await createEvidencePage(context, timeout)
        const telemetry = createTelemetry(page)
        await openM2(page, input.baseUrl, timeout)
        await configureM2Fire(
          page,
          input.fixture.fire.fireSourceId,
          size,
          false,
          timeout,
        )
        await aimAtLogicalPoint(page, direction.logicalTarget)
        await page.mouse.down()
        try {
          await page.waitForTimeout(input.fixture.fire.stableWarmupMilliseconds)
          const state = await readM2Evidence(page)
          const record = await capturePage(
            {
              page,
              telemetry,
              runtime: input.runtime,
              viewport: input.fixture.fire.viewport,
              screenshotMode: input.fixture.protocol.screenshotMode,
              reducedMotion: false,
              visionMode: 'normal',
              colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
              caseId,
              outputDirectory: input.outputDirectory,
              runId: input.runId,
              distSha256: input.distSha256,
              seed: input.fixture.protocol.deterministicSeed,
              state,
              checks: fireChecks(state, size),
            },
            expectedCell(input.expectedById, caseId),
          )
          input.records.set(caseId, record)
        } finally {
          await page.mouse.up()
        }
      } catch (error) {
        markFailed(input.records, input.expectedById, caseId, error)
      } finally {
        if (context !== undefined) {
          await runM5VisualEvidenceWithTimeout(
            context.close(),
            input.fixture.protocol.timeouts.cleanupMilliseconds,
            'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
          )
        }
      }
    }
  }
}

function firePhaseObservation(
  state: BrowserEvidenceState,
): M5VisualFirePhaseBoundaryObservation {
  return {
    firePresentationState: String(
      state.observableState.firePresentationState ?? '',
    ),
    isSpraying: state.observableState.isSpraying === true,
  }
}

async function acquirePageClockPause(
  page: Page,
  fixture: M5VisualEvidenceFixture,
): Promise<M5VisualClockPauseAudit> {
  return acquireM5VisualClockPause({
    leadMilliseconds: fixture.protocol.clock.pauseLeadMilliseconds,
    maximumAttempts: fixture.protocol.clock.pauseMaximumAttempts,
    nowMilliseconds: Date.now,
    pauseAt: (targetMilliseconds) => page.clock.pauseAt(targetMilliseconds),
  })
}

async function acquireWarningPageClockPause(
  page: Page,
  fixture: M5VisualEvidenceFixture,
): Promise<void> {
  await acquireM5VisualClockPause({
    leadMilliseconds: fixture.protocol.clock.pauseLeadMilliseconds,
    maximumAttempts: fixture.protocol.clock.pauseMaximumAttempts,
    nowMilliseconds: () => readBrowserClockMilliseconds(page),
    pauseAt: (targetMilliseconds) => page.clock.pauseAt(targetMilliseconds),
  })
}

async function readBrowserClockMilliseconds(page: Page): Promise<number> {
  const now = (await page.evaluate('Date.now()')) as number
  if (!Number.isFinite(now)) {
    throw new Error('M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_NOW_INVALID')
  }
  return now
}

async function advancePageClockUntil<T>(
  input: Readonly<{
    page: Page
    stepMilliseconds: number
    timeoutMilliseconds: number
    observe: () => Promise<T>
    reached: (value: T) => boolean
    timeoutCode: string
  }>,
): Promise<T> {
  const deadline = Date.now() + input.timeoutMilliseconds
  let observed = await input.observe()
  while (!input.reached(observed) && Date.now() <= deadline) {
    await input.page.clock.runFor(input.stepMilliseconds)
    observed = await input.observe()
  }
  if (!input.reached(observed)) throw new Error(input.timeoutCode)
  return observed
}

async function advanceToFirePhase(
  page: Page,
  fixture: M5VisualEvidenceFixture,
  phaseId: 'startup' | 'steady' | 'release',
  timeoutMilliseconds: number,
): Promise<M2BrowserEvidence> {
  const expectedState =
    phaseId === 'startup'
      ? 'emerging'
      : phaseId === 'steady'
        ? 'steady'
        : 'cooling'
  const expectedSpraying = phaseId !== 'release'
  return advancePageClockUntil({
    page,
    stepMilliseconds: fixture.protocol.clock.sequenceStepMilliseconds,
    timeoutMilliseconds,
    observe: () => readM2Evidence(page),
    reached: (state) =>
      state.observableState.firePresentationState === expectedState &&
      state.observableState.isSpraying === expectedSpraying,
    timeoutCode: `M5_VISUAL_EVIDENCE_FIRE_PHASE_TIMEOUT:${phaseId}`,
  })
}

async function captureTimedFirePhase(
  input: Readonly<{
    page: Page
    telemetry: PageTelemetry
    runtime: BrowserRuntime
    fixture: M5VisualEvidenceFixture
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
    phaseId: 'startup' | 'steady' | 'release'
    visionTransformToken: M5VisionTransformPreparedToken
  }>,
): Promise<void> {
  const phase = input.fixture.fire.phases.find(({ id }) => id === input.phaseId)
  if (phase === undefined)
    throw new Error(`M5_VISUAL_EVIDENCE_PHASE_MISSING:${input.phaseId}`)
  const stem = `${input.fixture.fire.phaseTrace.size}/${input.fixture.fire.phaseTrace.directionId}`
  const phaseStartedAtMilliseconds = await readBrowserClockMilliseconds(
    input.page,
  )
  let previousOffset = 0
  for (
    let index = 0;
    index < phase.sampleOffsetsMilliseconds.length;
    index += 1
  ) {
    const configuredOffset = phase.sampleOffsetsMilliseconds[index]!
    const advanceMilliseconds = configuredOffset - previousOffset
    if (advanceMilliseconds > 0) {
      await input.page.clock.runFor(advanceMilliseconds)
    }
    previousOffset = configuredOffset
    const caseId = `fire/raw/${stem}/${phase.id}/${String(index).padStart(2, '0')}`
    try {
      const record = await capturePage(
        {
          page: input.page,
          telemetry: input.telemetry,
          runtime: input.runtime,
          viewport: input.fixture.fire.viewport,
          screenshotMode: input.fixture.protocol.screenshotMode,
          reducedMotion: false,
          visionMode: 'normal',
          colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
          caseId,
          outputDirectory: input.outputDirectory,
          runId: input.runId,
          distSha256: input.distSha256,
          seed: input.fixture.protocol.deterministicSeed,
          checks: [],
          prepareBefore: () => readM2Evidence(input.page),
          prepareChecks: (state) =>
            fireChecks(
              state as M2BrowserEvidence,
              input.fixture.fire.phaseTrace.size,
            ),
          configuredSampleOffsetMilliseconds: configuredOffset,
          timedSample: {
            phaseStartedAtMilliseconds,
            readNowMilliseconds: () => readBrowserClockMilliseconds(input.page),
          },
          clockCapture: {
            mode: 'sequence-held',
            installed: true,
            paused: true,
            visionTransformToken: input.visionTransformToken,
            resumeOwner: 'sequence-finally',
            maximumCaptureMilliseconds:
              input.fixture.protocol.clock.maximumCaptureMilliseconds,
          },
          captureBoundary: {
            readAfter: () => readM2Evidence(input.page),
            checks: (before, after, timing) =>
              createM5VisualFirePhaseChecks({
                phaseId: input.phaseId,
                configuredOffsetMilliseconds: configuredOffset,
                screenshotStartedOffsetMilliseconds:
                  timing.screenshotStartedOffsetMilliseconds ?? -1,
                screenshotFinishedOffsetMilliseconds:
                  timing.screenshotFinishedOffsetMilliseconds ?? -1,
                maximumSampleLatenessMilliseconds:
                  input.fixture.fire.maximumSampleLatenessMilliseconds,
                before: firePhaseObservation(before),
                after: firePhaseObservation(after),
              }),
          },
        },
        expectedCell(input.expectedById, caseId),
      )
      input.records.set(caseId, record)
    } catch (error) {
      markFailed(input.records, input.expectedById, caseId, error)
    }
  }
}

function createFireContactSheet(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    phaseId: 'startup' | 'steady' | 'release'
    outputDirectory: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): void {
  const stem = `${input.fixture.fire.phaseTrace.size}/${input.fixture.fire.phaseTrace.directionId}`
  const caseId = `fire/contact/${stem}/${input.phaseId}`
  const cell = expectedCell(input.expectedById, caseId)
  const sourceCaseIds = cell.sourceCaseIds ?? []
  try {
    const sources = sourceCaseIds.map((sourceCaseId) => {
      const source = input.records.get(sourceCaseId)
      if (source?.status !== 'captured') {
        throw new Error(
          `M5_VISUAL_EVIDENCE_CONTACT_SOURCE_UNAVAILABLE:${sourceCaseId}`,
        )
      }
      return source
    })
    const relativePath = `contact-sheets/${safeCasePath(caseId)}.png`
    const absolutePath = resolve(input.outputDirectory, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    const artifact = createM5VisualEvidenceContactSheet(
      sources.map(({ artifact: sourceArtifact }) =>
        resolve(input.outputDirectory, sourceArtifact.relativePath),
      ),
      absolutePath,
      input.fixture.fire.contactSheet,
    )
    const context = createM5VisualContactSheetContext({
      phaseId: input.phaseId,
      sourceCaseIds,
      sources,
    })
    const record: M5VisualEvidenceCaptureRecord = {
      caseId,
      section: 'fire',
      kind: 'contact-sheet',
      status: 'captured',
      capturedAt: new Date().toISOString(),
      artifact: { relativePath, ...artifact },
      sourceCaseIds,
      context,
    }
    validateM5VisualEvidenceCaptureRecord(record, input.outputDirectory)
    input.records.set(caseId, record)
  } catch (error) {
    markFailed(input.records, input.expectedById, caseId, error)
  }
}

async function runFirePhaseTrace(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  let context: BrowserContext | undefined
  let page: Page | undefined
  let sequencePaused = false
  let sprayingPointerDown = false
  const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
  try {
    context = await createContext(
      input.runtime,
      input.fixture.fire.viewport,
      false,
      timeout,
    )
    page = await createEvidencePage(context, timeout)
    await page.clock.install({ time: Date.now() })
    const telemetry = createTelemetry(page)
    await openM2(page, input.baseUrl, timeout)
    await configureM2Fire(
      page,
      input.fixture.fire.fireSourceId,
      input.fixture.fire.phaseTrace.size,
      false,
      timeout,
    )
    const direction = input.fixture.fire.directions.find(
      ({ id }) => id === input.fixture.fire.phaseTrace.directionId,
    )
    if (direction === undefined) {
      throw new Error('M5_VISUAL_EVIDENCE_PHASE_DIRECTION_MISSING')
    }
    await aimAtLogicalPoint(page, direction.logicalTarget)
    const visionTransformToken = await applyVisionTransform(
      page,
      'normal',
      M5_VISUAL_IDENTITY_COLOR_MATRIX,
    )
    await acquirePageClockPause(page, input.fixture)
    sequencePaused = true
    await page.mouse.down()
    sprayingPointerDown = true
    await advanceToFirePhase(page, input.fixture, 'startup', timeout)
    try {
      await captureTimedFirePhase({
        ...input,
        page,
        telemetry,
        phaseId: 'startup',
        visionTransformToken,
      })
      await advanceToFirePhase(page, input.fixture, 'steady', timeout)
      await captureTimedFirePhase({
        ...input,
        page,
        telemetry,
        phaseId: 'steady',
        visionTransformToken,
      })
    } finally {
      if (sprayingPointerDown) {
        await page.mouse.up()
        sprayingPointerDown = false
      }
    }
    await advanceToFirePhase(page, input.fixture, 'release', timeout)
    await captureTimedFirePhase({
      ...input,
      page,
      telemetry,
      phaseId: 'release',
      visionTransformToken,
    })
  } catch (error) {
    const stem = `${input.fixture.fire.phaseTrace.size}/${input.fixture.fire.phaseTrace.directionId}`
    for (const phase of input.fixture.fire.phases) {
      for (
        let index = 0;
        index < phase.sampleOffsetsMilliseconds.length;
        index += 1
      ) {
        markFailed(
          input.records,
          input.expectedById,
          `fire/raw/${stem}/${phase.id}/${String(index).padStart(2, '0')}`,
          error,
        )
      }
    }
  } finally {
    const cleanupErrors: unknown[] = []
    if (page !== undefined && sprayingPointerDown) {
      try {
        await page.mouse.up()
      } catch (error) {
        cleanupErrors.push(error)
      }
      sprayingPointerDown = false
    }
    if (page !== undefined && sequencePaused) {
      try {
        await runM5VisualEvidenceWithTimeout(
          page.clock.resume(),
          input.fixture.protocol.clock.resumeReserveMilliseconds,
          'M5_VISUAL_EVIDENCE_FIRE_SEQUENCE_CLOCK_RESUME_TIMEOUT',
        )
      } catch (error) {
        cleanupErrors.push(error)
      } finally {
        sequencePaused = false
      }
    }
    if (context !== undefined) {
      try {
        await runM5VisualEvidenceWithTimeout(
          context.close(),
          input.fixture.protocol.timeouts.cleanupMilliseconds,
          'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
        )
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'M5_VISUAL_EVIDENCE_FIRE_SEQUENCE_CLEANUP_FAILED',
        { cause: cleanupErrors[0] },
      )
    }
  }
  for (const phaseId of ['startup', 'steady', 'release'] as const) {
    createFireContactSheet({ ...input, phaseId })
  }
}

type GalleryFixtureEvidence = Readonly<{
  seed: number
  pearlTypeWeights: Readonly<Record<string, number>>
  requiredEffectKinds: readonly string[]
}>

async function readGalleryFixtureEvidence(
  page: Page,
  scenarioId: string,
): Promise<GalleryFixtureEvidence> {
  return (await page.evaluate(`(async () => {
    const response = await fetch('/config/performance/m5-visual.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('M5_VISUAL_EVIDENCE_GALLERY_FIXTURE_UNAVAILABLE');
    const fixture = await response.json();
    const scenario = fixture.scenarios.find((candidate) => candidate.id === ${JSON.stringify(scenarioId)});
    if (!scenario) throw new Error('M5_VISUAL_EVIDENCE_GALLERY_SCENARIO_UNAVAILABLE');
    return {
      seed: scenario.seed,
      pearlTypeWeights: scenario.pearlTypeWeights,
      requiredEffectKinds: scenario.requiredEffectKinds
    };
  })()`)) as GalleryFixtureEvidence
}

function decorateGalleryEvidence(
  state: GalleryBrowserEvidence,
  fixtureEvidence: GalleryFixtureEvidence,
  visionMode: M5VisualEvidenceVisionMode,
  colorMatrix: readonly number[],
): GalleryBrowserEvidence {
  return {
    ...state,
    observableState: {
      ...state.observableState,
      galleryFixture: fixtureEvidence,
      visionTransform: {
        mode: visionMode,
        matrix: colorMatrix,
        mechanism:
          visionMode === 'normal' ? 'none' : 'deterministic-svg-feColorMatrix',
      },
    },
  }
}

function galleryChecks(
  state: GalleryBrowserEvidence,
  requiredStates: readonly string[],
  boundary: 'before' | 'after',
): readonly M5VisualEvidenceCheck[] {
  const observable = state.observableState
  const currentFrame = (observable.currentFrame ?? {}) as Record<
    string,
    unknown
  >
  const pearlCounts = (currentFrame.pearlRenderCountByType ?? {}) as Record<
    string,
    unknown
  >
  const effectCounts = (currentFrame.effectCountByKind ?? {}) as Record<
    string,
    Readonly<{ activeCount?: unknown; renderCount?: unknown }>
  >
  return requiredStates.map((required): M5VisualEvidenceCheck => {
    let passed = false
    let actual: string | number | boolean = 'not-observed'
    if (required === 'fire') {
      actual = Number(currentFrame.fireParticleCount ?? 0)
      passed = actual > 0
    } else if (required === 'localLight') {
      actual = Number(currentFrame.localLightIntensity ?? 0)
      passed = actual > 0
    } else if (
      required === 'medicinalLiquid' ||
      required === 'slag' ||
      required === 'impurity'
    ) {
      actual = Number(pearlCounts[required] ?? 0)
      passed = actual > 0
    } else if (
      required === 'shield' ||
      required === 'damage' ||
      required === 'steam' ||
      required === 'fight'
    ) {
      const counts = effectCounts[required]
      const activeCount = Number(counts?.activeCount ?? 0)
      const renderCount = Number(counts?.renderCount ?? 0)
      actual = `${activeCount}/${renderCount}`
      passed = activeCount > 0 && renderCount > 0
    }
    return {
      id: `required-state-${required}-${boundary}`,
      passed,
      actual,
      expected: 'visible-and-observable',
    }
  })
}

async function waitForGalleryEffects(
  page: Page,
  expectedKinds: readonly string[],
  timeout: number,
): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const current = window.__LIANDAN_M5_PERFORMANCE__?.snapshot().currentFrame;
      if (!current || current.fireParticleCount <= 0 || current.localLightIntensity <= 0) return false;
      const pearls = current.pearlRenderCountByType;
      if (!pearls || pearls.medicinalLiquid <= 0 || pearls.slag <= 0 || pearls.impurity <= 0) return false;
      return ${JSON.stringify(expectedKinds)}.every((kind) => {
        const counts = current.effectCountByKind[kind];
        return counts && counts.activeCount > 0 && counts.renderCount > 0;
      });
    })()`,
    undefined,
    { timeout },
  )
}

async function captureGalleryCase(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
    caseId: string
    viewport: M5VisualEvidenceViewport
    reducedMotion: boolean
    visionMode: M5VisualEvidenceVisionMode
    colorMatrix: readonly number[]
    requiredStates: readonly string[]
  }>,
): Promise<void> {
  let context: BrowserContext | undefined
  try {
    context = await createContext(
      input.runtime,
      input.viewport,
      input.reducedMotion,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const page = await createEvidencePage(
      context,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const telemetry = createTelemetry(page)
    const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
    await openGallery(
      page,
      input.baseUrl,
      input.fixture.protocol.galleryScenarioId,
      timeout,
    )
    const fixtureEvidence = await readGalleryFixtureEvidence(
      page,
      input.fixture.protocol.galleryScenarioId,
    )
    await waitForGalleryEffects(
      page,
      fixtureEvidence.requiredEffectKinds,
      timeout,
    )
    const record = await capturePage(
      {
        page,
        telemetry,
        runtime: input.runtime,
        viewport: input.viewport,
        screenshotMode: input.fixture.protocol.screenshotMode,
        reducedMotion: input.reducedMotion,
        visionMode: input.visionMode,
        colorMatrix: input.colorMatrix,
        caseId: input.caseId,
        outputDirectory: input.outputDirectory,
        runId: input.runId,
        distSha256: input.distSha256,
        seed: fixtureEvidence.seed,
        checks: [],
        prepareBefore: async () => {
          await waitForGalleryEffects(
            page,
            fixtureEvidence.requiredEffectKinds,
            timeout,
          )
          return decorateGalleryEvidence(
            await readGalleryEvidence(page),
            fixtureEvidence,
            input.visionMode,
            input.colorMatrix,
          )
        },
        captureBoundary: {
          readAfter: async () =>
            decorateGalleryEvidence(
              await readGalleryEvidence(page),
              fixtureEvidence,
              input.visionMode,
              input.colorMatrix,
            ),
          checks: (before, after) => [
            ...galleryChecks(
              before as GalleryBrowserEvidence,
              input.requiredStates,
              'before',
            ),
            ...galleryChecks(
              after as GalleryBrowserEvidence,
              input.requiredStates,
              'after',
            ),
          ],
        },
      },
      expectedCell(input.expectedById, input.caseId),
    )
    input.records.set(input.caseId, record)
  } catch (error) {
    markFailed(input.records, input.expectedById, input.caseId, error)
  } finally {
    if (context !== undefined) {
      await runM5VisualEvidenceWithTimeout(
        context.close(),
        input.fixture.protocol.timeouts.cleanupMilliseconds,
        'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
      )
    }
  }
}

type CoverageCase = M5VisualEvidenceFixture['coverage']['cases'][number]
type MaterialTopologyCoverageCase = CoverageCase &
  Required<
    Pick<
      CoverageCase,
      | 'fireSourceId'
      | 'materialBatchId'
      | 'materialDefinitionId'
      | 'fireSize'
      | 'flameThrust'
      | 'logicalTarget'
      | 'sourceEdge'
      | 'epsilon'
      | 'pollIntervalMilliseconds'
      | 'maximumWaitMilliseconds'
      | 'stopCondition'
      | 'shapeThresholds'
      | 'partialFront'
      | 'expectedTopology'
    >
  >
type MaterialPairCoverageCase = CoverageCase &
  Required<
    Pick<
      CoverageCase,
      | 'materialBatchIds'
      | 'materialDefinitionIds'
      | 'epsilon'
      | 'settleMilliseconds'
    >
  >
type WarningCoverageCase = CoverageCase &
  Required<
    Pick<CoverageCase, 'warningLevel' | 'expectedEffect' | 'expectedMessageZh'>
  >

type RawMaterialTopologyEvidence = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: Readonly<{
    center: Readonly<{ x: number; y: number }>
    width: number
    height: number
    rotationRadians: number
    layer: number
  }>
  contentPlacement: Readonly<{
    center: Readonly<{ x: number; y: number }>
    width: number
    height: number
    rotationRadians: number
    layer: number
  }>
  gridWidth: number
  gridHeight: number
  initialVolume: number
  remainingVolume: number
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
}>

function materialTopologyCase(
  coverageCase: CoverageCase,
): MaterialTopologyCoverageCase {
  if (
    coverageCase.automation !== 'm2-material-topology' ||
    coverageCase.fireSourceId === undefined ||
    coverageCase.materialBatchId === undefined ||
    coverageCase.materialDefinitionId === undefined ||
    coverageCase.fireSize === undefined ||
    coverageCase.flameThrust !== false ||
    coverageCase.logicalTarget === undefined ||
    coverageCase.sourceEdge === undefined ||
    coverageCase.epsilon === undefined ||
    coverageCase.pollIntervalMilliseconds === undefined ||
    coverageCase.maximumWaitMilliseconds === undefined ||
    coverageCase.stopCondition === undefined ||
    coverageCase.shapeThresholds === undefined ||
    coverageCase.partialFront === undefined ||
    coverageCase.expectedTopology === undefined
  ) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_MATERIAL_CASE_INVALID:${coverageCase.id}`,
    )
  }
  return coverageCase as MaterialTopologyCoverageCase
}

function materialPairCase(
  coverageCase: CoverageCase,
): MaterialPairCoverageCase {
  if (
    coverageCase.automation !== 'm2-material-pair-non-overlap' ||
    coverageCase.materialBatchIds === undefined ||
    coverageCase.materialBatchIds.length !== 2 ||
    coverageCase.materialDefinitionIds === undefined ||
    coverageCase.materialDefinitionIds.length !== 2 ||
    coverageCase.epsilon === undefined ||
    coverageCase.settleMilliseconds === undefined
  ) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_MATERIAL_PAIR_CASE_INVALID:${coverageCase.id}`,
    )
  }
  return coverageCase as MaterialPairCoverageCase
}

function warningCase(coverageCase: CoverageCase): WarningCoverageCase {
  if (
    coverageCase.automation !== 'm2-loss-warning' ||
    coverageCase.warningLevel === undefined ||
    coverageCase.expectedEffect === undefined ||
    coverageCase.expectedMessageZh === undefined
  ) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_WARNING_CASE_INVALID:${coverageCase.id}`,
    )
  }
  return coverageCase as WarningCoverageCase
}

function warningFormalMaterialCase(
  fixture: M5VisualEvidenceFixture,
): MaterialTopologyCoverageCase {
  const flow = fixture.coverage.warningFlow
  const coverageCase = fixture.coverage.cases.find(
    (candidate) =>
      candidate.automation === 'm2-material-topology' &&
      candidate.materialDefinitionId === flow.materialDefinitionId &&
      candidate.materialBatchId === flow.materialBatchId,
  )
  if (coverageCase === undefined) {
    throw new Error('M5_VISUAL_EVIDENCE_WARNING_FORMAL_MATERIAL_MISSING')
  }
  return materialTopologyCase(coverageCase)
}

async function readCollectorMotionConfig(
  page: Page,
  fireSourceId: string,
  timeoutMilliseconds: number,
): Promise<
  Readonly<{
    acceleration: number
    deceleration: number
    maxSpeed: number
    configuredCollectorInitialX: number
    configuredMaterialCenterX: number
    fireSourceOrigin: Readonly<{ x: number; y: number }>
  }>
> {
  const evaluation = page.evaluate(`(async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      ${JSON.stringify(timeoutMilliseconds)}
    );
    try {
      const [collectorResponse, prototypeResponse, fireSourcesResponse] = await Promise.all([
        fetch('/config/m2/collector.json', { signal: controller.signal }),
        fetch('/config/m2/prototype.json', { signal: controller.signal }),
        fetch('/config/m2/fire-sources.json', { signal: controller.signal })
      ]);
      if (!collectorResponse.ok || !prototypeResponse.ok || !fireSourcesResponse.ok) {
        throw new Error('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_CONFIG_UNAVAILABLE');
      }
      const collector = await collectorResponse.json();
      const prototype = await prototypeResponse.json();
      const fireSources = await fireSourcesResponse.json();
      const fireSource = fireSources.fireSources.find(
        (candidate) => candidate.id === ${JSON.stringify(fireSourceId)}
      );
      if (!fireSource) {
        throw new Error('M5_VISUAL_EVIDENCE_FIRE_SOURCE_CONFIG_MISSING');
      }
      return {
        acceleration: collector.acceleration,
        deceleration: collector.deceleration,
        maxSpeed: collector.maxSpeed,
        configuredCollectorInitialX: collector.initialX,
        configuredMaterialCenterX:
          prototype.materialPlacement.slots[0].centerX,
        fireSourceOrigin: fireSource.origin
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_CONFIG_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })()`)
  return (await runM5VisualEvidenceWithTimeout(
    evaluation,
    timeoutMilliseconds,
    'M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_CONFIG_TIMEOUT',
  )) as Readonly<{
    acceleration: number
    deceleration: number
    maxSpeed: number
    configuredCollectorInitialX: number
    configuredMaterialCenterX: number
    fireSourceOrigin: Readonly<{ x: number; y: number }>
  }>
}

async function readMaterialTopologyState(
  page: Page,
  coverageCase: MaterialTopologyCoverageCase,
  fireSourceOrigin: Readonly<{ x: number; y: number }>,
  authoritativeTarget: Readonly<{ x: number; y: number }>,
): Promise<M2BrowserEvidence> {
  const raw = (await page.evaluate(`(() => {
    const state = ${m2EvidenceExpression()};
    const api = window.__LIANDAN_M2__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    const material = api.getMaterialTopologyEvidence().find(
      (candidate) => candidate.materialDefinitionId === ${JSON.stringify(coverageCase.materialDefinitionId)}
    );
    if (!material) throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_MISSING');
    const presentation = api.getPresentationEvidence();
    return { state, material, collectorCenter: presentation.collectorCenter };
  })()`)) as Readonly<{
    state: M2BrowserEvidence
    material: RawMaterialTopologyEvidence
    collectorCenter: Readonly<{ x: number; y: number }>
  }>
  const verifiedTarget =
    assertM5MaterialEvidenceTargetMatchesContentCenter({
      caseId: coverageCase.id,
      configuredTarget: coverageCase.logicalTarget,
      contentCenter: raw.material.contentPlacement.center,
      epsilon: coverageCase.epsilon,
    })
  assertM5MaterialEvidenceTargetMatchesContentCenter({
    caseId: `${coverageCase.id}:capture`,
    configuredTarget: authoritativeTarget,
    contentCenter: raw.material.contentPlacement.center,
    epsilon: coverageCase.epsilon,
  })
  const metrics = classifyM5MaterialTopology({
    gridWidth: raw.material.gridWidth,
    gridHeight: raw.material.gridHeight,
    initialCellVolumes: raw.material.initialCellVolumes,
    remainingCellVolumes: raw.material.remainingCellVolumes,
    sourceEdge: coverageCase.sourceEdge,
    epsilon: coverageCase.epsilon,
    shapeThresholds: coverageCase.shapeThresholds,
    partialFront: coverageCase.partialFront,
    placement: raw.material.placement,
    fireRay: {
      origin: fireSourceOrigin,
      target: verifiedTarget,
    },
  })
  const collectorCenterOffset = Math.abs(
    raw.collectorCenter.x - raw.material.placement.center.x,
  )
  return {
    ...raw.state,
    observableState: {
      ...raw.state.observableState,
      materialTopology: {
        materialInstanceId: raw.material.materialInstanceId,
        materialDefinitionId: raw.material.materialDefinitionId,
        inventoryBatchId: raw.material.inventoryBatchId,
        placement: raw.material.placement,
        contentPlacement: raw.material.contentPlacement,
        gridWidth: raw.material.gridWidth,
        gridHeight: raw.material.gridHeight,
        initialVolume: raw.material.initialVolume,
        remainingVolume: raw.material.remainingVolume,
        initialGridSha256: sha256M5VisualEvidence(
          JSON.stringify(raw.material.initialCellVolumes),
        ),
        remainingGridSha256: sha256M5VisualEvidence(
          JSON.stringify(raw.material.remainingCellVolumes),
        ),
        collectorCenter: raw.collectorCenter,
        collectorCenterOffset,
        sourceEdge: coverageCase.sourceEdge,
        epsilon: coverageCase.epsilon,
        fireRay: {
          origin: fireSourceOrigin,
          target: verifiedTarget,
        },
        metrics,
      },
    },
  }
}

function topologyObservation(state: BrowserEvidenceState): Readonly<{
  sessionId: string
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: RawMaterialTopologyEvidence['placement']
  gridWidth: number
  gridHeight: number
  initialGridSha256: string
  remainingGridSha256: string
  collectorCenterOffset: number
  metrics: M5MaterialTopologyMetrics
}> {
  const topology = state.observableState.materialTopology as Omit<
    ReturnType<typeof topologyObservation>,
    'sessionId'
  >
  return { sessionId: state.sessionId, ...topology }
}

function materialTopologyChecks(
  beforeState: BrowserEvidenceState,
  afterState: BrowserEvidenceState,
  coverageCase: MaterialTopologyCoverageCase,
): readonly M5VisualEvidenceCheck[] {
  const expected = coverageCase.expectedTopology
  const observations = [
    ['before', topologyObservation(beforeState)],
    ['after', topologyObservation(afterState)],
  ] as const
  const checks: M5VisualEvidenceCheck[] = []
  for (const [boundary, observation] of observations) {
    const metrics = observation.metrics
    checks.push(
      {
        id: `material-authority-${boundary}`,
        passed:
          observation.materialDefinitionId ===
            coverageCase.materialDefinitionId &&
          observation.inventoryBatchId === coverageCase.materialBatchId &&
          observation.materialInstanceId.length > 0,
        actual: `${observation.materialDefinitionId}/${observation.inventoryBatchId}/${observation.materialInstanceId}`,
        expected: `${coverageCase.materialDefinitionId}/${coverageCase.materialBatchId}/non-empty-instance`,
      },
      {
        id: `material-classification-${boundary}`,
        passed: metrics.classification === expected.classification,
        actual: metrics.classification,
        expected: expected.classification,
      },
      {
        id: `material-dissolved-ratio-${boundary}`,
        passed:
          metrics.dissolvedVolumeRatio >=
            expected.minimumDissolvedVolumeRatio &&
          metrics.dissolvedVolumeRatio <= expected.maximumDissolvedVolumeRatio,
        actual: metrics.dissolvedVolumeRatio,
        expected: `${expected.minimumDissolvedVolumeRatio}..${expected.maximumDissolvedVolumeRatio}`,
      },
      {
        id: `material-remaining-ratio-${boundary}`,
        passed: metrics.remainingRatio >= expected.minimumRemainingRatio,
        actual: metrics.remainingRatio,
        expected: `>= ${expected.minimumRemainingRatio}`,
      },
      {
        id: `material-penetration-${boundary}`,
        passed:
          metrics.penetrationRatio >= expected.minimumPenetrationRatio &&
          metrics.penetrationRatio <= expected.maximumPenetrationRatio,
        actual: metrics.penetrationRatio,
        expected: `${expected.minimumPenetrationRatio}..${expected.maximumPenetrationRatio}`,
      },
      {
        id: `material-lateral-coverage-${boundary}`,
        passed:
          metrics.lateralCoverageRatio >=
            expected.minimumLateralCoverageRatio &&
          metrics.lateralCoverageRatio <= expected.maximumLateralCoverageRatio,
        actual: metrics.lateralCoverageRatio,
        expected: `${expected.minimumLateralCoverageRatio}..${expected.maximumLateralCoverageRatio}`,
      },
      {
        id: `material-boundary-connectivity-${boundary}`,
        passed:
          metrics.sourceBoundaryReached &&
          metrics.farBoundaryReached === expected.throughConnected &&
          metrics.throughConnected === expected.throughConnected,
        actual: `${metrics.sourceBoundaryReached}/${metrics.farBoundaryReached}/${metrics.throughConnected}`,
        expected: `true/${String(expected.throughConnected)}/${String(expected.throughConnected)}`,
      },
      {
        id: `material-collector-aligned-${boundary}`,
        passed:
          observation.collectorCenterOffset <=
          expected.maximumCollectorCenterOffset,
        actual: observation.collectorCenterOffset,
        expected: `<= ${expected.maximumCollectorCenterOffset}`,
      },
    )
  }
  const before = observations[0][1]
  const after = observations[1][1]
  checks.push(
    ...createM5VisualMaterialTopologyBoundaryChecks({ before, after }),
  )
  return checks
}

function materialStopReached(
  metrics: M5MaterialTopologyMetrics,
  coverageCase: MaterialTopologyCoverageCase,
): boolean {
  return hasM5MaterialTopologyStopAuthority(metrics, coverageCase.stopCondition)
}

async function waitForMaterialTopologyStop(
  page: Page,
  coverageCase: MaterialTopologyCoverageCase,
  fireSourceOrigin: Readonly<{ x: number; y: number }>,
  authoritativeTarget: Readonly<{ x: number; y: number }>,
): Promise<M2BrowserEvidence> {
  const deadline = Date.now() + coverageCase.maximumWaitMilliseconds
  let last: M2BrowserEvidence | undefined
  while (Date.now() <= deadline) {
    last = await readMaterialTopologyState(
      page,
      coverageCase,
      fireSourceOrigin,
      authoritativeTarget,
    )
    const metrics = topologyObservation(last).metrics
    if (
      coverageCase.stopCondition.mode === 'topology-classification' &&
      (metrics.dissolvedVolumeRatio >
        coverageCase.stopCondition.maximumDissolvedVolumeRatio ||
        metrics.remainingRatio <
          coverageCase.stopCondition.minimumRemainingRatio)
    ) {
      throw new Error(
        `M5_VISUAL_EVIDENCE_MATERIAL_STOP_OVERSHOT:${coverageCase.id}:${metrics.dissolvedVolumeRatio}`,
      )
    }
    if (materialStopReached(metrics, coverageCase)) return last
    await page.waitForTimeout(coverageCase.pollIntervalMilliseconds)
  }
  const actual =
    last === undefined
      ? 'unobserved'
      : JSON.stringify(topologyObservation(last).metrics)
  throw new Error(
    `M5_VISUAL_EVIDENCE_MATERIAL_STOP_TIMEOUT:${coverageCase.id}:${actual}`,
  )
}

async function runMaterialTopologyCases(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  const cases = input.fixture.coverage.cases
    .filter(({ automation }) => automation === 'm2-material-topology')
    .map(materialTopologyCase)
  for (const coverageCase of cases) {
    const caseId = `coverage/${coverageCase.id}`
    let context: BrowserContext | undefined
    let contextClosePromise: Promise<void> | undefined
    const closeContextOnce = (): Promise<void> => {
      if (contextClosePromise !== undefined) return contextClosePromise
      if (context === undefined) return Promise.resolve()
      contextClosePromise = runM5VisualEvidenceWithTimeout(
        context.close(),
        input.fixture.protocol.timeouts.cleanupMilliseconds,
        'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
      )
      return contextClosePromise
    }
    try {
      context = await createContext(
        input.runtime,
        input.fixture.coverage.viewport,
        false,
        input.fixture.protocol.timeouts.browserOperationMilliseconds,
      )
      const page = await createEvidencePage(
        context,
        input.fixture.protocol.timeouts.browserOperationMilliseconds,
      )
      await page.clock.install({ time: Date.now() })
      const telemetry = createTelemetry(page)
      const timeout =
        input.fixture.protocol.timeouts.browserOperationMilliseconds
      await openM2(page, input.baseUrl, timeout)
      await configureM2Fire(
        page,
        coverageCase.fireSourceId,
        coverageCase.fireSize,
        coverageCase.flameThrust,
        timeout,
      )
      await page.evaluate(`(() => {
        const api = window.__LIANDAN_M2__;
        if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
        api.preselectMaterial(${JSON.stringify(coverageCase.materialBatchId)});
        api.addSelectedMaterial();
      })()`)
      await page.waitForFunction(
        `window.__LIANDAN_M2__?.getMaterialTopologyEvidence().some(
          (material) => material.materialDefinitionId === ${JSON.stringify(coverageCase.materialDefinitionId)}
        ) === true`,
        undefined,
        { timeout },
      )
      const authoritativeTarget =
        assertM5MaterialEvidenceTargetMatchesContentCenter({
          caseId: coverageCase.id,
          configuredTarget: coverageCase.logicalTarget,
          contentCenter: (await page.evaluate(`(() => {
            const material = window.__LIANDAN_M2__?.getMaterialTopologyEvidence().find(
              (candidate) =>
                candidate.materialDefinitionId === ${JSON.stringify(coverageCase.materialDefinitionId)} &&
                candidate.inventoryBatchId === ${JSON.stringify(coverageCase.materialBatchId)}
            );
            if (!material) {
              throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_MISSING');
            }
            return material.contentPlacement.center;
          })()`)) as Readonly<{ x: number; y: number }>,
          epsilon: coverageCase.epsilon,
        })
      const collectorMotion = await readCollectorMotionConfig(
        page,
        coverageCase.fireSourceId,
        timeout,
      )
      const configuredInitialOffset = Math.abs(
        collectorMotion.configuredMaterialCenterX -
          collectorMotion.configuredCollectorInitialX,
      )
      if (!Number.isFinite(configuredInitialOffset)) {
        throw new Error(
          'M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_CONFIG_POSITION_INVALID',
        )
      }
      const collectorAlignment = await alignCollectorWithMaterialEvidence({
        config: input.fixture.coverage.materialAlignment,
        motion: collectorMotion,
        readPosition: async () =>
          (await runM5VisualEvidenceWithTimeout(
            page.evaluate(`(() => {
              const api = window.__LIANDAN_M2__;
              if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
              const material = api.getMaterialTopologyEvidence().find(
                (candidate) => candidate.materialDefinitionId === ${JSON.stringify(coverageCase.materialDefinitionId)} &&
                  candidate.inventoryBatchId === ${JSON.stringify(coverageCase.materialBatchId)}
              );
              if (!material) throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_MISSING');
               return {
                 collectorCenterX: api.getPresentationEvidence().collectorCenter.x,
                 materialCenterX: material.placement.center.x,
                 velocityX: api.getPresentationEvidence().collectorVelocityX,
                 tick: api.getPresentationEvidence().simulationTick
               };
            })()`),
            Math.min(
              timeout,
              input.fixture.coverage.materialAlignment.deadlineMilliseconds,
            ),
            'M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_POSITION_TIMEOUT',
          )) as Readonly<{
            collectorCenterX: number
            materialCenterX: number
            velocityX: number
            tick: number
          }>,
        focus: () => page.locator('[data-m2-stage]').focus(),
        keyDown: (key) => page.keyboard.down(key),
        keyUp: (key) => page.keyboard.up(key),
        waitForMilliseconds: (milliseconds) =>
          page.waitForTimeout(milliseconds),
      })
      await aimAtLogicalPoint(page, authoritativeTarget)
      const visionTransformToken = await applyVisionTransform(
        page,
        'normal',
        M5_VISUAL_IDENTITY_COLOR_MATRIX,
      )
      await page.mouse.down()
      try {
        await waitForMaterialTopologyStop(
          page,
          coverageCase,
          collectorMotion.fireSourceOrigin,
          authoritativeTarget,
        )
      } finally {
        await page.mouse.up()
      }
      await page.waitForFunction(
        'window.__LIANDAN_M2__?.getSnapshot().isSpraying === false',
        undefined,
        { timeout },
      )
      const record = await capturePage(
        {
          page,
          telemetry,
          runtime: input.runtime,
          viewport: input.fixture.coverage.viewport,
          screenshotMode: input.fixture.protocol.screenshotMode,
          reducedMotion: false,
          visionMode: 'normal',
          colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
          caseId,
          outputDirectory: input.outputDirectory,
          runId: input.runId,
          distSha256: input.distSha256,
          seed: input.fixture.protocol.deterministicSeed,
          checks: [
            {
              id: 'material-collector-feedback-aligned-before-fire',
              passed:
                collectorAlignment.finalOffset <=
                input.fixture.coverage.materialAlignment.maximumCenterOffset,
              actual: `${configuredInitialOffset}/${collectorAlignment.initialOffset}/${collectorAlignment.finalOffset}/${collectorAlignment.correctionCount}`,
              expected: `configured/initial/final<=${input.fixture.coverage.materialAlignment.maximumCenterOffset}/corrections`,
            },
          ],
          prepareBefore: () =>
            readMaterialTopologyState(
              page,
              coverageCase,
              collectorMotion.fireSourceOrigin,
              authoritativeTarget,
            ),
          clockCapture: {
            mode: 'transient',
            installed: true,
            visionTransformToken,
            maximumCaptureMilliseconds:
              input.fixture.protocol.clock.maximumCaptureMilliseconds,
            resumeReserveMilliseconds:
              input.fixture.protocol.clock.resumeReserveMilliseconds,
            maximumPauseAttempts:
              input.fixture.protocol.clock.pauseMaximumAttempts,
            pause: () => acquirePageClockPause(page, input.fixture),
            resume: () => page.clock.resume(),
            quarantine: closeContextOnce,
          },
          captureBoundary: {
            readAfter: () =>
              readMaterialTopologyState(
                page,
                coverageCase,
                collectorMotion.fireSourceOrigin,
                authoritativeTarget,
              ),
            checks: (before, after) =>
              materialTopologyChecks(before, after, coverageCase),
          },
        },
        expectedCell(input.expectedById, caseId),
      )
      input.records.set(caseId, record)
    } catch (error) {
      markFailed(input.records, input.expectedById, caseId, error)
    } finally {
      await closeContextOnce()
    }
  }
}

async function readMaterialPairState(
  page: Page,
  coverageCase: MaterialPairCoverageCase,
): Promise<M2BrowserEvidence> {
  const raw = (await page.evaluate(`(() => {
    const state = ${m2EvidenceExpression()};
    const api = window.__LIANDAN_M2__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    return {
      state,
      materials: api.getMaterialTopologyEvidence()
    };
  })()`)) as Readonly<{
    state: M2BrowserEvidence
    materials: readonly RawMaterialTopologyEvidence[]
  }>
  const expectedBatchOrder = new Map(
    coverageCase.materialBatchIds.map((batchId, index) => [batchId, index]),
  )
  const materials = [...raw.materials]
    .sort(
      (left, right) =>
        (expectedBatchOrder.get(left.inventoryBatchId) ??
          Number.MAX_SAFE_INTEGER) -
        (expectedBatchOrder.get(right.inventoryBatchId) ??
          Number.MAX_SAFE_INTEGER),
    )
    .map((material) => ({
      materialInstanceId: material.materialInstanceId,
      materialDefinitionId: material.materialDefinitionId,
      inventoryBatchId: material.inventoryBatchId,
      placement: material.placement,
      contentPlacement: material.contentPlacement,
      initialVolume: material.initialVolume,
      remainingVolume: material.remainingVolume,
      initialGridSha256: sha256M5VisualEvidence(
        JSON.stringify(material.initialCellVolumes),
      ),
      remainingGridSha256: sha256M5VisualEvidence(
        JSON.stringify(material.remainingCellVolumes),
      ),
      initialNonEmptyCellCount: material.initialCellVolumes.filter(
        (volume) => volume > coverageCase.epsilon,
      ).length,
      remainingNonEmptyCellCount: material.remainingCellVolumes.filter(
        (volume) => volume > coverageCase.epsilon,
      ).length,
    }))
  return {
    ...raw.state,
    observableState: {
      ...raw.state.observableState,
      materialPair: {
        sessionId: raw.state.sessionId,
        tick: raw.state.tick,
        equippedFireSourceId:
          raw.state.observableState.equippedFireSourceId ?? null,
        isSpraying: raw.state.observableState.isSpraying === true,
        firePresentationState: String(
          raw.state.observableState.firePresentationState ?? '',
        ),
        fireVisualIntensity: Number(
          raw.state.observableState.fireVisualIntensity,
        ),
        activePearlCount: Number(raw.state.observableState.activePearlCount),
        audioMuted: raw.state.observableState.audioMuted === true,
        materials,
      },
    },
  }
}

function materialPairObservation(
  state: BrowserEvidenceState,
): M5VisualMaterialPairBoundaryObservation {
  return state.observableState
    .materialPair as M5VisualMaterialPairBoundaryObservation
}

async function runMaterialPairNonOverlapCase(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  const configuredCase = input.fixture.coverage.cases.find(
    ({ automation }) => automation === 'm2-material-pair-non-overlap',
  )
  if (configuredCase === undefined) return
  const coverageCase = materialPairCase(configuredCase)
  const caseId = `coverage/${coverageCase.id}`
  let context: BrowserContext | undefined
  let contextClosePromise: Promise<void> | undefined
  const closeContextOnce = (): Promise<void> => {
    if (contextClosePromise !== undefined) return contextClosePromise
    if (context === undefined) return Promise.resolve()
    contextClosePromise = runM5VisualEvidenceWithTimeout(
      context.close(),
      input.fixture.protocol.timeouts.cleanupMilliseconds,
      'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
    )
    return contextClosePromise
  }
  try {
    context = await createContext(
      input.runtime,
      input.fixture.coverage.viewport,
      false,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const page = await createEvidencePage(
      context,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    await page.clock.install({ time: Date.now() })
    const telemetry = createTelemetry(page)
    const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
    await openM2(page, input.baseUrl, timeout)
    for (let index = 0; index < coverageCase.materialBatchIds.length; index += 1) {
      const batchId = coverageCase.materialBatchIds[index]!
      await page.evaluate(`(() => {
        const api = window.__LIANDAN_M2__;
        if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
        api.preselectMaterial(${JSON.stringify(batchId)});
        api.addSelectedMaterial();
      })()`)
      await page.waitForFunction(
        `(() => {
          const evidence = window.__LIANDAN_M2__?.getMaterialTopologyEvidence();
          return evidence?.length === ${JSON.stringify(index + 1)} &&
            evidence.some(
              (material) => material.inventoryBatchId === ${JSON.stringify(batchId)}
            );
        })()`,
        undefined,
        { timeout },
      )
    }
    await page.waitForFunction(
      `(() => {
        const api = window.__LIANDAN_M2__;
        const snapshot = api?.getSnapshot();
        const evidence = api?.getMaterialTopologyEvidence();
        return snapshot?.equippedFireSourceId === null &&
          snapshot.isSpraying === false &&
          snapshot.audioMuted === true &&
          evidence?.length === 2 &&
          ${JSON.stringify(coverageCase.materialBatchIds)}.every(
            (batchId) => evidence.some(
              (material) => material.inventoryBatchId === batchId
            )
          );
      })()`,
      undefined,
      { timeout },
    )
    await page.waitForTimeout(coverageCase.settleMilliseconds)
    const visionTransformToken = await applyVisionTransform(
      page,
      'normal',
      M5_VISUAL_IDENTITY_COLOR_MATRIX,
    )
    const expectedMaterials = coverageCase.materialBatchIds.map(
      (inventoryBatchId, index) => ({
        inventoryBatchId,
        materialDefinitionId: coverageCase.materialDefinitionIds[index]!,
      }),
    )
    const record = await capturePage(
      {
        page,
        telemetry,
        runtime: input.runtime,
        viewport: input.fixture.coverage.viewport,
        screenshotMode: input.fixture.protocol.screenshotMode,
        reducedMotion: false,
        visionMode: 'normal',
        colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
        caseId,
        outputDirectory: input.outputDirectory,
        runId: input.runId,
        distSha256: input.distSha256,
        seed: input.fixture.protocol.deterministicSeed,
        checks: [],
        prepareBefore: () => readMaterialPairState(page, coverageCase),
        clockCapture: {
          mode: 'transient',
          installed: true,
          visionTransformToken,
          maximumCaptureMilliseconds:
            input.fixture.protocol.clock.maximumCaptureMilliseconds,
          resumeReserveMilliseconds:
            input.fixture.protocol.clock.resumeReserveMilliseconds,
          maximumPauseAttempts:
            input.fixture.protocol.clock.pauseMaximumAttempts,
          pause: () => acquirePageClockPause(page, input.fixture),
          resume: () => page.clock.resume(),
          quarantine: closeContextOnce,
        },
        captureBoundary: {
          readAfter: () => readMaterialPairState(page, coverageCase),
          checks: (before, after) =>
            createM5VisualMaterialPairBoundaryChecks({
              expectedMaterials,
              epsilon: coverageCase.epsilon,
              before: materialPairObservation(before),
              after: materialPairObservation(after),
            }),
        },
      },
      expectedCell(input.expectedById, caseId),
    )
    input.records.set(caseId, record)
  } catch (error) {
    markFailed(input.records, input.expectedById, caseId, error)
  } finally {
    await closeContextOnce()
  }
}

async function readWarningState(
  page: Page,
  coverageCase: WarningCoverageCase,
): Promise<M2BrowserEvidence> {
  return (await page.evaluate(`(() => {
    const state = ${m2EvidenceExpression()};
    const api = window.__LIANDAN_M2__;
    if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
    const warning = document.querySelector('[data-loss-warning][data-level]');
    const presentation = api.getPresentationEvidence();
    const rectangle = warning?.getBoundingClientRect();
    return {
      ...state,
      observableState: {
        ...state.observableState,
        lossWarningEvidence: {
          expectedLevel: ${JSON.stringify(coverageCase.warningLevel)},
          actualLevel: state.observableState.lossWarningLevel,
          domLevel: warning?.dataset.level ?? '',
          domText: warning?.textContent ?? '',
          domVisible: Boolean(warning && !warning.hidden && rectangle && rectangle.width > 0 && rectangle.height > 0 && getComputedStyle(warning).display !== 'none' && getComputedStyle(warning).visibility !== 'hidden'),
          expectedMessageZh: ${JSON.stringify(coverageCase.expectedMessageZh)},
          expectedEffect: ${JSON.stringify(coverageCase.expectedEffect)},
          activeEffectKinds: Array.from(presentation.activeEffectKinds)
        }
      }
    };
  })()`)) as M2BrowserEvidence
}

function warningTransitionExpression(
  coverageCase: WarningCoverageCase,
  stopSprayingAtWarningLevel: 2,
): string {
  return `(() => {
    const api = window.__LIANDAN_M2__;
    const snapshot = api?.getSnapshot();
    const warning = document.querySelector('[data-loss-warning][data-level]');
    const presentation = api?.getPresentationEvidence();
    if (!snapshot || !warning || !presentation) return false;
    if (
      snapshot.status === 'failed' ||
      snapshot.failurePresentationState !== 'idle'
    ) {
      throw new Error(
        'M5_VISUAL_EVIDENCE_WARNING_TERMINAL_STATE_INVALID:' +
        snapshot.status + '/' + snapshot.failurePresentationState
      );
    }
    const rectangle = warning.getBoundingClientRect();
    const transitionMatches = snapshot.lossWarningLevel === ${JSON.stringify(coverageCase.warningLevel)} &&
      snapshot.lastDomainEventTypes.includes('LossWarningChanged') &&
      warning.dataset.level === ${JSON.stringify(String(coverageCase.warningLevel))} &&
      (warning.textContent ?? '').includes(${JSON.stringify(coverageCase.expectedMessageZh)}) &&
      !warning.hidden && rectangle.width > 0 && rectangle.height > 0 &&
      presentation.activeEffectKinds.includes(${JSON.stringify(coverageCase.expectedEffect)});
    if (!transitionMatches) return false;
    if (
      ${JSON.stringify(coverageCase.warningLevel)} ===
        ${JSON.stringify(stopSprayingAtWarningLevel)}
    ) {
      const stage = document.querySelector('[data-m2-stage]');
      const pointerId = Number(stage?.dataset.m5EvidencePointerId);
      if (!Number.isInteger(pointerId) || pointerId < 0) {
        throw new Error('M5_VISUAL_EVIDENCE_WARNING_POINTER_ID_MISSING');
      }
      window.dispatchEvent(new PointerEvent('pointerup', {
        pointerId,
        button: 0,
        buttons: 0,
        bubbles: true,
        cancelable: true
      }));
    }
    return Object.freeze({
      sessionId: snapshot.sessionId,
      tick: snapshot.tick,
      eventObserved: true,
      eventType: 'LossWarningChanged',
      level: snapshot.lossWarningLevel,
      effectKind: ${JSON.stringify(coverageCase.expectedEffect)}
    });
  })()`
}

function warningChecks(
  state: BrowserEvidenceState,
  coverageCase: WarningCoverageCase,
  boundary: 'before' | 'after',
  latchedWarning: M5VisualWarningTransitionLatch,
  maximumCaptureTickDrift?: number,
): readonly M5VisualEvidenceCheck[] {
  const evidence = state.observableState.lossWarningEvidence as Readonly<{
    actualLevel: number
    domLevel: string
    domText: string
    domVisible: boolean
    activeEffectKinds: readonly string[]
  }>
  return createM5VisualWarningBoundaryChecks({
    boundary,
    expectedLevel: coverageCase.warningLevel,
    expectedMessageZh: coverageCase.expectedMessageZh,
    expectedEffect: coverageCase.expectedEffect,
    latchedWarning,
    maximumCaptureTickDrift,
    current: {
      sessionId: state.sessionId,
      tick: state.tick,
      domainStatus: String(state.observableState.domainStatus ?? ''),
      failurePresentationState: String(
        state.observableState.failurePresentationState ?? '',
      ),
      ...evidence,
    },
  })
}

async function runWarningCases(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
    caseIdPrefix: string
    viewport: M5VisualEvidenceViewport
    reducedMotion: boolean
    visionMode: M5VisualEvidenceVisionMode
    colorMatrix: readonly number[]
  }>,
): Promise<void> {
  const warningCases = input.fixture.coverage.cases
    .filter(({ automation }) => automation === 'm2-loss-warning')
    .map(warningCase)
    .sort((left, right) => left.warningLevel - right.warningLevel)
  const caseIds = warningCases.map(({ id, warningLevel }) =>
    input.caseIdPrefix === 'coverage'
      ? `coverage/${id}`
      : `${input.caseIdPrefix}/warning-${warningLevel === 1 ? 'one' : 'two'}`,
  )
  let context: BrowserContext | undefined
  let contextClosePromise: Promise<void> | undefined
  const closeContextOnce = (): Promise<void> => {
    if (contextClosePromise !== undefined) return contextClosePromise
    if (context === undefined) return Promise.resolve()
    contextClosePromise = runM5VisualEvidenceWithTimeout(
      context.close(),
      input.fixture.protocol.timeouts.cleanupMilliseconds,
      'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
    )
    return contextClosePromise
  }
  try {
    context = await createContext(
      input.runtime,
      input.viewport,
      input.reducedMotion,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const page = await createEvidencePage(
      context,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    await page.clock.install({ time: Date.now() })
    const telemetry = createTelemetry(page)
    const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
    const flow = input.fixture.coverage.warningFlow
    const formalMaterial = warningFormalMaterialCase(input.fixture)
    await openM2(page, input.baseUrl, timeout)
    await configureM2Fire(
      page,
      flow.fireSourceId,
      flow.fireSize,
      flow.flameThrust,
      timeout,
    )
    await page.evaluate(`(() => {
      const api = window.__LIANDAN_M2__;
      if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
      api.preselectMaterial(${JSON.stringify(flow.materialBatchId)});
      api.addSelectedMaterial();
    })()`)
    await page.waitForFunction(
      `window.__LIANDAN_M2__?.getMaterialTopologyEvidence().some(
        (material) =>
          material.materialDefinitionId === ${JSON.stringify(flow.materialDefinitionId)} &&
          material.inventoryBatchId === ${JSON.stringify(flow.materialBatchId)}
      ) === true`,
      undefined,
      { timeout },
    )
    await page.locator('[data-m2-stage]').focus()
    await page.keyboard.down(flow.collectorMoveKey)
    try {
      await page.waitForTimeout(flow.collectorMoveMilliseconds)
    } finally {
      await page.keyboard.up(flow.collectorMoveKey)
    }
    await page.waitForTimeout(flow.collectorSettleMilliseconds)
    const authoritativeTarget =
      assertM5MaterialEvidenceTargetMatchesContentCenter({
        caseId: 'warningFlow',
        configuredTarget: flow.logicalTarget,
        contentCenter: (await page.evaluate(`(() => {
          const material = window.__LIANDAN_M2__?.getMaterialTopologyEvidence().find(
            (candidate) =>
              candidate.materialDefinitionId === ${JSON.stringify(flow.materialDefinitionId)} &&
              candidate.inventoryBatchId === ${JSON.stringify(flow.materialBatchId)}
          );
          if (!material) {
            throw new Error('M5_VISUAL_EVIDENCE_WARNING_MATERIAL_TOPOLOGY_MISSING');
          }
          return material.contentPlacement.center;
        })()`)) as Readonly<{ x: number; y: number }>,
        epsilon: formalMaterial.epsilon,
      })
    await aimAtLogicalPoint(page, authoritativeTarget)
    const visionTransformToken = await applyVisionTransform(
      page,
      input.visionMode,
      input.colorMatrix,
    )
    await page.evaluate(`(() => {
      const stage = document.querySelector('[data-m2-stage]');
      if (!(stage instanceof HTMLElement)) {
        throw new Error('M5_VISUAL_EVIDENCE_WARNING_STAGE_MISSING');
      }
      stage.addEventListener('pointerdown', (event) => {
        stage.dataset.m5EvidencePointerId = String(event.pointerId);
      }, { capture: true, once: true });
    })()`)
    await page.mouse.down()
    let sprayingPointerDown = true
    try {
      for (let index = 0; index < warningCases.length; index += 1) {
        const coverageCase = warningCases[index]!
        const caseId = caseIds[index]!
        let warningClockPaused = false
        try {
          if (coverageCase.warningLevel === flow.stopSprayingAtWarningLevel) {
            await acquireWarningPageClockPause(page, input.fixture)
            warningClockPaused = true
          }
          const transitionExpression = warningTransitionExpression(
            coverageCase,
            flow.stopSprayingAtWarningLevel,
          )
          let latchedWarning: M5VisualWarningTransitionLatch
          if (warningClockPaused) {
            let advancedMilliseconds = 0
            for (;;) {
              const transition = (await page.evaluate(transitionExpression)) as
                | false
                | M5VisualWarningTransitionLatch
              if (transition !== false) {
                latchedWarning = Object.freeze(transition)
                break
              }
              if (advancedMilliseconds >= flow.maximumWaitMilliseconds) {
                throw new Error(
                  `M5_VISUAL_EVIDENCE_WARNING_TRANSITION_TIMEOUT:${coverageCase.warningLevel}`,
                )
              }
              const advanceMilliseconds = Math.min(
                input.fixture.protocol.clock.sequenceStepMilliseconds,
                flow.maximumWaitMilliseconds - advancedMilliseconds,
              )
              await page.clock.runFor(advanceMilliseconds)
              advancedMilliseconds += advanceMilliseconds
            }
          } else {
            const transitionHandle = await page.waitForFunction(
              transitionExpression,
              undefined,
              { timeout: flow.maximumWaitMilliseconds },
            )
            latchedWarning = await (async () => {
              try {
                return Object.freeze(
                  (await transitionHandle.jsonValue()) as M5VisualWarningTransitionLatch,
                )
              } finally {
                await transitionHandle.dispose()
              }
            })()
          }
          if (
            coverageCase.warningLevel === flow.stopSprayingAtWarningLevel &&
            sprayingPointerDown
          ) {
            await page.mouse.up()
            sprayingPointerDown = false
            for (;;) {
              const stoppedState = (await page.evaluate(`(() => {
              const snapshot = window.__LIANDAN_M2__?.getSnapshot();
              if (!snapshot) {
                throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
              }
              return {
                tick: snapshot.tick,
                status: snapshot.status,
                isSpraying: snapshot.isSpraying,
                lossWarningLevel: snapshot.lossWarningLevel,
                failurePresentationState: snapshot.failurePresentationState
              };
            })()`)) as Readonly<{
                tick: number
                status: string
                isSpraying: boolean
                lossWarningLevel: number
                failurePresentationState: string
              }>
              const tickDrift = stoppedState.tick - latchedWarning.tick
              if (
                stoppedState.status === 'failed' ||
                stoppedState.failurePresentationState !== 'idle'
              ) {
                throw new Error(
                  `M5_VISUAL_EVIDENCE_WARNING_TERMINAL_STATE_INVALID:${stoppedState.status}/${stoppedState.failurePresentationState}`,
                )
              }
              if (tickDrift > flow.maximumStoppedCaptureTickDrift) {
                throw new Error(
                  `M5_VISUAL_EVIDENCE_WARNING_TICK_DRIFT_EXCEEDED:${tickDrift}/${flow.maximumStoppedCaptureTickDrift}`,
                )
              }
              if (
                stoppedState.status === 'extracting' &&
                stoppedState.isSpraying === false &&
                stoppedState.lossWarningLevel === coverageCase.warningLevel &&
                stoppedState.failurePresentationState === 'idle'
              ) {
                break
              }
              await page.clock.runFor(
                input.fixture.protocol.clock.sequenceStepMilliseconds,
              )
            }
          }
          const maximumCaptureTickDrift = warningClockPaused
            ? flow.maximumStoppedCaptureTickDrift
            : undefined
          const record = await capturePage(
            {
              page,
              telemetry,
              runtime: input.runtime,
              viewport: input.viewport,
              screenshotMode: input.fixture.protocol.screenshotMode,
              reducedMotion: input.reducedMotion,
              visionMode: input.visionMode,
              colorMatrix: input.colorMatrix,
              caseId,
              outputDirectory: input.outputDirectory,
              runId: input.runId,
              distSha256: input.distSha256,
              seed: input.fixture.protocol.deterministicSeed,
              checks: [],
              prepareBefore: () => readWarningState(page, coverageCase),
              clockCapture: warningClockPaused
                ? {
                    mode: 'sequence-held',
                    installed: true,
                    paused: true,
                    visionTransformToken,
                    resumeOwner: 'sequence-finally',
                    maximumCaptureMilliseconds:
                      input.fixture.protocol.clock.maximumCaptureMilliseconds,
                  }
                : {
                    mode: 'transient',
                    installed: true,
                    visionTransformToken,
                    maximumCaptureMilliseconds:
                      input.fixture.protocol.clock.maximumCaptureMilliseconds,
                    resumeReserveMilliseconds:
                      input.fixture.protocol.clock.resumeReserveMilliseconds,
                    maximumPauseAttempts:
                      input.fixture.protocol.clock.pauseMaximumAttempts,
                    pause: () => acquirePageClockPause(page, input.fixture),
                    resume: () => page.clock.resume(),
                    quarantine: closeContextOnce,
                  },
              captureBoundary: {
                readAfter: () => readWarningState(page, coverageCase),
                checks: (before, after) => [
                  ...warningChecks(
                    before,
                    coverageCase,
                    'before',
                    latchedWarning,
                    maximumCaptureTickDrift,
                  ),
                  ...warningChecks(
                    after,
                    coverageCase,
                    'after',
                    latchedWarning,
                    maximumCaptureTickDrift,
                  ),
                ],
              },
            },
            expectedCell(input.expectedById, caseId),
          )
          input.records.set(caseId, record)
        } finally {
          if (warningClockPaused) await page.clock.resume()
        }
      }
    } finally {
      if (sprayingPointerDown) await page.mouse.up()
    }
  } catch (error) {
    for (const caseId of caseIds) {
      if (input.records.get(caseId)?.status === 'captured') continue
      markFailed(input.records, input.expectedById, caseId, error)
    }
  } finally {
    await closeContextOnce()
  }
}

async function runCoverageCases(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  await runMaterialTopologyCases(input)
  await runMaterialPairNonOverlapCase(input)

  const galleryCase = input.fixture.coverage.cases.find(
    ({ automation }) => automation === 'gallery',
  )
  if (galleryCase !== undefined) {
    await captureGalleryCase({
      ...input,
      caseId: `coverage/${galleryCase.id}`,
      viewport: input.fixture.coverage.viewport,
      reducedMotion: false,
      visionMode: 'normal',
      colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
      requiredStates: galleryCase.requiredStates,
    })
  }

  await runWarningCases({
    ...input,
    caseIdPrefix: 'coverage',
    viewport: input.fixture.coverage.viewport,
    reducedMotion: false,
    visionMode: 'normal',
    colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
  })

  const automatedThrustCases = input.fixture.coverage.cases.filter(
    ({ automation }) =>
      automation === 'm2-thrust-off' || automation === 'm2-thrust-on',
  )
  if (automatedThrustCases.length === 0) return
  let context: BrowserContext | undefined
  const pageCaseIds = automatedThrustCases.map(({ id }) => `coverage/${id}`)
  try {
    context = await createContext(
      input.runtime,
      input.fixture.coverage.viewport,
      false,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const page = await createEvidencePage(
      context,
      input.fixture.protocol.timeouts.browserOperationMilliseconds,
    )
    const telemetry = createTelemetry(page)
    const timeout = input.fixture.protocol.timeouts.browserOperationMilliseconds
    await openM2(page, input.baseUrl, timeout)
    const direction = input.fixture.fire.directions.find(
      ({ id }) => id === 'center',
    )!
    await configureM2Fire(
      page,
      input.fixture.fire.fireSourceId,
      100,
      false,
      timeout,
    )
    await aimAtLogicalPoint(page, direction.logicalTarget)
    await page.mouse.down()
    try {
      await page.waitForTimeout(input.fixture.fire.stableWarmupMilliseconds)
      for (const coverageCase of automatedThrustCases) {
        const expectedThrust = coverageCase.automation === 'm2-thrust-on'
        await page.evaluate(`(() => {
          const api = window.__LIANDAN_M2__;
          if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
          api.setFlameThrust(${JSON.stringify(expectedThrust)});
        })()`)
        await page.waitForFunction(
          `window.__LIANDAN_M2__?.getSnapshot().flameThrustEnabled === ${JSON.stringify(expectedThrust)}`,
          undefined,
          { timeout },
        )
        await page.waitForTimeout(80)
        const state = await readM2Evidence(page)
        const caseId = `coverage/${coverageCase.id}`
        const canvasDataset = (state.observableState.canvasDataset ??
          {}) as Record<string, unknown>
        const localLightIntensity = Number(
          canvasDataset.localLightIntensity ?? 0,
        )
        const checks = [
          ...fireChecks(state, 100, expectedThrust),
          {
            id: 'local-light-current-frame-visible',
            passed:
              Number.isFinite(localLightIntensity) && localLightIntensity > 0,
            actual: localLightIntensity,
            expected: '> 0 from canvas.dataset.localLightIntensity',
          },
        ] satisfies readonly M5VisualEvidenceCheck[]
        const record = await capturePage(
          {
            page,
            telemetry,
            runtime: input.runtime,
            viewport: input.fixture.coverage.viewport,
            screenshotMode: input.fixture.protocol.screenshotMode,
            reducedMotion: false,
            visionMode: 'normal',
            colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
            caseId,
            outputDirectory: input.outputDirectory,
            runId: input.runId,
            distSha256: input.distSha256,
            seed: input.fixture.protocol.deterministicSeed,
            state,
            checks,
          },
          expectedCell(input.expectedById, caseId),
        )
        input.records.set(caseId, record)
      }
    } finally {
      await page.mouse.up()
    }
  } catch (error) {
    for (const caseId of pageCaseIds) {
      markFailed(input.records, input.expectedById, caseId, error)
    }
  } finally {
    if (context !== undefined) {
      await runM5VisualEvidenceWithTimeout(
        context.close(),
        input.fixture.protocol.timeouts.cleanupMilliseconds,
        'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
      )
    }
  }
}

async function runAccessibilityCases(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  for (const mode of input.fixture.accessibility.modes) {
    await captureGalleryCase({
      ...input,
      caseId: `accessibility/${mode.id}/gallery`,
      viewport: input.fixture.accessibility.viewport,
      reducedMotion: mode.reducedMotion,
      visionMode: mode.visionMode,
      colorMatrix: mode.colorMatrix,
      requiredStates: input.fixture.accessibility.galleryRequiredStates,
    })
    await runWarningCases({
      ...input,
      caseIdPrefix: `accessibility/${mode.id}`,
      viewport: input.fixture.accessibility.viewport,
      reducedMotion: mode.reducedMotion,
      visionMode: mode.visionMode,
      colorMatrix: mode.colorMatrix,
    })
  }
}

type FailurePresentationEvidence = Readonly<{
  durationSeconds: number
  thresholds: M5VisualFailurePhaseThresholds
}>

function failureObservation(
  state: BrowserEvidenceState,
): M5VisualFailureBoundaryObservation {
  return {
    sessionId: state.sessionId,
    tick: state.tick,
    domainStatus: String(state.observableState.domainStatus ?? ''),
    failurePresentationState: String(
      state.observableState.failurePresentationState ?? '',
    ),
    failurePresentationProgress: Number(
      state.observableState.failurePresentationProgress ?? Number.NaN,
    ),
    failurePresentationComplete:
      state.observableState.failurePresentationComplete === true,
  }
}

async function readFailurePresentationEvidence(
  page: Page,
  reducedMotion: boolean,
): Promise<FailurePresentationEvidence> {
  return (await page.evaluate(`(async () => {
    const response = await fetch('/config/m2/presentation.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('M5_VISUAL_EVIDENCE_PRESENTATION_CONFIG_UNAVAILABLE');
    const presentation = await response.json();
    return {
      durationSeconds: ${JSON.stringify(reducedMotion)}
        ? presentation.accessibility.reducedMotionFailureDurationSeconds
        : presentation.effects.failureDurationSeconds,
      thresholds: {
        shatteringStartRatio: presentation.failure.shatteringStartRatio,
        gatheringStartRatio: presentation.failure.gatheringStartRatio,
        flyingStartRatio: presentation.failure.flyingStartRatio
      }
    };
  })()`)) as FailurePresentationEvidence
}

async function advanceToFailurePhaseTarget(
  page: Page,
  fixture: M5VisualEvidenceFixture,
  phase: M5VisualEvidenceFixture['failure']['phases'][number],
  thresholds: M5VisualFailurePhaseThresholds,
  timeout: number,
): Promise<M2BrowserEvidence> {
  const expectedState = {
    trigger: 'charring',
    charring: 'charring',
    shattering: 'shattering',
    gathering: 'gathering',
    flying: 'flying',
    result: 'result',
  }[phase]
  const targetProgress = targetFailureProgress(phase, thresholds)
  const triggerMaximum = thresholds.shatteringStartRatio / 3
  return advancePageClockUntil({
    page,
    stepMilliseconds: fixture.protocol.clock.sequenceStepMilliseconds,
    timeoutMilliseconds: timeout,
    observe: () => readM2Evidence(page),
    reached: (state) => {
      const observable = state.observableState
      if (
        observable.domainStatus !== 'failed' ||
        observable.failurePresentationState !== expectedState
      ) {
        return false
      }
      const progress = Number(observable.failurePresentationProgress)
      if (phase === 'trigger') return progress <= triggerMaximum
      if (phase === 'result') {
        return observable.failurePresentationComplete === true && progress === 1
      }
      return progress >= targetProgress
    },
    timeoutCode: `M5_VISUAL_EVIDENCE_FAILURE_PHASE_TIMEOUT:${phase}`,
  })
}

async function failureResultUiChecks(
  page: Page,
): Promise<readonly M5VisualEvidenceCheck[]> {
  await page.locator('[data-failure-result]').focus()
  const measured = (await page.evaluate(`(() => {
    const canvas = document.querySelector('canvas[data-scene="m2-extraction"]');
    const result = document.querySelector('[data-failure-result]');
    const tip = document.querySelector('[data-failure-result-tip]');
    const panel = document.querySelector('[data-failure-dialog]');
    if (!canvas || !result || !tip || !panel) return { present: false };
    const canvasBox = canvas.getBoundingClientRect();
    const resultBox = result.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const overlap = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    return {
      present: true,
      resultCentered: Math.abs((resultBox.left + resultBox.right) / 2 - (canvasBox.left + canvasBox.right) / 2) <= 2 && Math.abs((resultBox.top + resultBox.bottom) / 2 - (canvasBox.top + canvasBox.bottom) / 2) <= 2,
      resultPanelOverlap: overlap(resultBox, panelBox),
      tipPanelOverlap: overlap(tipBox, panelBox),
      panelModal: panel.getAttribute('aria-modal') === 'true',
      againButtonCount: panel.querySelectorAll('button[data-action="again"]').length,
      tipText: tip.textContent ?? ''
    };
  })()`)) as {
    present: boolean
    resultCentered?: boolean
    resultPanelOverlap?: boolean
    tipPanelOverlap?: boolean
    panelModal?: boolean
    againButtonCount?: number
    tipText?: string
  }
  return [
    {
      id: 'failure-result-and-tips-present',
      passed:
        measured.present &&
        (measured.tipText ?? '').includes('药渣') &&
        (measured.tipText ?? '').includes('失败原因') &&
        (measured.tipText ?? '').includes('投入材料') &&
        /药渣\s*×\s*[1-9][0-9]*/u.test(measured.tipText ?? ''),
      actual: measured.tipText ?? 'missing',
      expected: '结果物、失败原因、投入材料与数量',
    },
    {
      id: 'failure-result-centered',
      passed: measured.resultCentered === true,
      actual: String(measured.resultCentered),
      expected: true,
    },
    {
      id: 'failure-result-panel-non-overlap',
      passed:
        measured.resultPanelOverlap === false &&
        measured.tipPanelOverlap === false,
      actual: `${String(measured.resultPanelOverlap)}/${String(measured.tipPanelOverlap)}`,
      expected: 'false/false',
    },
    {
      id: 'failure-panel-non-modal-single-action',
      passed: measured.panelModal === false && measured.againButtonCount === 1,
      actual: `${String(measured.panelModal)}/${String(measured.againButtonCount)}`,
      expected: 'false/1',
    },
  ]
}

async function readFailureCaptureState(
  input: Readonly<{
    page: Page
    failure: M5VisualEvidenceFixture['failure']
    interceptedBodySha256: string
    presentationEvidence: FailurePresentationEvidence
  }>,
): Promise<M2BrowserEvidence> {
  const rawState = await readM2Evidence(input.page)
  return {
    ...rawState,
    observableState: {
      ...rawState.observableState,
      failureFixtureOverride: {
        materialDefinitionId: input.failure.materialDefinitionId,
        targetPearlCount: input.failure.interceptedTargetPearlCount,
        interceptedBodySha256: input.interceptedBodySha256,
      },
      failurePresentationEvidence: input.presentationEvidence,
    },
  }
}

function failurePhaseTargetCheck(
  phase: M5VisualEvidenceFixture['failure']['phases'][number],
  thresholds: M5VisualFailurePhaseThresholds,
  state: BrowserEvidenceState,
): M5VisualEvidenceCheck {
  const observation = failureObservation(state)
  const expectedState = expectedM5VisualFailurePresentationState(phase)
  const targetProgress = targetFailureProgress(phase, thresholds)
  const triggerMaximum = thresholds.shatteringStartRatio / 3
  const targetReached =
    observation.domainStatus === 'failed' &&
    observation.failurePresentationState === expectedState &&
    (phase === 'trigger'
      ? observation.failurePresentationProgress <= triggerMaximum
      : phase === 'result'
        ? observation.failurePresentationComplete === true &&
          observation.failurePresentationProgress === 1
        : observation.failurePresentationProgress >= targetProgress)
  return {
    id: 'sequence-phase-target-audited',
    passed: targetReached,
    actual: `${observation.domainStatus}/${observation.failurePresentationState}/${observation.failurePresentationProgress}/${observation.failurePresentationComplete}`,
    expected:
      phase === 'trigger'
        ? `failed/${expectedState}/progress<=${triggerMaximum}/false`
        : phase === 'result'
          ? 'failed/result/1/true'
          : `failed/${expectedState}/progress>=${targetProgress}/false`,
  }
}

async function runFailureCases(
  input: Readonly<{
    fixture: M5VisualEvidenceFixture
    runtime: BrowserRuntime
    baseUrl: string
    outputDirectory: string
    runId: string
    distSha256: string
    records: Map<string, M5VisualEvidenceRecord>
    expectedById: ReadonlyMap<string, M5VisualEvidenceExpectedCell>
  }>,
): Promise<void> {
  const failure = input.fixture.failure
  for (const motion of failure.motionModes) {
    let context: BrowserContext | undefined
    let page: Page | undefined
    let sequencePaused = false
    let contextClosePromise: Promise<void> | undefined
    const closeContextOnce = (): Promise<void> => {
      if (contextClosePromise !== undefined) return contextClosePromise
      if (context === undefined) return Promise.resolve()
      contextClosePromise = runM5VisualEvidenceWithTimeout(
        context.close(),
        input.fixture.protocol.timeouts.cleanupMilliseconds,
        'M5_VISUAL_EVIDENCE_CONTEXT_CLEANUP_TIMEOUT',
      )
      return contextClosePromise
    }
    const motionCaseIds = failure.phases.map(
      (phase) => `failure/${motion.id}/${phase}`,
    )
    try {
      context = await createContext(
        input.runtime,
        failure.viewport,
        motion.reducedMotion,
        input.fixture.protocol.timeouts.browserOperationMilliseconds,
      )
      page = await createEvidencePage(
        context,
        input.fixture.protocol.timeouts.browserOperationMilliseconds,
      )
      await page.clock.install({ time: Date.now() })
      const telemetry = createTelemetry(page)
      let interceptedBodySha256 = ''
      await page.route(
        `**/config/materials/${failure.materialDefinitionId}.json`,
        async (route) => {
          const response = await route.fetch()
          const source = (await response.json()) as Record<string, unknown>
          const modified = {
            ...source,
            targetPearlCount: failure.interceptedTargetPearlCount,
          }
          const body = JSON.stringify(modified)
          interceptedBodySha256 = sha256M5VisualEvidence(body)
          await route.fulfill({
            response,
            body,
            contentType: 'application/json',
          })
        },
      )
      const timeout =
        input.fixture.protocol.timeouts.browserOperationMilliseconds
      await openM2(page, input.baseUrl, timeout)
      const visionTransformToken = await applyVisionTransform(
        page,
        'normal',
        M5_VISUAL_IDENTITY_COLOR_MATRIX,
      )
      const presentationEvidence = await readFailurePresentationEvidence(
        page,
        motion.reducedMotion,
      )
      await configureM2Fire(
        page,
        failure.fireSourceId,
        failure.fireSize,
        false,
        timeout,
      )
      await page.evaluate(`(() => {
        const api = window.__LIANDAN_M2__;
        if (!api) throw new Error('M5_VISUAL_EVIDENCE_M2_API_MISSING');
        api.preselectMaterial(${JSON.stringify(failure.materialBatchId)});
        api.addSelectedMaterial();
      })()`)
      await page.waitForFunction(
        'window.__LIANDAN_M2__?.getSnapshot().materialRemaining > 0',
        undefined,
        { timeout },
      )
      await page.locator('[data-m2-stage]').focus()
      let collectorKeyDown = false
      try {
        await page.keyboard.down(failure.collectorMoveKey)
        collectorKeyDown = true
        await page.waitForTimeout(failure.collectorMoveMilliseconds)
      } finally {
        if (collectorKeyDown) {
          await page.keyboard.up(failure.collectorMoveKey)
        }
      }
      await page.waitForTimeout(failure.collectorSettleMilliseconds)
      const direction = input.fixture.fire.directions.find(
        ({ id }) => id === 'center',
      )!
      await aimAtLogicalPoint(page, direction.logicalTarget)
      await acquirePageClockPause(page, input.fixture)
      sequencePaused = true
      await page.mouse.down()
      try {
        await advanceToFailurePhaseTarget(
          page,
          input.fixture,
          'trigger',
          presentationEvidence.thresholds,
          input.fixture.protocol.timeouts.failureTriggerMilliseconds,
        )
      } finally {
        await page.mouse.up()
      }
      const sequencePage = page

      for (const phase of failure.phases) {
        const caseId = `failure/${motion.id}/${phase}`
        try {
          const shouldWaitForTarget =
            phase === 'charring' ||
            phase === 'shattering' ||
            phase === 'gathering' ||
            phase === 'flying' ||
            phase === 'result'
          if (shouldWaitForTarget) {
            await advanceToFailurePhaseTarget(
              page,
              input.fixture,
              phase,
              presentationEvidence.thresholds,
              input.fixture.protocol.timeouts.failurePhaseMilliseconds,
            )
          }
          const record = await capturePage(
            {
              page,
              telemetry,
              runtime: input.runtime,
              viewport: failure.viewport,
              screenshotMode: failure.screenshotMode,
              reducedMotion: motion.reducedMotion,
              visionMode: 'normal',
              colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
              caseId,
              outputDirectory: input.outputDirectory,
              runId: input.runId,
              distSha256: input.distSha256,
              seed: input.fixture.protocol.deterministicSeed,
              clockCapture: {
                mode: 'sequence-held',
                installed: true,
                paused: true,
                visionTransformToken,
                resumeOwner: 'sequence-finally',
                maximumCaptureMilliseconds:
                  input.fixture.protocol.clock.maximumCaptureMilliseconds,
              },
              checks: [
                {
                  id: 'failure-fixture-route-override-observed',
                  passed:
                    interceptedBodySha256.length === 64 &&
                    failure.interceptedTargetPearlCount > 0,
                  actual: `${interceptedBodySha256}/${failure.interceptedTargetPearlCount}`,
                  expected: 'sha256/positive-target-count',
                },
              ],
              prepareChecks: async (state) => [
                failurePhaseTargetCheck(
                  phase,
                  presentationEvidence.thresholds,
                  state,
                ),
                ...(phase === 'result'
                  ? await failureResultUiChecks(sequencePage)
                  : []),
              ],
              prepareBefore: () =>
                readFailureCaptureState({
                  page: sequencePage,
                  failure,
                  interceptedBodySha256,
                  presentationEvidence,
                }),
              captureBoundary: {
                readAfter: () =>
                  readFailureCaptureState({
                    page: sequencePage,
                    failure,
                    interceptedBodySha256,
                    presentationEvidence,
                  }),
                checks: (before, after) =>
                  createM5VisualFailurePhaseChecks({
                    phase,
                    thresholds: presentationEvidence.thresholds,
                    before: failureObservation(before),
                    after: failureObservation(after),
                  }),
              },
            },
            expectedCell(input.expectedById, caseId),
          )
          input.records.set(caseId, record)
        } catch (error) {
          markFailed(input.records, input.expectedById, caseId, error)
          if (requiresM5VisualContextQuarantine(error)) throw error
        }
      }
      const capturedSequence = failure.phases.map((phase) => {
        const caseId = `failure/${motion.id}/${phase}`
        const record = input.records.get(caseId)
        if (record?.status !== 'captured') {
          throw new Error(
            `M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_CAPTURE_MISSING:${caseId}`,
          )
        }
        return {
          phase,
          failurePresentationState: String(
            record.context.observableState?.failurePresentationState ?? '',
          ),
          failurePresentationProgress: Number(
            record.context.observableState?.failurePresentationProgress ??
              Number.NaN,
          ),
          failurePresentationComplete:
            record.context.observableState?.failurePresentationComplete ===
            true,
          sha256: record.artifact.sha256,
        }
      })
      const uniqueFailurePngHashes = new Set(
        capturedSequence.map(({ sha256 }) => sha256),
      )
      if (uniqueFailurePngHashes.size !== capturedSequence.length) {
        throw new Error('M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_PNG_REUSED')
      }
      assertM5VisualFailureCaptureSequence(capturedSequence)
    } catch (error) {
      for (const caseId of motionCaseIds) {
        markPlaceholderFailed(input.records, input.expectedById, caseId, error)
      }
    } finally {
      const cleanupErrors: unknown[] = []
      if (page !== undefined && sequencePaused) {
        try {
          await runM5VisualEvidenceWithTimeout(
            page.clock.resume(),
            input.fixture.protocol.clock.resumeReserveMilliseconds,
            'M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_CLOCK_RESUME_TIMEOUT',
          )
        } catch (error) {
          cleanupErrors.push(error)
        } finally {
          sequencePaused = false
        }
      }
      try {
        await closeContextOnce()
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          'M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_CLEANUP_FAILED',
          { cause: cleanupErrors[0] },
        )
      }
    }
  }
}

function automatedGate(
  records: readonly M5VisualEvidenceRecord[],
  fatalErrors: readonly unknown[],
  browsers: readonly EvidenceManifest['browsers'][number][],
): EvidenceManifest['automatedGate'] {
  const captured = records.filter(
    (record): record is M5VisualEvidenceCaptureRecord =>
      record.status === 'captured',
  )
  const manualBlockedCount = records.filter(
    ({ status }) => status === 'manual-blocked',
  ).length
  const failedCount = records.filter(({ status }) => status === 'failed').length
  const allCapturedChecksPassed = captured.every(
    ({ context }) =>
      checksPassed(context.checks) &&
      context.consoleErrors.length === 0 &&
      context.pageErrors.length === 0 &&
      context.requestErrors.length === 0,
  )
  const browserLaunchAuditPassed =
    evaluateM5VisualEvidenceBrowserLaunchAudit(browsers) &&
    browsers.every(({ launchArgs, audioMutedByBrowser }) => {
      const mutedByExactLaunchArgs =
        m5VisualBrowserAudioMutedByLaunchArgs(launchArgs)
      return (
        mutedByExactLaunchArgs && audioMutedByBrowser === mutedByExactLaunchArgs
      )
    })
  const passed =
    fatalErrors.length === 0 &&
    manualBlockedCount === 0 &&
    failedCount === 0 &&
    allCapturedChecksPassed &&
    browserLaunchAuditPassed
  return {
    capturedCount: captured.length,
    manualBlockedCount,
    failedCount,
    allCapturedChecksPassed,
    browserLaunchAuditPassed,
    passed,
    statusZh: passed
      ? '自动证据门禁通过；仍必须等待独立 reviewer 与用户人工确认。'
      : '候选证据未通过自动门禁；不得宣称 M5 完成或进入 M6。',
  }
}

function buildReportMarkdown(manifest: EvidenceManifest): string {
  const failed = manifest.records.filter(({ status }) => status === 'failed')
  const blocked = manifest.records.filter(
    ({ status }) => status === 'manual-blocked',
  )
  const checkFailures = manifest.records.flatMap((record) =>
    record.status !== 'captured'
      ? []
      : record.context.checks
          .filter(({ passed }) => !passed)
          .map(
            (check) =>
              `${record.caseId} / ${check.id}: ${String(check.actual)}`,
          ),
  )
  return `# M5 正式视觉证据自动验收报告

- 运行 ID：${manifest.runId}
- 开始时间：${manifest.startedAt}
- 结束时间：${manifest.finishedAt ?? '未结束'}
- production dist SHA256：${manifest.build?.distSha256 ?? '未生成'}
- Git：${manifest.git.commit}（${manifest.git.branch || '(detached)'}，dirty=${String(manifest.git.dirty)}）
- Headed 浏览器静音启动参数审计：${manifest.automatedGate.browserLaunchAuditPassed ? '通过（每个 runtime 均由 exact launch args 派生 provenance）' : '证据不完整'}
- 期望格：${manifest.expectedCaseIds.length}
- 已捕获：${manifest.automatedGate.capturedCount}
- 人工阻塞：${manifest.automatedGate.manualBlockedCount}
- 失败：${manifest.automatedGate.failedCount}
- 自动门禁：${manifest.automatedGate.passed ? '通过' : '未通过'}
- 独立 reviewer / 用户结论：pending / pending

> ${manifest.disclaimerZh}

## 人工阻塞

${blocked.length === 0 ? '- 无' : blocked.map((record) => `- ${record.caseId}：${record.status === 'manual-blocked' ? record.reasonZh : ''}`).join('\n')}

## 捕获失败

${failed.length === 0 ? '- 无' : failed.map((record) => `- ${record.caseId}：${record.status === 'failed' ? record.reasonZh : ''}`).join('\n')}

## 自动检查未通过

${checkFailures.length === 0 ? '- 无' : checkFailures.map((failure) => `- ${failure}`).join('\n')}

## 致命错误

${manifest.fatalErrors.length === 0 ? '- 无' : manifest.fatalErrors.map((error) => `- [${error.stage}] ${error.name}: ${error.message}`).join('\n')}

## 结论边界

本报告只能生成候选证据。脚本不能、也不会把独立 reviewer 或用户结论写成通过；人工结论保持 pending 时，不得进入 M6。
`
}

function writeEmergencyAuditArtifacts(error: unknown, stage: string): void {
  mkdirSync(RUN_OUTPUT_DIRECTORY, { recursive: true })
  const fatalErrors = [serializeError(error, stage)]
  const manifest: EvidenceManifest = {
    reportVersion: 1,
    evidenceKind: 'm5-formal-visual-candidate',
    disclaimerZh:
      '本采集器在正式采集前发生致命错误；该审计只能证明失败被记录，不构成任何视觉通过证据。',
    runId: RUN_ID,
    startedAt: RUN_STARTED.toISOString(),
    finishedAt: new Date().toISOString(),
    outputDirectory: RUN_OUTPUT_DIRECTORY,
    fixture: {
      relativePath: 'public/config/evidence/m5-visual-matrix.json',
      schemaRelativePath: 'schemas/config/m5-visual-evidence.schema.json',
      sourceSha256: 'unavailable',
    },
    git: {
      commit: 'unavailable',
      branch: 'unavailable',
      dirty: true,
      status: 'audit-aborted-before-git-metadata',
    },
    browsers: [],
    expectedCaseIds: [],
    records: [],
    fatalErrors,
    automatedGate: automatedGate([], fatalErrors, []),
    manualReview: createPendingM5VisualManualReview(),
  }
  writeM5VisualEvidenceFileAtomically(
    resolve(RUN_OUTPUT_DIRECTORY, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  writeM5VisualEvidenceFileAtomically(
    resolve(RUN_OUTPUT_DIRECTORY, '自动验收报告.md'),
    buildReportMarkdown(manifest),
  )
}

async function closeBrowsers(
  runtimes: ReadonlyMap<string, BrowserRuntime>,
  timeoutMilliseconds: number,
): Promise<void> {
  const errors: unknown[] = []
  for (const runtime of runtimes.values()) {
    try {
      await runM5VisualEvidenceWithTimeout(
        runtime.browser.close(),
        timeoutMilliseconds,
        `M5_VISUAL_EVIDENCE_BROWSER_CLEANUP_TIMEOUT:${runtime.fixture.id}`,
      )
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      'M5_VISUAL_EVIDENCE_BROWSER_CLEANUP_FAILED',
    )
  }
}

async function main(): Promise<void> {
  const started = RUN_STARTED
  const runId = RUN_ID
  const outputDirectory = RUN_OUTPUT_DIRECTORY
  mkdirSync(resolve(outputDirectory, 'raw'), { recursive: true })
  mkdirSync(resolve(outputDirectory, 'contact-sheets'), { recursive: true })
  let earlyStage = 'fixture-read'
  let early:
    | Readonly<{
        fixtureSource: string
        fixture: M5VisualEvidenceFixture
        expected: readonly M5VisualEvidenceExpectedCell[]
        git: EvidenceManifest['git']
        port: number
      }>
    | undefined
  try {
    const fixtureSource = readFileSync(FIXTURE_PATH, 'utf8')
    earlyStage = 'schema-read'
    const schemaSource = readFileSync(SCHEMA_PATH, 'utf8')
    earlyStage = 'fixture-parse'
    const fixture = parseAndValidateM5VisualEvidenceFixtureJson(
      fixtureSource,
      schemaSource,
    )
    earlyStage = 'matrix-expand'
    const expected = expandM5VisualEvidenceMatrix(fixture)
    earlyStage = 'git-metadata'
    const earlyMetadata = { git: gitMetadata() }
    earlyStage = 'port-config'
    const port = readPort(
      process.env.M5_VISUAL_EVIDENCE_PORT,
      fixture.protocol.defaultPort,
    )
    early = {
      fixtureSource,
      fixture,
      expected,
      git: earlyMetadata.git,
      port,
    }
  } catch (error) {
    writeEmergencyAuditArtifacts(error, earlyStage)
    process.exitCode = 1
    return
  }
  const { fixtureSource, fixture, expected, git, port } = early
  const browserLaunchArgs = Object.freeze([
    ...fixture.protocol.browserLaunchArgs,
  ])
  const expectedById = new Map(expected.map((cell) => [cell.id, cell]))
  const records = recordMapFromExpected(expected)
  const fatalErrors: ReturnType<typeof serializeError>[] = []
  const baseUrl = `http://${fixture.protocol.host}:${port}`
  const distDirectory = resolve(outputDirectory, 'production-dist')
  const buildLogPath = resolve(outputDirectory, 'production-build.log')
  const previewStdoutPath = resolve(outputDirectory, 'preview.stdout.log')
  const previewStderrPath = resolve(outputDirectory, 'preview.stderr.log')
  const fixtureSourceSha256 = sha256M5VisualEvidence(fixtureSource)
  const runtimes = new Map<string, BrowserRuntime>()
  let preview:
    | Readonly<{
        child: ChildProcessWithoutNullStreams
        stdout: () => string
        stderr: () => string
      }>
    | undefined
  let distSha256 = ''
  let bindingRelativePath = 'm5-evidence-binding.json'
  let bindingBody = ''
  let servedBindingBody = ''
  let builtFixtureSha256: string | undefined
  let servedFixtureSha256: string | undefined
  let previewExitedAfterCleanup = false
  let portReleasedAfterCleanup = false

  const manifest: EvidenceManifest = {
    reportVersion: 1,
    evidenceKind: 'm5-formal-visual-candidate',
    disclaimerZh:
      '本采集器只生成 production 候选证据；任何缺格、自动检查失败、manual-blocked 或人工 pending 都会阻止 M5 完成声明。',
    runId,
    startedAt: started.toISOString(),
    outputDirectory,
    fixture: {
      relativePath: 'public/config/evidence/m5-visual-matrix.json',
      schemaRelativePath: 'schemas/config/m5-visual-evidence.schema.json',
      sourceSha256: fixtureSourceSha256,
    },
    git,
    browsers: [],
    expectedCaseIds: expected.map(({ id }) => id),
    records: [],
    fatalErrors,
    automatedGate: automatedGate([], fatalErrors, []),
    manualReview: createPendingM5VisualManualReview(),
  }

  let captureStage = 'port-probe'
  try {
    await assertPortAvailable(
      fixture.protocol.host,
      port,
      fixture.protocol.timeouts.cleanupMilliseconds,
    )
    captureStage = 'production-build'
    const buildLog = buildProduction(
      distDirectory,
      fixture.protocol.timeouts.buildMilliseconds,
    )
    writeM5VisualEvidenceFileAtomically(buildLogPath, buildLog)
    bindingBody = JSON.stringify({
      evidenceKind: manifest.evidenceKind,
      runId,
      sourceFixtureSha256: fixtureSourceSha256,
    })
    writeM5VisualEvidenceFileAtomically(
      resolve(distDirectory, bindingRelativePath),
      bindingBody,
    )
    distSha256 = hashDirectory(distDirectory)
    const builtFixturePath = resolve(
      distDirectory,
      'config',
      'evidence',
      'm5-visual-matrix.json',
    )
    if (!existsSync(builtFixturePath)) {
      throw new Error('M5_VISUAL_EVIDENCE_BUILT_FIXTURE_MISSING')
    }
    builtFixtureSha256 = sha256M5VisualEvidence(readFileSync(builtFixturePath))
    if (builtFixtureSha256 !== fixtureSourceSha256) {
      throw new Error('M5_VISUAL_EVIDENCE_BUILT_FIXTURE_HASH_MISMATCH')
    }
    manifest.build = {
      distDirectory,
      distSha256,
      indexMtimeIso: statSync(
        resolve(distDirectory, 'index.html'),
      ).mtime.toISOString(),
      buildLogRelativePath: relative(outputDirectory, buildLogPath).replaceAll(
        '\\',
        '/',
      ),
    }
    manifest.fixture = {
      ...manifest.fixture,
      builtSha256: builtFixtureSha256,
    }

    captureStage = 'preview-start'
    preview = startPreview(fixture.protocol.host, port, distDirectory)
    servedBindingBody = await waitForPreview(
      preview.child,
      new URL(`/${bindingRelativePath}`, baseUrl).toString(),
      bindingBody,
      fixture.protocol.timeouts.previewReadyMilliseconds,
    )
    const servedFixtureResponse = await fetch(
      new URL('/config/evidence/m5-visual-matrix.json', baseUrl),
      { cache: 'no-store', signal: AbortSignal.timeout(2_000) },
    )
    if (!servedFixtureResponse.ok) {
      throw new Error(
        `M5_VISUAL_EVIDENCE_SERVED_FIXTURE_HTTP_${servedFixtureResponse.status}`,
      )
    }
    servedFixtureSha256 = sha256M5VisualEvidence(
      new Uint8Array(await servedFixtureResponse.arrayBuffer()),
    )
    if (servedFixtureSha256 !== fixtureSourceSha256) {
      throw new Error('M5_VISUAL_EVIDENCE_SERVED_FIXTURE_HASH_MISMATCH')
    }
    manifest.fixture = {
      ...manifest.fixture,
      servedSha256: servedFixtureSha256,
    }

    for (const browserFixture of fixture.layout.browsers) {
      try {
        if (!browserLaunchArgs.includes('--mute-audio')) {
          throw new Error('M5_VISUAL_EVIDENCE_BROWSER_MUTE_ARG_MISSING')
        }
        const browser = await runM5VisualEvidenceWithTimeout(
          chromium.launch({
            channel: browserFixture.channel,
            headless: false,
            args: [...browserLaunchArgs],
          }),
          fixture.protocol.timeouts.browserOperationMilliseconds,
          `M5_VISUAL_EVIDENCE_BROWSER_LAUNCH_TIMEOUT:${browserFixture.id}`,
          async (lateBrowser) => lateBrowser.close(),
          M5_VISUAL_LATE_CLEANUPS,
        )
        const runtime: BrowserRuntime = {
          fixture: browserFixture,
          browser,
          version: browser.version(),
          launchArgs: browserLaunchArgs,
          audioMutedByBrowser:
            m5VisualBrowserAudioMutedByLaunchArgs(browserLaunchArgs),
        }
        runtimes.set(browserFixture.id, runtime)
        manifest.browsers.push({
          id: browserFixture.id,
          channel: browserFixture.channel,
          engine: 'chromium',
          version: runtime.version,
          headed: true,
          launchArgs: runtime.launchArgs,
          audioMutedByBrowser: runtime.audioMutedByBrowser,
        })
      } catch (error) {
        fatalErrors.push(
          serializeError(error, `browser-launch:${browserFixture.id}`),
        )
      }
    }

    captureStage = 'layout-capture'
    await runLayoutMatrix({
      fixture,
      runtimes,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })

    const fireRuntime = runtimes.get(fixture.fire.browserId)
    if (fireRuntime === undefined) {
      throw new Error(
        `M5_VISUAL_EVIDENCE_REQUIRED_BROWSER_UNAVAILABLE:${fixture.fire.browserId}`,
      )
    }
    captureStage = 'fire-matrix-capture'
    await runFireMatrix({
      fixture,
      runtime: fireRuntime,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })
    captureStage = 'fire-phase-capture'
    await runFirePhaseTrace({
      fixture,
      runtime: fireRuntime,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })
    captureStage = 'coverage-capture'
    await runCoverageCases({
      fixture,
      runtime: fireRuntime,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })
    captureStage = 'accessibility-capture'
    await runAccessibilityCases({
      fixture,
      runtime: fireRuntime,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })
    captureStage = 'failure-capture'
    await runFailureCases({
      fixture,
      runtime: fireRuntime,
      baseUrl,
      outputDirectory,
      runId,
      distSha256,
      records,
      expectedById,
    })
  } catch (error) {
    fatalErrors.push(serializeError(error, captureStage))
  } finally {
    try {
      await closeBrowsers(
        runtimes,
        fixture.protocol.timeouts.cleanupMilliseconds,
      )
    } catch (error) {
      fatalErrors.push(serializeError(error, 'browser-cleanup'))
    }
    try {
      await stopPreview(
        preview?.child,
        fixture.protocol.timeouts.cleanupMilliseconds,
      )
      previewExitedAfterCleanup =
        preview === undefined ||
        preview.child.exitCode !== null ||
        preview.child.signalCode !== null
    } catch (error) {
      fatalErrors.push(serializeError(error, 'preview-cleanup'))
    }
    try {
      await drainM5VisualLateCleanupRegistry(
        M5_VISUAL_LATE_CLEANUPS,
        fixture.protocol.timeouts.lateCleanupDrainMilliseconds,
      )
    } catch (error) {
      fatalErrors.push(serializeError(error, 'late-resource-cleanup'))
    }
    if (preview !== undefined) {
      try {
        writeM5VisualEvidenceFileAtomically(previewStdoutPath, preview.stdout())
        writeM5VisualEvidenceFileAtomically(previewStderrPath, preview.stderr())
      } catch (error) {
        fatalErrors.push(
          serializeError(
            new Error('M5_VISUAL_EVIDENCE_PREVIEW_LOG_WRITE_FAILED', {
              cause: error,
            }),
            'preview-log-write',
          ),
        )
      }
    }
    try {
      await assertPortAvailable(
        fixture.protocol.host,
        port,
        fixture.protocol.timeouts.cleanupMilliseconds,
      )
      portReleasedAfterCleanup = true
    } catch (error) {
      fatalErrors.push(serializeError(error, 'port-release-probe'))
    }
  }

  if (preview !== undefined) {
    manifest.preview = {
      baseUrl,
      port,
      pid: preview.child.pid ?? null,
      bindingRelativePath,
      bindingSha256: sha256M5VisualEvidence(bindingBody),
      servedBindingSha256: sha256M5VisualEvidence(servedBindingBody),
      exitedAfterCleanup: previewExitedAfterCleanup,
      portReleasedAfterCleanup,
    }
  }
  manifest.finishedAt = new Date().toISOString()
  manifest.records = expected.map(({ id }) => records.get(id)!)
  try {
    assertM5VisualEvidenceCellCoverage(expected, manifest.records)
    for (const record of manifest.records) {
      if (record.status === 'captured') {
        validateM5VisualEvidenceCaptureRecord(record, outputDirectory)
      }
    }
    assertM5VisualManualReviewPending(manifest.manualReview)
  } catch (error) {
    fatalErrors.push(serializeError(error, 'final-validation'))
  }
  manifest.automatedGate = automatedGate(
    manifest.records,
    fatalErrors,
    manifest.browsers,
  )
  const manifestPath = resolve(outputDirectory, 'manifest.json')
  const reportPath = resolve(outputDirectory, '自动验收报告.md')
  const artifactWriteErrors: unknown[] = []
  try {
    writeM5VisualEvidenceFileAtomically(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  } catch (error) {
    fatalErrors.push(serializeError(error, 'manifest-write'))
    artifactWriteErrors.push(error)
  }
  try {
    writeM5VisualEvidenceFileAtomically(
      reportPath,
      buildReportMarkdown(manifest),
    )
  } catch (error) {
    fatalErrors.push(serializeError(error, 'report-write'))
    artifactWriteErrors.push(error)
  }
  if (artifactWriteErrors.length > 0) {
    manifest.automatedGate = automatedGate(
      manifest.records,
      fatalErrors,
      manifest.browsers,
    )
    writeM5VisualEvidenceFileAtomically(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    writeM5VisualEvidenceFileAtomically(
      reportPath,
      buildReportMarkdown(manifest),
    )
  }
  console.log(
    `M5 正式视觉证据候选已写入 ${outputDirectory}：captured=${manifest.automatedGate.capturedCount}，manual-blocked=${manifest.automatedGate.manualBlockedCount}，failed=${manifest.automatedGate.failedCount}，manualReview=pending`,
  )
  if (!manifest.automatedGate.passed) process.exitCode = 1
}

void main().catch((error: unknown) => {
  try {
    writeEmergencyAuditArtifacts(error, 'top-level-unhandled')
  } catch (fallbackError) {
    console.error(
      'M5_VISUAL_EVIDENCE_EMERGENCY_AUDIT_WRITE_FAILED',
      serializeError(fallbackError, 'emergency-audit-write'),
    )
  }
  process.exitCode = 1
})
