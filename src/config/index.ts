export {
  loadBrowserConfig,
  loadBrowserConfigWithAssets,
  type BrowserConfigLoaderOptions,
  type BrowserConfigLoadResult,
  type BrowserConfigWithAssetsLoadResult,
} from './browser-loader'
export {
  loadBrowserM2GameplayConfig,
  type BrowserM2GameplayLoaderOptions,
  type BrowserM2GameplayLoadResult,
} from './browser-m2-gameplay-loader'
export {
  loadBrowserM1FireFlowFixture,
  type BrowserM1FireFlowLoaderOptions,
  type BrowserM1FireFlowLoadResult,
} from './browser-m1-fire-flow-loader'
export {
  loadBrowserM5VisualPerformanceFixture,
  type BrowserM5VisualPerformanceLoaderOptions,
  type BrowserM5VisualPerformanceLoadResult,
} from './browser-m5-visual-performance-loader.ts'
export type { ConfigErrorCode, ConfigIssue } from './errors'
export {
  canonicalizeJson,
  computeSimulationContentFingerprint,
  FINGERPRINT_SPEC,
  type FingerprintInput,
  type FingerprintResult,
} from './fingerprint'
export { createSimulationFingerprintInput } from './fingerprint-input'
export { createM2SimulationFingerprintInput } from './m2-fingerprint-input'
export { computeM2PresentationContentFingerprint } from './m2-presentation-fingerprint'
export {
  deriveBatchTags,
  type DerivedBatchTagsResult,
  type MaterialBatchState,
} from './tag-derivation'
export {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
  type M1FireFlowFixtureIssue,
  type M1PerformanceScenario,
  type M1TechnicalProbe,
} from './m1-fire-flow-fixture'
export {
  validateM5VisualPerformanceFixtureSemantics,
  type M5VisualPerformanceEffectKind,
  type M5VisualPerformanceFixture,
  type M5VisualPerformanceFixtureIssue,
  type M5VisualPerformanceScenario,
} from './m5-visual-performance-fixture.ts'
export {
  validateM1RuntimeCompatibility,
  type M1LogicalWorldRequirement,
} from './m1-runtime-compatibility'
export type {
  M2GameplaySchemaBundle,
  M2Vector,
  NormalizedM2Collector,
  NormalizedM2Config,
  NormalizedM2FireSource,
  NormalizedM2Interaction,
  NormalizedM2InteractionSelector,
  NormalizedM2GameplayConfig,
  NormalizedM2PearlType,
  NormalizedM2PearlPresentationProfile,
  NormalizedM2AudioProfile,
  NormalizedM2PresentationConfig,
  NormalizedM2Prototype,
  NormalizedM2Theme,
  RawM2GameplayConfig,
} from './m2-gameplay-model'
export type {
  ConfigSchemaBundle,
  DecodedCompositionMap,
  NormalizedConfig,
  NormalizedMaterial,
  NormalizedParameters,
  NormalizedTagCatalog,
  NormalizedTagDefinition,
  NormalizedTagStrength,
  MaterialTagCategory,
  IntrinsicMaterialTagCategory,
} from './model'
export {
  validateAndNormalizeConfigSet,
  type ConfigValidationResult,
  type RawConfigSet,
} from './validate'
