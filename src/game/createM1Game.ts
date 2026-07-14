import Phaser from 'phaser'

import type { M1FireFlowFixture } from '../config/m1-fire-flow-fixture.ts'
import type { NormalizedConfig } from '../config/model.ts'
import type {
  M1OverlayMode,
  M1Snapshot,
} from './m1/contracts.ts'
import type { M1PerformanceSample } from './m1/performance-metrics.ts'
import {
  M1TechnicalScene,
  type M1TechnicalSceneMetadata,
} from './m1/technical-scene.ts'

export const GAME_LOGICAL_WIDTH = 1600
export const GAME_LOGICAL_HEIGHT = 900

export interface CreateM1GameOptions {
  readonly parent: HTMLElement
  readonly config: NormalizedConfig
  readonly fixture: M1FireFlowFixture
  readonly simulationContentFingerprint: string
  readonly initialScenarioId: string
  readonly initialOverlayMode: M1OverlayMode
  readonly onReady?: (metadata: M1TechnicalSceneMetadata) => void
  readonly onSnapshot?: (snapshot: M1Snapshot) => void
}

export interface M1GameHandle {
  readonly game: Phaser.Game
  readonly metadata: M1TechnicalSceneMetadata
  getSnapshot(): M1Snapshot
  selectScenario(scenarioId: string): void
  setOverlayMode(mode: M1OverlayMode): void
  startSample(durationMilliseconds: number): Promise<M1PerformanceSample>
  destroy(): void
}

const METADATA: M1TechnicalSceneMetadata = Object.freeze({
  scene: 'm1-fire-flow',
  logicalWidth: GAME_LOGICAL_WIDTH,
  logicalHeight: GAME_LOGICAL_HEIGHT,
  phaserVersion: Phaser.VERSION,
})

export function createM1Game(options: CreateM1GameOptions): M1GameHandle {
  let destroyed = false
  const scene = new M1TechnicalScene(options)
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: GAME_LOGICAL_WIDTH,
    height: GAME_LOGICAL_HEIGHT,
    backgroundColor: '#11161a',
    banner: false,
    input: false,
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    scale: {
      parent: options.parent,
      width: GAME_LOGICAL_WIDTH,
      height: GAME_LOGICAL_HEIGHT,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
    },
    scene,
  })

  return {
    game,
    metadata: METADATA,
    getSnapshot: () => scene.getSnapshot(),
    selectScenario: (scenarioId) => scene.selectScenario(scenarioId),
    setOverlayMode: (mode) => scene.setOverlayMode(mode),
    startSample: (durationMilliseconds) =>
      scene.startSample(durationMilliseconds),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      scene.destroyRuntime()
      game.destroy(true)
    },
  }
}
