import Phaser from 'phaser'

import type {
  DropletGeometryConfig,
  DropletPresentation,
} from './droplet-config.ts'

export {
  DROPLET_GEOMETRY,
  type DropletGeometryConfig,
  type DropletPresentation,
} from './droplet-config.ts'

export function createDropletOutline(
  radius: number,
  config: DropletGeometryConfig,
): Phaser.Math.Vector2[] {
  const halfHeight = (radius * config.heightScale) / 2
  const tip = new Phaser.Math.Vector2(0, -halfHeight)
  const shoulder = new Phaser.Math.Vector2(
    radius * config.halfWidthScale,
    radius * config.shoulderYScale,
  )
  const bottom = new Phaser.Math.Vector2(0, halfHeight)
  const tipToShoulder = new Phaser.Curves.CubicBezier(
    tip,
    new Phaser.Math.Vector2(
      radius * config.tipControlXScale,
      radius * config.tipControlYScale,
    ),
    new Phaser.Math.Vector2(
      radius * config.halfWidthScale,
      radius * config.upperSideControlYScale,
    ),
    shoulder,
  ).getPoints(config.curveSegmentsPerSection)
  const shoulderToBottom = new Phaser.Curves.CubicBezier(
    shoulder,
    new Phaser.Math.Vector2(
      radius * config.halfWidthScale,
      radius * config.bottomControlYScale,
    ),
    new Phaser.Math.Vector2(radius * config.bottomControlXScale, halfHeight),
    bottom,
  ).getPoints(config.curveSegmentsPerSection)
  const rightSide = [...tipToShoulder, ...shoulderToBottom.slice(1)]
  const leftSide = rightSide
    .slice(1, -1)
    .reverse()
    .map((point) => new Phaser.Math.Vector2(-point.x, point.y))

  return [...rightSide, ...leftSide]
}

export function drawDroplet(
  graphics: Phaser.GameObjects.Graphics,
  centerX: number,
  centerY: number,
  radius: number,
  outline: Phaser.Math.Vector2[],
  presentation: DropletPresentation,
): void {
  graphics.save()
  graphics.translateCanvas(centerX, centerY)
  graphics.fillStyle(presentation.fillColor, presentation.fillAlpha)
  graphics.fillPoints(outline, true, true)
  graphics.lineStyle(
    presentation.outlineWidthPixels,
    presentation.outlineColor,
    presentation.outlineAlpha,
  )
  graphics.strokePoints(outline, true, true)
  graphics.fillStyle(
    presentation.highlight.color,
    presentation.highlight.alpha,
  )
  graphics.fillEllipse(
    radius * presentation.highlight.offsetXScale,
    radius * presentation.highlight.offsetYScale,
    radius * presentation.highlight.widthScale,
    radius * presentation.highlight.heightScale,
  )
  graphics.restore()
}
