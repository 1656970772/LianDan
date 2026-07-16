import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync, readdirSync } from 'node:fs'
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertM5VisualBuildArtifact,
  assertM5VisualTcpPortAvailable,
  buildM5VisualScenarioUrl,
  cleanupM5VisualRunResources,
  evaluateM5VisualForegroundLifecycle,
  evaluateM5VisualRunOutcome,
  hasM5VisualChildExited,
  m5VisualBrowserAudioMutedByLaunchArgs,
  M5_VISUAL_COLLECT_FOREGROUND_SCRIPT,
  M5_VISUAL_INSTALL_FOREGROUND_SCRIPT,
  parseAndValidateM5VisualFixtureJson,
  resolveM5VisualRunTiming,
  runM5VisualSampleWithTimeout,
  serializeM5VisualError,
  sha256,
  stopM5VisualPreview,
  writeM5VisualFileAtomically,
} from '../../../scripts/m5-visual-perf-support.ts'

describe('M5 正式表现 runner 契约', () => {
  const fixtureText = readFileSync(
    new URL('../../../public/config/performance/m5-visual.json', import.meta.url),
    'utf8',
  )
  const schemaText = readFileSync(
    new URL(
      '../../../schemas/config/m5-visual-performance.schema.json',
      import.meta.url,
    ),
    'utf8',
  )

  afterEach(() => {
    vi.useRealTimers()
  })

  it('性能门禁从 exact launch args 派生静音 provenance 并 fail closed', () => {
    expect(
      m5VisualBrowserAudioMutedByLaunchArgs(
        Object.freeze(['--force-device-scale-factor=1', '--mute-audio']),
      ),
    ).toBe(true)
    expect(
      m5VisualBrowserAudioMutedByLaunchArgs(
        Object.freeze(['--force-device-scale-factor=1']),
      ),
    ).toBe(false)
    expect(
      evaluateM5VisualRunOutcome({
        formal: true,
        fatalErrorCount: 0,
        requiredScenarioCount: 2,
        scenarioPassed: [true, true],
        browserLaunchAuditPassed: false,
      }),
    ).toEqual({
      executionPassed: false,
      formalGatePassed: false,
      exitCode: 1,
    })
  })

  it('foreground 全程追踪以原始浏览器脚本执行，不携带 tsx 的 __name helper', () => {
    const runnerSource = readFileSync(
      new URL('../../../scripts/run-m5-visual-perf.ts', import.meta.url),
      'utf8',
    )
    for (const script of [
      M5_VISUAL_INSTALL_FOREGROUND_SCRIPT,
      M5_VISUAL_COLLECT_FOREGROUND_SCRIPT,
    ]) {
      expect(script).toBeTypeOf('string')
      expect(script).not.toContain('__name')
    }
    expect(runnerSource).toContain(
      'page.evaluate(M5_VISUAL_INSTALL_FOREGROUND_SCRIPT)',
    )
    expect(runnerSource).toContain(
      '}>(M5_VISUAL_COLLECT_FOREGROUND_SCRIPT)',
    )
  })

  it('只有未覆盖的 10 秒预热加 60 秒采样可标记 formal', () => {
    expect(resolveM5VisualRunTiming({ warmupSeconds: 10, sampleSeconds: 60 }, {})).toEqual({
      warmupMilliseconds: 10_000,
      sampleMilliseconds: 60_000,
      formal: true,
      overridden: false,
    })
    expect(
      resolveM5VisualRunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        {
          M5_VISUAL_PERF_SMOKE: '1',
          M5_VISUAL_PERF_WARMUP_MS: '0',
          M5_VISUAL_PERF_SAMPLE_MS: '1000',
        },
      ),
    ).toEqual({
      warmupMilliseconds: 0,
      sampleMilliseconds: 1_000,
      formal: false,
      overridden: true,
    })
  })

  it('无显式 smoke 开关时拒绝缩短正式时长', () => {
    expect(() =>
      resolveM5VisualRunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        { M5_VISUAL_PERF_SAMPLE_MS: '1000' },
      ),
    ).toThrow('M5_VISUAL_PERF_SMOKE_NOT_EXPLICIT')
    expect(() =>
      resolveM5VisualRunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        {
          M5_VISUAL_PERF_SMOKE: '1',
          M5_VISUAL_PERF_SAMPLE_MS: '1500',
        },
      ),
    ).toThrow('M5_VISUAL_PERF_ENV_INVALID:M5_VISUAL_PERF_SAMPLE_MS')
  })

  it('runner 自身执行 strict JSON、Schema 和语义校验', () => {
    expect(parseAndValidateM5VisualFixtureJson(fixtureText, schemaText).scenarios).toHaveLength(2)
    expect(() =>
      parseAndValidateM5VisualFixtureJson(
        fixtureText.replace(
          '"schemaVersion": 1,',
          '"schemaVersion": 1,\n  "schemaVersion": 1,',
        ),
        schemaText,
      ),
    ).toThrow('M5_VISUAL_PERF_FIXTURE_STRICT_JSON_INVALID')
  })

  it('生产 URL 显式选择 M5 presentation benchmark 场景', () => {
    expect(
      buildM5VisualScenarioUrl('http://127.0.0.1:4185', 'visual-normal'),
    ).toBe(
      'http://127.0.0.1:4185/?mode=m5-performance&scenario=visual-normal',
    )
  })

  it('preview 前拒绝占用端口', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = blocker.address()
      if (address === null || typeof address === 'string') throw new Error('端口不可用')
      await expect(
        assertM5VisualTcpPortAvailable('127.0.0.1', address.port),
      ).rejects.toThrow('M5_VISUAL_PERF_PORT_IN_USE')
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    }
  })

  it('never-resolving 采样在 sampleMs 加明确余量后硬超时并触发 context 清理', async () => {
    vi.useFakeTimers()
    const closeContext = vi.fn(async () => undefined)
    const pending = runM5VisualSampleWithTimeout(
      new Promise<never>(() => undefined),
      60_000,
      5_000,
      closeContext,
    )
    const rejection = expect(pending).rejects.toThrow(
      'M5_VISUAL_SAMPLE_TIMEOUT',
    )

    await vi.advanceTimersByTimeAsync(64_999)
    expect(closeContext).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(closeContext).toHaveBeenCalledOnce()
  })

  it('采样超时后的 context.close 永不返回时仍在独立上限后 fatal', async () => {
    vi.useFakeTimers()
    const closeContext = vi.fn(() => new Promise<never>(() => undefined))
    const pending = runM5VisualSampleWithTimeout(
      new Promise<never>(() => undefined),
      1_000,
      1,
      closeContext,
      25,
    )
    const rejection = expect(pending).rejects.toThrow(
      'M5_VISUAL_SAMPLE_TIMEOUT_CONTEXT_CLOSE_TIMEOUT',
    )

    await vi.advanceTimersByTimeAsync(1_026)
    await rejection
    expect(closeContext).toHaveBeenCalledOnce()
  })

  it('signalCode 表示子进程已退出，真实 preview SIGTERM 后也不残留', async () => {
    expect(
      hasM5VisualChildExited({ exitCode: null, signalCode: 'SIGTERM' }),
    ).toBe(true)

    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      { stdio: 'ignore', windowsHide: true },
    )
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      await expect(
        stopM5VisualPreview(child, {
          termTimeoutMilliseconds: 5_000,
          killTimeoutMilliseconds: 2_000,
        }),
      ).resolves.toBeUndefined()
      expect(hasM5VisualChildExited(child)).toBe(true)
    } finally {
      if (!hasM5VisualChildExited(child)) child.kill('SIGKILL')
    }
  })

  it('AggregateError 序列化递归保留 execution、cleanup 与 cause 证据', () => {
    const serialized = serializeM5VisualError(
      new AggregateError(
        [
          new Error('EXECUTION_FAILED'),
          new Error('CLEANUP_FAILED', { cause: new Error('STOP_FAILED') }),
        ],
        'M5_VISUAL_EXECUTION_AND_CLEANUP_FAILED',
        { cause: new Error('ROOT_CAUSE') },
      ),
    )

    expect(serialized.message).toBe('M5_VISUAL_EXECUTION_AND_CLEANUP_FAILED')
    expect(serialized.cause?.message).toBe('ROOT_CAUSE')
    expect(serialized.errors?.map(({ message }) => message)).toEqual([
      'EXECUTION_FAILED',
      'CLEANUP_FAILED',
    ])
    expect(serialized.errors?.[1]?.cause?.message).toBe('STOP_FAILED')
  })

  it('browser、preview 或 binding 任一清理失败均成为 fatal outcome', async () => {
    await expect(
      cleanupM5VisualRunResources({
        closeBrowser: async () => {
          throw new Error('browser-close-failed')
        },
        stopPreview: async () => false,
        removeBinding: async () => {
          throw new Error('binding-remove-failed')
        },
      }),
    ).rejects.toThrow(/M5_VISUAL_CLEANUP_FAILED.*browser.*preview.*binding/)

    expect(
      evaluateM5VisualRunOutcome({
        formal: true,
        fatalErrorCount: 0,
        cleanupFailureCount: 1,
        requiredScenarioCount: 2,
        scenarioPassed: [true, true],
        browserLaunchAuditPassed: true,
      }),
    ).toEqual({
      executionPassed: false,
      formalGatePassed: false,
      exitCode: 1,
    })
  })

  it('browser cleanup 永不返回时按独立 timeout 进入 fatal 且继续其他清理', async () => {
    vi.useFakeTimers()
    const stopPreview = vi.fn(async () => true)
    const removeBinding = vi.fn(async () => undefined)
    const cleanup = cleanupM5VisualRunResources(
      {
        closeBrowser: () => new Promise<never>(() => undefined),
        stopPreview,
        removeBinding,
      },
      { operationTimeoutMilliseconds: 25 },
    )
    const rejection = expect(cleanup).rejects.toThrow(
      /M5_VISUAL_CLEANUP_FAILED:browser/,
    )

    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(stopPreview).toHaveBeenCalledOnce()
    expect(removeBinding).toHaveBeenCalledOnce()
  })

  it('JSON/Markdown 原子写失败时保留旧目标并清理同目录临时文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liandan-m5-atomic-'))
    const target = join(directory, 'summary.json')
    await writeFile(target, 'old', 'utf8')
    try {
      await expect(
        writeM5VisualFileAtomically(target, 'new', {
          writeFile,
          rename: async () => {
            throw new Error('rename-failed')
          },
          rm,
        }),
      ).rejects.toThrow('rename-failed')
      expect(await readFile(target, 'utf8')).toBe('old')
      expect(
        readdirSync(directory).filter((name) => name.includes('.tmp-')),
      ).toEqual([])

      await writeM5VisualFileAtomically(target, 'fresh', {
        writeFile,
        rename,
        rm,
      })
      expect(await readFile(target, 'utf8')).toBe('fresh')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('采样中曾 blur/hidden 即使结束恢复也失败', () => {
    expect(
      evaluateM5VisualForegroundLifecycle({
        blurCount: 1,
        hiddenCount: 1,
        finalHasFocus: true,
        finalVisibilityState: 'visible',
      }),
    ).toEqual([
      expect.objectContaining({ id: 'sampling-never-blurred', passed: false }),
      expect.objectContaining({ id: 'sampling-never-hidden', passed: false }),
    ])
  })

  it('拒绝 index-only 旧产物、fixture 缺失和 source/build hash 不一致', () => {
    const sourceHash = sha256(fixtureText)
    expect(() =>
      assertM5VisualBuildArtifact({
        indexExists: true,
        fixtureExists: false,
        sourceFixtureSha256: sourceHash,
        builtFixtureSha256: '',
        manifestSourceFixtureSha256: sourceHash,
        manifestBuiltFixtureSha256: sourceHash,
        manifestDistContentSha256: 'dist',
        computedDistContentSha256: 'dist',
      }),
    ).toThrow('M5_VISUAL_BUILD_FIXTURE_MISSING')
    expect(() =>
      assertM5VisualBuildArtifact({
        indexExists: true,
        fixtureExists: true,
        sourceFixtureSha256: sourceHash,
        builtFixtureSha256: sha256(`${fixtureText}\n`),
        manifestSourceFixtureSha256: sourceHash,
        manifestBuiltFixtureSha256: sourceHash,
        manifestDistContentSha256: 'dist',
        computedDistContentSha256: 'dist',
      }),
    ).toThrow('M5_VISUAL_BUILD_FIXTURE_HASH_MISMATCH')
  })
})
