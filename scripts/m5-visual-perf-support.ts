import { createHash, randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import {
  rename as renameFile,
  rm as removeFile,
  writeFile as writeTextFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'

import Ajv2020 from 'ajv/dist/2020.js'

import {
  validateM5VisualPerformanceFixtureSemantics,
  type M5VisualPerformanceFixture,
} from '../src/config/m5-visual-performance-fixture.ts'
import { parseStrictJson } from '../src/config/strict-json.ts'

const FORMAL_WARMUP_MILLISECONDS = 10_000
const FORMAL_SAMPLE_MILLISECONDS = 60_000

export function m5VisualBrowserAudioMutedByLaunchArgs(
  launchArgs: readonly string[],
): boolean {
  return launchArgs.includes('--mute-audio')
}

export const M5_VISUAL_OPERATION_TIMEOUTS = Object.freeze({
  buildMilliseconds: 120_000,
  bindingFetchMilliseconds: 2_000,
  browserLaunchMilliseconds: 30_000,
  browserOperationMilliseconds: 30_000,
  contextCleanupMilliseconds: 10_000,
  resourceCleanupMilliseconds: 10_000,
  previewTermMilliseconds: 5_000,
  previewKillMilliseconds: 2_000,
})

/**
 * Playwright 以字符串直接交给浏览器，避免 tsx/esbuild 给嵌套回调注入 runner
 * 作用域中的 `__name` helper。
 */
export const M5_VISUAL_INSTALL_FOREGROUND_SCRIPT = `(() => {
  const tracker = {
    blurCount: 0,
    hiddenCount: 0,
    onBlur: null,
    onVisibilityChange: null
  };
  tracker.onBlur = function () {
    tracker.blurCount += 1;
  };
  tracker.onVisibilityChange = function () {
    if (document.visibilityState === 'hidden') tracker.hiddenCount += 1;
  };
  window.__LIANDAN_M5_FOREGROUND_TRACKER__ = tracker;
  window.addEventListener('blur', tracker.onBlur);
  document.addEventListener('visibilitychange', tracker.onVisibilityChange);
})()`

export const M5_VISUAL_COLLECT_FOREGROUND_SCRIPT = `(() => {
  const tracker = window.__LIANDAN_M5_FOREGROUND_TRACKER__;
  if (tracker === undefined) {
    return {
      blurCount: -1,
      hiddenCount: -1,
      finalHasFocus: document.hasFocus(),
      finalVisibilityState: document.visibilityState
    };
  }
  window.removeEventListener('blur', tracker.onBlur);
  document.removeEventListener('visibilitychange', tracker.onVisibilityChange);
  delete window.__LIANDAN_M5_FOREGROUND_TRACKER__;
  return {
    blurCount: tracker.blurCount,
    hiddenCount: tracker.hiddenCount,
    finalHasFocus: document.hasFocus(),
    finalVisibilityState: document.visibilityState
  };
})()`

export type M5VisualSerializedError = Readonly<{
  name: string
  message: string
  stack?: string
  cause?: M5VisualSerializedError
  errors?: readonly M5VisualSerializedError[]
}>

export type M5VisualPreviewStopOptions = Readonly<{
  termTimeoutMilliseconds?: number
  killTimeoutMilliseconds?: number
}>

export type M5VisualRunTiming = Readonly<{
  warmupMilliseconds: number
  sampleMilliseconds: number
  formal: boolean
  overridden: boolean
}>

export type M5VisualForegroundCheck = Readonly<{
  id: 'sampling-never-blurred' | 'sampling-never-hidden'
  passed: boolean
  actual: number
  expected: 0
}>

export type M5VisualAtomicFileOperations = Readonly<{
  writeFile(
    path: string,
    contents: string,
    encoding: 'utf8',
  ): Promise<unknown>
  rename(source: string, target: string): Promise<unknown>
  rm(path: string, options: Readonly<{ force: true }>): Promise<unknown>
}>

const DEFAULT_ATOMIC_FILE_OPERATIONS: M5VisualAtomicFileOperations = {
  writeFile: (path, contents, encoding) =>
    writeTextFile(path, contents, encoding),
  rename: (source, target) => renameFile(source, target),
  rm: (path, options) => removeFile(path, options),
}

function requirePositiveTimeout(value: number, errorCode: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(errorCode)
  return value
}

export function serializeM5VisualError(
  error: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): M5VisualSerializedError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) }
  }
  if (seen.has(error)) {
    return { name: error.name, message: '[Circular error]' }
  }
  seen.add(error)
  const cause = error.cause
  const errors =
    error instanceof AggregateError
      ? Array.from(error.errors, (nested) =>
          serializeM5VisualError(nested, seen),
        )
      : undefined
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(cause === undefined
      ? {}
      : { cause: serializeM5VisualError(cause, seen) }),
    ...(errors === undefined ? {} : { errors }),
  }
}

export function runM5VisualOperationWithTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMilliseconds: number,
  timeoutErrorCode: string,
): Promise<T> {
  try {
    requirePositiveTimeout(
      timeoutMilliseconds,
      'M5_VISUAL_OPERATION_TIMEOUT_CONFIG_INVALID',
    )
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(timeoutErrorCode))
    }, timeoutMilliseconds)
    void Promise.resolve(operation).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function hasM5VisualChildExited(
  child: Readonly<{
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }>,
): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForM5VisualChildExit(
  child: ChildProcess,
  timeoutMilliseconds: number,
): Promise<boolean> {
  requirePositiveTimeout(
    timeoutMilliseconds,
    'M5_VISUAL_PREVIEW_STOP_TIMEOUT_INVALID',
  )
  if (hasM5VisualChildExited(child)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      child.off('exit', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    child.once('exit', onExit)
    timer = setTimeout(
      () => finish(hasM5VisualChildExited(child)),
      timeoutMilliseconds,
    )
    if (hasM5VisualChildExited(child)) finish(true)
  })
}

function sendM5VisualPreviewSignal(
  child: ChildProcess,
  signal: NodeJS.Signals,
): Readonly<{ sent: boolean; error?: string }> {
  try {
    return { sent: child.kill(signal) }
  } catch (error) {
    return {
      sent: false,
      error: serializeM5VisualError(error).message,
    }
  }
}

export async function stopM5VisualPreview(
  child: ChildProcess | undefined,
  options: M5VisualPreviewStopOptions = {},
): Promise<void> {
  if (child === undefined || hasM5VisualChildExited(child)) return
  const termTimeoutMilliseconds = requirePositiveTimeout(
    options.termTimeoutMilliseconds ??
      M5_VISUAL_OPERATION_TIMEOUTS.previewTermMilliseconds,
    'M5_VISUAL_PREVIEW_STOP_TIMEOUT_INVALID',
  )
  const killTimeoutMilliseconds = requirePositiveTimeout(
    options.killTimeoutMilliseconds ??
      M5_VISUAL_OPERATION_TIMEOUTS.previewKillMilliseconds,
    'M5_VISUAL_PREVIEW_STOP_TIMEOUT_INVALID',
  )
  const term = sendM5VisualPreviewSignal(child, 'SIGTERM')
  if (await waitForM5VisualChildExit(child, termTimeoutMilliseconds)) return
  const kill = sendM5VisualPreviewSignal(child, 'SIGKILL')
  if (await waitForM5VisualChildExit(child, killTimeoutMilliseconds)) return
  throw new Error(
    `M5_VISUAL_PREVIEW_CLEANUP_FAILED:TERM sent=${term.sent}${term.error === undefined ? '' : ` error=${term.error}`};KILL sent=${kill.sent}${kill.error === undefined ? '' : ` error=${kill.error}`};exitCode=${String(child.exitCode)};signalCode=${String(child.signalCode)}`,
  )
}

function parseMilliseconds(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`M5_VISUAL_PERF_ENV_INVALID:${name}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`M5_VISUAL_PERF_ENV_INVALID:${name}`)
  }
  return parsed
}

export function resolveM5VisualRunTiming(
  protocol: Readonly<{ warmupSeconds: number; sampleSeconds: number }>,
  environment: Readonly<Record<string, string | undefined>>,
): M5VisualRunTiming {
  const defaultWarmupMilliseconds = protocol.warmupSeconds * 1_000
  const defaultSampleMilliseconds = protocol.sampleSeconds * 1_000
  if (
    defaultWarmupMilliseconds !== FORMAL_WARMUP_MILLISECONDS ||
    defaultSampleMilliseconds !== FORMAL_SAMPLE_MILLISECONDS
  ) {
    throw new Error('M5_VISUAL_PERF_PROTOCOL_INVALID')
  }
  const hasOverride =
    environment.M5_VISUAL_PERF_WARMUP_MS !== undefined ||
    environment.M5_VISUAL_PERF_SAMPLE_MS !== undefined
  const smokeRequested = environment.M5_VISUAL_PERF_SMOKE === '1'
  if (hasOverride && environment.M5_VISUAL_PERF_SMOKE !== '1') {
    throw new Error('M5_VISUAL_PERF_SMOKE_NOT_EXPLICIT')
  }
  const warmupMilliseconds = parseMilliseconds(
    'M5_VISUAL_PERF_WARMUP_MS',
    environment.M5_VISUAL_PERF_WARMUP_MS,
    defaultWarmupMilliseconds,
    0,
  )
  const sampleMilliseconds = parseMilliseconds(
    'M5_VISUAL_PERF_SAMPLE_MS',
    environment.M5_VISUAL_PERF_SAMPLE_MS,
    defaultSampleMilliseconds,
    1_000,
  )
  if (sampleMilliseconds % 1_000 !== 0) {
    throw new Error('M5_VISUAL_PERF_ENV_INVALID:M5_VISUAL_PERF_SAMPLE_MS')
  }
  return {
    warmupMilliseconds,
    sampleMilliseconds,
    formal:
      !hasOverride &&
      !smokeRequested &&
      warmupMilliseconds === FORMAL_WARMUP_MILLISECONDS &&
      sampleMilliseconds === FORMAL_SAMPLE_MILLISECONDS,
    overridden: hasOverride || smokeRequested,
  }
}

export function parseAndValidateM5VisualFixtureJson(
  fixtureText: string,
  schemaText: string,
): M5VisualPerformanceFixture {
  const fixtureResult = parseStrictJson(fixtureText)
  if (!fixtureResult.ok) {
    throw new Error('M5_VISUAL_PERF_FIXTURE_STRICT_JSON_INVALID')
  }
  const schemaResult = parseStrictJson(schemaText)
  if (!schemaResult.ok) {
    throw new Error('M5_VISUAL_PERF_FIXTURE_SCHEMA_JSON_INVALID')
  }
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    validateSchema: true,
  }).compile(schemaResult.value as object)
  if (!validate(fixtureResult.value)) {
    throw new Error(
      `M5_VISUAL_PERF_FIXTURE_SCHEMA_INVALID:${JSON.stringify(validate.errors ?? [])}`,
    )
  }
  const fixture = fixtureResult.value as M5VisualPerformanceFixture
  const issues = validateM5VisualPerformanceFixtureSemantics(fixture)
  if (issues.length > 0) {
    throw new Error(
      `M5_VISUAL_PERF_FIXTURE_SEMANTICS_INVALID:${JSON.stringify(issues)}`,
    )
  }
  return fixture
}

export function buildM5VisualScenarioUrl(
  baseUrl: string,
  scenarioId: string,
): string {
  const url = new URL('/', baseUrl)
  url.searchParams.set('mode', 'm5-performance')
  url.searchParams.set('scenario', scenarioId)
  return url.toString()
}

export async function assertM5VisualTcpPortAvailable(
  host: string,
  port: number,
): Promise<void> {
  if (
    host.length === 0 ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(`M5_VISUAL_PERF_PORT_INVALID:${host}:${port}`)
  }
  const server = createServer()
  server.unref()
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `M5_VISUAL_PERF_PORT_${error.code === 'EADDRINUSE' ? 'IN_USE' : 'UNAVAILABLE'}:${host}:${port}`,
          { cause: error },
        ),
      )
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(
          new Error('M5_VISUAL_PERF_PORT_RELEASE_FAILED', { cause: error }),
        )
      })
    })
  })
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * 给浏览器内采样加 runner 自己持有的硬截止时间。超时回调必须关闭对应
 * context，使仍悬挂的 page.evaluate 不会把进程永久留住。
 */
export function runM5VisualSampleWithTimeout<T>(
  samplePromise: Promise<T>,
  sampleMilliseconds: number,
  timeoutMarginMilliseconds: number,
  closeContextOnTimeout: () => Promise<unknown>,
  contextCloseTimeoutMilliseconds: number =
    M5_VISUAL_OPERATION_TIMEOUTS.contextCleanupMilliseconds,
): Promise<T> {
  if (
    !Number.isSafeInteger(sampleMilliseconds) ||
    sampleMilliseconds < 1_000 ||
    !Number.isSafeInteger(timeoutMarginMilliseconds) ||
    timeoutMarginMilliseconds < 1 ||
    !Number.isSafeInteger(contextCloseTimeoutMilliseconds) ||
    contextCloseTimeoutMilliseconds < 1
  ) {
    return Promise.reject(new Error('M5_VISUAL_SAMPLE_TIMEOUT_CONFIG_INVALID'))
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let closePromise: Promise<unknown>
      try {
        closePromise = closeContextOnTimeout()
      } catch (error) {
        reject(
          new Error('M5_VISUAL_SAMPLE_TIMEOUT_CONTEXT_CLOSE_FAILED', {
            cause: error,
          }),
        )
        return
      }
      void runM5VisualOperationWithTimeout(
        closePromise,
        contextCloseTimeoutMilliseconds,
        'M5_VISUAL_SAMPLE_TIMEOUT_CONTEXT_CLOSE_TIMEOUT',
      ).then(
        () => reject(new Error('M5_VISUAL_SAMPLE_TIMEOUT')),
        (error: unknown) => {
          if (
            error instanceof Error &&
            error.message ===
              'M5_VISUAL_SAMPLE_TIMEOUT_CONTEXT_CLOSE_TIMEOUT'
          ) {
            reject(error)
            return
          }
          reject(
            new Error('M5_VISUAL_SAMPLE_TIMEOUT_CONTEXT_CLOSE_FAILED', {
              cause: error,
            }),
          )
        },
      )
    }, sampleMilliseconds + timeoutMarginMilliseconds)
    void samplePromise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

/** 同目录临时文件 + rename；失败时绝不截断旧报告。 */
export async function writeM5VisualFileAtomically(
  targetPath: string,
  contents: string,
  operations: M5VisualAtomicFileOperations = DEFAULT_ATOMIC_FILE_OPERATIONS,
): Promise<void> {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await operations.writeFile(temporaryPath, contents, 'utf8')
    await operations.rename(temporaryPath, targetPath)
  } catch (error) {
    try {
      await operations.rm(temporaryPath, { force: true })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'M5_VISUAL_ATOMIC_WRITE_CLEANUP_FAILED',
      )
    }
    throw error
  }
}

export function evaluateM5VisualForegroundLifecycle(
  evidence: Readonly<{
    blurCount: number
    hiddenCount: number
    finalHasFocus: boolean
    finalVisibilityState: string
  }>,
): readonly M5VisualForegroundCheck[] {
  return [
    {
      id: 'sampling-never-blurred',
      passed:
        evidence.blurCount === 0 && evidence.finalHasFocus,
      actual: evidence.blurCount,
      expected: 0,
    },
    {
      id: 'sampling-never-hidden',
      passed:
        evidence.hiddenCount === 0 &&
        evidence.finalVisibilityState === 'visible',
      actual: evidence.hiddenCount,
      expected: 0,
    },
  ]
}

export function assertM5VisualBuildArtifact(
  evidence: Readonly<{
    indexExists: boolean
    fixtureExists: boolean
    sourceFixtureSha256: string
    builtFixtureSha256: string
    manifestSourceFixtureSha256: string
    manifestBuiltFixtureSha256: string
    manifestDistContentSha256: string
    computedDistContentSha256: string
  }>,
): void {
  if (!evidence.indexExists) throw new Error('M5_VISUAL_BUILD_INDEX_MISSING')
  if (!evidence.fixtureExists) {
    throw new Error('M5_VISUAL_BUILD_FIXTURE_MISSING')
  }
  if (
    evidence.sourceFixtureSha256.length === 0 ||
    evidence.sourceFixtureSha256 !== evidence.builtFixtureSha256 ||
    evidence.sourceFixtureSha256 !==
      evidence.manifestSourceFixtureSha256 ||
    evidence.builtFixtureSha256 !== evidence.manifestBuiltFixtureSha256
  ) {
    throw new Error('M5_VISUAL_BUILD_FIXTURE_HASH_MISMATCH')
  }
  if (
    evidence.computedDistContentSha256.length === 0 ||
    evidence.computedDistContentSha256 !==
      evidence.manifestDistContentSha256
  ) {
    throw new Error('M5_VISUAL_BUILD_CONTENT_HASH_MISMATCH')
  }
}

export async function cleanupM5VisualRunResources(
  resources: Readonly<{
    closeBrowser: () => Promise<unknown>
    stopPreview: () => Promise<boolean>
    removeBinding: () => Promise<unknown>
  }>,
  options: Readonly<{
    operationTimeoutMilliseconds?: number
  }> = {},
): Promise<void> {
  const failures: Error[] = []
  const labels: string[] = []
  const operationTimeoutMilliseconds = requirePositiveTimeout(
    options.operationTimeoutMilliseconds ??
      M5_VISUAL_OPERATION_TIMEOUTS.resourceCleanupMilliseconds,
    'M5_VISUAL_CLEANUP_TIMEOUT_INVALID',
  )
  try {
    await runM5VisualOperationWithTimeout(
      resources.closeBrowser(),
      operationTimeoutMilliseconds,
      'M5_VISUAL_BROWSER_CLEANUP_TIMEOUT',
    )
  } catch (error) {
    labels.push('browser')
    failures.push(error instanceof Error ? error : new Error(String(error)))
  }
  try {
    if (!(await runM5VisualOperationWithTimeout(
      resources.stopPreview(),
      operationTimeoutMilliseconds,
      'M5_VISUAL_PREVIEW_CLEANUP_TIMEOUT',
    ))) {
      labels.push('preview')
      failures.push(new Error('M5_VISUAL_PREVIEW_CLEANUP_FAILED'))
    }
  } catch (error) {
    labels.push('preview')
    failures.push(error instanceof Error ? error : new Error(String(error)))
  }
  try {
    await runM5VisualOperationWithTimeout(
      resources.removeBinding(),
      operationTimeoutMilliseconds,
      'M5_VISUAL_BINDING_CLEANUP_TIMEOUT',
    )
  } catch (error) {
    labels.push('binding')
    failures.push(error instanceof Error ? error : new Error(String(error)))
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `M5_VISUAL_CLEANUP_FAILED:${labels.join(',')}`,
    )
  }
}

export function evaluateM5VisualRunOutcome(input: Readonly<{
  formal: boolean
  fatalErrorCount: number
  cleanupFailureCount?: number
  requiredScenarioCount: number
  scenarioPassed: readonly boolean[]
  browserLaunchAuditPassed: boolean
}>): Readonly<{
  executionPassed: boolean
  formalGatePassed: boolean | null
  exitCode: 0 | 1
}> {
  const executionPassed =
    input.fatalErrorCount === 0 &&
    (input.cleanupFailureCount ?? 0) === 0 &&
    input.browserLaunchAuditPassed &&
    input.scenarioPassed.length === input.requiredScenarioCount &&
    input.scenarioPassed.every(Boolean)
  return {
    executionPassed,
    formalGatePassed: input.formal ? executionPassed : null,
    exitCode: executionPassed ? 0 : 1,
  }
}
