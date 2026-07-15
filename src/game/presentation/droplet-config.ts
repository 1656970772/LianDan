export type DropletGeometryConfig = Readonly<{
  heightScale: number
  halfWidthScale: number
  shoulderYScale: number
  tipControlXScale: number
  tipControlYScale: number
  upperSideControlYScale: number
  bottomControlXScale: number
  bottomControlYScale: number
  curveSegmentsPerSection: number
}>

export type DropletPresentation = Readonly<{
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
  droplet: DropletGeometryConfig
}>

export const DROPLET_GEOMETRY: DropletGeometryConfig = Object.freeze({
  heightScale: 2,
  halfWidthScale: 0.78,
  shoulderYScale: 0.22,
  tipControlXScale: 0.1,
  tipControlYScale: -0.72,
  upperSideControlYScale: -0.25,
  bottomControlXScale: 0.44,
  bottomControlYScale: 0.72,
  curveSegmentsPerSection: 14,
})
