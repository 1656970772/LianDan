export type M5VisualPerformanceEffectKind =
  | 'steam'
  | 'shield'
  | 'damage'
  | 'fight'

export interface M5VisualPerformanceScenario {
  readonly id: string
  readonly seed: number
  readonly activePearlCount: number
  readonly fireSize: number
  readonly interactionGroupCount: number
  readonly pearlTypeWeights: Readonly<{
    medicinalLiquid: number
    slag: number
    impurity: number
  }>
  readonly motion: Readonly<{
    horizontalAmplitudePixels: number
    verticalAmplitudePixels: number
    cyclesPerSecond: number
  }>
  readonly effectSchedule: Readonly<{
    steamPerSecond: number
    shieldPerSecond: number
    damagePerSecond: number
    fightPerSecond: number
  }>
  readonly requiredEffectKinds: readonly M5VisualPerformanceEffectKind[]
  readonly effectPool: Readonly<{
    initialCapacity: number
    maximumCapacity: number
  }>
  readonly audio: Readonly<{
    enabled: boolean
    cueIntervalMilliseconds: number
  }>
  readonly thresholds: Readonly<{
    minimumFramesPerCompleteSecond: number
    minimumInteractionGroupCount: number
    maximumDroppedEffectCount: number
    minimumAudioVoiceHighWaterMark: number
    maximumTrackedFrameAllocationCount: number
  }>
}

export interface M5VisualPerformanceFixture {
  readonly schemaVersion: 1
  readonly id: 'm5-visual-performance'
  readonly benchmarkKind: 'presentation-only'
  readonly protocol: Readonly<{
    warmupSeconds: number
    sampleSeconds: number
    viewportWidth: number
    viewportHeight: number
    deviceScaleFactor: number
    maximumRecordedFramesPerSecond: number
  }>
  readonly scenarios: M5VisualPerformanceScenario[]
}

export interface M5VisualPerformanceFixtureIssue {
  readonly code:
    | 'M5_VISUAL_DUPLICATE_SCENARIO_ID'
    | 'M5_VISUAL_DUPLICATE_PEARL_COUNT'
    | 'M5_VISUAL_REQUIRED_SCENARIO_MISSING'
    | 'M5_VISUAL_PROTOCOL_INVALID'
    | 'M5_VISUAL_NORMAL_PEARL_TYPE_MISSING'
    | 'M5_VISUAL_EFFECT_KIND_MISSING'
    | 'M5_VISUAL_INTERACTION_GROUPS_INSUFFICIENT'
    | 'M5_VISUAL_EFFECT_POOL_CAPACITY_INVALID'
    | 'M5_VISUAL_THRESHOLD_INVALID'
  readonly fieldPath: string
  readonly messageZh: string
}

function issue(
  code: M5VisualPerformanceFixtureIssue['code'],
  fieldPath: string,
  messageZh: string,
): M5VisualPerformanceFixtureIssue {
  return { code, fieldPath, messageZh }
}

const REQUIRED_EFFECT_KINDS: readonly M5VisualPerformanceEffectKind[] = [
  'steam',
  'shield',
  'damage',
  'fight',
]

const REQUIRED_SCENARIOS = Object.freeze({
  'visual-normal': Object.freeze({ pearlCount: 300, minimumFps: 59 }),
  'visual-stress': Object.freeze({ pearlCount: 900, minimumFps: 45 }),
})

/**
 * 对 JSON Schema 无法表达的里程碑硬约束做语义校验。场景仍由 fixture
 * 驱动，渲染层不含 300/900 或门限分支。
 */
export function validateM5VisualPerformanceFixtureSemantics(
  fixture: M5VisualPerformanceFixture,
): readonly M5VisualPerformanceFixtureIssue[] {
  const issues: M5VisualPerformanceFixtureIssue[] = []
  const protocol = fixture.protocol
  if (
    protocol.warmupSeconds !== 10 ||
    protocol.sampleSeconds !== 60 ||
    protocol.viewportWidth !== 1600 ||
    protocol.viewportHeight !== 900 ||
    protocol.deviceScaleFactor !== 1 ||
    protocol.maximumRecordedFramesPerSecond < 60
  ) {
    issues.push(
      issue(
        'M5_VISUAL_PROTOCOL_INVALID',
        '/protocol',
        'M5 正式表现门禁必须使用 1600x900、DPR1、10 秒预热和 60 秒采样',
      ),
    )
  }

  const ids = new Set<string>()
  const pearlCounts = new Set<number>()
  for (const [index, scenario] of fixture.scenarios.entries()) {
    const path = `/scenarios/${index}`
    if (ids.has(scenario.id)) {
      issues.push(
        issue(
          'M5_VISUAL_DUPLICATE_SCENARIO_ID',
          `${path}/id`,
          `表现性能场景 ID ${scenario.id} 重复`,
        ),
      )
    }
    ids.add(scenario.id)
    if (pearlCounts.has(scenario.activePearlCount)) {
      issues.push(
        issue(
          'M5_VISUAL_DUPLICATE_PEARL_COUNT',
          `${path}/activePearlCount`,
          `表现性能场景珠数 ${scenario.activePearlCount} 重复`,
        ),
      )
    }
    pearlCounts.add(scenario.activePearlCount)

    const weights = Object.values(scenario.pearlTypeWeights)
    if (weights.some((value) => !Number.isFinite(value) || value <= 0)) {
      issues.push(
        issue(
          'M5_VISUAL_NORMAL_PEARL_TYPE_MISSING',
          `${path}/pearlTypeWeights`,
          '正式表现基准必须以正权重包含三类正常尺寸珠',
        ),
      )
    }
    const effectKinds = new Set(scenario.requiredEffectKinds)
    if (REQUIRED_EFFECT_KINDS.some((kind) => !effectKinds.has(kind))) {
      issues.push(
        issue(
          'M5_VISUAL_EFFECT_KIND_MISSING',
          `${path}/requiredEffectKinds`,
          '正式表现基准必须保留蒸汽、护盾、受伤和争斗效果',
        ),
      )
    }
    if (scenario.interactionGroupCount < 4) {
      issues.push(
        issue(
          'M5_VISUAL_INTERACTION_GROUPS_INSUFFICIENT',
          `${path}/interactionGroupCount`,
          '正式表现基准必须同时展示至少 4 组争斗',
        ),
      )
    }
    if (
      scenario.effectPool.initialCapacity >
        scenario.effectPool.maximumCapacity ||
      scenario.effectPool.maximumCapacity < 1
    ) {
      issues.push(
        issue(
          'M5_VISUAL_EFFECT_POOL_CAPACITY_INVALID',
          `${path}/effectPool`,
          '效果池初始容量不得超过最大容量，且最大容量必须为正整数',
        ),
      )
    }
    if (
      scenario.thresholds.minimumInteractionGroupCount < 4 ||
      scenario.thresholds.maximumDroppedEffectCount !== 0 ||
      scenario.thresholds.minimumAudioVoiceHighWaterMark < 1 ||
      scenario.thresholds.maximumTrackedFrameAllocationCount !== 0
    ) {
      issues.push(
        issue(
          'M5_VISUAL_THRESHOLD_INVALID',
          `${path}/thresholds`,
          '表现正确性门限不得放宽争斗、效果池丢弃、音频 voice 或逐帧受跟踪分配要求',
        ),
      )
    }
  }

  for (const [id, expected] of Object.entries(REQUIRED_SCENARIOS)) {
    const scenario = fixture.scenarios.find((candidate) => candidate.id === id)
    if (
      scenario === undefined ||
      scenario.activePearlCount !== expected.pearlCount ||
      scenario.fireSize !== 100 ||
      scenario.thresholds.minimumFramesPerCompleteSecond !==
        expected.minimumFps
    ) {
      issues.push(
        issue(
          'M5_VISUAL_REQUIRED_SCENARIO_MISSING',
          '/scenarios',
          `缺少符合里程碑硬门限的 ${id} 表现场景`,
        ),
      )
    }
  }
  return issues
}
