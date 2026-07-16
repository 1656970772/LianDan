export {
  GAME_LOGICAL_HEIGHT,
  GAME_LOGICAL_WIDTH,
  createM1Game,
  type CreateM1GameOptions,
  type M1GameHandle,
} from './createM1Game.ts'
export {
  M1_OVERLAY_MODES,
  type M1BrowserApi,
  type M1OverlayMode,
  type M1Snapshot,
} from './m1/contracts.ts'
export type { M1PerformanceSample } from './m1/performance-metrics.ts'
export {
  createM2Game,
  type CreateM2GameOptions,
  type M2GameHandle,
} from './createM2Game.ts'
export type { M2BrowserApi, M2Snapshot } from './extraction/contracts.ts'
export {
  createM5VisualPerformanceGame,
  type CreateM5VisualPerformanceGameOptions,
  type M5VisualPerformanceGameHandle,
} from './createM5VisualPerformanceGame.ts'
export type {
  M5VisualPerformanceBrowserApi,
  M5VisualPerformanceSnapshot,
} from './m5-performance/contracts.ts'
export {
  evaluateM5VisualPerformanceGate,
  summarizeM5VisualPerformanceSample,
  type M5VisualPerformanceGate,
  type M5VisualPerformanceGateCheck,
  type M5VisualPerformanceSample,
  type M5VisualPerformanceSummary,
  type M5VisualPerformanceThresholds,
} from './m5-performance/m5-visual-performance-metrics.ts'
