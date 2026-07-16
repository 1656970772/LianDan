import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { M5VisualPerformanceFixture } from '../../config/m5-visual-performance-fixture.ts'
import {
  createM5VisualPerformanceSnapshot,
  isValidM5VisualSampleDuration,
} from '../../game/m5-performance/m5-visual-performance-contract.ts'

function fixture(): M5VisualPerformanceFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        '../../../public/config/performance/m5-visual.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as M5VisualPerformanceFixture
}

describe('M5 presentation benchmark 场景契约', () => {
  it('只读 snapshot 明确声明 presentation-only，且保留四条正式 renderer 证据', () => {
    const performanceFixture = fixture()
    const scenario = performanceFixture.scenarios.find(
      ({ id }) => id === 'visual-normal',
    )!
    const snapshot = createM5VisualPerformanceSnapshot({
      ready: false,
      fixture: performanceFixture,
      scenario,
      observedEffectKinds: [],
      currentFrame: {
        frameSequence: 1,
        frameTimeMilliseconds: 16,
        fireParticleCount: 170,
        localLightIntensity: 0.8,
        pearlRenderCountByType: {
          medicinalLiquid: 100,
          slag: 100,
          impurity: 100,
        },
        effectCountByKind: {
          steam: { activeCount: 1, renderCount: 1 },
          shield: { activeCount: 1, renderCount: 1 },
          damage: { activeCount: 1, renderCount: 1 },
          fight: { activeCount: 1, renderCount: 1 },
        },
      },
      effectPool: {
        activeCount: 0,
        capacity: scenario.effectPool.initialCapacity,
        maximumCapacity: scenario.effectPool.maximumCapacity,
        highWaterMark: 0,
        droppedCount: 0,
        overflowPolicy: 'drop-newest',
      },
      audio: {
        unlocked: false,
        muted: false,
        volume: 0.65,
        activeVoiceCount: 0,
        voiceHighWaterMark: 0,
        pendingMergedCueCount: 0,
        mergedEventCount: 0,
        playedVoiceCount: 0,
        droppedVoiceCount: 0,
      },
      trackedFrameAllocationCount: 0,
      samplingState: 'idle',
      sampledFrameCount: 0,
      simulationContentFingerprint: 'simulation-fingerprint',
      presentationContentFingerprint: 'presentation-fingerprint',
    })

    expect(snapshot).toMatchObject({
      ready: false,
      scene: 'm5-visual-performance',
      benchmarkKind: 'presentation-only',
      scenarioId: 'visual-normal',
      seed: scenario.seed,
      activePearlCount: 300,
      interactionGroupCount: 4,
      fireSize: 100,
      currentFrame: {
        fireParticleCount: 170,
        localLightIntensity: 0.8,
      },
      rendererEvidence: {
        fire: 'm5-heat-field',
        pearls: 'm5-shape-motion-surface',
        effects: 'm5-effect-pool',
        localLight: 'm5-local-light',
        automaticQualityReduction: false,
        proxyPearls: false,
      },
    })
  })

  it('场景实现不写死 300/900，数量只来自独立 fixture', () => {
    const source = readFileSync(
      new URL(
        '../../game/m5-performance/m5-visual-performance-scene.ts',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).not.toMatch(/\b300\b/)
    expect(source).not.toMatch(/\b900\b/)
    expect(source).toContain('this.#scenario.activePearlCount')
    expect(source).toContain('M5PearlSpritePool')
    expect(source).toContain("dataset.pearlBatchRenderer = 'm5-formal-sprite-pool'")
  })

  it('玩家场景与 benchmark 共用正式 Sprite 批次，配置池大小仅作为可增长初始块', () => {
    const source = readFileSync(
      new URL(
        '../../game/extraction/extraction-scene.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const renderPearls = source.slice(
      source.lastIndexOf('  #renderPearls('),
      source.lastIndexOf('  #renderCollector('),
    )

    expect(source).toContain('M5PearlSpritePool')
    expect(source).toContain('growthCapacity: effectCapacity.pearlPoolSize')
    expect(renderPearls).toContain('pearlSpritePool.ensure(')
    expect(renderPearls).toContain('pearlSpritePool.render(')
    expect(renderPearls).not.toContain('this.#pearlRenderer.draw(')
    expect(source).toContain("setChangedCanvasDataset(dataset, 'pearlRenderer', 'm5-formal-sprite-pool')")
  })

  it('正式逐帧路径不通过分配 diagnostics 对象读取 effect pool 容量，也不镜像音频分配', () => {
    const source = readFileSync(
      new URL(
        '../../game/m5-performance/m5-visual-performance-scene.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const renderEffects = source.slice(
      source.lastIndexOf('  #renderEffects('),
      source.lastIndexOf('  #renderFire('),
    )
    const updateAudio = source.slice(
      source.lastIndexOf('  #updateAudio('),
      source.lastIndexOf('  #sampleSecondIndex('),
    )

    expect(renderEffects).not.toContain('getDiagnostics()')
    expect(renderEffects).toContain('this.#effectPool.capacity')
    expect(updateAudio).toContain('runtimeStorageGrowthCount')
    expect(updateAudio).not.toContain("recordAllocation('audio', 1)")
  })

  it('采样与正式效果热循环使用索引且音频 backend 接收配置 voice 容量', () => {
    const sceneSource = readFileSync(
      new URL(
        '../../game/m5-performance/m5-visual-performance-scene.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const metricsSource = readFileSync(
      new URL(
        '../../game/m5-performance/m5-visual-performance-metrics.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const effectPoolSource = readFileSync(
      new URL('../../game/extraction/m5-effect-pool.ts', import.meta.url),
      'utf8',
    )
    const playerSource = readFileSync(
      new URL('../../game/extraction/extraction-scene.ts', import.meta.url),
      'utf8',
    )

    expect(sceneSource).not.toContain('M5_APP_ALLOCATION_KINDS.entries()')
    expect(metricsSource).not.toContain('for (const count of this.#counts)')
    expect(effectPoolSource).not.toContain('for (const slot of this.#slots)')
    expect(sceneSource).toContain(
      'createBrowserM5AudioBackend(globalThis, audioConfig.maxVoices)',
    )
    expect(playerSource).toContain(
      'createBrowserM5AudioBackend(globalThis, audioConfig.maxVoices)',
    )
  })

  it('采样 API 契约拒绝不足完整一秒和超过 fixture 上限的请求', () => {
    expect(isValidM5VisualSampleDuration(999, 60_000)).toBe(false)
    expect(isValidM5VisualSampleDuration(1_000, 60_000)).toBe(true)
    expect(isValidM5VisualSampleDuration(1_500, 60_000)).toBe(false)
    expect(isValidM5VisualSampleDuration(60_000, 60_000)).toBe(true)
    expect(isValidM5VisualSampleDuration(60_001, 60_000)).toBe(false)
  })

  it('headed 性能与 E2E 浏览器均使用浏览器级静音且不跳过 WebAudio', () => {
    const runnerSource = readFileSync(
      new URL('../../../scripts/run-m5-visual-perf.ts', import.meta.url),
      'utf8',
    )
    const playwrightConfig = readFileSync(
      new URL('../../../playwright.config.ts', import.meta.url),
      'utf8',
    )

    expect(runnerSource).toContain(
      'const M5_VISUAL_BROWSER_LAUNCH_ARGS = Object.freeze(',
    )
    expect(runnerSource).toContain("'--force-device-scale-factor=1'")
    expect(runnerSource).toContain("'--mute-audio'")
    expect(runnerSource).toContain(
      'args: [...M5_VISUAL_BROWSER_LAUNCH_ARGS]',
    )
    expect(runnerSource).toContain(
      'launchArgs: M5_VISUAL_BROWSER_LAUNCH_ARGS',
    )
    expect(runnerSource).toContain(
      'audioMutedByBrowser: m5VisualBrowserAudioMutedByLaunchArgs(',
    )
    expect(runnerSource).not.toContain('audioMutedByBrowser: true')
    expect(playwrightConfig).toContain("args: ['--mute-audio']")
    expect(runnerSource).not.toContain('new SilentM5AudioBackend')
  })

  it('音频审计只通过 performance API 显式启用，普通项目仍按配置默认静音', () => {
    const sceneSource = readFileSync(
      new URL(
        '../../game/m5-performance/m5-visual-performance-scene.ts',
        import.meta.url,
      ),
      'utf8',
    )
    const gameSource = readFileSync(
      new URL('../../game/createM5VisualPerformanceGame.ts', import.meta.url),
      'utf8',
    )
    const contractsSource = readFileSync(
      new URL('../../game/m5-performance/contracts.ts', import.meta.url),
      'utf8',
    )
    const mainSource = readFileSync(
      new URL('../../main.ts', import.meta.url),
      'utf8',
    )
    const presentation = JSON.parse(
      readFileSync(
        new URL('../../../public/config/m2/presentation.json', import.meta.url),
        'utf8',
      ),
    ) as { audio: { initiallyMuted: boolean } }

    const auditMethod = sceneSource.slice(
      sceneSource.indexOf('  async enableAudioAudit()'),
      sceneSource.indexOf('  startSample('),
    )
    expect(auditMethod).toContain('if (!this.#scenario.audio.enabled) return')
    expect(auditMethod.indexOf('await this.#audio.unlock()')).toBeGreaterThan(-1)
    expect(auditMethod.indexOf('this.#audio.setMuted(false)')).toBeGreaterThan(
      auditMethod.indexOf('await this.#audio.unlock()'),
    )
    expect(auditMethod.indexOf('this.#audio.setFireActive(true')).toBeGreaterThan(
      auditMethod.indexOf('this.#audio.setMuted(false)'),
    )
    expect(gameSource).toContain('enableAudioAudit(): Promise<void>')
    expect(gameSource).toContain(
      'enableAudioAudit: () => scene.enableAudioAudit()',
    )
    expect(contractsSource).toContain('enableAudioAudit(): Promise<void>')
    expect(mainSource).toContain(
      'enableAudioAudit: () => gameHandle!.enableAudioAudit()',
    )
    expect(presentation.audio.initiallyMuted).toBe(true)
  })

  it('runner 在用户手势后等待音频审计就绪并验证状态，再进入预热', () => {
    const runnerSource = readFileSync(
      new URL('../../../scripts/run-m5-visual-perf.ts', import.meta.url),
      'utf8',
    )
    const runScenarioSource = runnerSource.slice(
      runnerSource.indexOf('async function runScenario('),
      runnerSource.indexOf('function markdown('),
    )
    const clickIndex = runScenarioSource.indexOf(
      "await page.locator('canvas').click",
    )
    const auditIndex = runScenarioSource.indexOf('.enableAudioAudit()')
    const stateValidationIndex = runScenarioSource.indexOf(
      'M5_VISUAL_AUDIO_AUDIT_NOT_READY',
    )
    const environmentIndex = runScenarioSource.indexOf(
      'const beforeWarmupChecks = await environmentChecks',
    )
    const warmupIndex = runScenarioSource.indexOf(
      'await page.waitForTimeout(input.timing.warmupMilliseconds)',
    )

    expect(clickIndex).toBeGreaterThan(-1)
    expect(auditIndex).toBeGreaterThan(clickIndex)
    expect(stateValidationIndex).toBeGreaterThan(auditIndex)
    expect(environmentIndex).toBeGreaterThan(stateValidationIndex)
    expect(warmupIndex).toBeGreaterThan(environmentIndex)
    expect(runnerSource).toContain("id: 'audio-unlocked'")
    expect(runnerSource).toContain("id: 'audio-unmuted'")
    expect(runnerSource).toContain('snapshot.audio.unlocked === true')
    expect(runnerSource).toContain('snapshot.audio.muted === false')
  })
})
