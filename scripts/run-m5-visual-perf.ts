import { randomUUID, createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { cpus, arch, platform, release, totalmem } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import type {
  M5VisualPerformanceFixture,
  M5VisualPerformanceScenario,
} from '../src/config/m5-visual-performance-fixture.ts'
import type {
  M5VisualPerformanceSnapshot,
} from '../src/game/m5-performance/contracts.ts'
import {
  M5_APP_ALLOCATION_KINDS,
  deriveExpectedM5PearlTextureStyleCount,
  evaluateM5VisualPerformanceGate,
  summarizeM5VisualPerformanceSample,
  type M5VisualPerformanceGate,
  type M5VisualPerformanceSummary,
} from '../src/game/m5-performance/m5-visual-performance-metrics.ts'
import {
  assertM5VisualTcpPortAvailable,
  assertM5VisualBuildArtifact,
  buildM5VisualScenarioUrl,
  cleanupM5VisualRunResources,
  evaluateM5VisualForegroundLifecycle,
  evaluateM5VisualRunOutcome,
  hasM5VisualChildExited,
  M5_VISUAL_COLLECT_FOREGROUND_SCRIPT,
  M5_VISUAL_INSTALL_FOREGROUND_SCRIPT,
  M5_VISUAL_OPERATION_TIMEOUTS,
  m5VisualBrowserAudioMutedByLaunchArgs,
  parseAndValidateM5VisualFixtureJson,
  resolveM5VisualRunTiming,
  runM5VisualOperationWithTimeout,
  runM5VisualSampleWithTimeout,
  serializeM5VisualError as serializeError,
  sha256,
  stopM5VisualPreview,
  writeM5VisualFileAtomically,
  type M5VisualSerializedError,
  type M5VisualRunTiming,
} from './m5-visual-perf-support.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'output', 'performance', 'm5-visual')
const HOST = '127.0.0.1'
const DEFAULT_PORT = 4_185
const REQUIRED_SCENARIO_IDS = ['visual-normal', 'visual-stress'] as const
const SAMPLE_TIMEOUT_MARGIN_MILLISECONDS = 10_000
const M5_VISUAL_BROWSER_LAUNCH_ARGS = Object.freeze([
  '--force-device-scale-factor=1',
  '--mute-audio',
])

function configuredPearlTextureStyleCount(configRoot: string): number {
  const readJson = (relativePath: string): unknown =>
    JSON.parse(readFileSync(resolve(configRoot, relativePath), 'utf8'))
  const m2Manifest = readJson('config/m2-config-set.json') as {
    baseConfigSet: string
    pearlTypes: string
  }
  const baseManifest = readJson(
    m2Manifest.baseConfigSet.replace(/^\/+/, ''),
  ) as { materials: readonly string[] }
  const materialDefinitionIds = baseManifest.materials.map((path) => {
    const material = readJson(path.replace(/^\/+/, '')) as { id: string }
    return material.id
  })
  const pearlTypeDocument = readJson(
    m2Manifest.pearlTypes.replace(/^\/+/, ''),
  ) as { pearlTypes: readonly { pearlType: 'medicinalLiquid' | 'slag' | 'impurity' }[] }
  return deriveExpectedM5PearlTextureStyleCount({
    materialDefinitionIds,
    pearlTypes: pearlTypeDocument.pearlTypes.map(({ pearlType }) => pearlType),
  })
}

type EvidenceCheck = Readonly<{
  id: string
  passed: boolean
  actual: string | number | boolean
  expected: string | number | boolean
}>

type SerializedError = M5VisualSerializedError

type ScenarioReport = Readonly<{
  scenarioId: string
  formal: boolean
  passed: boolean
  url: string
  screenshotPath: string
  rawSamplePath: string
  failureSnapshotPath?: string
  environmentChecks: readonly EvidenceCheck[]
  before: M5VisualPerformanceSnapshot
  after: M5VisualPerformanceSnapshot
  summary: M5VisualPerformanceSummary
  gate: M5VisualPerformanceGate
  consoleErrors: readonly string[]
  pageErrors: readonly SerializedError[]
  failedRequests: readonly string[]
  failedResponses: readonly string[]
}>

type RunReport = {
  reportVersion: 1
  benchmarkKind: 'presentation-only'
  disclaimerZh: string
  startedAt: string
  finishedAt?: string
  outputDirectory: string
  formal: boolean
  timing?: M5VisualRunTiming
  fixture?: Readonly<{
    path: string
    schemaPath: string
    sha256: string
    scenarioIds: readonly string[]
    simulationContentFingerprint?: string
    presentationContentFingerprint?: string
  }>
  build?: Readonly<{
    distDirectory: string
    distContentSha256: string
    indexMtimeIso: string
    manifestPath: string
    runId: string
    sourceFixtureSha256: string
    builtFixtureSha256: string
    servedFixtureSha256?: string
  }>
  git?: Readonly<{
    commit: string
    branch: string
    dirty: boolean
    status: string
  }>
  machine?: Readonly<{
    platform: string
    release: string
    arch: string
    cpuModel: string
    logicalCpuCount: number
    totalMemoryBytes: number
    gpu: unknown
  }>
  browser?: Readonly<{
    engine: 'chromium'
    headed: true
    version: string
    executablePath: string
    playwrightVersion: string
    viewport: Readonly<{ width: number; height: number }>
    deviceScaleFactor: 1
    audioMutedByBrowser: boolean
    launchArgs: readonly string[]
  }>
  preview?: Readonly<{
    url: string
    port: number
    pid: number | null
    bindingPath: string
    bindingBodySha256: string
    servedBindingBodySha256: string
    bindingPassed: boolean
    stdout: string
    stderr: string
    exitedAfterCleanup: boolean
  }>
  scenarios: ScenarioReport[]
  fatalErrors: SerializedError[]
  executionPassed: boolean
  formalGatePassed: boolean | null
}

function timestampDirectoryName(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function readPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('M5_VISUAL_PERF_PORT_INVALID')
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('M5_VISUAL_PERF_PORT_INVALID')
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

function computeDistHash(directory: string): string {
  const hash = createHash('sha256')
  hash.update('LIANDAN_M5_VISUAL_DIST_V1\0')
  const files = listFiles(directory).sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  for (const filePath of files) {
    const path = relative(directory, filePath).replaceAll('\\', '/')
    const bytes = readFileSync(filePath)
    hash.update(path, 'utf8')
    hash.update('\0')
    hash.update(String(bytes.byteLength), 'utf8')
    hash.update('\0')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

function gitText(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
}

function playwrightVersion(): string {
  const packagePath = resolve(
    REPOSITORY_ROOT,
    'node_modules',
    '@playwright',
    'test',
    'package.json',
  )
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
  }
  return parsed.version
}

function viteEntryPath(): string {
  return resolve(
    REPOSITORY_ROOT,
    'node_modules',
    'vite',
    'bin',
    'vite.js',
  )
}

function buildProduction(distDirectory: string): string {
  return execFileSync(
    process.execPath,
    [
      viteEntryPath(),
      'build',
      '--outDir',
      distDirectory,
      '--emptyOutDir',
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
      timeout: M5_VISUAL_OPERATION_TIMEOUTS.buildMilliseconds,
    },
  )
}

function startPreview(port: number, distDirectory: string): Readonly<{
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
      HOST,
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

async function waitForBinding(
  child: ChildProcessWithoutNullStreams,
  url: string,
  expectedBody: string,
): Promise<string> {
  const deadline = Date.now() + 20_000
  let lastError = 'not-started'
  while (Date.now() < deadline) {
    if (hasM5VisualChildExited(child)) {
      throw new Error(
        `M5_VISUAL_PREVIEW_EXITED:exitCode=${String(child.exitCode)}:signalCode=${String(child.signalCode)}`,
      )
    }
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(
          M5_VISUAL_OPERATION_TIMEOUTS.bindingFetchMilliseconds,
        ),
      })
      const body = await response.text()
      if (response.ok && body === expectedBody) return body
      lastError = `HTTP ${response.status} body=${sha256(body)}`
    } catch (error) {
      lastError = serializeError(error).message
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`M5_VISUAL_PREVIEW_BINDING_TIMEOUT:${lastError}`)
}

async function environmentChecks(
  page: Page,
  fixture: M5VisualPerformanceFixture,
  scenario: M5VisualPerformanceScenario,
): Promise<EvidenceCheck[]> {
  const evidence = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const bounds = canvas?.getBoundingClientRect()
    const snapshot = window.__LIANDAN_M5_PERFORMANCE__?.snapshot()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewportScale: window.visualViewport?.scale ?? 1,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      bodyState: document.body.dataset.appState ?? '',
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      canvasCssWidth: bounds?.width ?? 0,
      canvasCssHeight: bounds?.height ?? 0,
      snapshot,
    }
  })
  const protocol = fixture.protocol
  const snapshot = evidence.snapshot
  const checks: EvidenceCheck[] = [
    {
      id: 'viewport-width',
      passed: evidence.innerWidth === protocol.viewportWidth,
      actual: evidence.innerWidth,
      expected: protocol.viewportWidth,
    },
    {
      id: 'viewport-height',
      passed: evidence.innerHeight === protocol.viewportHeight,
      actual: evidence.innerHeight,
      expected: protocol.viewportHeight,
    },
    {
      id: 'device-scale-factor',
      passed: Math.abs(evidence.devicePixelRatio - protocol.deviceScaleFactor) <= 1e-6,
      actual: evidence.devicePixelRatio,
      expected: protocol.deviceScaleFactor,
    },
    {
      id: 'browser-zoom',
      passed: Math.abs(evidence.visualViewportScale - 1) <= 1e-6,
      actual: evidence.visualViewportScale,
      expected: 1,
    },
    {
      id: 'foreground-visible',
      passed: evidence.visibilityState === 'visible',
      actual: evidence.visibilityState,
      expected: 'visible',
    },
    {
      id: 'foreground-focused',
      passed: evidence.hasFocus,
      actual: evidence.hasFocus,
      expected: true,
    },
    {
      id: 'app-ready',
      passed: evidence.bodyState === 'ready' && snapshot?.ready === true,
      actual: `${evidence.bodyState}/${String(snapshot?.ready)}`,
      expected: 'ready/true',
    },
    {
      id: 'audio-unlocked',
      passed: snapshot !== undefined && snapshot.audio.unlocked === true,
      actual: snapshot?.audio.unlocked ?? false,
      expected: true,
    },
    {
      id: 'audio-unmuted',
      passed: snapshot !== undefined && snapshot.audio.muted === false,
      actual: snapshot?.audio.muted ?? true,
      expected: false,
    },
    {
      id: 'canvas-logical-size',
      passed:
        evidence.canvasWidth === protocol.viewportWidth &&
        evidence.canvasHeight === protocol.viewportHeight,
      actual: `${evidence.canvasWidth}x${evidence.canvasHeight}`,
      expected: `${protocol.viewportWidth}x${protocol.viewportHeight}`,
    },
    {
      id: 'canvas-output-size',
      passed:
        evidence.canvasCssWidth === protocol.viewportWidth &&
        evidence.canvasCssHeight === protocol.viewportHeight,
      actual: `${evidence.canvasCssWidth}x${evidence.canvasCssHeight}`,
      expected: `${protocol.viewportWidth}x${protocol.viewportHeight}`,
    },
    {
      id: 'presentation-only-contract',
      passed:
        snapshot?.benchmarkKind === 'presentation-only' &&
        snapshot.rendererEvidence.proxyPearls === false &&
        snapshot.rendererEvidence.automaticQualityReduction === false,
      actual: `${snapshot?.benchmarkKind}/${String(snapshot?.rendererEvidence.proxyPearls)}/${String(snapshot?.rendererEvidence.automaticQualityReduction)}`,
      expected: 'presentation-only/false/false',
    },
    {
      id: 'active-pearl-count',
      passed: snapshot?.activePearlCount === scenario.activePearlCount,
      actual: snapshot?.activePearlCount ?? -1,
      expected: scenario.activePearlCount,
    },
    {
      id: 'interaction-group-count',
      passed:
        (snapshot?.interactionGroupCount ?? 0) >=
        scenario.thresholds.minimumInteractionGroupCount,
      actual: snapshot?.interactionGroupCount ?? -1,
      expected: `>= ${scenario.thresholds.minimumInteractionGroupCount}`,
    },
  ]
  return checks
}

async function runScenario(input: Readonly<{
  browser: Browser
  baseUrl: string
  outputDirectory: string
  fixture: M5VisualPerformanceFixture
  scenario: M5VisualPerformanceScenario
  timing: M5VisualRunTiming
  expectedPearlTextureStyleCount: number
}>): Promise<ScenarioReport> {
  const context: BrowserContext = await runM5VisualOperationWithTimeout(
    input.browser.newContext({
      viewport: {
        width: input.fixture.protocol.viewportWidth,
        height: input.fixture.protocol.viewportHeight,
      },
      screen: {
        width: input.fixture.protocol.viewportWidth,
        height: input.fixture.protocol.viewportHeight,
      },
      deviceScaleFactor: input.fixture.protocol.deviceScaleFactor,
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
    }),
    M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
    'M5_VISUAL_BROWSER_CONTEXT_CREATE_TIMEOUT',
  )
  context.setDefaultTimeout(
    M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
  )
  context.setDefaultNavigationTimeout(
    M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
  )
  let contextClosePromise: Promise<void> | null = null
  const closeContext = (): Promise<void> => {
    contextClosePromise ??= runM5VisualOperationWithTimeout(
      context.close(),
      M5_VISUAL_OPERATION_TIMEOUTS.contextCleanupMilliseconds,
      'M5_VISUAL_BROWSER_CONTEXT_CLOSE_TIMEOUT',
    )
    return contextClosePromise
  }
  const page = await runM5VisualOperationWithTimeout(
    context.newPage(),
    M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
    'M5_VISUAL_BROWSER_PAGE_CREATE_TIMEOUT',
  )
  const consoleErrors: string[] = []
  const pageErrors: SerializedError[] = []
  const failedRequests: string[] = []
  const failedResponses: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(serializeError(error)))
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`)
    }
  })
  const url = buildM5VisualScenarioUrl(input.baseUrl, input.scenario.id)
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForFunction(
      () =>
        document.body.dataset.appState === 'ready' &&
        window.__LIANDAN_M5_PERFORMANCE__?.snapshot().ready === true,
      undefined,
      { timeout: 30_000 },
    )
    await page.bringToFront()
    await page.locator('canvas').click({ position: { x: 800, y: 450 } })
    await page.evaluate(() =>
      window.__LIANDAN_M5_PERFORMANCE__!.enableAudioAudit(),
    )
    const audioAuditState = await page.evaluate(() =>
      window.__LIANDAN_M5_PERFORMANCE__!.snapshot().audio,
    )
    if (!audioAuditState.unlocked || audioAuditState.muted) {
      throw new Error(
        `M5_VISUAL_AUDIO_AUDIT_NOT_READY:unlocked=${String(audioAuditState.unlocked)}:muted=${String(audioAuditState.muted)}`,
      )
    }
    const beforeWarmupChecks = await environmentChecks(
      page,
      input.fixture,
      input.scenario,
    )
    await page.waitForTimeout(input.timing.warmupMilliseconds)
    await page.bringToFront()
    const before = await page.evaluate(() =>
      window.__LIANDAN_M5_PERFORMANCE__!.snapshot(),
    )
    await page.evaluate(M5_VISUAL_INSTALL_FOREGROUND_SCRIPT)
    const sampleEvaluation = page.evaluate(
      (durationMilliseconds) =>
        window.__LIANDAN_M5_PERFORMANCE__!.startSample(durationMilliseconds),
      input.timing.sampleMilliseconds,
    )
    const sample = await runM5VisualSampleWithTimeout(
      sampleEvaluation,
      input.timing.sampleMilliseconds,
      SAMPLE_TIMEOUT_MARGIN_MILLISECONDS,
      closeContext,
    )
    const foregroundLifecycle = await page.evaluate<{
      blurCount: number
      hiddenCount: number
      finalHasFocus: boolean
      finalVisibilityState: string
    }>(M5_VISUAL_COLLECT_FOREGROUND_SCRIPT)
    const after = await page.evaluate(() =>
      window.__LIANDAN_M5_PERFORMANCE__!.snapshot(),
    )
    const afterChecks = await environmentChecks(
      page,
      input.fixture,
      input.scenario,
    )
    const environment = [
      ...beforeWarmupChecks,
      ...evaluateM5VisualForegroundLifecycle(foregroundLifecycle),
      ...afterChecks,
    ]
    const summary = summarizeM5VisualPerformanceSample(sample)
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: input.scenario.activePearlCount,
      expectedPearlTextureStyleCount:
        input.expectedPearlTextureStyleCount,
      minimumFramesPerCompleteSecond:
        input.scenario.thresholds.minimumFramesPerCompleteSecond,
      minimumInteractionGroupCount:
        input.scenario.thresholds.minimumInteractionGroupCount,
      requiredEffectKinds: input.scenario.requiredEffectKinds,
      maximumDroppedEffectCount:
        input.scenario.thresholds.maximumDroppedEffectCount,
      minimumAudioVoiceHighWaterMark:
        input.scenario.thresholds.minimumAudioVoiceHighWaterMark,
      maximumTrackedFrameAllocationCount:
        input.scenario.thresholds.maximumTrackedFrameAllocationCount,
    })
    const screenshotPath = resolve(
      input.outputDirectory,
      `${input.scenario.id}.png`,
    )
    const rawSamplePath = resolve(
      input.outputDirectory,
      `${input.scenario.id}-raw.json`,
    )
    await runM5VisualOperationWithTimeout(
      page.screenshot({
        path: screenshotPath,
        type: 'png',
        timeout: M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
      }),
      M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
      'M5_VISUAL_SCREENSHOT_TIMEOUT',
    )
    await writeM5VisualFileAtomically(
      rawSamplePath,
      `${JSON.stringify({
        benchmarkKind: 'presentation-only',
        formal: input.timing.formal,
        scenario: input.scenario,
        before,
        after,
        environment,
        sample,
        summary,
        gate,
      }, null, 2)}\n`,
    )
    const passed =
      gate.passed &&
      environment.every((check) => check.passed) &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      failedRequests.length === 0 &&
      failedResponses.length === 0
    let failureSnapshotPath: string | undefined
    if (!passed) {
      failureSnapshotPath = resolve(
        input.outputDirectory,
        `${input.scenario.id}-failure-snapshot.json`,
      )
      await writeM5VisualFileAtomically(
        failureSnapshotPath,
        `${JSON.stringify({ before, after, environment, consoleErrors, pageErrors, failedRequests, failedResponses }, null, 2)}\n`,
      )
    }
    return {
      scenarioId: input.scenario.id,
      formal: input.timing.formal,
      passed,
      url,
      screenshotPath,
      rawSamplePath,
      ...(failureSnapshotPath === undefined ? {} : { failureSnapshotPath }),
      environmentChecks: environment,
      before,
      after,
      summary,
      gate,
      consoleErrors,
      pageErrors,
      failedRequests,
      failedResponses,
    }
  } finally {
    await closeContext()
  }
}

function markdown(report: RunReport): string {
  const lines = [
    '# M5 正式表现性能报告',
    '',
    `- 口径：${report.formal ? '正式门禁' : '烟测（不可作为正式通过证据）'}`,
    `- 类型：presentation-only benchmark，不代表领域规则性能或领域结算结果`,
    `- 开始：${report.startedAt}`,
    `- 结束：${report.finishedAt ?? '未结束'}`,
    `- 构建哈希：${report.build?.distContentSha256 ?? '缺失'}`,
    `- fixture source/build/served：${report.build?.sourceFixtureSha256 ?? '缺失'} / ${report.build?.builtFixtureSha256 ?? '缺失'} / ${report.build?.servedFixtureSha256 ?? '缺失'}`,
    `- Git：${report.git?.commit ?? '缺失'}${report.git?.dirty ? '（工作树有改动）' : ''}`,
    `- 浏览器启动参数静音审计：${report.browser?.engine ?? '缺失'} ${report.browser?.version ?? ''}，headed=${String(report.browser?.headed ?? false)}，provenance=${String(report.browser?.audioMutedByBrowser ?? false)}，args=${report.browser?.launchArgs.join(' ') ?? '缺失'}`,
    `- 总结：${report.executionPassed ? 'PASS' : 'FAIL'}`,
    '',
    '## 场景',
    '',
    '| 场景 | 珠数 | 最低完整秒 FPS | 帧 delta p95/max | 长任务 | pearl pool init/cap/active/high/frame/min/max/texture/growth | effect pool high/cap/max/drop | voice high | Fire粒子 min/max | steam emit/render/high | 局部光 min/max | fight render/high；组 min/max | app-owned allocation total；byKind max | 结果 |',
    '| --- | ---: | ---: | --- | ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
  ]
  for (const scenario of report.scenarios) {
    const summary = scenario.summary
    lines.push(
      `| ${scenario.scenarioId} | ${summary.activePearlCount} | ${summary.minimumFramesPerCompleteSecond} | ${summary.frameDelta.p95Milliseconds.toFixed(3)}/${summary.frameDelta.maxMilliseconds.toFixed(3)} ms | ${summary.longTaskCount} | ${summary.pearlSpritePool.initializedCount}/${summary.pearlSpritePool.capacity}/${summary.pearlSpritePool.activeCount}/${summary.pearlSpritePool.activeHighWaterMark}/${summary.pearlSpritePool.renderedFrameCount}/${summary.pearlSpritePool.minimumRenderedCountPerFrame}/${summary.pearlSpritePool.maximumRenderedCountPerFrame}/${summary.pearlSpritePool.textureCount}/${summary.pearlSpritePool.runtimeStorageGrowthCount} | ${summary.effectPool.highWaterMark}/${summary.effectPool.capacity}/${summary.effectPool.maximumCapacity}/${summary.effectPool.droppedCount} | ${summary.audioVoiceHighWaterMark} | ${summary.presentationEvidence.fire.minimumParticleCount}/${summary.presentationEvidence.fire.maximumParticleCount} | ${summary.effectTotalsByKind.steam.spawnCount}/${summary.effectTotalsByKind.steam.renderCount}/${summary.effectTotalsByKind.steam.activeHighWater} | ${summary.presentationEvidence.localLight.minimumIntensity.toFixed(3)}/${summary.presentationEvidence.localLight.maximumIntensity.toFixed(3)} | ${summary.effectTotalsByKind.fight.renderCount}/${summary.effectTotalsByKind.fight.activeHighWater}；${summary.presentationEvidence.fight.minimumRenderedGroupCount}/${summary.presentationEvidence.fight.maximumRenderedGroupCount} | ${summary.maximumTrackedFrameAllocationCount}；${M5_APP_ALLOCATION_KINDS.map((kind) => `${kind}=${summary.maximumTrackedFrameAllocationByKind[kind]}`).join(',')} | ${scenario.passed ? 'PASS' : 'FAIL'} |`,
    )
    lines.push(
      '',
      `逐秒 FPS：${summary.framesPerCompleteSecond.join(', ')}`,
      '',
      `app-owned coverage：${M5_APP_ALLOCATION_KINDS.map((kind) => `${kind}=${summary.allocationCoverage.byKind[kind]}`).join(', ')}；Phaser=${summary.allocationCoverage.thirdParty.phaserInternal}；WebAudio=${summary.allocationCoverage.thirdParty.webAudioInternal}`,
      '',
      `### ${scenario.scenarioId} 完整秒效果证据`,
      '',
      '| 秒 | steam s/r/a | shield s/r/a | damage s/r/a | fight s/r/a |',
      '| ---: | --- | --- | --- | --- |',
    )
    for (const window of summary.effectSeconds) {
      const value = (kind: keyof typeof window.byKind): string => {
        const counters = window.byKind[kind]
        return `${counters.spawnCount}/${counters.renderCount}/${counters.activeHighWater}`
      }
      lines.push(
        `| ${window.secondIndex} | ${value('steam')} | ${value('shield')} | ${value('damage')} | ${value('fight')} |`,
      )
    }
    lines.push('')
  }
  if (report.fatalErrors.length > 0) {
    lines.push('## 致命错误', '')
    for (const error of report.fatalErrors) lines.push(`- ${error.message}`)
    lines.push('')
  }
  lines.push(
    '## 分配证据口径',
    '',
    'app-owned frame allocation 统计项目显式拥有的 pearl 正式 Sprite/纹理缓存、effect pool 与 audio 合并存储增长，并逐帧保存 total/byKind。Fire 与 local-light 使用预分配稳定缓冲，标记为 audited-allocation-free。Phaser 与 WebAudio 内部分配明确标记为 excluded-not-measured；它们不属于此门禁口径，报告不声称测到了浏览器 GC 字节或第三方引擎内部对象。任一 app-owned 路径 coverage=unsupported 会阻止正式通过。',
    '',
  )
  return `${lines.join('\n')}\n`
}

async function execute(report: RunReport): Promise<void> {
  const fixturePath = resolve(
    REPOSITORY_ROOT,
    'public',
    'config',
    'performance',
    'm5-visual.json',
  )
  const schemaPath = resolve(
    REPOSITORY_ROOT,
    'schemas',
    'config',
    'm5-visual-performance.schema.json',
  )
  const fixtureText = readFileSync(fixturePath, 'utf8')
  const fixture = parseAndValidateM5VisualFixtureJson(
    fixtureText,
    readFileSync(schemaPath, 'utf8'),
  )
  const timing = resolveM5VisualRunTiming(fixture.protocol, process.env)
  const sourcePearlTextureStyleCount = configuredPearlTextureStyleCount(
    resolve(REPOSITORY_ROOT, 'public'),
  )
  report.formal = timing.formal
  report.timing = timing
  report.fixture = {
    path: fixturePath,
    schemaPath,
    sha256: sha256(fixtureText),
    scenarioIds: fixture.scenarios.map(({ id }) => id),
  }
  const status = gitText(['status', '--short'])
  report.git = {
    commit: gitText(['rev-parse', 'HEAD']),
    branch: gitText(['branch', '--show-current']),
    dirty: status.length > 0,
    status,
  }

  const runId = randomUUID()
  const distDirectory = resolve(report.outputDirectory, 'production-dist')
  buildProduction(distDirectory)
  const indexPath = resolve(distDirectory, 'index.html')
  const builtFixturePath = resolve(
    distDirectory,
    'config',
    'performance',
    'm5-visual.json',
  )
  const sourceFixtureSha256 = sha256(fixtureText)
  const builtFixtureText = existsSync(builtFixturePath)
    ? readFileSync(builtFixturePath, 'utf8')
    : ''
  const builtFixtureSha256 =
    builtFixtureText.length === 0 ? '' : sha256(builtFixtureText)

  const distContentSha256 = computeDistHash(distDirectory)
  const builtPearlTextureStyleCount =
    configuredPearlTextureStyleCount(distDirectory)
  if (builtPearlTextureStyleCount !== sourcePearlTextureStyleCount) {
    throw new Error('M5_VISUAL_PEARL_TEXTURE_STYLE_CONFIG_MISMATCH')
  }
  const manifestPath = resolve(report.outputDirectory, 'build-manifest.json')
  const buildManifest = {
    manifestVersion: 1,
    benchmark: 'm5-visual',
    runId,
    sourceFixtureSha256,
    builtFixtureSha256,
    sourcePearlTextureStyleCount,
    builtPearlTextureStyleCount,
    distContentSha256,
  }
  await writeM5VisualFileAtomically(
    manifestPath,
    `${JSON.stringify(buildManifest, null, 2)}\n`,
  )
  assertM5VisualBuildArtifact({
    indexExists: existsSync(indexPath),
    fixtureExists: existsSync(builtFixturePath),
    sourceFixtureSha256,
    builtFixtureSha256,
    manifestSourceFixtureSha256: buildManifest.sourceFixtureSha256,
    manifestBuiltFixtureSha256: buildManifest.builtFixtureSha256,
    manifestDistContentSha256: buildManifest.distContentSha256,
    computedDistContentSha256: distContentSha256,
  })
  report.build = {
    distDirectory,
    distContentSha256,
    indexMtimeIso: statSync(indexPath).mtime.toISOString(),
    manifestPath,
    runId,
    sourceFixtureSha256,
    builtFixtureSha256,
  }

  const port = readPort(process.env.M5_VISUAL_PERF_PORT)
  await assertM5VisualTcpPortAvailable(HOST, port)
  const baseUrl = `http://${HOST}:${port}`
  const bindingName = `m5-visual-run-${randomUUID()}.json`
  const bindingPath = resolve(distDirectory, bindingName)
  const bindingBody = JSON.stringify({
    benchmark: 'm5-visual',
    runId,
    sourceFixtureSha256,
    builtFixtureSha256,
    distContentSha256,
  })
  await writeM5VisualFileAtomically(bindingPath, bindingBody)
  const preview = startPreview(port, distDirectory)
  let browser: Browser | undefined
  let servedBindingBody = ''
  let servedFixtureText = ''
  let gpu: unknown = null
  let executionError: unknown
  try {
    servedBindingBody = await waitForBinding(
      preview.child,
      `${baseUrl}/${bindingName}`,
      bindingBody,
    )
    servedFixtureText = await waitForBinding(
      preview.child,
      `${baseUrl}/config/performance/m5-visual.json`,
      fixtureText,
    )
    report.build = {
      ...report.build,
      servedFixtureSha256: sha256(servedFixtureText),
    }
    const executablePath = chromium.executablePath()
    if (!executablePath.toLowerCase().includes(`${sep}ms-playwright${sep}chromium-`)) {
      throw new Error(`M5_VISUAL_CHROMIUM_NOT_LOCKED:${executablePath}`)
    }
    if (!M5_VISUAL_BROWSER_LAUNCH_ARGS.includes('--mute-audio')) {
      throw new Error('M5_VISUAL_BROWSER_MUTE_ARG_MISSING')
    }
    browser = await runM5VisualOperationWithTimeout(
      chromium.launch({
        headless: false,
        executablePath,
        args: [...M5_VISUAL_BROWSER_LAUNCH_ARGS],
      }),
      M5_VISUAL_OPERATION_TIMEOUTS.browserLaunchMilliseconds,
      'M5_VISUAL_BROWSER_LAUNCH_TIMEOUT',
    )
    try {
      const cdp = await runM5VisualOperationWithTimeout(
        browser.newBrowserCDPSession(),
        M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
        'M5_VISUAL_CDP_SESSION_TIMEOUT',
      )
      gpu = await runM5VisualOperationWithTimeout(
        cdp.send('SystemInfo.getInfo'),
        M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
        'M5_VISUAL_GPU_INFO_TIMEOUT',
      )
      await runM5VisualOperationWithTimeout(
        cdp.detach(),
        M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds,
        'M5_VISUAL_CDP_DETACH_TIMEOUT',
      )
    } catch (error) {
      gpu = { unavailable: serializeError(error) }
    }
    const cpuList = cpus()
    report.machine = {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpuList[0]?.model ?? 'unknown',
      logicalCpuCount: cpuList.length,
      totalMemoryBytes: totalmem(),
      gpu,
    }
    report.browser = {
      engine: 'chromium',
      headed: true,
      version: browser.version(),
      executablePath,
      playwrightVersion: playwrightVersion(),
      viewport: {
        width: fixture.protocol.viewportWidth,
        height: fixture.protocol.viewportHeight,
      },
      deviceScaleFactor: 1,
      audioMutedByBrowser: m5VisualBrowserAudioMutedByLaunchArgs(
        M5_VISUAL_BROWSER_LAUNCH_ARGS,
      ),
      launchArgs: M5_VISUAL_BROWSER_LAUNCH_ARGS,
    }

    for (const scenarioId of REQUIRED_SCENARIO_IDS) {
      const scenario = fixture.scenarios.find(({ id }) => id === scenarioId)
      if (scenario === undefined) {
        throw new Error(`M5_VISUAL_REQUIRED_SCENARIO_MISSING:${scenarioId}`)
      }
      process.stdout.write(
        `[M5 VISUAL] ${scenario.id}: ${timing.formal ? '正式' : '烟测'}预热 ${timing.warmupMilliseconds}ms + 采样 ${timing.sampleMilliseconds}ms\n`,
      )
      const result = await runM5VisualOperationWithTimeout(
        runScenario({
          browser,
          baseUrl,
          outputDirectory: report.outputDirectory,
          fixture,
          scenario,
          timing,
          expectedPearlTextureStyleCount:
            sourcePearlTextureStyleCount,
        }),
        timing.warmupMilliseconds +
          timing.sampleMilliseconds +
          SAMPLE_TIMEOUT_MARGIN_MILLISECONDS +
          M5_VISUAL_OPERATION_TIMEOUTS.browserOperationMilliseconds * 3,
        `M5_VISUAL_SCENARIO_TIMEOUT:${scenario.id}`,
      )
      report.scenarios.push(result)
      const simulationFingerprint = result.after.simulationContentFingerprint
      const presentationFingerprint = result.after.presentationContentFingerprint
      if (report.fixture.simulationContentFingerprint !== undefined) {
        if (
          report.fixture.simulationContentFingerprint !== simulationFingerprint ||
          report.fixture.presentationContentFingerprint !== presentationFingerprint
        ) {
          throw new Error('M5_VISUAL_FINGERPRINT_CHANGED_BETWEEN_SCENARIOS')
        }
      }
      report.fixture = {
        ...report.fixture,
        simulationContentFingerprint: simulationFingerprint,
        presentationContentFingerprint: presentationFingerprint,
      }
      process.stdout.write(
        `[M5 VISUAL] ${scenario.id}: ${result.passed ? 'PASS' : 'FAIL'}\n`,
      )
    }
  } catch (error) {
    executionError = error
  }

  let exitedAfterCleanup = false
  let cleanupError: unknown
  try {
    await cleanupM5VisualRunResources({
      closeBrowser: async () => {
        if (browser !== undefined) await browser.close()
      },
      stopPreview: async () => {
        await stopM5VisualPreview(preview.child)
        exitedAfterCleanup = hasM5VisualChildExited(preview.child)
        return exitedAfterCleanup
      },
      removeBinding: () => rm(bindingPath, { force: true }),
    })
  } catch (error) {
    cleanupError = error
  }
  report.preview = {
    url: baseUrl,
    port,
    pid: preview.child.pid ?? null,
    bindingPath,
    bindingBodySha256: sha256(bindingBody),
    servedBindingBodySha256: sha256(servedBindingBody),
    bindingPassed:
      servedBindingBody === bindingBody && servedFixtureText === fixtureText,
    stdout: preview.stdout(),
    stderr: preview.stderr(),
    exitedAfterCleanup,
  }
  if (executionError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [executionError, cleanupError],
      'M5_VISUAL_EXECUTION_AND_CLEANUP_FAILED',
    )
  }
  if (cleanupError !== undefined) throw cleanupError
  if (executionError !== undefined) throw executionError
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const outputDirectory = resolve(
    OUTPUT_ROOT,
    timestampDirectoryName(startedAt),
  )
  await mkdir(outputDirectory, { recursive: true })
  const report: RunReport = {
    reportVersion: 1,
    benchmarkKind: 'presentation-only',
    disclaimerZh:
      '该场景只验证 M5 正式表现路径，不执行或替代领域规则性能与领域结算验收。',
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
    const updateOutcome = (): ReturnType<
      typeof evaluateM5VisualRunOutcome
    > => {
      const outcome = evaluateM5VisualRunOutcome({
        formal: report.formal,
        fatalErrorCount: report.fatalErrors.length,
        requiredScenarioCount: REQUIRED_SCENARIO_IDS.length,
        scenarioPassed: report.scenarios.map(({ passed }) => passed),
        browserLaunchAuditPassed:
          report.browser !== undefined &&
          report.browser.headed === true &&
          report.browser.launchArgs === M5_VISUAL_BROWSER_LAUNCH_ARGS &&
          report.browser.audioMutedByBrowser ===
            m5VisualBrowserAudioMutedByLaunchArgs(
              report.browser.launchArgs,
            ) &&
          report.browser.audioMutedByBrowser,
      })
      report.executionPassed = outcome.executionPassed
      report.formalGatePassed = outcome.formalGatePassed
      return outcome
    }
    updateOutcome()
    const summaryJsonPath = resolve(outputDirectory, 'summary.json')
    const summaryMarkdownPath = resolve(outputDirectory, 'summary.md')
    try {
      await writeM5VisualFileAtomically(
        summaryMarkdownPath,
        markdown(report),
      )
    } catch (error) {
      report.fatalErrors.push(serializeError(error))
      updateOutcome()
    }
    try {
      await writeM5VisualFileAtomically(
        summaryJsonPath,
        `${JSON.stringify(report, null, 2)}\n`,
      )
    } catch (error) {
      report.fatalErrors.push(serializeError(error))
      updateOutcome()
      try {
        await writeM5VisualFileAtomically(
          summaryMarkdownPath,
          markdown(report),
        )
      } catch (markdownError) {
        report.fatalErrors.push(serializeError(markdownError))
      }
    }
    const outcome = updateOutcome()
    process.stdout.write(`[M5 VISUAL] 报告：${summaryMarkdownPath}\n`)
    process.stdout.write(
      `[M5 VISUAL] ${report.formal ? '正式门禁' : '烟测（不可冒充正式报告）'}：${report.executionPassed ? 'PASS' : 'FAIL'}\n`,
    )
    process.exitCode = outcome.exitCode
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[M5 VISUAL] RUNNER_FATAL:${serializeError(error).message}\n`,
  )
  process.exitCode = 1
})
