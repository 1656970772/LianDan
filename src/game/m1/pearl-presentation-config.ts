import type { M1ScenarioMetadata } from './contracts.ts'
import {
  DROPLET_GEOMETRY,
  type DropletGeometryConfig,
} from '../presentation/droplet-config.ts'

export type M1PearlRenderer = 'droplet' | 'circle-proxy'

export type M1DropletPresentationConfig = DropletGeometryConfig

export type M1PearlPresentation = Readonly<{
  renderer: M1PearlRenderer
  fillColor: number
  fillAlpha: number
  outlineColor: number
  outlineAlpha: number
  outlineWidthPixels: number
  highlight: Readonly<{
    color: number
    alpha: number
    offsetXScale: number
    offsetYScale: number
    widthScale: number
    heightScale: number
  }>
  fireOcclusion: Readonly<{
    mode: 'precise-geometry' | 'flow-grid'
    circleRadiusScale: number
    circleFeatherPixels: number
  }>
  droplet: M1DropletPresentationConfig
}>

const TECHNICAL_PROBE_PRESENTATION: M1PearlPresentation = Object.freeze({
  renderer: 'droplet',
  fillColor: 0x596b77,
  fillAlpha: 1,
  outlineColor: 0x26323a,
  outlineAlpha: 1,
  outlineWidthPixels: 3,
  highlight: Object.freeze({
    color: 0xd2e0e6,
    alpha: 0.58,
    offsetXScale: -0.24,
    offsetYScale: -0.15,
    widthScale: 0.24,
    heightScale: 0.42,
  }),
  fireOcclusion: Object.freeze({
    mode: 'precise-geometry',
    circleRadiusScale: 0.82,
    circleFeatherPixels: 4,
  }),
  droplet: DROPLET_GEOMETRY,
})

const PERFORMANCE_PRESENTATION: M1PearlPresentation = Object.freeze({
  renderer: 'circle-proxy',
  fillColor: 0x47525b,
  fillAlpha: 0.92,
  outlineColor: 0x47525b,
  outlineAlpha: 0,
  outlineWidthPixels: 0,
  highlight: Object.freeze({
    color: 0x47525b,
    alpha: 0,
    offsetXScale: 0,
    offsetYScale: 0,
    widthScale: 0,
    heightScale: 0,
  }),
  fireOcclusion: Object.freeze({
    mode: 'flow-grid',
    circleRadiusScale: 1,
    circleFeatherPixels: 0,
  }),
  droplet: DROPLET_GEOMETRY,
})

export const M1_PEARL_PRESENTATION_CONFIG = Object.freeze({
  technicalProbe: TECHNICAL_PROBE_PRESENTATION,
  performance: PERFORMANCE_PRESENTATION,
})

export function resolveM1PearlPresentation(
  scenarioKind: M1ScenarioMetadata['kind'],
): M1PearlPresentation {
  return scenarioKind === 'performance'
    ? M1_PEARL_PRESENTATION_CONFIG.performance
    : M1_PEARL_PRESENTATION_CONFIG.technicalProbe
}
