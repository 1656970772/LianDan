import type { M5VisualPerformanceEffectKind } from '../../config/index.ts'
import type { M5AudioDiagnostics } from '../extraction/m5-audio-director.ts'
import type { M5EffectPoolDiagnostics } from '../extraction/m5-effect-pool.ts'
import type { M5VisualPerformanceSample } from './m5-visual-performance-metrics.ts'

export type M5VisualPerformanceCurrentFrameEvidence = Readonly<{
  frameSequence: number
  frameTimeMilliseconds: number
  fireParticleCount: number
  localLightIntensity: number
  pearlRenderCountByType: Readonly<{
    medicinalLiquid: number
    slag: number
    impurity: number
  }>
  effectCountByKind: Readonly<{
    steam: Readonly<{ activeCount: number; renderCount: number }>
    shield: Readonly<{ activeCount: number; renderCount: number }>
    damage: Readonly<{ activeCount: number; renderCount: number }>
    fight: Readonly<{ activeCount: number; renderCount: number }>
  }>
}>

export type M5VisualPerformanceSnapshot = Readonly<{
  ready: boolean
  scene: 'm5-visual-performance'
  benchmarkKind: 'presentation-only'
  scenarioId: string
  seed: number
  logicalWidth: number
  logicalHeight: number
  deviceScaleFactor: number
  activePearlCount: number
  interactionGroupCount: number
  fireSize: number
  currentFrame: M5VisualPerformanceCurrentFrameEvidence
  observedEffectKinds: readonly M5VisualPerformanceEffectKind[]
  effectPool: M5EffectPoolDiagnostics
  audio: M5AudioDiagnostics
  trackedFrameAllocationCount: number
  samplingState: 'idle' | 'sampling' | 'complete'
  sampledFrameCount: number
  simulationContentFingerprint: string
  presentationContentFingerprint: string
  rendererEvidence: Readonly<{
    fire: 'm5-heat-field'
    pearls: 'm5-shape-motion-surface'
    effects: 'm5-effect-pool'
    localLight: 'm5-local-light'
    automaticQualityReduction: false
    proxyPearls: false
  }>
}>

export interface M5VisualPerformanceBrowserApi {
  snapshot(): M5VisualPerformanceSnapshot
  startSample(durationMilliseconds: number): Promise<M5VisualPerformanceSample>
  enableAudioAudit(): Promise<void>
}

declare global {
  interface Window {
    __LIANDAN_M5_PERFORMANCE__?: M5VisualPerformanceBrowserApi
  }
}
