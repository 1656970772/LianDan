import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  cleanupPreviewResources,
  evaluateM1RunOutcome,
  stopPreview,
} from '../../../scripts/run-perf-scenario.ts'

function neverExitingChild(killResult: boolean): ChildProcess {
  return {
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => killResult),
    once: vi.fn(function once(this: unknown) {
      return this
    }),
  } as unknown as ChildProcess
}

describe('M1 性能 preview 清理', () => {
  it('headed Chromium 运行器始终携带物理静音参数且保留 launch options', () => {
    const source = readFileSync(
      new URL('../../../scripts/run-perf-scenario.ts', import.meta.url),
      'utf8',
    )
    const launch = source.slice(
      source.indexOf('browser = await chromium.launch({'),
      source.indexOf('report.browser = {'),
    )

    expect(launch).toContain("args: ['--mute-audio']")
    expect(launch).toContain('headless: false')
    expect(launch).toContain('executablePath,')
  })

  it('TERM 与 KILL 都无法送达且子进程从未退出时必须失败', async () => {
    const child = neverExitingChild(false)

    await expect(
      stopPreview(child, { termTimeoutMilliseconds: 5, killTimeoutMilliseconds: 5 }),
    ).rejects.toThrow('M1_PERF_PREVIEW_CLEANUP_FAILED')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('TERM 与 KILL 都报告已送达但子进程仍未退出时也必须失败', async () => {
    const child = neverExitingChild(true)

    await expect(
      stopPreview(child, { termTimeoutMilliseconds: 5, killTimeoutMilliseconds: 5 }),
    ).rejects.toThrow('M1_PERF_PREVIEW_CLEANUP_FAILED')
    expect(child.kill).toHaveBeenCalledTimes(2)
  })

  it('stop 失败仍删除绑定，并把失败传到报告结果与退出码', async () => {
    const child = neverExitingChild(false)
    const removeBinding = vi.fn(async () => undefined)

    const cleanup = await cleanupPreviewResources(
      {
        child,
        bindingPath: 'dist/m1-preview-binding-test.json',
        stopOptions: { termTimeoutMilliseconds: 5, killTimeoutMilliseconds: 5 },
      },
      { removeBinding },
    )
    const fatalErrors = cleanup.errors
    const outcome = evaluateM1RunOutcome({
      formal: true,
      fatalErrorCount: fatalErrors.length,
      requiredScenarioCount: 2,
      scenarioPassed: [true, true],
    })

    expect(removeBinding).toHaveBeenCalledWith('dist/m1-preview-binding-test.json')
    expect(fatalErrors.map((error) => error.message)).toContainEqual(
      expect.stringContaining('M1_PERF_PREVIEW_CLEANUP_FAILED'),
    )
    expect(cleanup.childExitedAfterCleanup).toBe(false)
    expect(outcome).toEqual({
      executionPassed: false,
      formalGatePassed: false,
      exitCode: 1,
    })
  })
})
