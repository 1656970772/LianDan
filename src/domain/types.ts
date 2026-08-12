/**
 * 规则层公开类型。所有配置与输入对象都必须可无损序列化为 JSON。
 */

export type JsonScalar = string | number | boolean | null;
export type FactorValue = string | number | boolean;
export type Quality = "lower" | "middle" | "upper" | "supreme";
export type SimulationStatus =
  | "success"
  | "not_formed"
  | "exploded"
  | "config_error";

export interface NumberRange {
  min: number;
  max: number;
}

export interface ConfigMeta {
  name: string;
  description: string;
  maxMaterials: number;
  maxCandidates: number;
  maxPillQuantity: number;
  residualMatchRatio: number;
  qualityEffectMultipliers: Record<Quality, number>;
  qualityYieldDeltas: Record<Quality, number>;
}

export type RecipeSlotRole = "main" | "auxiliary" | "catalyst";

export interface RecipeSlotDefinition {
  id: string;
  role: RecipeSlotRole;
  label: string;
  order: number;
}

export interface MaterialInventoryEntry {
  materialId: string;
  quantity: number;
}

export type TagCategory =
  | "nature"
  | "effect"
  | "reaction"
  | "risk"
  | "state";

export interface TagDefinition {
  id: string;
  category: TagCategory;
  name: string;
  description: string;
}

export interface TagValue {
  tagId: string;
  strength: number;
}

export type MaterialKind = "herb" | "flower" | "fruit" | "root" | "core" | "liquid" | "wonder";

export interface MaterialKindProfile {
  id: MaterialKind;
  allowedStateIds: string[];
  allowedOriginIds: string[];
  defaultStateId: string;
  defaultOriginId: string;
  ageLabel: string;
  ageUnit: string;
  maturityLabel: string;
}

export interface MaterialDefinition {
  id: string;
  name: string;
  kind: MaterialKind;
  description: string;
  allowedStateIds: string[];
  allowedOriginIds: string[];
  defaultStateId: string;
  defaultOriginId: string;
  ageLabel: string;
  ageUnit: string;
  maturityLabel: string;
  defaultYears: number;
  yearRange: { min: number; mature: number; max: number };
  baseTags: TagValue[];
  doseValue: number;
  icon: string;
  sourceNote: string;
}

export interface MaterialState {
  id: string;
  name: string;
  description: string;
  tagMultipliers?: Record<string, number>;
  tagDeltas?: Record<string, number>;
  qualityDelta: number;
  riskDelta: number;
}

export interface MaterialOrigin {
  id: string;
  name: string;
  description: string;
  tagDeltas?: Record<string, number>;
  qualityDelta: number;
  riskDelta: number;
}

export interface FactorGroup {
  id: string;
  name: string;
  description: string;
  order: number;
}

export interface FactorOption {
  value: string;
  label: string;
  description?: string;
}

export interface FactorDefinition {
  id: string;
  label: string;
  groupId: string;
  valueType: "number" | "string" | "boolean";
  controlType: "range" | "select" | "toggle" | "number";
  defaultValue: FactorValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: FactorOption[];
  optionCatalogId?: string;
  description: string;
  visibilityCondition?: Condition;
}

export interface OptionModifier {
  target: "danger" | "formation" | "quality" | "tag";
  targetId?: string;
  value: number;
}

export interface OptionDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  modifiers: OptionModifier[];
}

export interface OptionCatalog {
  id: string;
  name: string;
  options: OptionDefinition[];
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: "primary" | "secondary" | "side";
  description: string;
  unit: string;
  range: NumberRange;
}

export interface TraitDefinition {
  id: string;
  name: string;
  description: string;
}

export interface EvaluationDefinition {
  id: "normal" | "residual" | "waste" | "mutated";
  name: string;
  description: string;
}

export type Condition =
  | { op: "all"; conditions: Condition[] }
  | { op: "any"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | { op: "hasMaterial"; materialId: string }
  | { op: "materialQuantity"; materialId: string; min?: number; max?: number }
  | { op: "tagRange"; tagId: string; min?: number; max?: number }
  | { op: "factorRange"; factorId: string; min?: number; max?: number }
  | { op: "factorEquals"; factorId: string; value: string | boolean }
  | { op: "materialState"; materialId: string; stateId: string }
  | { op: "materialOrigin"; materialId: string; originId: string }
  | { op: "orderBefore"; firstMaterialId: string; secondMaterialId: string }
  | { op: "qualityRange"; min?: number; max?: number }
  | { op: "dangerRange"; min?: number; max?: number }
  | { op: "formationRange"; min?: number; max?: number };

export interface WeightedFactor {
  source: "factor" | "material_quality" | "option_modifier" | "dose_fit";
  sourceId?: string;
  weight: number;
}

export interface ScoreModel {
  base: number;
  inputs: WeightedFactor[];
  min: number;
  max: number;
}

export interface ScoreModels {
  danger: ScoreModel;
  formation: ScoreModel;
  quality: ScoreModel;
  thresholds: {
    explosion: number;
    formation: number;
    qualities: Array<{ quality: Quality; min: number }>;
  };
}

export interface EffectGrant {
  effectId: string;
  value: number;
}

export interface PillPrototype {
  id: string;
  name: string;
  form: "pill" | "powder" | "liquid";
  grade: number;
  priority: number;
  description: string;
  icon: string;
  identityCondition: Condition;
  idealFactors: Array<{
    factorId: string;
    idealMin: number;
    idealMax: number;
    penaltyPerStep: number;
  }>;
  yield: { dosePerPill: number; min: number; max: number };
  primaryEffect: EffectGrant;
  secondaryEffects: EffectGrant[];
  sideEffects: EffectGrant[];
  traits: string[];
  sourceNote: string;
}

export interface ReasonTemplate {
  code: string;
  title: string;
  detail: string;
  tone: "positive" | "negative" | "neutral";
}

export type RuleAction =
  | { type: "adjustDanger"; value: number }
  | { type: "adjustFormation"; value: number }
  | { type: "adjustQuality"; value: number }
  | { type: "adjustYield"; value: number }
  | { type: "grantEffect"; effectId: string; value: number }
  | { type: "scaleEffect"; effectId: string; factor: number }
  | { type: "grantTrait"; traitId: string }
  | { type: "grantEvaluation"; evaluationId: string };

export interface ModifierRule {
  id: string;
  name: string;
  phase: "danger" | "formation" | "quality" | "result";
  priority: number;
  condition: Condition;
  actions: RuleAction[];
  reason: ReasonTemplate;
}

export interface MutationRule {
  id: string;
  name: string;
  priority: number;
  probability: number;
  condition: Condition;
  actions: RuleAction[];
  reason: ReasonTemplate;
}

export interface FailureResultDefinition {
  id: "not_formed" | "exploded" | "residual" | "waste";
  name: string;
  description: string;
  icon?: string;
  evaluationId?: "residual" | "waste";
  primaryEffect?: EffectGrant;
}

export interface MaterialInput {
  materialId: string;
  quantity: number;
  stateId: string;
  originId: string;
  years: number;
  order: number;
}

export interface SimulationInput {
  schemaVersion: string;
  configVersion: string;
  materials: MaterialInput[];
  factors: Record<string, FactorValue>;
  seed: number;
}

export interface PresetExpectation {
  status: SimulationStatus;
  prototypeId?: string;
  quality?: Quality;
  evaluations?: string[];
}

export interface SimulationPreset {
  id: string;
  name: string;
  description: string;
  input: SimulationInput;
  expectation?: PresetExpectation;
}

export interface AlchemyConfig {
  schemaVersion: string;
  configVersion: string;
  meta: ConfigMeta;
  tagDefinitions: TagDefinition[];
  materialStates: MaterialState[];
  materialOrigins: MaterialOrigin[];
  materialKindProfiles: MaterialKindProfile[];
  materials: MaterialDefinition[];
  recipeSlots: RecipeSlotDefinition[];
  inventory: MaterialInventoryEntry[];
  factorGroups: FactorGroup[];
  factors: FactorDefinition[];
  optionCatalogs: OptionCatalog[];
  effects: EffectDefinition[];
  traits: TraitDefinition[];
  evaluations: EvaluationDefinition[];
  scoreModels: ScoreModels;
  pillPrototypes: PillPrototype[];
  modifierRules: ModifierRule[];
  mutationRules: MutationRule[];
  failureResults: FailureResultDefinition[];
  presets: SimulationPreset[];
}

export interface EffectiveMaterial {
  definitionId: string;
  quantity: number;
  dose: number;
  stateId: string;
  originId: string;
  years: number;
  order: number;
  tags: Record<string, number>;
  quality: number;
  risk: number;
}

export interface ConditionEvidence {
  code: string;
  matched: boolean;
  description: string;
  actual?: string | number | boolean;
  expected?: string;
  relatedFactorId?: string;
  relatedMaterialId?: string;
}

export interface CandidateResult {
  prototypeId: string;
  name: string;
  matched: boolean;
  priority: number;
  specificity: number;
  satisfiedCount: number;
  totalCount: number;
  conditions: ConditionEvidence[];
  missingConditions: ConditionEvidence[];
}

export interface ReasonItem {
  code: string;
  phase: "danger" | "formation" | "identity" | "quality" | "modifier";
  tone: "positive" | "negative" | "neutral";
  title: string;
  detail: string;
  sourceId: string;
  actual?: number | string | boolean;
  expected?: string;
  impact?: number;
  relatedFactorId?: string;
  relatedMaterialId?: string;
}

export interface EffectResult {
  id: string;
  name: string;
  value: number;
  unit: string;
  description: string;
  sourceRuleIds: string[];
}

export interface TraitResult {
  id: string;
  name: string;
  description: string;
  sourceRuleIds: string[];
}

export interface PillResult {
  prototypeId: string;
  name: string;
  form: "pill" | "powder" | "liquid";
  grade: number;
  icon: string;
  quality: Quality;
  qualityScore: number;
  quantity: number;
  evaluations: string[];
  primaryEffect: EffectResult;
  secondaryEffects: EffectResult[];
  sideEffects: EffectResult[];
  traits: TraitResult[];
  mutated: boolean;
}

export interface SimulationResult {
  schemaVersion: string;
  configVersion: string;
  inputHash: string;
  seed: number;
  status: SimulationStatus;
  pill?: PillResult;
  metrics: {
    danger: number;
    formation: number;
    quality?: number;
  };
  reasons: ReasonItem[];
  candidates: CandidateResult[];
  diagnostics: string[];
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
