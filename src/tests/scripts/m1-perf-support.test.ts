import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

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
} from '../../../scripts/m1-perf-support.ts'
import type { M1PerformanceSample } from '../../game/m1/performance-metrics.ts'

function regularTimestamps(rate: number, seconds: number): number[] {
  return Array.from({ length: rate * seconds }, (_, index) => (index * 1_000) / rate)
}

function validSample(): M1PerformanceSample {
  return {
    sampleStartMilliseconds: 0,
    sampleDurationMilliseconds: 2_000,
    frameTimestamps: regularTimestamps(60, 2),
    flowTimestamps: regularTimestamps(30, 2),
    flowDurationsMilliseconds: new Array<number>(60).fill(2),
    droppedTickCount: 0,
    activePearlCount: 900,
    interactionCount: 0,
  }
}

describe('M1 性能采样器纯函数', () => {
  const fixtureText = readFileSync(
    new URL('../../../public/config/performance/m1-fire-flow.json', import.meta.url),
    'utf8',
  )
  const fixtureSchemaText = readFileSync(
    new URL(
      '../../../schemas/config/m1-fire-flow-performance.schema.json',
      import.meta.url,
    ),
    'utf8',
  )

  it('只有未覆盖的 10 秒预热与 60 秒采样可标记为正式门禁', () => {
    expect(
      resolveM1RunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        {},
      ),
    ).toEqual({
      warmupMilliseconds: 10_000,
      sampleMilliseconds: 60_000,
      formal: true,
      overridden: false,
    })

    expect(
      resolveM1RunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        {
          M1_PERF_WARMUP_MS: '1000',
          M1_PERF_SAMPLE_MS: '3000',
        },
      ),
    ).toEqual({
      warmupMilliseconds: 1_000,
      sampleMilliseconds: 3_000,
      formal: false,
      overridden: true,
    })
  })

  it('拒绝不足一个完整秒窗口和非整数的 smoke 配置', () => {
    expect(() =>
      resolveM1RunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        { M1_PERF_SAMPLE_MS: '999' },
      ),
    ).toThrow('M1_PERF_ENV_INVALID')
    expect(() =>
      resolveM1RunTiming(
        { warmupSeconds: 10, sampleSeconds: 60 },
        { M1_PERF_WARMUP_MS: '1.5' },
      ),
    ).toThrow('M1_PERF_ENV_INVALID')
  })

  it('runner 自身对 fixture 执行 strict JSON、Schema 和语义校验', () => {
    expect(
      parseAndValidateM1FixtureJson(fixtureText, fixtureSchemaText).performanceScenarios,
    ).toHaveLength(2)

    const duplicateKey = fixtureText.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "schemaVersion": 1,',
    )
    expect(() =>
      parseAndValidateM1FixtureJson(duplicateKey, fixtureSchemaText),
    ).toThrow('M1_PERF_FIXTURE_STRICT_JSON_INVALID')

    const withUnknownField = JSON.parse(fixtureText) as Record<string, unknown>
    withUnknownField.runnerMustRejectThis = true
    expect(() =>
      parseAndValidateM1FixtureJson(
        JSON.stringify(withUnknownField),
        fixtureSchemaText,
      ),
    ).toThrow('M1_PERF_FIXTURE_SCHEMA_INVALID')
  })

  it('用明确 URL 参数选择场景并关闭覆盖层', () => {
    expect(buildM1ScenarioUrl('http://127.0.0.1:4174', 'm1-2400')).toBe(
      'http://127.0.0.1:4174/?scenario=m1-2400&overlay=none',
    )
  })

  it('启动 preview 前稳定拒绝已被其他服务占用的端口', async () => {
    const blocker = createServer()
    await new Promise<void>((resolveListen, rejectListen) => {
      blocker.once('error', rejectListen)
      blocker.listen(0, '127.0.0.1', resolveListen)
    })
    try {
      const address = blocker.address()
      if (address === null || typeof address === 'string') throw new Error('测试端口不可用')
      await expect(
        assertM1TcpPortAvailable('127.0.0.1', address.port),
      ).rejects.toThrow('M1_PERF_PORT_IN_USE')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        blocker.close((error) =>
          error === undefined ? resolveClose() : rejectClose(error),
        )
      })
    }
  })

  it('即使未知服务 fetch 成功，也拒绝未出现本次 ready marker 或已退出的子进程', () => {
    const result = evaluateM1PreviewProbe({
      childPid: 12_345,
      childExited: true,
      readyMarkerSeen: false,
      responseOk: true,
      expectedBindingBody: '{"run":"this-run"}',
      servedBindingBody: '{"run":"this-run"}',
    })

    expect(result.passed).toBe(false)
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'preview-child-alive', passed: false }),
        expect.objectContaining({ id: 'preview-ready-marker', passed: false }),
        expect.objectContaining({ id: 'preview-binding-http', passed: true }),
      ]),
    )
  })

  it('只有本次子进程存活、ready marker 已出现且返回唯一 dist 绑定内容才就绪', () => {
    const expectedBindingBody = '{"run":"this-run","dist":"abc"}'
    const mismatch = evaluateM1PreviewProbe({
      childPid: 12_345,
      childExited: false,
      readyMarkerSeen: true,
      responseOk: true,
      expectedBindingBody,
      servedBindingBody: '{"run":"old-run","dist":"abc"}',
    })
    const matching = evaluateM1PreviewProbe({
      childPid: 12_345,
      childExited: false,
      readyMarkerSeen: true,
      responseOk: true,
      expectedBindingBody,
      servedBindingBody: expectedBindingBody,
    })

    expect(mismatch.passed).toBe(false)
    expect(mismatch.checks.find((check) => check.id === 'preview-binding-body')).toMatchObject({
      passed: false,
    })
    expect(matching.passed).toBe(true)
    expect(matching.checks.every((check) => check.passed)).toBe(true)
  })

  it('把 Chromium 在 Windows 上的 DPR 浮点表示误差视为 DPR 1', () => {
    expect(isM1DevicePixelRatioOne(1.0000000298023224)).toBe(true)
    expect(isM1DevicePixelRatioOne(1.000002)).toBe(false)
  })

  it('用 fixture 的显式完整秒上下界判断滚动 tickHz', () => {
    expect(isM1TickRateInsideConfiguredWindow(29, 29, 31)).toBe(true)
    expect(isM1TickRateInsideConfiguredWindow(31, 29, 31)).toBe(true)
    expect(isM1TickRateInsideConfiguredWindow(28, 29, 31)).toBe(false)
  })

  it('稳定 framing 哈希不受输入顺序影响，但会响应路径与内容变化', () => {
    const left = computeFramedContentSha256([
      { path: 'assets/b.js', bytes: new TextEncoder().encode('b') },
      { path: 'index.html', bytes: new TextEncoder().encode('a') },
    ])
    const reordered = computeFramedContentSha256([
      { path: 'index.html', bytes: new TextEncoder().encode('a') },
      { path: 'assets/b.js', bytes: new TextEncoder().encode('b') },
    ])
    const changed = computeFramedContentSha256([
      { path: 'index.html', bytes: new TextEncoder().encode('a') },
      { path: 'assets/b.js', bytes: new TextEncoder().encode('c') },
    ])

    expect(left).toBe(reordered)
    expect(changed).not.toBe(left)
  })

  it('证明 raw flow 一一对应，并与采样前后累计值和珠数一致', () => {
    const result = evaluateM1SampleConsistency({
      requestedDurationMilliseconds: 2_000,
      expectedActivePearlCount: 900,
      expectedTickRateHz: 30,
      allowedTotalTickError: 1,
      allowedBoundaryUpdateError: 1,
      sample: validSample(),
      before: {
        fieldUpdateCount: 100,
        lastCommittedTick: 99,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
      after: {
        fieldUpdateCount: 160,
        lastCommittedTick: 159,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
    })

    expect(result.passed).toBe(true)
    expect(result.checks.every((check) => check.passed)).toBe(true)
  })

  it('原始证据检查也拒绝重复 timestamp 与空 timestamp 序列', () => {
    const repeatedSample = validSample()
    const repeatedFrames = [...repeatedSample.frameTimestamps]
    const repeatedFlows = [...repeatedSample.flowTimestamps]
    repeatedFrames[1] = repeatedFrames[0]!
    repeatedFlows[1] = repeatedFlows[0]!
    const commonInput = {
      requestedDurationMilliseconds: 2_000,
      expectedActivePearlCount: 900,
      expectedTickRateHz: 30,
      allowedTotalTickError: 1,
      allowedBoundaryUpdateError: 1,
      before: {
        fieldUpdateCount: 100,
        lastCommittedTick: 99,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
      after: {
        fieldUpdateCount: 160,
        lastCommittedTick: 159,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
    } as const

    const repeated = evaluateM1SampleConsistency({
      ...commonInput,
      sample: {
        ...repeatedSample,
        frameTimestamps: repeatedFrames,
        flowTimestamps: repeatedFlows,
      },
    })
    const empty = evaluateM1SampleConsistency({
      ...commonInput,
      sample: {
        ...repeatedSample,
        frameTimestamps: [],
        flowTimestamps: [],
        flowDurationsMilliseconds: [],
      },
    })

    for (const result of [repeated, empty]) {
      expect(
        result.checks.find((check) => check.id === 'flow-timestamp-window'),
      ).toMatchObject({ passed: false })
      expect(
        result.checks.find((check) => check.id === 'frame-timestamp-window'),
      ).toMatchObject({ passed: false })
    }
  })

  it('分别暴露删珠、漏记流场耗时与累计更新量不一致', () => {
    const sample = {
      ...validSample(),
      flowDurationsMilliseconds: new Array<number>(59).fill(2),
      activePearlCount: 899,
    }
    const result = evaluateM1SampleConsistency({
      requestedDurationMilliseconds: 2_000,
      expectedActivePearlCount: 900,
      expectedTickRateHz: 30,
      allowedTotalTickError: 1,
      allowedBoundaryUpdateError: 1,
      sample,
      before: {
        fieldUpdateCount: 100,
        lastCommittedTick: 99,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
      after: {
        fieldUpdateCount: 158,
        lastCommittedTick: 159,
        droppedTickCount: 0,
        activePearlCount: 899,
      },
    })

    expect(result.passed).toBe(false)
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'flow-pairs', passed: false }),
        expect.objectContaining({ id: 'flow-update-delta', passed: false }),
        expect.objectContaining({ id: 'active-sample', passed: false }),
        expect.objectContaining({ id: 'active-after', passed: false }),
      ]),
    )
  })

  it('允许结束帧已推进但因到达窗口终点未写入 raw sample 的一次边界更新', () => {
    const result = evaluateM1SampleConsistency({
      requestedDurationMilliseconds: 2_000,
      expectedActivePearlCount: 900,
      expectedTickRateHz: 30,
      allowedTotalTickError: 1,
      allowedBoundaryUpdateError: 1,
      sample: validSample(),
      before: {
        fieldUpdateCount: 100,
        lastCommittedTick: 99,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
      after: {
        fieldUpdateCount: 161,
        lastCommittedTick: 160,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
    })

    expect(result.passed).toBe(true)
    expect(result.checks.find((check) => check.id === 'flow-update-delta')).toMatchObject({
      passed: true,
      actual: 61,
      expected: '60..61',
    })
  })

  it('拒绝超过一次 rAF 结束边界竞态的额外流场与提交更新', () => {
    const result = evaluateM1SampleConsistency({
      requestedDurationMilliseconds: 2_000,
      expectedActivePearlCount: 900,
      expectedTickRateHz: 30,
      allowedTotalTickError: 1,
      allowedBoundaryUpdateError: 1,
      sample: validSample(),
      before: {
        fieldUpdateCount: 100,
        lastCommittedTick: 99,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
      after: {
        fieldUpdateCount: 162,
        lastCommittedTick: 161,
        droppedTickCount: 0,
        activePearlCount: 900,
      },
    })

    expect(result.passed).toBe(false)
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'flow-update-delta', passed: false }),
        expect.objectContaining({ id: 'committed-tick-delta', passed: false }),
      ]),
    )
  })

  it('在浏览器上下文关闭错误追加到 pageErrors 后将场景最终判为 FAIL', () => {
    const base = {
      errorPresent: false,
      consistencyPassed: true,
      gatePassed: true,
      environmentChecks: [{ id: 'ready', passed: true }],
      consoleErrorCount: 0,
      pageErrorCount: 0,
      failedRequestCount: 0,
      failedResponseCount: 0,
    } as const

    expect(evaluateM1ScenarioPassed(base)).toBe(true)
    expect(evaluateM1ScenarioPassed({ ...base, pageErrorCount: 1 })).toBe(false)
  })
})
