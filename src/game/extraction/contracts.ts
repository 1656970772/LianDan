import type { M2WorkbenchModel } from '../../ui/createM2Workbench.ts'

export type M2Snapshot = M2WorkbenchModel &
  Readonly<{
    ready: boolean
    scene: 'm2-extraction'
    logicalWidth: number
    logicalHeight: number
    flowGeneration: number
    remainingMaterialCellCount: number
    simulationContentFingerprint: string
    lastDomainEventTypes: readonly string[]
  }>

export interface M2BrowserApi {
  getSnapshot(): M2Snapshot
  selectFireSource(fireSourceId: string): void
  preselectMaterial(inventoryBatchId: string): void
  cancelMaterialSelection(): void
  addSelectedMaterial(): void
  setFireSize(size: number): void
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
