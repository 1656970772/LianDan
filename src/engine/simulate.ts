import type {
  AlchemyConfig,
  CandidateResult,
  Condition,
  EffectGrant,
  EffectResult,
  EffectiveMaterial,
  FactorValue,
  ModifierRule,
  PillPrototype,
  PillResult,
  Quality,
  ReasonItem,
  RuleAction,
  SimulationInput,
  SimulationResult,
  TraitResult,
} from "../domain/types";
import { evaluateCondition, countConditionLeaves, type RuleContext } from "./condition";
import { XorShift32, normalizeSeed } from "./random";
import { clamp, hashStableValue, round1, unique } from "./utils";
import { validateConfig, validateSimulationInput } from "./validateConfig";

interface ScoreEvaluation {
  value: number;
  reasons: ReasonItem[];
}

interface MutablePill {
  prototypeId: string;
  name: string;
  form: PillResult["form"];
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

function configErrorResult(
  input: SimulationInput,
  config: AlchemyConfig,
  diagnostics: string[],
): SimulationResult {
  return {
    schemaVersion: config.schemaVersion,
    configVersion: config.configVersion,
    inputHash: hashStableValue(input),
    seed: Number.isFinite(input.seed) ? normalizeSeed(input.seed) : 0,
    status: "config_error",
    metrics: { danger: 0, formation: 0 },
    reasons: [],
    candidates: [],
    diagnostics,
  };
}

function yearStrengthMultiplier(material: AlchemyConfig["materials"][number], years: number): number {
  const { min, mature, max } = material.yearRange;
  if (years < mature) {
    const denominator = Math.max(1, mature - min);
    return 0.7 + 0.3 * ((years - min) / denominator);
  }
  const denominator = Math.max(1, max - mature);
  return 1 + 0.1 * ((years - mature) / denominator);
}

function yearQualityDelta(material: AlchemyConfig["materials"][number], years: number): number {
  const { min, mature, max } = material.yearRange;
  if (years < mature) {
    const denominator = Math.max(1, mature - min);
    return -20 * (1 - (years - min) / denominator);
  }
  const denominator = Math.max(1, max - mature);
  return 5 * ((years - mature) / denominator);
}

function buildMaterials(input: SimulationInput, config: AlchemyConfig): EffectiveMaterial[] {
  const materialMap = new Map(config.materials.map((item) => [item.id, item]));
  const stateMap = new Map(config.materialStates.map((item) => [item.id, item]));
  const originMap = new Map(config.materialOrigins.map((item) => [item.id, item]));
  const riskTagIds = new Set(
    config.tagDefinitions.filter((item) => item.category === "risk").map((item) => item.id),
  );

  return [...input.materials]
    .sort((left, right) => left.order - right.order || left.materialId.localeCompare(right.materialId))
    .map((item) => {
      const definition = materialMap.get(item.materialId);
      const state = stateMap.get(item.stateId);
      const origin = originMap.get(item.originId);
      if (!definition || !state || !origin) {
        throw new Error(`无法构建有效材料：${item.materialId}`);
      }
      const multiplier = yearStrengthMultiplier(definition, item.years);
      const tags: Record<string, number> = {};
      for (const tag of definition.baseTags) {
        const stateMultiplier = state.tagMultipliers?.[tag.tagId] ?? 1;
        tags[tag.tagId] = clamp(tag.strength * stateMultiplier * multiplier, 0, 100);
      }
      for (const [tagId, delta] of Object.entries(state.tagDeltas ?? {})) {
        tags[tagId] = clamp((tags[tagId] ?? 0) + delta, 0, 100);
      }
      for (const [tagId, delta] of Object.entries(origin.tagDeltas ?? {})) {
        tags[tagId] = clamp((tags[tagId] ?? 0) + delta, 0, 100);
      }
      const inherentRisk = Math.max(
        0,
        ...Object.entries(tags).filter(([tagId]) => riskTagIds.has(tagId)).map(([, value]) => value),
      );
      return {
        definitionId: definition.id,
        quantity: item.quantity,
        dose: item.quantity * definition.doseValue,
        stateId: item.stateId,
        originId: item.originId,
        years: item.years,
        order: item.order,
        tags,
        quality: clamp(72 + state.qualityDelta + origin.qualityDelta + yearQualityDelta(definition, item.years), 0, 100),
        risk: clamp(inherentRisk + state.riskDelta + origin.riskDelta, 0, 100),
      };
    });
}

function selectedOptionModifiers(
  input: SimulationInput,
  config: AlchemyConfig,
): Array<{ factorId: string; optionId: string; target: "danger" | "formation" | "quality" | "tag"; targetId?: string; value: number }> {
  const catalogs = new Map(config.optionCatalogs.map((catalog) => [catalog.id, catalog]));
  const result: Array<{ factorId: string; optionId: string; target: "danger" | "formation" | "quality" | "tag"; targetId?: string; value: number }> = [];
  for (const factor of config.factors) {
    if (!factor.optionCatalogId) continue;
    const optionId = input.factors[factor.id];
    if (typeof optionId !== "string") continue;
    const option = catalogs.get(factor.optionCatalogId)?.options.find((item) => item.id === optionId);
    if (!option) continue;
    for (const modifier of option.modifiers) {
      result.push({ factorId: factor.id, optionId, ...modifier });
    }
  }
  return result;
}

function aggregateTags(
  materials: EffectiveMaterial[],
  optionModifiers: ReturnType<typeof selectedOptionModifiers>,
): Record<string, number> {
  const tags: Record<string, number> = {};
  for (const material of materials) {
    for (const [tagId, strength] of Object.entries(material.tags)) {
      tags[tagId] = Math.max(tags[tagId] ?? 0, strength);
    }
  }
  for (const modifier of optionModifiers) {
    if (modifier.target === "tag" && modifier.targetId) {
      tags[modifier.targetId] = clamp((tags[modifier.targetId] ?? 0) + modifier.value, 0, 100);
    }
  }
  return Object.fromEntries(Object.entries(tags).map(([id, value]) => [id, round1(value)]));
}

function reason(
  base: Omit<ReasonItem, "actual" | "expected" | "impact" | "relatedFactorId" | "relatedMaterialId">,
  optional: Pick<ReasonItem, "actual" | "expected" | "impact" | "relatedFactorId" | "relatedMaterialId"> = {},
): ReasonItem {
  const result: ReasonItem = { ...base };
  if (optional.actual !== undefined) result.actual = optional.actual;
  if (optional.expected !== undefined) result.expected = optional.expected;
  if (optional.impact !== undefined) result.impact = optional.impact;
  if (optional.relatedFactorId !== undefined) result.relatedFactorId = optional.relatedFactorId;
  if (optional.relatedMaterialId !== undefined) result.relatedMaterialId = optional.relatedMaterialId;
  return result;
}

function computeScore(
  phase: "danger" | "formation" | "quality",
  context: RuleContext,
  config: AlchemyConfig,
  optionModifiers: ReturnType<typeof selectedOptionModifiers>,
): ScoreEvaluation {
  const model = config.scoreModels[phase];
  const factorMap = new Map(config.factors.map((item) => [item.id, item]));
  const averageMaterialQuality = context.materials.length === 0
    ? 0
    : context.materials.reduce((sum, item) => sum + item.quality, 0) / context.materials.length;
  let value = model.base;
  const reasons: ReasonItem[] = [];

  for (const [index, input] of model.inputs.entries()) {
    let sourceValue = 0;
    let sourceName = "未知输入";
    let sourceId = `score.${phase}.input.${index}`;
    let relatedFactorId: string | undefined;
    if (input.source === "factor" && input.sourceId) {
      const raw = context.factors[input.sourceId];
      sourceValue = typeof raw === "number" ? raw : 0;
      sourceName = factorMap.get(input.sourceId)?.label ?? input.sourceId;
      sourceId = `factor.${input.sourceId}`;
      relatedFactorId = input.sourceId;
    } else if (input.source === "material_quality") {
      sourceValue = averageMaterialQuality;
      sourceName = "材料综合品质";
      sourceId = "score.material_quality";
    } else if (input.source === "option_modifier") {
      sourceValue = optionModifiers
        .filter((modifier) => modifier.target === phase)
        .reduce((sum, modifier) => sum + modifier.value, 0);
      sourceName = "选项综合修正";
      sourceId = `score.option_modifier.${phase}`;
    } else if (input.source === "dose_fit") {
      sourceValue = 100;
      sourceName = "有效剂量";
      sourceId = "score.dose_fit";
    }
    const impact = input.source === "option_modifier" ? sourceValue * input.weight : sourceValue * input.weight;
    value += impact;
    if (Math.abs(impact) >= 0.05) {
      const positiveForOutcome = phase === "danger" ? impact < 0 : impact > 0;
      reasons.push(reason({
        code: `${phase}.score.contribution`,
        phase,
        tone: positiveForOutcome ? "positive" : impact === 0 ? "neutral" : "negative",
        title: `${sourceName}${impact >= 0 ? "提升" : "降低"}${phase === "danger" ? "危险" : phase === "formation" ? "成形" : "品质"}`,
        detail: `${sourceName} ${round1(sourceValue)}，按权重 ${input.weight} 计入 ${impact >= 0 ? "+" : ""}${round1(impact)}。`,
        sourceId,
      }, {
        actual: round1(sourceValue),
        impact: round1(impact),
        ...(relatedFactorId ? { relatedFactorId } : {}),
      }));
    }
  }
  return { value, reasons };
}

function sortedRules(rules: ModifierRule[], phase: ModifierRule["phase"]): ModifierRule[] {
  return rules
    .filter((rule) => rule.phase === phase)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

function applyScoreRules(
  phase: "danger" | "formation" | "quality",
  value: number,
  context: RuleContext,
  config: AlchemyConfig,
): ScoreEvaluation {
  const reasons: ReasonItem[] = [];
  let next = value;
  for (const rule of sortedRules(config.modifierRules, phase)) {
    if (!evaluateCondition(rule.condition, { ...context, [phase]: round1(next) }, config).matched) continue;
    for (const action of rule.actions) {
      if (phase === "danger" && action.type === "adjustDanger") next += action.value;
      if (phase === "formation" && action.type === "adjustFormation") next += action.value;
      if (phase === "quality" && action.type === "adjustQuality") next += action.value;
    }
    const impact = next - value - reasons.reduce((sum, item) => sum + (item.impact ?? 0), 0);
    reasons.push(reason({
      code: rule.reason.code,
      phase,
      tone: rule.reason.tone,
      title: rule.reason.title,
      detail: rule.reason.detail,
      sourceId: rule.id,
    }, { impact: round1(impact) }));
  }
  return { value: next, reasons };
}

function candidateResults(context: RuleContext, config: AlchemyConfig): CandidateResult[] {
  return config.pillPrototypes
    .map((prototype): CandidateResult => {
      const evaluation = evaluateCondition(prototype.identityCondition, context, config);
      const specificity = countConditionLeaves(prototype.identityCondition);
      const satisfiedCount = evaluation.evidences.filter((item) => item.matched).length;
      return {
        prototypeId: prototype.id,
        name: prototype.name,
        matched: evaluation.matched,
        priority: prototype.priority,
        specificity,
        satisfiedCount,
        totalCount: evaluation.evidences.length,
        conditions: evaluation.evidences,
        missingConditions: evaluation.evidences.filter((item) => !item.matched),
      };
    })
    .sort((left, right) => {
      if (left.matched !== right.matched) return left.matched ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      if (left.specificity !== right.specificity) return right.specificity - left.specificity;
      const leftRatio = left.totalCount === 0 ? 0 : left.satisfiedCount / left.totalCount;
      const rightRatio = right.totalCount === 0 ? 0 : right.satisfiedCount / right.totalCount;
      if (leftRatio !== rightRatio) return rightRatio - leftRatio;
      return left.prototypeId.localeCompare(right.prototypeId);
    })
    .slice(0, config.meta.maxCandidates);
}

function selectedPrototype(
  candidates: CandidateResult[],
  config: AlchemyConfig,
): { prototype?: PillPrototype; conflict?: string } {
  const matched = candidates.filter((item) => item.matched);
  if (matched.length === 0) return {};
  const first = matched[0];
  const second = matched[1];
  if (first && second && first.priority === second.priority && first.specificity === second.specificity) {
    return { conflict: `丹药身份冲突：${first.prototypeId} 与 ${second.prototypeId} 同优先级且同特异度` };
  }
  const prototype = config.pillPrototypes.find((item) => item.id === first?.prototypeId);
  return prototype ? { prototype } : {};
}

function qualityFromScore(score: number, config: AlchemyConfig): Quality {
  const thresholds = [...config.scoreModels.thresholds.qualities].sort((left, right) => left.min - right.min);
  let quality: Quality = thresholds[0]?.quality ?? "lower";
  for (const threshold of thresholds) {
    if (score >= threshold.min) quality = threshold.quality;
  }
  return quality;
}

function applyIdealPenalties(
  score: number,
  prototype: PillPrototype,
  factors: Record<string, FactorValue>,
  config: AlchemyConfig,
): ScoreEvaluation {
  let value = score;
  const reasons: ReasonItem[] = [];
  const factorMap = new Map(config.factors.map((item) => [item.id, item]));
  for (const ideal of prototype.idealFactors) {
    const raw = factors[ideal.factorId];
    if (typeof raw !== "number") continue;
    const distance = raw < ideal.idealMin ? ideal.idealMin - raw : raw > ideal.idealMax ? raw - ideal.idealMax : 0;
    if (distance === 0) {
      reasons.push(reason({
        code: "quality.factor.ideal",
        phase: "quality",
        tone: "positive",
        title: `${factorMap.get(ideal.factorId)?.label ?? ideal.factorId}处于理想区间`,
        detail: `实际值 ${raw}，理想区间 ${ideal.idealMin} 至 ${ideal.idealMax}。`,
        sourceId: prototype.id,
      }, { actual: raw, expected: `${ideal.idealMin} 至 ${ideal.idealMax}`, relatedFactorId: ideal.factorId }));
      continue;
    }
    const penalty = distance * ideal.penaltyPerStep;
    value -= penalty;
    reasons.push(reason({
      code: "quality.factor.deviation",
      phase: "quality",
      tone: "negative",
      title: `${factorMap.get(ideal.factorId)?.label ?? ideal.factorId}偏离理想区间`,
      detail: `实际值 ${raw}，偏离 ${round1(distance)} 个步长，品质降低 ${round1(penalty)}。`,
      sourceId: prototype.id,
    }, { actual: raw, expected: `${ideal.idealMin} 至 ${ideal.idealMax}`, impact: -round1(penalty), relatedFactorId: ideal.factorId }));
  }
  return { value, reasons };
}

function effectResult(
  grant: EffectGrant,
  sourceId: string,
  quality: Quality,
  config: AlchemyConfig,
): EffectResult {
  const definition = config.effects.find((item) => item.id === grant.effectId);
  if (!definition) throw new Error(`效果定义不存在：${grant.effectId}`);
  const multiplier = config.meta.qualityEffectMultipliers[quality];
  return {
    id: definition.id,
    name: definition.name,
    value: Math.round(clamp(grant.value * multiplier, definition.range.min, definition.range.max)),
    unit: definition.unit,
    description: definition.description,
    sourceRuleIds: [sourceId],
  };
}

function traitResult(traitId: string, sourceId: string, config: AlchemyConfig): TraitResult {
  const definition = config.traits.find((item) => item.id === traitId);
  if (!definition) throw new Error(`特质定义不存在：${traitId}`);
  return { id: definition.id, name: definition.name, description: definition.description, sourceRuleIds: [sourceId] };
}

function coreMaterialIds(condition: Condition): string[] {
  switch (condition.op) {
    case "all":
    case "any":
      return unique(condition.conditions.flatMap(coreMaterialIds));
    case "not":
      return [];
    case "hasMaterial":
    case "materialQuantity":
      return [condition.materialId];
    default:
      return [];
  }
}

function formalPill(
  prototype: PillPrototype,
  quality: Quality,
  qualityScore: number,
  context: RuleContext,
  config: AlchemyConfig,
): MutablePill {
  const coreIds = new Set(coreMaterialIds(prototype.identityCondition));
  const coreDose = context.materials
    .filter((item) => coreIds.has(item.definitionId))
    .reduce((sum, item) => sum + item.dose, 0);
  const rawQuantity = Math.floor(coreDose / prototype.yield.dosePerPill) + config.meta.qualityYieldDeltas[quality];
  const quantity = Math.round(clamp(rawQuantity, prototype.yield.min, Math.min(prototype.yield.max, config.meta.maxPillQuantity)));
  return {
    prototypeId: prototype.id,
    name: prototype.name,
    form: prototype.form,
    grade: prototype.grade,
    icon: prototype.icon,
    quality,
    qualityScore,
    quantity,
    evaluations: ["normal"],
    primaryEffect: effectResult(prototype.primaryEffect, prototype.id, quality, config),
    secondaryEffects: prototype.secondaryEffects.map((grant) => effectResult(grant, prototype.id, quality, config)),
    sideEffects: prototype.sideEffects.map((grant) => effectResult(grant, prototype.id, quality, config)),
    traits: prototype.traits.map((traitId) => traitResult(traitId, prototype.id, config)),
    mutated: false,
  };
}

function fallbackPill(
  kind: "residual" | "waste",
  quality: Quality,
  qualityScore: number,
  config: AlchemyConfig,
): MutablePill {
  const definition = config.failureResults.find((item) => item.id === kind);
  if (!definition?.primaryEffect || !definition.icon || !definition.evaluationId) {
    throw new Error(`兜底结果定义不完整：${kind}`);
  }
  return {
    prototypeId: `fallback_${kind}`,
    name: definition.name,
    form: "pill",
    grade: 0,
    icon: definition.icon,
    quality,
    qualityScore,
    quantity: 1,
    evaluations: [definition.evaluationId],
    primaryEffect: effectResult(definition.primaryEffect, `failure_${kind}`, quality, config),
    secondaryEffects: [],
    sideEffects: kind === "waste"
      ? [effectResult({ effectId: "side_impurity", value: 48 }, `failure_${kind}`, quality, config)]
      : [],
    traits: [],
    mutated: false,
  };
}

function mergeEffect(
  pill: MutablePill,
  action: Extract<RuleAction, { type: "grantEffect" }>,
  sourceId: string,
  config: AlchemyConfig,
): void {
  const definition = config.effects.find((item) => item.id === action.effectId);
  if (!definition) throw new Error(`效果定义不存在：${action.effectId}`);
  const lists = definition.category === "secondary" ? pill.secondaryEffects : definition.category === "side" ? pill.sideEffects : [];
  if (definition.category === "primary") return;
  const existing = lists.find((item) => item.id === action.effectId);
  if (existing) {
    existing.value = Math.round(clamp(Math.max(existing.value, action.value), definition.range.min, definition.range.max));
    existing.sourceRuleIds = unique([...existing.sourceRuleIds, sourceId]);
  } else {
    lists.push({
      id: definition.id,
      name: definition.name,
      value: Math.round(clamp(action.value, definition.range.min, definition.range.max)),
      unit: definition.unit,
      description: definition.description,
      sourceRuleIds: [sourceId],
    });
  }
}

function applyResultAction(
  pill: MutablePill,
  action: RuleAction,
  sourceId: string,
  config: AlchemyConfig,
): void {
  switch (action.type) {
    case "adjustYield":
      pill.quantity = Math.round(clamp(pill.quantity + action.value, 1, config.meta.maxPillQuantity));
      return;
    case "grantEffect":
      mergeEffect(pill, action, sourceId, config);
      return;
    case "scaleEffect": {
      const allEffects = [pill.primaryEffect, ...pill.secondaryEffects, ...pill.sideEffects];
      const target = allEffects.find((item) => item.id === action.effectId);
      const definition = config.effects.find((item) => item.id === action.effectId);
      if (target && definition) {
        target.value = Math.round(clamp(target.value * action.factor, definition.range.min, definition.range.max));
        target.sourceRuleIds = unique([...target.sourceRuleIds, sourceId]);
      }
      return;
    }
    case "grantTrait": {
      const existing = pill.traits.find((item) => item.id === action.traitId);
      if (existing) existing.sourceRuleIds = unique([...existing.sourceRuleIds, sourceId]);
      else pill.traits.push(traitResult(action.traitId, sourceId, config));
      return;
    }
    case "grantEvaluation":
      pill.evaluations = unique([...pill.evaluations, action.evaluationId]);
      return;
    default:
      return;
  }
}

function applyResultRules(
  pill: MutablePill,
  context: RuleContext,
  config: AlchemyConfig,
): ReasonItem[] {
  const reasons: ReasonItem[] = [];
  for (const rule of sortedRules(config.modifierRules, "result")) {
    if (!evaluateCondition(rule.condition, context, config).matched) continue;
    rule.actions.forEach((action) => applyResultAction(pill, action, rule.id, config));
    reasons.push({
      code: rule.reason.code,
      phase: "modifier",
      tone: rule.reason.tone,
      title: rule.reason.title,
      detail: rule.reason.detail,
      sourceId: rule.id,
    });
  }
  if (pill.evaluations.includes("residual") || pill.evaluations.includes("waste")) {
    pill.evaluations = pill.evaluations.filter((item) => item !== "normal");
  }
  return reasons;
}

function applyMutation(
  pill: MutablePill,
  context: RuleContext,
  config: AlchemyConfig,
  seed: number,
): ReasonItem[] {
  if (context.factors.allow_mutation !== true) return [];
  const random = new XorShift32(seed);
  const rules = [...config.mutationRules].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  for (const rule of rules) {
    if (!evaluateCondition(rule.condition, context, config).matched) continue;
    const roll = random.nextFloat();
    if (roll >= rule.probability) continue;
    rule.actions.forEach((action) => applyResultAction(pill, action, rule.id, config));
    pill.mutated = true;
    return [reason({
      code: rule.reason.code,
      phase: "modifier",
      tone: rule.reason.tone,
      title: rule.reason.title,
      detail: rule.reason.detail,
      sourceId: rule.id,
    }, { actual: round1(roll), expected: `< ${rule.probability}` })];
  }
  return [];
}

function identityReasons(candidate: CandidateResult): ReasonItem[] {
  return candidate.conditions.map((item) => reason({
    code: item.matched ? "identity.condition.met" : "identity.condition.missing",
    phase: "identity",
    tone: item.matched ? "positive" : "negative",
    title: item.matched ? `身份条件满足：${candidate.name}` : `身份条件未满足：${candidate.name}`,
    detail: item.description,
    sourceId: candidate.prototypeId,
  }, {
    ...(item.actual !== undefined ? { actual: item.actual } : {}),
    ...(item.expected !== undefined ? { expected: item.expected } : {}),
    ...(item.relatedFactorId !== undefined ? { relatedFactorId: item.relatedFactorId } : {}),
    ...(item.relatedMaterialId !== undefined ? { relatedMaterialId: item.relatedMaterialId } : {}),
  }));
}

function simulation(
  input: SimulationInput,
  config: AlchemyConfig,
): SimulationResult {
  const normalizedSeed = normalizeSeed(input.seed);
  const inputHash = hashStableValue(input);
  const effectiveMaterials = buildMaterials(input, config);
  const optionModifiers = selectedOptionModifiers(input, config);
  const tags = aggregateTags(effectiveMaterials, optionModifiers);
  const baseContext: RuleContext = { materials: effectiveMaterials, factors: input.factors, tags };

  const dangerBase = computeScore("danger", baseContext, config, optionModifiers);
  const dangerRules = applyScoreRules("danger", dangerBase.value, baseContext, config);
  const danger = round1(clamp(dangerRules.value, config.scoreModels.danger.min, config.scoreModels.danger.max));
  const dangerReasons = [...dangerBase.reasons, ...dangerRules.reasons];
  if (danger >= config.scoreModels.thresholds.explosion) {
    const failure = config.failureResults.find((item) => item.id === "exploded");
    dangerReasons.push(reason({
      code: "danger.threshold.exploded",
      phase: "danger",
      tone: "negative",
      title: failure?.name ?? "炸炉",
      detail: `${failure?.description ?? "危险超出承受阈值。"}实际危险分 ${danger}，阈值 ${config.scoreModels.thresholds.explosion}。`,
      sourceId: "threshold.explosion",
    }, { actual: danger, expected: `< ${config.scoreModels.thresholds.explosion}` }));
    return {
      schemaVersion: config.schemaVersion, configVersion: config.configVersion, inputHash, seed: normalizedSeed,
      status: "exploded", metrics: { danger, formation: 0 }, reasons: dangerReasons, candidates: [], diagnostics: [],
    };
  }

  const contextWithDanger: RuleContext = { ...baseContext, danger };
  const formationBase = computeScore("formation", contextWithDanger, config, optionModifiers);
  const formationRules = applyScoreRules("formation", formationBase.value, contextWithDanger, config);
  const formation = round1(clamp(formationRules.value, config.scoreModels.formation.min, config.scoreModels.formation.max));
  const formationReasons = [...formationBase.reasons, ...formationRules.reasons];
  if (formation < config.scoreModels.thresholds.formation) {
    const failure = config.failureResults.find((item) => item.id === "not_formed");
    formationReasons.push(reason({
      code: "formation.threshold.not_formed",
      phase: "formation",
      tone: "negative",
      title: failure?.name ?? "未成丹",
      detail: `${failure?.description ?? "成形分不足。"}实际成形分 ${formation}，阈值 ${config.scoreModels.thresholds.formation}。`,
      sourceId: "threshold.formation",
    }, { actual: formation, expected: `>= ${config.scoreModels.thresholds.formation}` }));
    return {
      schemaVersion: config.schemaVersion, configVersion: config.configVersion, inputHash, seed: normalizedSeed,
      status: "not_formed", metrics: { danger, formation },
      reasons: [...dangerReasons, ...formationReasons], candidates: [], diagnostics: [],
    };
  }

  const contextWithFormation: RuleContext = { ...contextWithDanger, formation };
  const candidates = candidateResults(contextWithFormation, config);
  const selection = selectedPrototype(candidates, config);
  if (selection.conflict) {
    return {
      schemaVersion: config.schemaVersion, configVersion: config.configVersion, inputHash, seed: normalizedSeed,
      status: "config_error", metrics: { danger, formation }, reasons: [...dangerReasons, ...formationReasons],
      candidates, diagnostics: [selection.conflict],
    };
  }

  const qualityBase = computeScore("quality", contextWithFormation, config, optionModifiers);
  const ideal = selection.prototype
    ? applyIdealPenalties(qualityBase.value, selection.prototype, input.factors, config)
    : { value: qualityBase.value, reasons: [] };
  const qualityRules = applyScoreRules("quality", ideal.value, contextWithFormation, config);
  const qualityScore = round1(clamp(qualityRules.value, config.scoreModels.quality.min, config.scoreModels.quality.max));
  const quality = qualityFromScore(qualityScore, config);
  const qualityReasons = [...qualityBase.reasons, ...ideal.reasons, ...qualityRules.reasons];
  qualityReasons.push(reason({
    code: "quality.threshold.selected",
    phase: "quality",
    tone: "neutral",
    title: `品质定为${quality === "lower" ? "下品" : quality === "middle" ? "中品" : quality === "upper" ? "上品" : "极品"}`,
    detail: `最终品质分 ${qualityScore}，按当前配置阈值归档。`,
    sourceId: `quality.${quality}`,
  }, { actual: qualityScore }));

  let pill: MutablePill;
  let chosenCandidate: CandidateResult | undefined;
  let fallbackReason: ReasonItem | undefined;
  if (selection.prototype) {
    chosenCandidate = candidates.find((item) => item.prototypeId === selection.prototype?.id);
    pill = formalPill(selection.prototype, quality, qualityScore, contextWithFormation, config);
  } else {
    const closest = [...candidates].sort((left, right) => {
      const leftRatio = left.totalCount === 0 ? 0 : left.satisfiedCount / left.totalCount;
      const rightRatio = right.totalCount === 0 ? 0 : right.satisfiedCount / right.totalCount;
      return rightRatio - leftRatio || right.priority - left.priority || left.prototypeId.localeCompare(right.prototypeId);
    })[0];
    const ratio = closest && closest.totalCount > 0 ? closest.satisfiedCount / closest.totalCount : 0;
    const kind = ratio >= config.meta.residualMatchRatio ? "residual" : "waste";
    pill = fallbackPill(kind, quality, qualityScore, config);
    chosenCandidate = closest;
    fallbackReason = reason({
      code: `identity.fallback.${kind}`,
      phase: "identity",
      tone: "negative",
      title: kind === "residual" ? "未命中正式丹方，进入残丹兜底" : "药性分散，进入废丹兜底",
      detail: `最接近${closest?.name ?? "无候选"}，核心条件满足率 ${round1(ratio * 100)}%，残丹阈值 ${round1(config.meta.residualMatchRatio * 100)}%。`,
      sourceId: `failure_${kind}`,
    }, { actual: round1(ratio * 100), expected: `>= ${round1(config.meta.residualMatchRatio * 100)}% 为残丹` });
  }

  const resultContext: RuleContext = { ...contextWithFormation, quality: qualityScore };
  const resultReasons = applyResultRules(pill, resultContext, config);
  const mutationReasons = selection.prototype ? applyMutation(pill, resultContext, config, normalizedSeed) : [];
  const identity = chosenCandidate ? identityReasons(chosenCandidate) : [];
  if (fallbackReason) identity.push(fallbackReason);

  const result: PillResult = { ...pill };
  return {
    schemaVersion: config.schemaVersion,
    configVersion: config.configVersion,
    inputHash,
    seed: normalizedSeed,
    status: "success",
    pill: result,
    metrics: { danger, formation, quality: qualityScore },
    reasons: [...dangerReasons, ...formationReasons, ...identity, ...qualityReasons, ...resultReasons, ...mutationReasons],
    candidates,
    diagnostics: [],
  };
}

/** 一次无状态、可复现的成丹推演。 */
export function simulate(input: SimulationInput, config: AlchemyConfig): SimulationResult {
  const configValidation = validateConfig(config);
  if (!configValidation.valid) return configErrorResult(input, config, configValidation.errors);
  const inputErrors = validateSimulationInput(input, config);
  if (inputErrors.length > 0) return configErrorResult(input, config, inputErrors);
  try {
    return simulation(input, config);
  } catch (error) {
    return configErrorResult(input, config, [error instanceof Error ? error.message : String(error)]);
  }
}
