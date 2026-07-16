import type { NormalizedM2PresentationConfig } from '../../config/index.ts'
import type { FirePresentationConfig } from '../presentation/fire/fire-presentation-config.ts'
import { M2_FIRE_PRESENTATION_CONFIG } from './presentation-config.ts'

function colorNumber(value: string): number {
  const parsed = Number.parseInt(value.startsWith('#') ? value.slice(1) : value, 16)
  return Number.isFinite(parsed) ? parsed : 0xffffff
}

function colorRgb(value: string): readonly [number, number, number] {
  const color = colorNumber(value)
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

function alphaByte(alpha: number): number {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 255)
}

/** 玩家场景与 M5 presentation benchmark 共用的正式火焰表现映射。 */
export function createM5FirePresentationConfig(
  presentation: NormalizedM2PresentationConfig,
  logicalWidth: number,
  logicalHeight: number,
): FirePresentationConfig {
  const base = M2_FIRE_PRESENTATION_CONFIG
  const { fire } = presentation
  const outer = colorRgb(fire.outer.color)
  const body = colorRgb(fire.body.color)
  const core = colorRgb(fire.core.color)
  return Object.freeze({
    ...base,
    particleCount: fire.geometry.particleCount,
    sourceWidthScale: fire.geometry.sourceWidthScale,
    displaySwayPixels: fire.geometry.swayPixels,
    startup: Object.freeze({
      mode: 'rapid-reveal' as const,
      propagationSpeedPixelsPerSecond:
        Math.hypot(logicalWidth, logicalHeight) / fire.emergenceSeconds,
      frontFeatherPixels:
        base.startup.mode === 'rapid-reveal'
          ? base.startup.frontFeatherPixels
          : 70,
    }),
    colors: Object.freeze({
      outer: colorNumber(fire.outer.color),
      core: colorNumber(fire.body.color),
      head: colorNumber(fire.ember.color),
    }),
    heatField: Object.freeze({
      ...base.heatField,
      headRadiusPixels: fire.geometry.bodyRadiusPixels,
      trailRadiusScale: fire.geometry.trailRadiusScale,
      tipRadiusScale: fire.geometry.tipRadiusScale,
      trailCurlPixels: fire.geometry.curlPixels,
      bodyDensity: fire.geometry.bodyDensity,
      trailDensity: fire.geometry.trailDensity,
      sourceWidthScale: fire.geometry.sourceWidthScale,
      palette: Object.freeze({
        outer: Object.freeze({
          ...base.heatField.palette.outer,
          red: outer[0],
          green: outer[1],
          blue: outer[2],
          alpha: alphaByte(fire.outer.alpha),
        }),
        middle: Object.freeze({
          ...base.heatField.palette.middle,
          red: body[0],
          green: body[1],
          blue: body[2],
          alpha: alphaByte(fire.body.alpha),
        }),
        core: Object.freeze({
          ...base.heatField.palette.core,
          red: core[0],
          green: core[1],
          blue: core[2],
          alpha: alphaByte(fire.core.alpha),
        }),
      }),
    }),
    sparks: Object.freeze({
      ...base.sparks,
      alpha: fire.ember.alpha,
    }),
  })
}
