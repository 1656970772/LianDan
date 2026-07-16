import type { JsonSchema, NormalizedConfig, RawConfigDocument } from './model'

export interface M2GameplaySchemaBundle {
  readonly manifest: JsonSchema
  readonly prototype: JsonSchema
  readonly fireSources: JsonSchema
  readonly pearlTypes: JsonSchema
  readonly collector: JsonSchema
  readonly interactions: JsonSchema
  readonly presentation: JsonSchema
}

export interface RawM2GameplayConfig {
  readonly manifest: RawConfigDocument
  readonly prototype: RawConfigDocument
  readonly fireSources: RawConfigDocument
  readonly pearlTypes: RawConfigDocument
  readonly collector: RawConfigDocument
  readonly interactions?: RawConfigDocument
  readonly presentation: RawConfigDocument
}

export type M2Vector = Readonly<{ x: number; y: number }>

export interface NormalizedM2Theme {
  readonly colors: Readonly<{
    background: string
    surface: string
    surfaceRaised: string
    border: string
    text: string
    muted: string
    accent: string
    danger: string
    focus: string
  }>
  readonly radius: number
}

export interface NormalizedM2Prototype {
  readonly seed: number
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly materialPlacement: Readonly<{
    visibleLongEdge: number
    minimumGap: number
    usableRegion: Readonly<{
      left: number
      top: number
      right: number
      bottom: number
    }>
    slots: readonly Readonly<{
      centerX: number
      centerY: number
      rotationDegrees: number
    }>[]
  }>
  readonly availableFireSourceIds: readonly string[]
  readonly initialFireSize: number
  readonly fireSizeWheelStep: number
  readonly initialFireDirection: M2Vector
  readonly theme: NormalizedM2Theme
  readonly inventoryBatches: readonly Readonly<{
    batchId: string
    materialDefinitionId: string
    servings: number
    preservationStateId?: string
    growthSourceId?: string
    ageYears?: number
    tags?: readonly Readonly<{ tagId: string; strength: number }>[]
  }>[]
}

export type NormalizedM2InteractionSelector = Readonly<{
  materialDefinitionIds: readonly string[]
  requiredTagIds: readonly string[]
  pearlTypes: readonly ('medicinalLiquid' | 'slag' | 'impurity')[]
}>

export type NormalizedM2Interaction = Readonly<{
  id: string
  nameZh?: string
  behavior: 'fight'
  participantA: NormalizedM2InteractionSelector
  participantB: NormalizedM2InteractionSelector
  distance: number
  durationSeconds: number
  impulse: number
  cooldownSeconds: number
}>

export interface NormalizedM2FireSource {
  readonly id: string
  readonly nameZh: string
  readonly descriptionZh: string
  readonly origin: M2Vector
  readonly halfAngleDegrees: number
  readonly minWidth: number
  readonly maxWidth: number
  readonly baseTemperature: number
  readonly maximumTemperature: number
  readonly heatingRatePerSecond: number
  readonly coolingRatePerSecond: number
  readonly temperatureCurve: 'linear'
}

export interface NormalizedM2PearlType {
  readonly id: string
  readonly pearlType: 'medicinalLiquid' | 'slag' | 'impurity'
  readonly standardRadius: number
  readonly spawnClearance: number
  readonly color: string
  readonly outlineColor: string
  readonly spawnVelocity: Readonly<{
    minX: number
    maxX: number
    minY: number
    maxY: number
  }>
  readonly gravity: number
  readonly drift: number
  readonly maxSpeed: number
  readonly materialRestitution: number
  readonly wallRestitution: number
  readonly fireProtectionSeconds: number
  readonly resetProtectionOnExit: boolean
  readonly burnDurationSeconds: number
  readonly thrustAcceleration: number
}

export interface NormalizedM2Collector {
  readonly initialX: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly minX: number
  readonly maxX: number
  readonly acceleration: number
  readonly deceleration: number
  readonly maxSpeed: number
}

export type NormalizedM2PearlPresentationProfile = Readonly<{
  shape: 'droplet' | 'clump' | 'spike'
  motion: 'swim' | 'tumble' | 'jitter'
  surface: 'glossy' | 'rough' | 'smoky'
}>

export type NormalizedM2AudioProfile = Readonly<{
  kind: 'tone' | 'noise'
  attackSeconds: number
  decaySeconds: number
  sustainLevel: number
  releaseSeconds: number
  frequencyHz: number
  gain: number
}>

export interface NormalizedM2PresentationConfig {
  readonly schemaVersion: 1
  readonly temperature: Readonly<{
    warmRatio: number
    blazingRatio: number
  }>
  readonly fire: Readonly<{
    afterglowSeconds: number
    emergenceSeconds: number
    steadyThresholdSeconds: number
    geometry: Readonly<{
      sourceWidthScale: number
      bodyRadiusPixels: number
      trailRadiusScale: number
      tipRadiusScale: number
      swayPixels: number
      curlPixels: number
      particleCount: number
      bodyDensity: number
      trailDensity: number
    }>
    core: Readonly<{ color: string; alpha: number }>
    body: Readonly<{ color: string; alpha: number }>
    outer: Readonly<{ color: string; alpha: number }>
    ember: Readonly<{ color: string; alpha: number }>
    emberRate: number
  }>
  readonly material: Readonly<{
    maskScale: number
    edgeFeatherPixels: number
    heatEdgeWidthPixels: number
    charAlpha: number
    debrisRate: number
    debrisLifetimeSeconds: number
  }>
  readonly pearls: Readonly<{
    medicinalLiquid: NormalizedM2PearlPresentationProfile
    slag: NormalizedM2PearlPresentationProfile
    impurity: NormalizedM2PearlPresentationProfile
  }>
  readonly failure: Readonly<{
    shatteringStartRatio: number
    gatheringStartRatio: number
    flyingStartRatio: number
    shardsPerSource: number
    maximumParticleCount: number
    scatterRadiusPixels: number
    particleRadiusPixels: number
    resultRadiusPixels: number
    furnaceBottomAnchor: Readonly<{ xRatio: number; yRatio: number }>
    resultAnchor: Readonly<{ xRatio: number; yRatio: number }>
  }>
  readonly effects: Readonly<{
    shieldDurationSeconds: number
    damageDurationSeconds: number
    steamDurationSeconds: number
    warningOneDurationSeconds: number
    warningTwoDurationSeconds: number
    failureDurationSeconds: number
  }>
  readonly camera: Readonly<{
    normalCatchStrength: number
    damageStrength: number
    fightStrength: number
    warningTwoStrength: number
    failureStrength: number
    durationSeconds: number
    maxOffsetPixels: number
  }>
  readonly audio: Readonly<{
    initiallyMuted: boolean
    defaultVolume: number
    mergeWindowMs: number
    mergeGain: number
    maxVoices: number
    profiles: Readonly<{
      fireStart: NormalizedM2AudioProfile
      fireLoop: NormalizedM2AudioProfile
      fireStop: NormalizedM2AudioProfile
      pearlCaught: NormalizedM2AudioProfile
      pearlShield: NormalizedM2AudioProfile
      pearlDamaged: NormalizedM2AudioProfile
      interaction: NormalizedM2AudioProfile
      warningOne: NormalizedM2AudioProfile
      warningTwo: NormalizedM2AudioProfile
      failure: NormalizedM2AudioProfile
    }>
  }>
  readonly accessibility: Readonly<{
    reducedMotionFailureDurationSeconds: number
    reducedMotionCameraMultiplier: number
  }>
  readonly performance: Readonly<{
    particlePoolSize: number
    steamPoolSize: number
    pearlPoolSize: number
    effectPoolInitialCapacity: number
    effectPoolMaximumCapacity: number
  }>
}

export interface NormalizedM2GameplayConfig {
  readonly schemaVersion: 1
  readonly prototype: NormalizedM2Prototype
  readonly fireSources: readonly NormalizedM2FireSource[]
  readonly pearlTypes: readonly NormalizedM2PearlType[]
  readonly collector: NormalizedM2Collector
  readonly interactions?: readonly NormalizedM2Interaction[]
}

export interface NormalizedM2Config {
  readonly schemaVersion: 1
  readonly base: NormalizedConfig
  readonly gameplay: NormalizedM2GameplayConfig
  readonly presentation: NormalizedM2PresentationConfig
}
