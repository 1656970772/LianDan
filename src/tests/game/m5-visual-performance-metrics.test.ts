import { describe, expect, it } from 'vitest'

import {
  M5_APP_ALLOCATION_KINDS,
  M5FrameAllocationTracker,
  deriveExpectedM5PearlTextureStyleCount,
  evaluateM5VisualPerformanceGate,
  summarizeM5VisualPerformanceSample,
  type M5VisualEffectSecondEvidence,
  type M5VisualPerformanceSample,
} from '../../game/m5-performance/m5-visual-performance-metrics.ts'

function timestamps(rate: number, seconds: number): number[] {
  const result: number[] = []
  for (let second = 0; second < seconds; second += 1) {
    for (let frame = 0; frame < rate; frame += 1) {
      result.push(second * 1_000 + (frame * 1_000) / rate)
    }
  }
  return result
}

function sample(overrides: Partial<M5VisualPerformanceSample> = {}): M5VisualPerformanceSample {
  const frameTimestamps = timestamps(60, 2)
  const effectSeconds: M5VisualEffectSecondEvidence[] = Array.from(
    { length: 2 },
    (_, secondIndex) => ({
      secondIndex,
      byKind: {
        steam: { spawnCount: 24, renderCount: 120, activeHighWater: 8 },
        shield: { spawnCount: 12, renderCount: 72, activeHighWater: 4 },
        damage: { spawnCount: 8, renderCount: 48, activeHighWater: 3 },
        fight: { spawnCount: 4, renderCount: 24, activeHighWater: 2 },
      },
    }),
  )
  return {
    scenarioId: 'visual-normal',
    sampleStartMilliseconds: 0,
    sampleDurationMilliseconds: 2_000,
    frameTimestamps,
    frameDeltasMilliseconds: frameTimestamps.slice(1).map(
      (value, index) => value - frameTimestamps[index]!,
    ),
    longTasks: [],
    activePearlCount: 300,
    interactionGroupCount: 4,
    observedEffectKinds: ['steam', 'shield', 'damage', 'fight'],
    effectPool: {
      activeCount: 20,
      capacity: 512,
      maximumCapacity: 1024,
      highWaterMark: 80,
      droppedCount: 0,
      overflowPolicy: 'drop-newest',
    },
    audioVoiceHighWaterMark: 3,
    pearlSpritePool: {
      capacity: 300,
      initializedCount: 300,
      activeCount: 300,
      activeHighWaterMark: 300,
      renderedFrameCount: frameTimestamps.length,
      minimumRenderedCountPerFrame: 300,
      maximumRenderedCountPerFrame: 300,
      textureCount: 10,
      runtimeStorageGrowthCount: 0,
      visualKinds: ['medicinalLiquid', 'slag', 'impurity'],
      sealed: true,
    },
    effectSeconds,
    presentationEvidence: {
      fire: {
        renderedFrameCount: frameTimestamps.length,
        minimumParticleCount: 96,
        maximumParticleCount: 96,
      },
      localLight: {
        renderedFrameCount: frameTimestamps.length,
        minimumIntensity: 1,
        maximumIntensity: 1,
      },
      fight: {
        renderedFrameCount: frameTimestamps.length,
        minimumRenderedGroupCount: 4,
        maximumRenderedGroupCount: 4,
      },
    },
    frameAllocationEvidence: frameTimestamps.map(() => ({
      total: 0,
      byKind: {
        pearl: 0,
        effect: 0,
        fire: 0,
        localLight: 0,
        audio: 0,
      },
      observedKinds: [...M5_APP_ALLOCATION_KINDS],
    })),
    allocationCoverage: {
      definition: 'app-owned-explicit-frame-allocation',
      byKind: {
        pearl: 'measured',
        effect: 'measured',
        fire: 'audited-allocation-free',
        localLight: 'audited-allocation-free',
        audio: 'measured',
      },
      thirdParty: {
        phaserInternal: 'excluded-not-measured',
        webAudioInternal: 'excluded-not-measured',
      },
    },
    ...overrides,
  }
}

describe('M5 正式表现性能指标', () => {
  it('火焰与局部光使用已审计的零增长路径，不伪装成带分配 hook 的 measured', () => {
    const summary = summarizeM5VisualPerformanceSample(sample())
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(summary.allocationCoverage.byKind).toMatchObject({
      fire: 'audited-allocation-free',
      localLight: 'audited-allocation-free',
    })
    expect(
      gate.checks.find(
        ({ id }) => id === 'app-owned-allocation-coverage',
      ),
    ).toMatchObject({ passed: true })
  })

  it('正式珠 Sprite 池必须容量匹配、完整复用且保留三类视觉种类', () => {
    const summary = summarizeM5VisualPerformanceSample(sample())
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(
      gate.checks.find(({ id }) => id === 'pearl-sprite-pool'),
    ).toMatchObject({ passed: true })
    expect(summary.pearlSpritePool.visualKinds).toEqual([
      'medicinalLiquid',
      'slag',
      'impurity',
    ])
  })

  it('纹理样式期望从正式材料与珠类型配置派生，降到三种代理纹理必须失败', () => {
    const expectedPearlTextureStyleCount =
      deriveExpectedM5PearlTextureStyleCount({
        materialDefinitionIds: [
          'herb-a',
          'herb-b',
          'herb-c',
          'herb-d',
          'herb-e',
          'herb-f',
          'herb-g',
          'herb-h',
        ],
        pearlTypes: ['medicinalLiquid', 'slag', 'impurity'],
      })
    expect(expectedPearlTextureStyleCount).toBe(10)
    const base = sample()
    const summary = summarizeM5VisualPerformanceSample(
      sample({
        pearlSpritePool: {
          ...base.pearlSpritePool,
          textureCount: 3,
        },
      }),
    )
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(
      gate.checks.find(({ id }) => id === 'pearl-sprite-pool'),
    ).toMatchObject({ passed: false })
  })

  it('任一采样帧未提交全部唯一槽位时拒绝 pearl Sprite 门禁', () => {
    const base = sample()
    const summary = summarizeM5VisualPerformanceSample(
      sample({
        pearlSpritePool: {
          ...base.pearlSpritePool,
          minimumRenderedCountPerFrame: 299,
        },
      }),
    )
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(
      gate.checks.find(({ id }) => id === 'pearl-sprite-pool'),
    ).toMatchObject({ passed: false })
  })

  it('按 rAF timestamp 的完整一秒窗口统计 FPS，并汇总 delta mean/median/p95/max', () => {
    const result = summarizeM5VisualPerformanceSample(sample())

    expect(result.framesPerCompleteSecond).toEqual([60, 60])
    expect(result.minimumFramesPerCompleteSecond).toBe(60)
    expect(result.frameDelta).toMatchObject({
      meanMilliseconds: expect.any(Number),
      medianMilliseconds: expect.any(Number),
      p95Milliseconds: expect.any(Number),
      maxMilliseconds: expect.any(Number),
    })
    expect(result.longTaskCount).toBe(0)
  })

  it('逐项门禁拒绝任一完整秒、效果种类、争斗、池、voice 或分配证据失败', () => {
    const failingFrames = [
      ...timestamps(60, 1),
      ...timestamps(58, 1).map((value) => value + 1_000),
    ]
    const failing = sample({
      frameTimestamps: failingFrames,
      frameDeltasMilliseconds: failingFrames.slice(1).map(
        (value, index) => value - failingFrames[index]!,
      ),
      interactionGroupCount: 3,
      observedEffectKinds: ['steam', 'shield'],
      effectPool: {
        activeCount: 20,
        capacity: 512,
        maximumCapacity: 1_024,
        highWaterMark: 80,
        droppedCount: 1,
        overflowPolicy: 'drop-newest',
      },
      audioVoiceHighWaterMark: 0,
      frameAllocationEvidence: failingFrames.map((_, index) => ({
        total: index === 1 ? 1 : 0,
        byKind: {
          pearl: index === 1 ? 1 : 0,
          effect: 0,
          fire: 0,
          localLight: 0,
          audio: 0,
        },
        observedKinds: [...M5_APP_ALLOCATION_KINDS],
      })),
    })
    const summary = summarizeM5VisualPerformanceSample(failing)
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(gate.passed).toBe(false)
    expect(gate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fps-every-complete-second', passed: false }),
        expect.objectContaining({ id: 'interaction-groups', passed: false }),
        expect.objectContaining({ id: 'required-effect-kinds', passed: false }),
        expect.objectContaining({ id: 'effect-pool-dropped', passed: false }),
        expect.objectContaining({ id: 'audio-voice-high-water', passed: false }),
        expect.objectContaining({ id: 'tracked-frame-allocations', passed: false }),
      ]),
    )
  })

  it('受控注入五类 app-owned 分配，保留逐帧 total/byKind 且 0 门限必定失败', () => {
    const tracker = new M5FrameAllocationTracker()
    tracker.beginFrame()
    for (const kind of M5_APP_ALLOCATION_KINDS) {
      tracker.markPath(kind)
      tracker.recordAllocation(kind, 1)
    }
    const injected = tracker.snapshot()
    expect(injected).toEqual({
      total: 5,
      byKind: {
        pearl: 1,
        effect: 1,
        fire: 1,
        localLight: 1,
        audio: 1,
      },
      observedKinds: [...M5_APP_ALLOCATION_KINDS],
    })

    const base = sample()
    const summary = summarizeM5VisualPerformanceSample(
      sample({
        frameAllocationEvidence: [
          injected,
          ...base.frameAllocationEvidence.slice(1),
        ],
      }),
    )
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(summary.maximumTrackedFrameAllocationCount).toBe(5)
    expect(summary.maximumTrackedFrameAllocationByKind).toEqual({
      pearl: 1,
      effect: 1,
      fire: 1,
      localLight: 1,
      audio: 1,
    })
    expect(
      gate.checks.find(({ id }) => id === 'tracked-frame-allocations'),
    ).toMatchObject({ passed: false, actual: 5 })
  })

  it('效果种类名齐全但数值为 0，或任一完整秒缺少任一种效果，均拒绝通过', () => {
    const zeroEvidence = sample({
      effectSeconds: sample().effectSeconds.map((window) => ({
        ...window,
        byKind: {
          ...window.byKind,
          steam: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
        },
      })),
    })
    const missingOneFullSecond = sample({
      effectSeconds: sample().effectSeconds.map((window, index) =>
        index === 1
          ? {
              ...window,
              byKind: {
                ...window.byKind,
                fight: { spawnCount: 0, renderCount: 0, activeHighWater: 0 },
              },
            }
          : window,
      ),
    })
    const thresholds = {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'] as const,
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    }

    for (const input of [zeroEvidence, missingOneFullSecond]) {
      const gate = evaluateM5VisualPerformanceGate(
        summarizeM5VisualPerformanceSample(input),
        thresholds,
      )
      expect(
        gate.checks.find(({ id }) => id === 'effect-evidence-every-second'),
      ).toMatchObject({ passed: false })
      expect(gate.passed).toBe(false)
    }
  })

  it('任一完整秒缺失效果窗口，或 app-owned 路径未逐帧覆盖，均拒绝样本', () => {
    expect(() =>
      summarizeM5VisualPerformanceSample(
        sample({ effectSeconds: sample().effectSeconds.slice(0, 1) }),
      ),
    ).toThrow('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
    expect(() =>
      summarizeM5VisualPerformanceSample(
        sample({
          frameAllocationEvidence: sample().frameAllocationEvidence.map(
            (frame, index) =>
              index === 1
                ? {
                    ...frame,
                    observedKinds: frame.observedKinds.filter(
                      (kind) => kind !== 'audio',
                    ),
                  }
                : frame,
          ),
        }),
      ),
    ).toThrow('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
  })

  it('app-owned 任一路径标记 unsupported 会阻止门禁，但第三方内部保持明确排除口径', () => {
    const base = sample()
    const summary = summarizeM5VisualPerformanceSample(
      sample({
        allocationCoverage: {
          ...base.allocationCoverage,
          byKind: {
            ...base.allocationCoverage.byKind,
            audio: 'unsupported',
          },
        },
      }),
    )
    const gate = evaluateM5VisualPerformanceGate(summary, {
      expectedActivePearlCount: 300,
      expectedPearlTextureStyleCount: 10,
      minimumFramesPerCompleteSecond: 59,
      minimumInteractionGroupCount: 4,
      requiredEffectKinds: ['steam', 'shield', 'damage', 'fight'],
      maximumDroppedEffectCount: 0,
      minimumAudioVoiceHighWaterMark: 1,
      maximumTrackedFrameAllocationCount: 0,
    })

    expect(summary.allocationCoverage.thirdParty).toEqual({
      phaserInternal: 'excluded-not-measured',
      webAudioInternal: 'excluded-not-measured',
    })
    expect(
      gate.checks.find(
        ({ id }) => id === 'app-owned-allocation-coverage',
      ),
    ).toMatchObject({ passed: false })
    expect(gate.passed).toBe(false)
  })

  it('拒绝伪造的 delta 数量、非单调 timestamp 和不完整 1 秒采样', () => {
    expect(() =>
      summarizeM5VisualPerformanceSample(
        sample({ frameDeltasMilliseconds: [] }),
      ),
    ).toThrow('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
    expect(() =>
      summarizeM5VisualPerformanceSample(
        sample({ frameTimestamps: [0, 0, 10] }),
      ),
    ).toThrow('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
    expect(() =>
      summarizeM5VisualPerformanceSample(
        sample({
          sampleDurationMilliseconds: 999,
          frameTimestamps: [0],
          frameDeltasMilliseconds: [],
          frameAllocationEvidence: sample().frameAllocationEvidence.slice(0, 1),
          effectSeconds: [],
        }),
      ),
    ).toThrow('M5_VISUAL_PERFORMANCE_SAMPLE_INVALID')
  })
})
