import Phaser from 'phaser'

import type {
  DecodedCompositionMap,
  NormalizedM2Config,
} from '../config/index.ts'
import type { LifecycleSnapshot } from '../application/index.ts'
import type { M2Snapshot } from './extraction/contracts.ts'
import type { M5EffectKind } from './extraction/m5-feedback-mapper.ts'
import type { M5MaterialTopologyEvidence } from './extraction/m5-material-topology-evidence.ts'
import type { M5PearlEvidence } from './extraction/m5-pearl-evidence.ts'
import {
  M2ExtractionScene,
  type M2ExtractionSceneMetadata,
} from './extraction/extraction-scene.ts'
import { createM2InputRouter } from './extraction/input-router.ts'

export type CreateM2GameOptions = Readonly<{
  parent: HTMLElement
  inputStage: HTMLElement
  config: NormalizedM2Config
  compositionMaps: readonly DecodedCompositionMap[]
  simulationContentFingerprint: string
  presentationContentFingerprint: string
  onReady?: (metadata: M2ExtractionSceneMetadata) => void
  onSnapshot?: (snapshot: M2Snapshot) => void
}>

export interface M2GameHandle {
  readonly game: Phaser.Game
  readonly metadata: M2ExtractionSceneMetadata
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
  destroy(): void
}

function lifecycleSnapshot(document: Document): LifecycleSnapshot {
  return {
    hasFocus: document.hasFocus(),
    visibilityState:
      document.visibilityState === 'hidden' ? 'hidden' : 'visible',
  }
}

export function createM2Game(options: CreateM2GameOptions): M2GameHandle {
  const prototype = options.config.gameplay.prototype
  const scene = new M2ExtractionScene(options)
  const metadata: M2ExtractionSceneMetadata = Object.freeze({
    scene: 'm2-extraction',
    logicalWidth: prototype.logicalWidth,
    logicalHeight: prototype.logicalHeight,
    phaserVersion: Phaser.VERSION,
  })
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: prototype.logicalWidth,
    height: prototype.logicalHeight,
    backgroundColor: prototype.theme.colors.background,
    banner: false,
    input: false,
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    scale: {
      parent: options.parent,
      width: prototype.logicalWidth,
      height: prototype.logicalHeight,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
    },
    scene,
  })

  const inputRouter = createM2InputRouter({
    stage: options.inputStage,
    coordinateSurface: game.canvas,
    logicalWidth: prototype.logicalWidth,
    logicalHeight: prototype.logicalHeight,
    fireSizeWheelStep: prototype.fireSizeWheelStep,
    getFireConstraint: () => {
      const snapshot = scene.getSnapshot()
      const equippedId = snapshot.equippedFireSourceId
      const source = options.config.gameplay.fireSources.find(
        (candidate) => candidate.id === equippedId,
      )
      if (source === undefined) return null
      return {
        origin: source.origin,
        centerDirection: prototype.initialFireDirection,
        halfAngleDegrees: source.halfAngleDegrees,
      }
    },
    getFireSize: () => scene.getSnapshot().fireSize,
    canStartSpraying: () => {
      const snapshot = scene.getSnapshot()
      return (
        snapshot.equippedFireSourceId !== null &&
        (snapshot.status === 'ready' || snapshot.status === 'extracting') &&
        !snapshot.paused &&
        snapshot.restartConfirmation === 'closed'
      )
    },
    onFireDirection: (direction) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetFireDirection', payload: direction })
    },
    onSpraying: (spraying) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetSpraying', payload: { spraying } })
    },
    onFireSize: (size) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetFireSize', payload: { size } })
    },
    onContainerAxis: (axis) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetContainerAxis', payload: { axis } })
    },
    onControl: (control) => scene.captureControl(control),
  })

  const document = options.inputStage.ownerDocument
  let destroyed = false
  return {
    game,
    metadata,
    getSnapshot: () => scene.getSnapshot(),
    getMaterialTopologyEvidence: () => scene.getMaterialTopologyEvidence(),
    getPearlEvidence: () => scene.getPearlEvidence(),
    getPresentationEvidence: () => scene.getPresentationEvidence(),
    selectFireSource: (fireSourceId) => {
      scene.unlockAudio()
      scene.captureRuleCommand({
        type: 'SelectFireSource',
        payload: { fireSourceId },
      })
    },
    preselectMaterial: (inventoryBatchId) => {
      scene.unlockAudio()
      scene.captureRuleCommand({
        type: 'PreselectMaterial',
        payload: { inventoryBatchId },
      })
    },
    cancelMaterialSelection: () => {
      scene.unlockAudio()
      scene.captureRuleCommand({
        type: 'CancelMaterialSelection',
        payload: {},
      })
    },
    addSelectedMaterial: () => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'AddSelectedMaterial', payload: {} })
    },
    setFireSize: (size) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetFireSize', payload: { size } })
    },
    setFlameThrust: (enabled) => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'SetFlameThrust', payload: { enabled } })
    },
    setAudioVolume: (volume) => {
      scene.unlockAudio()
      scene.setAudioVolume(volume)
    },
    setAudioMuted: (muted) => {
      scene.unlockAudio()
      scene.setAudioMuted(muted)
    },
    unlockAudio: () => scene.unlockAudio(),
    requestFinish: () => {
      scene.unlockAudio()
      scene.captureRuleCommand({ type: 'RequestFinish', payload: {} })
    },
    pause: () => {
      scene.unlockAudio()
      scene.captureControl({ type: 'Pause', payload: {} })
    },
    resume: () => {
      scene.unlockAudio()
      scene.captureControl({ type: 'Resume', payload: {} })
    },
    requestRestart: () => {
      scene.unlockAudio()
      scene.captureControl({ type: 'RequestRestart', payload: {} })
    },
    cancelRestart: () => {
      scene.unlockAudio()
      scene.captureControl({ type: 'CancelRestart', payload: {} })
    },
    confirmRestart: () => {
      scene.unlockAudio()
      scene.captureControl({
        type: 'ConfirmRestart',
        payload: { lifecycleSnapshot: lifecycleSnapshot(document) },
      })
    },
    again: () => {
      scene.unlockAudio()
      scene.captureControl({
        type: 'Again',
        payload: { lifecycleSnapshot: lifecycleSnapshot(document) },
      })
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      inputRouter.destroy()
      scene.destroyRuntime()
      game.destroy(true)
    },
  }
}
