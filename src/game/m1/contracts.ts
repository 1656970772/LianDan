import type { M1PerformanceSample } from './performance-metrics.ts'
import type { M1FlowSample } from './scenario-runtime.ts'

export const M1_OVERLAY_MODES = [
  'fire',
  'reachable',
  'direction',
  'obstacle',
  'timing',
  'none',
] as const

export type M1OverlayMode = (typeof M1_OVERLAY_MODES)[number]

export type M1BehaviorId =
  | 'blocking'
  | 'split-flow'
  | 'gap-recovery'
  | 'crowd-blocking'
  | 'downstream-rejoin'

export type M1BehaviorMetadata = Readonly<{
  id: M1BehaviorId
  labelZh: string
  scenarioId: 'pillar' | 'gap' | 'crowd'
}>

export type M1ScenarioMetadata = Readonly<{
  id: string
  labelZh: string
  kind: 'technical-probe' | 'performance'
  activePearlCount: number
  seed: number
  summaryZh: string
  behaviorIds: readonly M1BehaviorId[]
}>

export type M1Snapshot = Readonly<{
  ready: boolean
  scenarioId: string
  scenarioKind: M1ScenarioMetadata['kind']
  overlayMode: M1OverlayMode
  tick: number
  nextTick: number
  lastCommittedTick: number
  fieldGeneration: number
  renderedGeneration: number
  fieldUpdateCount: number
  activePearlCount: number
  interactionCount: number
  seed: number
  simulationContentFingerprint: string
  flowDigest: string
  ruleSample: M1FlowSample
  renderSample: M1FlowSample
  fps: number
  tickHz: number
  lastFlowDurationMs: number
  droppedTickCount: number
}>

export interface M1BrowserApi {
  getSnapshot(): M1Snapshot
  setOverlayMode(mode: M1OverlayMode): void
  startSample(durationMs: number): Promise<M1PerformanceSample>
}
