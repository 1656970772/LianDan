import Phaser from 'phaser'

import type {
  NormalizedM2PearlType,
  NormalizedM2PresentationConfig,
  NormalizedMaterial,
} from '../../config/index.ts'
import type { PearlType } from '../../domain/index.ts'
import {
  createDropletOutline,
  drawDroplet,
  type DropletPresentation,
} from '../presentation/droplet.ts'
import { M2_DROPLET_PRESENTATION } from './presentation-config.ts'
import type { M5EffectKind } from './m5-feedback-mapper.ts'
import {
  deriveM5PearlVisualStyle,
  type M5PearlVisualStyle,
} from './m5-visual-policy.ts'
import type { M5PearlPoseTarget } from './m5-pearl-sprite-pool.ts'

export function m5ColorNumber(value: string): number {
  const normalized = value.startsWith('#') ? value.slice(1) : value
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
}

export type M5PearlRendererConfig = Readonly<{
  pearlTypes: readonly NormalizedM2PearlType[]
  materials: readonly NormalizedMaterial[]
  profiles: NormalizedM2PresentationConfig['pearls']
}>

/**
 * 正式三类珠绘制器。玩家场景与 M5 presentation benchmark 共用此实例
 * 类型，避免性能场景另画小圆或复制一套会漂移的轮廓/材质逻辑。
 */
export class M5PearlRenderer {
  readonly #styles: Readonly<Record<PearlType, M5PearlVisualStyle>>
  readonly #typeConfig: ReadonlyMap<PearlType, NormalizedM2PearlType>
  readonly #materialColor: ReadonlyMap<string, string>
  readonly #dropletOutlines = new Map<number, Phaser.Math.Vector2[]>()
  readonly #motionPhases = new Map<string, number>()
  readonly #dropletPresentation: DropletPresentation & {
    fillColor: number
    fillAlpha: number
    outlineColor: number
    outlineAlpha: number
  } = { ...M2_DROPLET_PRESENTATION }
  readonly #drawPose: M5PearlPoseTarget = { x: 0, y: 0, rotation: 0 }
  #trackedFrameAllocationCount = 0

  constructor(config: M5PearlRendererConfig) {
    this.#styles = Object.freeze({
      medicinalLiquid: deriveM5PearlVisualStyle(
        config.profiles.medicinalLiquid,
      ),
      slag: deriveM5PearlVisualStyle(config.profiles.slag),
      impurity: deriveM5PearlVisualStyle(config.profiles.impurity),
    })
    this.#typeConfig = new Map(
      config.pearlTypes.map((candidate) => [
        candidate.pearlType,
        candidate,
      ]),
    )
    this.#materialColor = new Map(
      config.materials.flatMap((material) =>
        material.pearlColor === undefined
          ? []
          : [[material.id, material.pearlColor] as const],
      ),
    )
  }

  beginFrame(): void {
    this.#trackedFrameAllocationCount = 0
  }

  get trackedFrameAllocationCount(): number {
    return this.#trackedFrameAllocationCount
  }

  prewarm(pearlId: string, pearlType: PearlType, radius: number): void {
    this.#motionPhase(pearlId)
    if (pearlType === 'medicinalLiquid') this.#dropletOutline(radius)
  }

  phaseForId(id: string): number {
    return this.#motionPhase(id)
  }

  resetSession(): void {
    this.#motionPhases.clear()
    this.#trackedFrameAllocationCount = 0
  }

  /** Graphics 与正式 Sprite 池共享同一 shape-specific motion 计算。 */
  writePose(
    target: M5PearlPoseTarget,
    pearlId: string,
    pearlType: PearlType,
    x: number,
    y: number,
    radius: number,
    timestampMilliseconds: number,
    animated: boolean,
  ): void {
    const style = this.#styles[pearlType]
    const phase = this.#motionPhase(pearlId)
    const seconds = timestampMilliseconds / 1_000
    target.x = x
    target.y = y
    target.rotation = 0
    if (!animated) return
    if (style.motion === 'swim') {
      target.y += Math.sin(seconds * 5.2 + phase) * radius * 0.07
    } else if (style.motion === 'tumble') {
      target.rotation = seconds * 2.1 + phase
    } else {
      target.x += Math.sin(seconds * 15 + phase) * radius * 0.07
      target.y += Math.cos(seconds * 12.5 + phase) * radius * 0.05
    }
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    pearlId: string,
    pearlType: PearlType,
    sourceMaterialDefinitionId: string,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    timestampMilliseconds: number,
    animated: boolean,
  ): void {
    const config = this.#typeConfig.get(pearlType)
    const fillColor = m5ColorNumber(
      pearlType === 'medicinalLiquid'
        ? this.#materialColor.get(sourceMaterialDefinitionId) ??
            config?.color ??
            '#FFFFFF'
        : config?.color ?? '#FFFFFF',
    )
    const outlineColor = m5ColorNumber(config?.outlineColor ?? '#FFFFFF')
    const style = this.#styles[pearlType]
    const phase = this.#motionPhase(pearlId)
    this.writePose(
      this.#drawPose,
      pearlId,
      pearlType,
      x,
      y,
      radius,
      timestampMilliseconds,
      animated,
    )
    const drawX = this.#drawPose.x
    const drawY = this.#drawPose.y
    const rotation = this.#drawPose.rotation
    if (style.shape === 'droplet') {
      const outline = this.#dropletOutline(radius)
      this.#dropletPresentation.fillColor = fillColor
      this.#dropletPresentation.fillAlpha =
        M2_DROPLET_PRESENTATION.fillAlpha * alpha
      this.#dropletPresentation.outlineColor = outlineColor
      this.#dropletPresentation.outlineAlpha =
        M2_DROPLET_PRESENTATION.outlineAlpha * alpha
      drawDroplet(
        graphics,
        drawX,
        drawY,
        radius,
        outline,
        this.#dropletPresentation,
      )
      this.#drawSurface(
        graphics,
        style,
        drawX,
        drawY,
        radius,
        alpha,
        outlineColor,
        phase,
      )
      return
    }

    graphics.fillStyle(fillColor, 0.92 * alpha)
    graphics.lineStyle(2, outlineColor, 0.8 * alpha)
    graphics.beginPath()
    for (let index = 0; index < style.pointCount; index += 1) {
      const angle =
        rotation - Math.PI / 2 + (index / style.pointCount) * Math.PI * 2
      const radiusScale =
        style.shape === 'clump'
          ? 0.76 + ((index * 37) % 5) * 0.045
          : index % 2 === 0
            ? 1
            : 0.5
      const pointX = drawX + Math.cos(angle) * radius * radiusScale
      const pointY = drawY + Math.sin(angle) * radius * radiusScale
      if (index === 0) graphics.moveTo(pointX, pointY)
      else graphics.lineTo(pointX, pointY)
    }
    graphics.closePath()
    graphics.fillPath()
    graphics.strokePath()
    this.#drawSurface(
      graphics,
      style,
      drawX,
      drawY,
      radius,
      alpha,
      outlineColor,
      phase,
    )
  }

  #drawSurface(
    graphics: Phaser.GameObjects.Graphics,
    style: M5PearlVisualStyle,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    outlineColor: number,
    phase: number,
  ): void {
    if (style.surface === 'rough') {
      graphics.lineStyle(1.4, outlineColor, 0.48 * alpha)
      graphics.lineBetween(
        x - radius * 0.42,
        y - radius * 0.18,
        x + radius * 0.2,
        y + radius * 0.08,
      )
      graphics.lineBetween(
        x + radius * 0.08,
        y - radius * 0.48,
        x - radius * 0.12,
        y + radius * 0.32,
      )
    } else if (style.surface === 'glossy') {
      graphics.fillStyle(outlineColor, 0.16 * alpha)
      graphics.fillCircle(
        x - radius * 0.28,
        y - radius * 0.72,
        radius * 0.18,
      )
      graphics.fillCircle(
        x + radius * 0.4,
        y - radius * 0.9,
        radius * 0.12,
      )
    } else {
      graphics.lineStyle(1.2, outlineColor, 0.16 * alpha)
      graphics.strokeCircle(x, y, radius * 1.12)
      graphics.strokeCircle(x, y - radius * 0.16, radius * 1.28)
      graphics.fillStyle(outlineColor, 0.12 * alpha)
      for (let mote = 0; mote < 3; mote += 1) {
        const angle = phase + mote * 2.17
        graphics.fillCircle(
          x + Math.cos(angle) * radius * (0.52 + mote * 0.12),
          y - radius * (0.72 + mote * 0.3),
          radius * (0.09 + mote * 0.025),
        )
      }
    }
  }

  #dropletOutline(radius: number): Phaser.Math.Vector2[] {
    let outline = this.#dropletOutlines.get(radius)
    if (outline !== undefined) return outline
    outline = createDropletOutline(radius, M2_DROPLET_PRESENTATION.droplet)
    this.#dropletOutlines.set(radius, outline)
    this.#trackedFrameAllocationCount += 1
    return outline
  }

  #motionPhase(pearlId: string): number {
    const cached = this.#motionPhases.get(pearlId)
    if (cached !== undefined) return cached
    let hash = 2_166_136_261
    for (let index = 0; index < pearlId.length; index += 1) {
      hash ^= pearlId.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
    const phase = ((hash >>> 0) / 0xffff_ffff) * Math.PI * 2
    this.#motionPhases.set(pearlId, phase)
    this.#trackedFrameAllocationCount += 1
    return phase
  }
}

export type M5PresentationTheme = Readonly<{
  accent: string
  danger: string
  focus: string
}>

/** 正式效果池槽位的共享绘制路径。 */
export function drawM5Effect(
  graphics: Phaser.GameObjects.Graphics,
  theme: M5PresentationTheme,
  logicalWidth: number,
  logicalHeight: number,
  kind: M5EffectKind,
  x: number,
  y: number,
  secondaryX: number,
  secondaryY: number,
  progress: number,
  slotIndex: number,
): void {
  const remaining = 1 - progress
  if (kind === 'steam') {
    graphics.fillStyle(0xd8d1c5, remaining * 0.28)
    graphics.fillCircle(
      x - 8 + (slotIndex % 3) * 8,
      y - progress * 42,
      5 + progress * 12,
    )
  } else if (kind === 'shield') {
    graphics.lineStyle(3, m5ColorNumber(theme.focus), remaining * 0.9)
    graphics.strokeCircle(x, y, 12 + progress * 26)
    graphics.lineStyle(1, 0xffffff, remaining * 0.55)
    graphics.strokeCircle(x, y, 6 + progress * 18)
  } else if (kind === 'damage') {
    graphics.lineStyle(5, m5ColorNumber(theme.danger), remaining)
    graphics.lineBetween(x - 18, y - 14, x + 18, y + 14)
    graphics.lineBetween(x + 13, y - 18, x - 10, y + 16)
  } else if (kind === 'fight') {
    graphics.lineStyle(3, m5ColorNumber(theme.danger), remaining * 0.85)
    graphics.lineBetween(x, y, secondaryX, secondaryY)
    graphics.strokeCircle(
      (x + secondaryX) / 2,
      (y + secondaryY) / 2,
      6 + progress * 20,
    )
  } else if (kind === 'warningOne' || kind === 'warningTwo') {
    const inset = 22 + progress * 18
    graphics.lineStyle(
      kind === 'warningTwo' ? 8 : 4,
      m5ColorNumber(theme.danger),
      remaining * (kind === 'warningTwo' ? 0.72 : 0.42),
    )
    graphics.strokeRoundedRect(
      inset,
      inset,
      logicalWidth - inset * 2,
      logicalHeight - inset * 2,
      28,
    )
  } else {
    const color =
      kind === 'failure'
        ? m5ColorNumber(theme.danger)
        : kind === 'ready'
          ? m5ColorNumber(theme.focus)
          : m5ColorNumber(theme.accent)
    graphics.lineStyle(kind === 'caught' ? 4 : 2, color, remaining * 0.85)
    graphics.strokeCircle(x, y, 5 + progress * 34)
    if (kind === 'birth') {
      graphics.fillStyle(color, remaining * 0.65)
      graphics.fillCircle(x - 12, y - progress * 28, 3)
      graphics.fillCircle(x + 10, y - progress * 20, 2)
    }
  }
}

export type M5LocalLightSource = Readonly<{
  position: Readonly<{ x: number; y: number }>
  direction: Readonly<{ x: number; y: number }>
  width: number
}>

/** 正式局部光绘制路径。仅照亮火源邻域，不给全屏套橙色滤镜。 */
export function drawM5LocalLight(
  graphics: Phaser.GameObjects.Graphics,
  presentation: NormalizedM2PresentationConfig,
  source: M5LocalLightSource | null,
  fireSize: number,
  visualIntensity: number,
): number {
  graphics.clear()
  const intensity =
    Math.max(0, Math.min(1, visualIntensity)) *
    Math.max(0, Math.min(1, fireSize / 100))
  if (source === null || intensity <= 0) return intensity
  const bodyColor = m5ColorNumber(presentation.fire.body.color)
  const coreColor = m5ColorNumber(presentation.fire.core.color)
  const radius = 90 + source.width * 0.95
  for (let ring = 6; ring >= 1; ring -= 1) {
    const ratio = ring / 6
    graphics.fillStyle(
      ring <= 2 ? coreColor : bodyColor,
      intensity * (1 - ratio * 0.78) * 0.055,
    )
    graphics.fillCircle(
      source.position.x + source.direction.x * 52,
      source.position.y + source.direction.y * 52,
      radius * ratio,
    )
  }
  return intensity
}
