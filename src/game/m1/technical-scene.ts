import Phaser from 'phaser'

import type { M1FireFlowFixture } from '../../config/m1-fire-flow-fixture.ts'
import type { NormalizedConfig } from '../../config/model.ts'
import type { FireFlowReadView } from '../../simulation/fire-flow/index.ts'
import {
  createDropletOutline,
  drawDroplet,
} from '../presentation/droplet.ts'
import type { M1OverlayMode, M1Snapshot } from './contracts.ts'
import {
  M1FireHeatField,
  type M1FireOcclusionInput,
} from './fire-heat-field.ts'
import { M1_FIRE_PRESENTATION_CONFIG } from './fire-presentation-config.ts'
import { M1FirePresentation } from './fire-presentation.ts'
import {
  resolveM1PearlPresentation,
} from './pearl-presentation-config.ts'
import type { M1PerformanceSample } from './performance-metrics.ts'
import { sampleM1FlowView } from './scenario-runtime.ts'
import {
  M1TechnicalRuntime,
  type M1TechnicalRuntimeOptions,
} from './technical-runtime.ts'

const FLOW_TEXTURE_KEY = 'm1-fire-flow-overlay'
const FIRE_TEXTURE_KEY = 'm1-fire-heat-field'
const ACCENT_COLOR = 0xd06a3a
const COLD_SURFACE_COLOR = 0x20262c
const COLD_CHAMBER_COLOR = 0x11161a
const BORDER_COLOR = 0x47525b
const SNAPSHOT_INTERVAL_MILLISECONDS = 200

export type M1TechnicalSceneMetadata = Readonly<{
  scene: 'm1-fire-flow'
  logicalWidth: number
  logicalHeight: number
  phaserVersion: string
}>

export interface M1TechnicalSceneOptions extends M1TechnicalRuntimeOptions {
  readonly config: NormalizedConfig
  readonly fixture: M1FireFlowFixture
  readonly onReady?: (metadata: M1TechnicalSceneMetadata) => void
  readonly onSnapshot?: (snapshot: M1Snapshot) => void
}

function publishCanvasMetadata(
  canvas: HTMLCanvasElement,
  snapshot: M1Snapshot,
): void {
  canvas.dataset.game = 'liandan'
  canvas.dataset.gameState = snapshot.ready ? 'ready' : 'loading'
  canvas.dataset.scene = 'm1-fire-flow'
  canvas.dataset.logicalWidth = '1600'
  canvas.dataset.logicalHeight = '900'
  canvas.dataset.phaserVersion = Phaser.VERSION
  canvas.dataset.scenarioId = snapshot.scenarioId
  canvas.dataset.overlayMode = snapshot.overlayMode
  canvas.dataset.fieldGeneration = String(snapshot.fieldGeneration)
  canvas.dataset.renderedGeneration = String(snapshot.renderedGeneration)
  canvas.dataset.flowDigest = snapshot.flowDigest
  canvas.dataset.fireRenderer = 'heat-field'
  canvas.dataset.simulationContentFingerprint =
    snapshot.simulationContentFingerprint
  canvas.setAttribute('aria-label', '炼丹萃取火流技术场景')
  canvas.setAttribute('role', 'img')
}

export class M1TechnicalScene extends Phaser.Scene {
  readonly #options: M1TechnicalSceneOptions
  readonly #runtime: M1TechnicalRuntime
  #baseGraphics: Phaser.GameObjects.Graphics | null = null
  #foregroundGraphics: Phaser.GameObjects.Graphics | null = null
  #arrowGraphics: Phaser.GameObjects.Graphics | null = null
  #fireSparkGraphics: Phaser.GameObjects.Graphics | null = null
  #fireImage: Phaser.GameObjects.Image | null = null
  #fireTexture: Phaser.Textures.CanvasTexture | null = null
  #firePixels: ImageData | null = null
  #overlayImage: Phaser.GameObjects.Image | null = null
  #overlayTexture: Phaser.Textures.CanvasTexture | null = null
  #overlayPixels: ImageData | null = null
  #lastRenderedGeneration = -1
  #lastSnapshotTimestamp = Number.NEGATIVE_INFINITY
  #readyNotified = false
  readonly #firePresentation = new M1FirePresentation(
    M1_FIRE_PRESENTATION_CONFIG,
  )
  readonly #fireHeatField = new M1FireHeatField(
    M1_FIRE_PRESENTATION_CONFIG.heatField,
  )
  readonly #reducedMotion =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  #firePrepared = false
  #fireLayerVisible = false
  #lastFireTimestamp = Number.NaN
  readonly #dropletOutlines = new Map<number, Phaser.Math.Vector2[]>()
  #fireOcclusionInput: M1FireOcclusionInput | null = null

  constructor(options: M1TechnicalSceneOptions) {
    super({ key: 'm1-fire-flow-scene' })
    this.#options = options
    this.#runtime = new M1TechnicalRuntime(options)
  }

  create(): void {
    const view = this.#runtime.view
    this.#baseGraphics = this.add.graphics()
    const heatFieldConfig = M1_FIRE_PRESENTATION_CONFIG.heatField
    this.#fireTexture = this.textures.createCanvas(
      FIRE_TEXTURE_KEY,
      heatFieldConfig.width,
      heatFieldConfig.height,
    )
    if (this.#fireTexture === null) {
      throw new Error('M1_FIRE_TEXTURE_UNAVAILABLE')
    }
    this.#fireImage = this.add
      .image(0, 0, FIRE_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDisplaySize(
        heatFieldConfig.width * heatFieldConfig.pixelScale,
        heatFieldConfig.height * heatFieldConfig.pixelScale,
      )
      .setVisible(false)
    this.#fireImage.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.#overlayTexture = this.textures.createCanvas(
      FLOW_TEXTURE_KEY,
      view.columns,
      view.rows,
    )
    if (this.#overlayTexture === null) {
      throw new Error('M1_OVERLAY_TEXTURE_UNAVAILABLE')
    }
    this.#overlayPixels = this.#overlayTexture.context.createImageData(
      view.columns,
      view.rows,
    )
    this.#overlayImage = this.add
      .image(0, 0, FLOW_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDisplaySize(view.columns * view.cellSize, view.rows * view.cellSize)
    this.#overlayImage.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.#arrowGraphics = this.add.graphics()
    this.#fireSparkGraphics = this.add.graphics().setVisible(false)
    this.#foregroundGraphics = this.add.graphics()
    this.#renderBorrowedView()
    if (this.#runtime.overlayMode !== 'fire') this.#disableFirePresentation()
    publishCanvasMetadata(this.game.canvas, this.#runtime.snapshot())
  }

  update(time: number): void {
    const wallTimestamp = performance.now()
    this.#runtime.frame(time, wallTimestamp)
    if (this.#runtime.view.generation !== this.#lastRenderedGeneration) {
      this.#renderBorrowedView()
    }
    if (this.#runtime.overlayMode === 'fire') {
      this.#renderFireFrame(wallTimestamp)
    }
    const snapshot = this.#runtime.snapshot(wallTimestamp)
    publishCanvasMetadata(this.game.canvas, snapshot)
    if (snapshot.ready && !this.#readyNotified) {
      this.#readyNotified = true
      this.#options.onReady?.({
        scene: 'm1-fire-flow',
        logicalWidth: 1600,
        logicalHeight: 900,
        phaserVersion: Phaser.VERSION,
      })
    }
    if (
      snapshot.ready &&
      wallTimestamp - this.#lastSnapshotTimestamp >=
        SNAPSHOT_INTERVAL_MILLISECONDS
    ) {
      this.#lastSnapshotTimestamp = wallTimestamp
      this.#options.onSnapshot?.(snapshot)
    }
  }

  selectScenario(scenarioId: string): void {
    this.#runtime.selectScenario(scenarioId)
    this.#lastRenderedGeneration = -1
    this.#firePrepared = false
    this.#lastFireTimestamp = Number.NaN
    if (this.#baseGraphics !== null) this.#renderBorrowedView()
    if (this.#runtime.overlayMode === 'fire') {
      this.#renderFireFrame(performance.now())
    }
    const snapshot = this.#runtime.snapshot()
    publishCanvasMetadata(this.game.canvas, snapshot)
    this.#options.onSnapshot?.(snapshot)
  }

  setOverlayMode(mode: M1OverlayMode): void {
    const previousMode = this.#runtime.overlayMode
    this.#runtime.setOverlayMode(mode)
    if (this.#baseGraphics !== null) this.#renderBorrowedView()
    if (mode === 'fire') {
      this.#renderFireFrame(performance.now())
    } else if (previousMode === 'fire') {
      this.#disableFirePresentation()
    }
    const snapshot = this.#runtime.snapshot()
    publishCanvasMetadata(this.game.canvas, snapshot)
    this.#options.onSnapshot?.(snapshot)
  }

  getSnapshot(): M1Snapshot {
    return this.#runtime.snapshot()
  }

  startSample(durationMilliseconds: number): Promise<M1PerformanceSample> {
    return this.#runtime.startSample(durationMilliseconds)
  }

  destroyRuntime(): void {
    this.#runtime.destroy()
  }

  #renderBorrowedView(): void {
    const base = this.#baseGraphics
    const foreground = this.#foregroundGraphics
    const arrows = this.#arrowGraphics
    const texture = this.#overlayTexture
    const image = this.#overlayImage
    const pixels = this.#overlayPixels
    if (
      base === null ||
      foreground === null ||
      arrows === null ||
      texture === null ||
      image === null ||
      pixels === null
    ) {
      return
    }

    const view = this.#runtime.view
    const scenario = this.#runtime.scenario
    const circles = this.#runtime.circles
    base.clear()
    base.fillStyle(COLD_SURFACE_COLOR, 1)
    base.fillRoundedRect(16, 16, 1_568, 868, 8)
    base.fillStyle(COLD_CHAMBER_COLOR, 1)
    base.fillRoundedRect(40, 40, 1_520, 820, 8)
    base.lineStyle(2, BORDER_COLOR, 1)
    base.strokeRoundedRect(40, 40, 1_520, 820, 8)

    foreground.clear()
    foreground.fillStyle(BORDER_COLOR, 0.9)
    for (const rect of scenario.fullObstacleRects) {
      foreground.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
    const pearlPresentation = resolveM1PearlPresentation(
      scenario.metadata.kind,
    )
    const canvas = this.game.canvas
    canvas.dataset.pearlRenderer = pearlPresentation.renderer
    canvas.dataset.pearlRadius = String(scenario.circles.radius)
    canvas.dataset.fireOcclusion = pearlPresentation.fireOcclusion.mode
    if (pearlPresentation.renderer === 'circle-proxy') {
      foreground.fillStyle(
        pearlPresentation.fillColor,
        pearlPresentation.fillAlpha,
      )
      for (let index = 0; index < circles.count; index += 1) {
        if (circles.eligible[index] === 0) continue
        foreground.fillCircle(
          circles.x[index]!,
          circles.y[index]!,
          circles.radius[index]!,
        )
      }
    } else {
      for (let index = 0; index < circles.count; index += 1) {
        if (circles.eligible[index] === 0) continue
        const radius = circles.radius[index]!
        let outline = this.#dropletOutlines.get(radius)
        if (outline === undefined) {
          outline = createDropletOutline(radius, pearlPresentation.droplet)
          this.#dropletOutlines.set(radius, outline)
        }
        drawDroplet(
          foreground,
          circles.x[index]!,
          circles.y[index]!,
          radius,
          outline,
          pearlPresentation,
        )
      }
    }
    const source = scenario.source
    foreground.fillStyle(ACCENT_COLOR, 1)
    foreground.fillRect(
      source.position.x - source.width / 2,
      source.position.y - 6,
      source.width,
      12,
    )

    const overlay = this.#runtime.overlayMode
    const debugOverlay = overlay !== 'none' && overlay !== 'fire'
    image.setVisible(debugOverlay)
    arrows.clear()
    if (debugOverlay) {
      this.#paintOverlayPixels(view, pixels.data, overlay)
      texture.context.putImageData(pixels, 0, 0)
      texture.refresh()
    }
    if (overlay === 'direction') this.#paintDirectionArrows(view, arrows)

    const renderSample = sampleM1FlowView(
      view,
      this.#runtime.samplePosition(),
    )
    this.#runtime.markRendered(renderSample)
    this.#lastRenderedGeneration = view.generation
  }

  #renderFireFrame(wallTimestamp: number): void {
    const texture = this.#fireTexture
    const image = this.#fireImage
    const sparks = this.#fireSparkGraphics
    if (texture === null || image === null || sparks === null) return

    if (this.#runtime.overlayMode !== 'fire') return

    const canvas = this.game.canvas
    image.setVisible(true)
    sparks.setVisible(true)
    this.#fireLayerVisible = true
    const view = this.#runtime.view
    if (!this.#firePrepared && view.generation > 0) {
      this.#firePresentation.reset(view, this.#runtime.scenario.source)
      this.#firePrepared = true
    }
    if (!this.#firePrepared) {
      canvas.dataset.fireState = 'loading'
      return
    }

    const config = M1_FIRE_PRESENTATION_CONFIG
    const minimumFrameMilliseconds =
      1_000 / config.heatField.maximumFramesPerSecond
    if (
      Number.isFinite(this.#lastFireTimestamp) &&
      (this.#reducedMotion ||
        wallTimestamp - this.#lastFireTimestamp < minimumFrameMilliseconds)
    ) {
      return
    }

    if (!this.#reducedMotion && Number.isFinite(this.#lastFireTimestamp)) {
      this.#firePresentation.advance(
        view,
        this.#runtime.scenario.source,
        (wallTimestamp - this.#lastFireTimestamp) / 1_000,
      )
    }
    this.#lastFireTimestamp = wallTimestamp

    const particles = this.#firePresentation.particles
    const scenario = this.#runtime.scenario
    const pearlPresentation = resolveM1PearlPresentation(
      scenario.metadata.kind,
    )
    let occlusion: M1FireOcclusionInput | undefined
    if (pearlPresentation.fireOcclusion.mode === 'precise-geometry') {
      if (this.#fireOcclusionInput === null) {
        this.#fireOcclusionInput = {
          fullObstacleRects: scenario.fullObstacleRects,
          circles: this.#runtime.circles,
          circleRadiusScale:
            pearlPresentation.fireOcclusion.circleRadiusScale,
          circleFeatherPixels:
            pearlPresentation.fireOcclusion.circleFeatherPixels,
        }
      } else {
        this.#fireOcclusionInput.fullObstacleRects =
          scenario.fullObstacleRects
        this.#fireOcclusionInput.circles = this.#runtime.circles
        this.#fireOcclusionInput.circleRadiusScale =
          pearlPresentation.fireOcclusion.circleRadiusScale
        this.#fireOcclusionInput.circleFeatherPixels =
          pearlPresentation.fireOcclusion.circleFeatherPixels
      }
      occlusion = this.#fireOcclusionInput
    }
    const frame = this.#fireHeatField.render(
      view,
      particles,
      scenario.source,
      occlusion,
    )
    if (this.#firePixels === null) {
      this.#firePixels = new ImageData(frame.pixels, frame.width, frame.height)
    }
    texture.context.putImageData(this.#firePixels, 0, 0)
    texture.refresh()

    sparks.clear()
    sparks.fillStyle(config.colors.head, config.sparks.alpha)
    for (
      let index = 0;
      index < particles.count;
      index += config.sparks.stride
    ) {
      sparks.fillCircle(
        particles.x[index]! + particles.displayOffsetX[index]!,
        particles.y[index]! + particles.displayOffsetY[index]!,
        config.sparks.radiusPixels * particles.sizeScale[index]!,
      )
    }

    canvas.dataset.fireState = this.#reducedMotion ? 'reduced' : 'animated'
    canvas.dataset.fireFrame = String(this.#firePresentation.frame)
    canvas.dataset.fireParticleCount = String(particles.count)
  }

  #disableFirePresentation(): void {
    const image = this.#fireImage
    const sparks = this.#fireSparkGraphics
    if (image === null || sparks === null) return

    if (this.#fireLayerVisible) {
      image.setVisible(false)
      sparks.clear().setVisible(false)
      this.#fireLayerVisible = false
    }
    this.#lastFireTimestamp = Number.NaN
    const canvas = this.game.canvas
    canvas.dataset.fireState = 'off'
    canvas.dataset.fireParticleCount = '0'
    delete canvas.dataset.fireFrame
  }

  #paintOverlayPixels(
    view: FireFlowReadView,
    pixels: Uint8ClampedArray,
    overlay: M1OverlayMode,
  ): void {
    const timingAlpha = Math.min(
      1,
      Math.max(0.2, this.#runtime.snapshot().lastFlowDurationMs / 12),
    )
    for (let index = 0; index < view.intensity.length; index += 1) {
      const offset = index * 4
      const obstacle = view.obstacle[index]!
      const reachable = view.intensity[index]! > 0
      if (overlay === 'obstacle') {
        const shade = Math.round(42 + obstacle * 122)
        pixels[offset] = shade
        pixels[offset + 1] = shade + 4
        pixels[offset + 2] = shade + 7
        pixels[offset + 3] = obstacle > 0 ? 230 : 34
      } else if (reachable) {
        pixels[offset] = 208
        pixels[offset + 1] = 94
        pixels[offset + 2] = 50
        pixels[offset + 3] = Math.round(
          150 * (overlay === 'timing' ? timingAlpha : 1),
        )
      } else {
        pixels[offset] = 28
        pixels[offset + 1] = 34
        pixels[offset + 2] = 39
        pixels[offset + 3] = overlay === 'direction' ? 32 : 64
      }
    }
  }

  #paintDirectionArrows(
    view: FireFlowReadView,
    graphics: Phaser.GameObjects.Graphics,
  ): void {
    const stride = 4
    const length = view.cellSize * 1.15
    graphics.lineStyle(2, ACCENT_COLOR, 0.9)
    graphics.beginPath()
    for (let row = 2; row < view.rows; row += stride) {
      for (let column = 2; column < view.columns; column += stride) {
        const index = row * view.columns + column
        if (view.intensity[index] === 0) continue
        const flowX = view.flowX[index]!
        const flowY = view.flowY[index]!
        const centerX = view.originX + (column + 0.5) * view.cellSize
        const centerY = view.originY + (row + 0.5) * view.cellSize
        graphics.moveTo(centerX, centerY)
        graphics.lineTo(centerX + flowX * length, centerY + flowY * length)
      }
    }
    graphics.strokePath()
  }
}
