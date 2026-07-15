export type FireStartupConfig =
  | Readonly<{
      mode: 'prewarmed'
    }>
  | Readonly<{
      mode: 'rapid-reveal'
      propagationSpeedPixelsPerSecond: number
      frontFeatherPixels: number
    }>

export type FirePresentationConfig = Readonly<{
  particleCount: number
  speedPixelsPerSecond: number
  speedVariationRatio: number
  lifetimeSeconds: number
  lifetimeVariationRatio: number
  trailLengthPixels: number
  trailVariationRatio: number
  outerTrailWidthPixels: number
  coreTrailWidthPixels: number
  headRadiusPixels: number
  headRadiusVariationRatio: number
  maximumDeltaSeconds: number
  prewarmStepSeconds: number
  sourceWidthScale: number
  sourceLateralCenterBias: number
  sourceDepthPixels: number
  displaySwayPixels: number
  displaySwayFrequencyHz: number
  startup: FireStartupConfig
  colors: Readonly<{
    outer: number
    core: number
    head: number
  }>
  heatField: FireHeatFieldConfig
  sparks: Readonly<{
    stride: number
    radiusPixels: number
    alpha: number
  }>
}>

export type FireHeatPaletteStop = Readonly<{
  heat: number
  red: number
  green: number
  blue: number
  alpha: number
}>

export type FireHeatFieldConfig = Readonly<{
  width: number
  height: number
  pixelScale: number
  maximumFramesPerSecond: number
  trailLengthPixels: number
  trailSampleSpacingPixels: number
  coreTrailSampleSpacingPixels: number
  trailCurlPixels: number
  trailCurlCycles: number
  headRadiusPixels: number
  trailRadiusScale: number
  coreRadiusScale: number
  coolingDistancePixels: number
  tipHeatScale: number
  tipRadiusScale: number
  densityExposure: number
  temperatureExposure: number
  bodyDensity: number
  coreTemperature: number
  trailDensity: number
  sourceDensity: number
  trailMinimumDensityScale: number
  coreTrailMinimumTemperatureScale: number
  sourceWidthScale: number
  sourceRadiusScale: number
  sourceBackClipPixels: number
  transparentDensity: number
  transparentTemperature: number
  palette: Readonly<{
    outer: FireHeatPaletteStop
    middle: FireHeatPaletteStop
    core: FireHeatPaletteStop
  }>
}>

export const FIRE_PRESENTATION_CONFIG: FirePresentationConfig =
  Object.freeze({
    particleCount: 280,
    speedPixelsPerSecond: 275,
    speedVariationRatio: 0.32,
    lifetimeSeconds: 4.1,
    lifetimeVariationRatio: 0.22,
    trailLengthPixels: 38,
    trailVariationRatio: 0.5,
    outerTrailWidthPixels: 7,
    coreTrailWidthPixels: 2.6,
    headRadiusPixels: 2.1,
    headRadiusVariationRatio: 0.34,
    maximumDeltaSeconds: 1 / 24,
    prewarmStepSeconds: 1 / 60,
    sourceWidthScale: 0.78,
    sourceLateralCenterBias: 0.55,
    sourceDepthPixels: 26,
    displaySwayPixels: 5.5,
    displaySwayFrequencyHz: 1.35,
    startup: Object.freeze({
      mode: 'prewarmed',
    }),
    colors: Object.freeze({
      outer: 0x8f3d24,
      core: 0xe7783f,
      head: 0xffc07a,
    }),
    heatField: Object.freeze({
      width: 320,
      height: 180,
      pixelScale: 5,
      maximumFramesPerSecond: 30,
      trailLengthPixels: 96,
      trailSampleSpacingPixels: 12,
      coreTrailSampleSpacingPixels: 4.5,
      trailCurlPixels: 8,
      trailCurlCycles: 0.85,
      headRadiusPixels: 40,
      trailRadiusScale: 1.1,
      coreRadiusScale: 0.1,
      coolingDistancePixels: 560,
      tipHeatScale: 0.22,
      tipRadiusScale: 0.42,
      densityExposure: 1,
      temperatureExposure: 1,
      bodyDensity: 0.12,
      coreTemperature: 2.9,
      trailDensity: 0.3,
      sourceDensity: 0.075,
      trailMinimumDensityScale: 0.55,
      coreTrailMinimumTemperatureScale: 0.2,
      sourceWidthScale: 0.72,
      sourceRadiusScale: 0.6,
      sourceBackClipPixels: 5,
      transparentDensity: 0.045,
      transparentTemperature: 0.045,
      palette: Object.freeze({
        outer: Object.freeze({
          heat: 0.07,
          red: 104,
          green: 18,
          blue: 5,
          alpha: 32,
        }),
        middle: Object.freeze({
          heat: 0.34,
          red: 242,
          green: 74,
          blue: 15,
          alpha: 205,
        }),
        core: Object.freeze({
          heat: 2.25,
          red: 255,
          green: 228,
          blue: 142,
          alpha: 248,
        }),
      }),
    }),
    sparks: Object.freeze({
      stride: 17,
      radiusPixels: 1.5,
      alpha: 0.78,
    }),
  })

export function fitFirePresentationConfig(
  worldWidth: number,
  worldHeight: number,
  base: FirePresentationConfig = FIRE_PRESENTATION_CONFIG,
): FirePresentationConfig {
  const pixelScale = base.heatField.pixelScale
  return Object.freeze({
    ...base,
    heatField: Object.freeze({
      ...base.heatField,
      width: Math.ceil(worldWidth / pixelScale),
      height: Math.ceil(worldHeight / pixelScale),
    }),
  })
}
