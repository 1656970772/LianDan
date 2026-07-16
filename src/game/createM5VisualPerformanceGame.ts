import Phaser from 'phaser'

import type {
  M5VisualPerformanceFixture,
  M5VisualPerformanceScenario,
  NormalizedM2Config,
} from '../config/index.ts'
import type {
  M5VisualPerformanceSample,
} from './m5-performance/m5-visual-performance-metrics.ts'
import type { M5VisualPerformanceSnapshot } from './m5-performance/contracts.ts'
import { M5VisualPerformanceScene } from './m5-performance/m5-visual-performance-scene.ts'

export type CreateM5VisualPerformanceGameOptions = Readonly<{
  parent: HTMLElement
  config: NormalizedM2Config
  fixture: M5VisualPerformanceFixture
  scenario: M5VisualPerformanceScenario
  simulationContentFingerprint: string
  presentationContentFingerprint: string
  onReady?: () => void
}>

export interface M5VisualPerformanceGameHandle {
  readonly game: Phaser.Game
  snapshot(): M5VisualPerformanceSnapshot
  startSample(durationMilliseconds: number): Promise<M5VisualPerformanceSample>
  unlockAudio(): Promise<void>
  enableAudioAudit(): Promise<void>
  destroy(): void
}

export function createM5VisualPerformanceGame(
  options: CreateM5VisualPerformanceGameOptions,
): M5VisualPerformanceGameHandle {
  const scene = new M5VisualPerformanceScene({
    config: options.config,
    fixture: options.fixture,
    scenario: options.scenario,
    simulationContentFingerprint: options.simulationContentFingerprint,
    presentationContentFingerprint: options.presentationContentFingerprint,
    onReady: options.onReady,
  })
  const protocol = options.fixture.protocol
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: protocol.viewportWidth,
    height: protocol.viewportHeight,
    backgroundColor: options.config.gameplay.prototype.theme.colors.background,
    banner: false,
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    scale: {
      parent: options.parent,
      width: protocol.viewportWidth,
      height: protocol.viewportHeight,
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
    },
    scene,
  })
  let destroyed = false
  return {
    game,
    snapshot: () => scene.getSnapshot(),
    startSample: (durationMilliseconds) =>
      scene.startSample(durationMilliseconds),
    unlockAudio: () => scene.unlockAudio(),
    enableAudioAudit: () => scene.enableAudioAudit(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      scene.destroyRuntime()
      game.destroy(true)
    },
  }
}
