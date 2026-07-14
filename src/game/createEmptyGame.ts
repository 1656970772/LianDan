import Phaser from 'phaser'

export const GAME_LOGICAL_WIDTH = 1600
export const GAME_LOGICAL_HEIGHT = 900

export interface EmptyGameMetadata {
  readonly scene: 'empty'
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly phaserVersion: string
}

export interface CreateEmptyGameOptions {
  readonly parent: HTMLElement
  readonly onReady?: (metadata: EmptyGameMetadata) => void
}

export interface EmptyGameHandle {
  readonly game: Phaser.Game
  readonly metadata: EmptyGameMetadata
  readonly destroy: () => void
}

const EMPTY_GAME_METADATA: EmptyGameMetadata = Object.freeze({
  scene: 'empty',
  logicalWidth: GAME_LOGICAL_WIDTH,
  logicalHeight: GAME_LOGICAL_HEIGHT,
  phaserVersion: Phaser.VERSION,
})

function publishCanvasMetadata(canvas: HTMLCanvasElement): void {
  canvas.dataset.game = 'liandan'
  canvas.dataset.gameState = 'ready'
  canvas.dataset.logicalWidth = String(GAME_LOGICAL_WIDTH)
  canvas.dataset.logicalHeight = String(GAME_LOGICAL_HEIGHT)
  canvas.dataset.phaserVersion = Phaser.VERSION
  canvas.setAttribute('aria-label', '炼丹萃取画布')
  canvas.setAttribute('role', 'img')
}

class EmptyScene extends Phaser.Scene {
  private readonly notifyReady: () => void

  constructor(notifyReady: () => void) {
    super({ key: 'm0-empty-scene' })
    this.notifyReady = notifyReady
  }

  create(): void {
    publishCanvasMetadata(this.game.canvas)
    this.notifyReady()
  }
}

export function createEmptyGame(options: CreateEmptyGameOptions): EmptyGameHandle {
  let destroyed = false

  const notifyReady = (): void => {
    if (!destroyed) {
      options.onReady?.(EMPTY_GAME_METADATA)
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: GAME_LOGICAL_WIDTH,
    height: GAME_LOGICAL_HEIGHT,
    backgroundColor: '#171815',
    banner: false,
    input: false,
    scale: {
      parent: options.parent,
      width: GAME_LOGICAL_WIDTH,
      height: GAME_LOGICAL_HEIGHT,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
    },
    scene: new EmptyScene(notifyReady),
  })

  const destroy = (): void => {
    if (destroyed) {
      return
    }

    destroyed = true
    game.destroy(true)
  }

  return Object.freeze({
    game,
    metadata: EMPTY_GAME_METADATA,
    destroy,
  })
}
