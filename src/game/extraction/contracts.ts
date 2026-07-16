import type { M2WorkbenchModel } from '../../ui/createM2Workbench.ts'
import type { M5AudioDiagnostics } from './m5-audio-director.ts'
import type { M5EffectPoolDiagnostics } from './m5-effect-pool.ts'
import type {
  M5FailurePresentationState,
  M5FirePresentationState,
} from './m5-presentation-lifecycle.ts'
import type { M5EffectKind } from './m5-feedback-mapper.ts'
import type { M5MaterialTopologyEvidence } from './m5-material-topology-evidence.ts'
import type { M5PearlEvidence } from './m5-pearl-evidence.ts'

export type M2Snapshot = M2WorkbenchModel &
  Readonly<{
    ready: boolean
    scene: 'm2-extraction'
    logicalWidth: number
    logicalHeight: number
    seed: number
    flowGeneration: number
    remainingMaterialCellCount: number
    simulationContentFingerprint: string
    presentationContentFingerprint: string
    lastDomainEventTypes: readonly string[]
    pauseReasons: readonly string[]
    firePresentationState: M5FirePresentationState
    fireVisualIntensity: number
    failurePresentationState: M5FailurePresentationState
    failurePresentationProgress: number
    audioDiagnostics: M5AudioDiagnostics
    effectPoolDiagnostics: M5EffectPoolDiagnostics
  }>

export interface M2BrowserApi {
  getSnapshot(): M2Snapshot
  getMaterialTopologyEvidence(): readonly M5MaterialTopologyEvidence[]
  getPearlEvidence(): readonly M5PearlEvidence[]
  getPresentationEvidence(): Readonly<{
    activeEffectKinds: readonly M5EffectKind[]
    collectorCenter: Readonly<{ x: number; y: number }>
    collectorVelocityX: number
    simulationTick: number
  }>
  selectFireSource(fireSourceId: string): void
  preselectMaterial(inventoryBatchId: string): void
  cancelMaterialSelection(): void
  addSelectedMaterial(): void
  setFireSize(size: number): void
  setFlameThrust(enabled: boolean): void
  setAudioVolume(volume: number): void
  setAudioMuted(muted: boolean): void
  unlockAudio(): void
  requestFinish(): void
  pause(): void
  resume(): void
  requestRestart(): void
  cancelRestart(): void
  confirmRestart(): void
  again(): void
}

declare global {
  interface Window {
    __LIANDAN_M2__?: M2BrowserApi
  }
}
