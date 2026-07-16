import type {
  M5VisualPerformanceEffectKind,
  M5VisualPerformanceFixture,
  M5VisualPerformanceScenario,
} from '../../config/index.ts'
import type { M5AudioDiagnostics } from '../extraction/m5-audio-director.ts'
import type { M5EffectPoolDiagnostics } from '../extraction/m5-effect-pool.ts'
import type {
  M5VisualPerformanceCurrentFrameEvidence,
  M5VisualPerformanceSnapshot,
} from './contracts.ts'

export const M5_VISUAL_RENDERER_EVIDENCE = Object.freeze({
  fire: 'm5-heat-field' as const,
  pearls: 'm5-shape-motion-surface' as const,
  effects: 'm5-effect-pool' as const,
  localLight: 'm5-local-light' as const,
  automaticQualityReduction: false as const,
  proxyPearls: false as const,
})

export function isValidM5VisualSampleDuration(
  durationMilliseconds: number,
  maximumDurationMilliseconds: number,
): boolean {
  return (
    Number.isSafeInteger(durationMilliseconds) &&
    durationMilliseconds >= 1_000 &&
    durationMilliseconds % 1_000 === 0 &&
    durationMilliseconds <= maximumDurationMilliseconds
  )
}

export function createM5VisualPerformanceSnapshot(input: Readonly<{
  ready: boolean
  fixture: M5VisualPerformanceFixture
  scenario: M5VisualPerformanceScenario
  observedEffectKinds: readonly M5VisualPerformanceEffectKind[]
  currentFrame: M5VisualPerformanceCurrentFrameEvidence
  effectPool: M5EffectPoolDiagnostics
  audio: M5AudioDiagnostics
  trackedFrameAllocationCount: number
  samplingState: M5VisualPerformanceSnapshot['samplingState']
  sampledFrameCount: number
  simulationContentFingerprint: string
  presentationContentFingerprint: string
}>): M5VisualPerformanceSnapshot {
  return {
    ready: input.ready,
    scene: 'm5-visual-performance',
    benchmarkKind: 'presentation-only',
    scenarioId: input.scenario.id,
    seed: input.scenario.seed,
    logicalWidth: input.fixture.protocol.viewportWidth,
    logicalHeight: input.fixture.protocol.viewportHeight,
    deviceScaleFactor: input.fixture.protocol.deviceScaleFactor,
    activePearlCount: input.scenario.activePearlCount,
    interactionGroupCount: input.scenario.interactionGroupCount,
    fireSize: input.scenario.fireSize,
    currentFrame: input.currentFrame,
    observedEffectKinds: [...input.observedEffectKinds],
    effectPool: input.effectPool,
    audio: input.audio,
    trackedFrameAllocationCount: input.trackedFrameAllocationCount,
    samplingState: input.samplingState,
    sampledFrameCount: input.sampledFrameCount,
    simulationContentFingerprint: input.simulationContentFingerprint,
    presentationContentFingerprint: input.presentationContentFingerprint,
    rendererEvidence: M5_VISUAL_RENDERER_EVIDENCE,
  }
}
