import {
  DROPLET_GEOMETRY,
  type DropletPresentation,
} from '../presentation/droplet-config.ts'
import {
  FIRE_PRESENTATION_CONFIG,
  type FirePresentationConfig,
} from '../presentation/fire/fire-presentation-config.ts'

export const M2_FIRE_PRESENTATION_CONFIG: FirePresentationConfig =
  Object.freeze({
    ...FIRE_PRESENTATION_CONFIG,
    startup: Object.freeze({
      mode: 'rapid-reveal',
      propagationSpeedPixelsPerSecond: 3_000,
      frontFeatherPixels: 70,
    }),
  })

export const M2_DROPLET_PRESENTATION: DropletPresentation = Object.freeze({
  fillColor: 0x78e6d0,
  fillAlpha: 0.94,
  outlineColor: 0xd9fff7,
  outlineAlpha: 0.86,
  outlineWidthPixels: 2,
  highlight: Object.freeze({
    color: 0xffffff,
    alpha: 0.68,
    offsetXScale: -0.28,
    offsetYScale: -0.28,
    widthScale: 0.32,
    heightScale: 0.32,
  }),
  droplet: DROPLET_GEOMETRY,
})

export const M2_FIRE_OCCLUSION_CONFIG = Object.freeze({
  circleRadiusScale: 0.82,
  circleFeatherPixels: 4,
})
