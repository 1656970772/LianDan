import type {
  AlchemyConfig,
  Condition,
  ConfigValidationResult,
  FactorDefinition,
  MaterialKind,
  SimulationInput,
} from "../domain/types";
import { countConditionLeaves } from "./condition";
import { stableStringify } from "./utils";

const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function pushDuplicateErrors(
  errors: string[],
  label: string,
  items: unknown,
): void {
  if (!Array.isArray(items)) {
    errors.push(`${label} 必须是数组`);
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      errors.push(`${label}[${index}] 必须是对象`);
      continue;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      errors.push(`${label}[${index}].id 不符合稳定 ID 格式：${String(id)}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label} 存在重复 ID：${id}`);
    }
    seen.add(id);
  }
}

function collectFactorReferences(condition: Condition): string[] {
  switch (condition.op) {
    case "all":
    case "any":
      return condition.conditions.flatMap(collectFactorReferences);
    case "not":
      return collectFactorReferences(condition.condition);
    case "factorRange":
    case "factorEquals":
      return [condition.factorId];
    default:
      return [];
  }
}

interface ReferenceSets {
  tags: Set<string>;
  materials: Set<string>;
  factors: Map<string, FactorDefinition>;
  states: Set<string>;
  origins: Set<string>;
}

function validateCondition(
  condition: Condition,
  path: string,
  refs: ReferenceSets,
  errors: string[],
  allowedDerived: Set<"qualityRange" | "dangerRange" | "formationRange">,
): void {
  const validateBounds = (min?: number, max?: number): void => {
    if (min !== undefined && !finite(min)) errors.push(`${path}.min 必须是有限数`);
    if (max !== undefined && !finite(max)) errors.push(`${path}.max 必须是有限数`);
    if (min !== undefined && max !== undefined && min > max) errors.push(`${path} 的 min 不得大于 max`);
  };

  switch (condition.op) {
    case "all":
    case "any":
      if (condition.conditions.length === 0) errors.push(`${path}.conditions 不得为空`);
      condition.conditions.forEach((item, index) =>
        validateCondition(item, `${path}.conditions[${index}]`, refs, errors, allowedDerived),
      );
      return;
    case "not":
      validateCondition(condition.condition, `${path}.condition`, refs, errors, allowedDerived);
      return;
    case "hasMaterial":
    case "materialQuantity":
      if (!refs.materials.has(condition.materialId)) errors.push(`${path} 引用不存在的材料：${condition.materialId}`);
      if (condition.op === "materialQuantity") validateBounds(condition.min, condition.max);
      return;
    case "tagRange":
      if (!refs.tags.has(condition.tagId)) errors.push(`${path} 引用不存在的标签：${condition.tagId}`);
      validateBounds(condition.min, condition.max);
      return;
    case "factorRange": {
      const factor = refs.factors.get(condition.factorId);
      if (!factor) errors.push(`${path} 引用不存在的因素：${condition.factorId}`);
      else if (factor.valueType !== "number") errors.push(`${path} 对非数值因素使用 factorRange：${condition.factorId}`);
      validateBounds(condition.min, condition.max);
      return;
    }
    case "factorEquals": {
      const factor = refs.factors.get(condition.factorId);
      if (!factor) errors.push(`${path} 引用不存在的因素：${condition.factorId}`);
      else if (factor.valueType === "number") errors.push(`${path} 对数值因素使用 factorEquals：${condition.factorId}`);
      return;
    }
    case "materialState":
      if (!refs.materials.has(condition.materialId)) errors.push(`${path} 引用不存在的材料：${condition.materialId}`);
      if (!refs.states.has(condition.stateId)) errors.push(`${path} 引用不存在的状态：${condition.stateId}`);
      return;
    case "materialOrigin":
      if (!refs.materials.has(condition.materialId)) errors.push(`${path} 引用不存在的材料：${condition.materialId}`);
      if (!refs.origins.has(condition.originId)) errors.push(`${path} 引用不存在的来源：${condition.originId}`);
      return;
    case "orderBefore":
      if (!refs.materials.has(condition.firstMaterialId)) errors.push(`${path} 引用不存在的材料：${condition.firstMaterialId}`);
      if (!refs.materials.has(condition.secondMaterialId)) errors.push(`${path} 引用不存在的材料：${condition.secondMaterialId}`);
      return;
    case "qualityRange":
    case "dangerRange":
    case "formationRange":
      if (!allowedDerived.has(condition.op)) errors.push(`${path} 在当前阶段不允许使用 ${condition.op}`);
      validateBounds(condition.min, condition.max);
  }
}

function factorOptions(factor: FactorDefinition, config: AlchemyConfig): string[] {
  if (factor.options) return factor.options.map((item) => item.value);
  if (!factor.optionCatalogId) return [];
  return config.optionCatalogs.find((catalog) => catalog.id === factor.optionCatalogId)?.options.map((item) => item.id) ?? [];
}

function validateFactorValue(
  factor: FactorDefinition,
  value: unknown,
  path: string,
  config: AlchemyConfig,
  errors: string[],
): void {
  if (factor.valueType === "number") {
    if (typeof value !== "number" || !finite(value)) {
      errors.push(`${path} 必须是有限数`);
      return;
    }
    if (factor.min !== undefined && value < factor.min) errors.push(`${path} 低于下限 ${factor.min}`);
    if (factor.max !== undefined && value > factor.max) errors.push(`${path} 高于上限 ${factor.max}`);
    if (factor.step !== undefined && factor.min !== undefined) {
      const steps = (value - factor.min) / factor.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8) errors.push(`${path} 不符合步长 ${factor.step}`);
    }
    return;
  }
  if (factor.valueType === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path} 必须是布尔值`);
    return;
  }
  if (typeof value !== "string") {
    errors.push(`${path} 必须是字符串`);
    return;
  }
  const options = factorOptions(factor, config);
  if (!options.includes(value)) errors.push(`${path} 不是合法选项：${value}`);
}

export function validateSimulationInput(input: SimulationInput, config: AlchemyConfig): string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== config.schemaVersion) errors.push(`input.schemaVersion 与配置不兼容：${input.schemaVersion}`);
  if (input.configVersion !== config.configVersion) errors.push(`input.configVersion 与当前配置不一致：${input.configVersion}`);
  if (!Number.isInteger(input.seed)) errors.push("input.seed 必须是整数");
  if (!Array.isArray(input.materials) || input.materials.length === 0) errors.push("input.materials 至少需要一种材料");
  if (input.materials.length > config.meta.maxMaterials) errors.push(`input.materials 超过上限 ${config.meta.maxMaterials}`);

  const materialMap = new Map(config.materials.map((item) => [item.id, item]));
  const inventoryEntries = Array.isArray(config.inventory)
    ? config.inventory.filter((item) => item && typeof item === "object")
    : [];
  const recipeSlotEntries = Array.isArray(config.recipeSlots)
    ? config.recipeSlots.filter((slot) => slot && typeof slot === "object")
    : [];
  const inventoryMap = new Map(inventoryEntries.map((item) => [item.materialId, item.quantity]));
  const validOrders = new Set(recipeSlotEntries.map((slot) => slot.order));
  const states = new Set(config.materialStates.map((item) => item.id));
  const origins = new Set(config.materialOrigins.map((item) => item.id));
  const seenMaterials = new Set<string>();
  const seenOrders = new Set<number>();
  input.materials.forEach((item, index) => {
    const path = `input.materials[${index}]`;
    const definition = materialMap.get(item.materialId);
    if (!definition) errors.push(`${path}.materialId 不存在：${item.materialId}`);
    if (seenMaterials.has(item.materialId)) errors.push(`${path}.materialId 重复，同种材料应合并数量：${item.materialId}`);
    seenMaterials.add(item.materialId);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) errors.push(`${path}.quantity 必须是正整数`);
    else if (item.quantity > (inventoryMap.get(item.materialId) ?? 0)) errors.push(`${path}.quantity 超过背包库存`);
    if (!states.has(item.stateId)) errors.push(`${path}.stateId 不存在：${item.stateId}`);
    else if (definition && (!Array.isArray(definition.allowedStateIds) || !definition.allowedStateIds.includes(item.stateId))) errors.push(`${path}.stateId 不适用于 ${definition.name}：${item.stateId}`);
    if (!origins.has(item.originId)) errors.push(`${path}.originId 不存在：${item.originId}`);
    else if (definition && (!Array.isArray(definition.allowedOriginIds) || !definition.allowedOriginIds.includes(item.originId))) errors.push(`${path}.originId 不适用于 ${definition.name}：${item.originId}`);
    if (!Number.isInteger(item.years)) errors.push(`${path}.years 必须是整数`);
    else if (definition && (item.years < definition.yearRange.min || item.years > definition.yearRange.max)) {
      errors.push(`${path}.years 超出 ${definition.name} 合法范围 ${definition.yearRange.min} 至 ${definition.yearRange.max}`);
    }
    if (!Number.isInteger(item.order) || !validOrders.has(item.order)) errors.push(`${path}.order 必须对应配置中的丹方槽位`);
    if (seenOrders.has(item.order)) errors.push(`${path}.order 重复：${item.order}`);
    seenOrders.add(item.order);
  });

  for (const factor of config.factors) {
    if (!(factor.id in input.factors)) errors.push(`input.factors.${factor.id} 缺失`);
    else validateFactorValue(factor, input.factors[factor.id], `input.factors.${factor.id}`, config, errors);
  }
  const factorIds = new Set(config.factors.map((item) => item.id));
  for (const factorId of Object.keys(input.factors)) {
    if (!factorIds.has(factorId)) errors.push(`input.factors 包含未定义因素：${factorId}`);
  }
  return errors;
}

export function validateConfig(config: AlchemyConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config || typeof config !== "object") return { valid: false, errors: ["根配置必须是对象"], warnings };
  if (!config.schemaVersion) errors.push("schemaVersion 不得为空");
  if (!config.configVersion) errors.push("configVersion 不得为空");
  const materialKindProfiles = Array.isArray(config.materialKindProfiles) ? config.materialKindProfiles : [];
  if (!Array.isArray(config.materialKindProfiles)) errors.push("materialKindProfiles 必须是数组");

  const collections: Array<[string, Array<{ id: string }>]> = [
    ["tagDefinitions", config.tagDefinitions], ["materialStates", config.materialStates],
    ["materialOrigins", config.materialOrigins], ["materialKindProfiles", materialKindProfiles],
    ["materials", config.materials],
    ["factorGroups", config.factorGroups], ["factors", config.factors],
    ["optionCatalogs", config.optionCatalogs], ["effects", config.effects],
    ["traits", config.traits], ["evaluations", config.evaluations],
    ["pillPrototypes", config.pillPrototypes], ["modifierRules", config.modifierRules],
    ["mutationRules", config.mutationRules], ["failureResults", config.failureResults],
    ["presets", config.presets],
  ];
  collections.forEach(([label, items]) => pushDuplicateErrors(errors, label, items));

  const tagIds = new Set(config.tagDefinitions.map((item) => item.id));
  const materialIds = new Set(config.materials.map((item) => item.id));
  const factorMap = new Map(config.factors.map((item) => [item.id, item]));
  const groupIds = new Set(config.factorGroups.map((item) => item.id));
  const catalogIds = new Set(config.optionCatalogs.map((item) => item.id));
  const stateIds = new Set(config.materialStates.map((item) => item.id));
  const originIds = new Set(config.materialOrigins.map((item) => item.id));
  const materialKindProfileMap = new Map(materialKindProfiles.map((item) => [item.id, item]));
  const effectMap = new Map(config.effects.map((item) => [item.id, item]));
  const traitIds = new Set(config.traits.map((item) => item.id));
  const evaluationIds = new Set<string>(config.evaluations.map((item) => item.id));
  const refs: ReferenceSets = { tags: tagIds, materials: materialIds, factors: factorMap, states: stateIds, origins: originIds };

  if (!Array.isArray(config.recipeSlots) || config.recipeSlots.length !== 6) {
    errors.push("recipeSlots 必须配置六个丹方槽位");
  } else {
    pushDuplicateErrors(errors, "recipeSlots", config.recipeSlots);
    const slotOrders = new Set<number>();
    const roleCounts = { main: 0, auxiliary: 0, catalyst: 0 };
    config.recipeSlots.forEach((slot, index) => {
      if (!slot || typeof slot !== "object") {
        errors.push(`recipeSlots[${index}] 必须是对象`);
        return;
      }
      if (typeof slot.label !== "string" || !slot.label.trim()) errors.push(`recipeSlots[${index}].label 不得为空`);
      if (!Number.isInteger(slot.order) || slot.order < 0) errors.push(`recipeSlots[${index}].order 必须是非负整数`);
      if (slotOrders.has(slot.order)) errors.push(`recipeSlots[${index}].order 不得重复`);
      slotOrders.add(slot.order);
      if (slot.role === "main" || slot.role === "auxiliary" || slot.role === "catalyst") {
        roleCounts[slot.role] += 1;
      } else {
        errors.push(`recipeSlots[${index}].role 不是合法槽位类型：${String(slot.role)}`);
      }
    });
    if (roleCounts.main !== 3 || roleCounts.auxiliary !== 2 || roleCounts.catalyst !== 1) {
      errors.push("recipeSlots 必须包含三个主药槽、两个辅药槽和一个药引槽");
    }
  }
  if (!Array.isArray(config.inventory)) {
    errors.push("inventory 必须是数组");
  } else {
    const inventoryMaterialIds = new Set<string>();
    config.inventory.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push(`inventory[${index}] 必须是对象`);
        return;
      }
      if (typeof entry.materialId !== "string") {
        errors.push(`inventory[${index}].materialId 必须是字符串`);
        return;
      }
      if (!materialIds.has(entry.materialId)) errors.push(`inventory[${index}] 引用不存在材料：${entry.materialId}`);
      if (inventoryMaterialIds.has(entry.materialId)) errors.push(`inventory[${index}].materialId 不得重复：${entry.materialId}`);
      inventoryMaterialIds.add(entry.materialId);
      if (!Number.isInteger(entry.quantity) || entry.quantity < 0) errors.push(`inventory[${index}].quantity 必须是非负整数`);
    });
    config.materials.forEach((material) => {
      if (!inventoryMaterialIds.has(material.id)) errors.push(`inventory 缺少材料：${material.id}`);
    });
  }

  if (!finite(config.meta.residualMatchRatio) || config.meta.residualMatchRatio < 0 || config.meta.residualMatchRatio > 1) errors.push("meta.residualMatchRatio 必须在 0 至 1");
  if (!Number.isInteger(config.meta.maxMaterials) || config.meta.maxMaterials < 1) errors.push("meta.maxMaterials 必须是正整数");
  if (Array.isArray(config.recipeSlots) && config.meta.maxMaterials !== config.recipeSlots.length) {
    errors.push("meta.maxMaterials 必须与 recipeSlots 数量一致");
  }
  if (!Number.isInteger(config.meta.maxCandidates) || config.meta.maxCandidates < 1) errors.push("meta.maxCandidates 必须是正整数");
  if (!Number.isInteger(config.meta.maxPillQuantity) || config.meta.maxPillQuantity < 1) errors.push("meta.maxPillQuantity 必须是正整数");
  (["lower", "middle", "upper", "supreme"] as const).forEach((quality) => {
    const effectMultiplier = config.meta.qualityEffectMultipliers[quality];
    const yieldDelta = config.meta.qualityYieldDeltas[quality];
    if (!finite(effectMultiplier) || effectMultiplier < 0) errors.push(`meta.qualityEffectMultipliers.${quality} 必须是非负有限数`);
    if (!Number.isInteger(yieldDelta)) errors.push(`meta.qualityYieldDeltas.${quality} 必须是整数`);
  });

  config.tagDefinitions.forEach((item, index) => {
    if (!item.name) errors.push(`tagDefinitions[${index}].name 不得为空`);
  });
  config.materialStates.forEach((state, index) => {
    Object.keys(state.tagMultipliers ?? {}).forEach((tagId) => {
      if (!tagIds.has(tagId)) errors.push(`materialStates[${index}].tagMultipliers 引用不存在标签：${tagId}`);
    });
    Object.keys(state.tagDeltas ?? {}).forEach((tagId) => {
      if (!tagIds.has(tagId)) errors.push(`materialStates[${index}].tagDeltas 引用不存在标签：${tagId}`);
    });
  });
  config.materialOrigins.forEach((origin, index) => {
    Object.keys(origin.tagDeltas ?? {}).forEach((tagId) => {
      if (!tagIds.has(tagId)) errors.push(`materialOrigins[${index}].tagDeltas 引用不存在标签：${tagId}`);
    });
  });
  const requiredMaterialKinds: MaterialKind[] = ["herb", "flower", "fruit", "root", "core", "liquid", "wonder"];
  requiredMaterialKinds.forEach((kind) => {
    if (!materialKindProfileMap.has(kind)) errors.push(`materialKindProfiles 缺少材料类别：${kind}`);
  });
  materialKindProfiles.forEach((profile, index) => {
    const allowedStateIds = Array.isArray(profile.allowedStateIds) ? profile.allowedStateIds : [];
    const allowedOriginIds = Array.isArray(profile.allowedOriginIds) ? profile.allowedOriginIds : [];
    if (!requiredMaterialKinds.includes(profile.id)) errors.push(`materialKindProfiles[${index}].id 不是合法材料类别：${profile.id}`);
    if (!Array.isArray(profile.allowedStateIds) || !allowedStateIds.length) errors.push(`materialKindProfiles[${index}].allowedStateIds 不得为空`);
    if (new Set(allowedStateIds).size !== allowedStateIds.length) errors.push(`materialKindProfiles[${index}].allowedStateIds 不得重复`);
    allowedStateIds.forEach((stateId) => {
      if (!stateIds.has(stateId)) errors.push(`materialKindProfiles[${index}].allowedStateIds 引用不存在状态：${stateId}`);
    });
    if (!allowedStateIds.includes(profile.defaultStateId)) errors.push(`materialKindProfiles[${index}].defaultStateId 必须属于 allowedStateIds`);
    if (!Array.isArray(profile.allowedOriginIds) || !allowedOriginIds.length) errors.push(`materialKindProfiles[${index}].allowedOriginIds 不得为空`);
    if (new Set(allowedOriginIds).size !== allowedOriginIds.length) errors.push(`materialKindProfiles[${index}].allowedOriginIds 不得重复`);
    allowedOriginIds.forEach((originId) => {
      if (!originIds.has(originId)) errors.push(`materialKindProfiles[${index}].allowedOriginIds 引用不存在来源：${originId}`);
    });
    if (!allowedOriginIds.includes(profile.defaultOriginId)) errors.push(`materialKindProfiles[${index}].defaultOriginId 必须属于 allowedOriginIds`);
    if (typeof profile.ageLabel !== "string" || !profile.ageLabel.trim()) errors.push(`materialKindProfiles[${index}].ageLabel 不得为空`);
    if (typeof profile.ageUnit !== "string" || !profile.ageUnit.trim()) errors.push(`materialKindProfiles[${index}].ageUnit 不得为空`);
    if (typeof profile.maturityLabel !== "string" || !profile.maturityLabel.trim()) errors.push(`materialKindProfiles[${index}].maturityLabel 不得为空`);
  });
  config.materials.forEach((item, index) => {
    if (!item.icon.endsWith(".png")) errors.push(`materials[${index}].icon 必须指向 PNG：${item.icon}`);
    if (!finite(item.doseValue) || item.doseValue <= 0) errors.push(`materials[${index}].doseValue 必须为正有限数`);
    const allowedStateIds = Array.isArray(item.allowedStateIds) ? item.allowedStateIds : [];
    const allowedOriginIds = Array.isArray(item.allowedOriginIds) ? item.allowedOriginIds : [];
    const kindProfile = materialKindProfileMap.get(item.kind);
    if (!kindProfile) errors.push(`materials[${index}].kind 没有类别配置：${item.kind}`);
    if (!Array.isArray(item.allowedStateIds) || !allowedStateIds.length) errors.push(`materials[${index}].allowedStateIds 不得为空`);
    if (new Set(allowedStateIds).size !== allowedStateIds.length) errors.push(`materials[${index}].allowedStateIds 不得重复`);
    allowedStateIds.forEach((stateId) => {
      if (!stateIds.has(stateId)) errors.push(`materials[${index}].allowedStateIds 引用不存在状态：${stateId}`);
      if (kindProfile && (!Array.isArray(kindProfile.allowedStateIds) || !kindProfile.allowedStateIds.includes(stateId))) errors.push(`materials[${index}].allowedStateIds 包含不属于 ${item.kind} 类别的状态：${stateId}`);
    });
    if (!allowedStateIds.includes(item.defaultStateId)) errors.push(`materials[${index}].defaultStateId 必须属于 allowedStateIds`);
    if (!Array.isArray(item.allowedOriginIds) || !allowedOriginIds.length) errors.push(`materials[${index}].allowedOriginIds 不得为空`);
    if (new Set(allowedOriginIds).size !== allowedOriginIds.length) errors.push(`materials[${index}].allowedOriginIds 不得重复`);
    allowedOriginIds.forEach((originId) => {
      if (!originIds.has(originId)) errors.push(`materials[${index}].allowedOriginIds 引用不存在来源：${originId}`);
      if (kindProfile && (!Array.isArray(kindProfile.allowedOriginIds) || !kindProfile.allowedOriginIds.includes(originId))) errors.push(`materials[${index}].allowedOriginIds 包含不属于 ${item.kind} 类别的来源：${originId}`);
    });
    if (!allowedOriginIds.includes(item.defaultOriginId)) errors.push(`materials[${index}].defaultOriginId 必须属于 allowedOriginIds`);
    if (typeof item.ageLabel !== "string" || !item.ageLabel.trim()) errors.push(`materials[${index}].ageLabel 不得为空`);
    if (typeof item.ageUnit !== "string" || !item.ageUnit.trim()) errors.push(`materials[${index}].ageUnit 不得为空`);
    if (typeof item.maturityLabel !== "string" || !item.maturityLabel.trim()) errors.push(`materials[${index}].maturityLabel 不得为空`);
    if (kindProfile && item.ageLabel !== kindProfile.ageLabel) errors.push(`materials[${index}].ageLabel 必须遵循 ${item.kind} 类别配置`);
    if (kindProfile && item.ageUnit !== kindProfile.ageUnit) errors.push(`materials[${index}].ageUnit 必须遵循 ${item.kind} 类别配置`);
    if (kindProfile && item.maturityLabel !== kindProfile.maturityLabel) errors.push(`materials[${index}].maturityLabel 必须遵循 ${item.kind} 类别配置`);
    if (!(item.yearRange.min <= item.yearRange.mature && item.yearRange.mature <= item.yearRange.max)) errors.push(`materials[${index}].yearRange 顺序非法`);
    if (item.defaultYears < item.yearRange.min || item.defaultYears > item.yearRange.max) errors.push(`materials[${index}].defaultYears 越界`);
    item.baseTags.forEach((tag, tagIndex) => {
      if (!tagIds.has(tag.tagId)) errors.push(`materials[${index}].baseTags[${tagIndex}] 引用不存在标签：${tag.tagId}`);
      if (!finite(tag.strength) || tag.strength < 0 || tag.strength > 100) errors.push(`materials[${index}].baseTags[${tagIndex}].strength 必须在 0 至 100`);
    });
  });

  config.optionCatalogs.forEach((catalog, catalogIndex) => {
    pushDuplicateErrors(errors, `optionCatalogs[${catalogIndex}].options`, catalog.options);
    catalog.options.forEach((option, optionIndex) => option.modifiers.forEach((modifier, modifierIndex) => {
      if (!finite(modifier.value)) errors.push(`optionCatalogs[${catalogIndex}].options[${optionIndex}].modifiers[${modifierIndex}].value 必须是有限数`);
      if (modifier.target === "tag" && (!modifier.targetId || !tagIds.has(modifier.targetId))) errors.push(`optionCatalogs[${catalogIndex}].options[${optionIndex}].modifiers[${modifierIndex}] 引用不存在标签：${modifier.targetId ?? "缺失"}`);
    }));
  });

  config.factors.forEach((factor, index) => {
    const path = `factors[${index}]`;
    if (!groupIds.has(factor.groupId)) errors.push(`${path}.groupId 不存在：${factor.groupId}`);
    if ((factor.controlType === "range" || factor.controlType === "number")) {
      if (factor.valueType !== "number") errors.push(`${path} 的数值控件必须使用 number valueType`);
      if (factor.min === undefined || factor.max === undefined || factor.step === undefined) errors.push(`${path} 的数值控件必须定义 min、max、step`);
      else if (!finite(factor.min) || !finite(factor.max) || !finite(factor.step) || factor.min > factor.max || factor.step <= 0) errors.push(`${path} 的 min、max、step 非法`);
    }
    if (factor.controlType === "select") {
      if (factor.valueType !== "string") errors.push(`${path} 的 select 必须使用 string valueType`);
      if (!factor.options && !factor.optionCatalogId) errors.push(`${path} 的 select 必须定义 options 或 optionCatalogId`);
      if (factor.optionCatalogId && !catalogIds.has(factor.optionCatalogId)) errors.push(`${path}.optionCatalogId 不存在：${factor.optionCatalogId}`);
    }
    if (factor.controlType === "toggle" && factor.valueType !== "boolean") errors.push(`${path} 的 toggle 必须使用 boolean valueType`);
    validateFactorValue(factor, factor.defaultValue, `${path}.defaultValue`, config, errors);
    if (factor.visibilityCondition) {
      validateCondition(factor.visibilityCondition, `${path}.visibilityCondition`, refs, errors, new Set());
      const currentIndex = index;
      collectFactorReferences(factor.visibilityCondition).forEach((factorId) => {
        const dependencyIndex = config.factors.findIndex((item) => item.id === factorId);
        if (dependencyIndex >= currentIndex) errors.push(`${path}.visibilityCondition 只能引用更早因素：${factorId}`);
      });
    }
  });

  config.effects.forEach((item, index) => {
    if (!finite(item.range.min) || !finite(item.range.max) || item.range.min > item.range.max) errors.push(`effects[${index}].range 非法`);
  });
  const scoreModels = [config.scoreModels.danger, config.scoreModels.formation, config.scoreModels.quality];
  scoreModels.forEach((model, index) => {
    if (![model.base, model.min, model.max].every(finite) || model.min > model.max) errors.push(`scoreModels[${index}] 范围非法`);
    model.inputs.forEach((input, inputIndex) => {
      if (!finite(input.weight)) errors.push(`scoreModels[${index}].inputs[${inputIndex}].weight 必须是有限数`);
      if (input.source === "factor" && (!input.sourceId || !factorMap.has(input.sourceId))) errors.push(`scoreModels[${index}].inputs[${inputIndex}] 引用不存在因素：${input.sourceId ?? "缺失"}`);
    });
    const magnitude = model.inputs.reduce((sum, item) => sum + Math.abs(item.weight), 0);
    if (magnitude > 5) warnings.push(`scoreModels[${index}] 权重量级偏大：${magnitude}`);
  });
  const qualities = config.scoreModels.thresholds.qualities;
  if (qualities.length !== 4 || qualities[0]?.min !== 0) errors.push("scoreModels.thresholds.qualities 必须从 0 开始定义四个品质档");
  for (let index = 1; index < qualities.length; index += 1) {
    if ((qualities[index]?.min ?? 0) <= (qualities[index - 1]?.min ?? 0)) errors.push("scoreModels.thresholds.qualities 必须严格递增");
  }

  config.pillPrototypes.forEach((prototype, index) => {
    const path = `pillPrototypes[${index}]`;
    if (!prototype.icon.endsWith(".png")) errors.push(`${path}.icon 必须指向 PNG`);
    if (!Number.isInteger(prototype.grade) || prototype.grade < 1) errors.push(`${path}.grade 必须是正整数`);
    if (prototype.yield.min > prototype.yield.max || prototype.yield.min < 1 || prototype.yield.dosePerPill <= 0) errors.push(`${path}.yield 范围非法`);
    const primary = effectMap.get(prototype.primaryEffect.effectId);
    if (!primary) errors.push(`${path}.primaryEffect 引用不存在效果：${prototype.primaryEffect.effectId}`);
    else if (primary.category !== "primary") errors.push(`${path}.primaryEffect 引用的效果不是 primary：${primary.id}`);
    const grants = [
      ...prototype.secondaryEffects.map((grant) => ({ grant, category: "secondary" as const })),
      ...prototype.sideEffects.map((grant) => ({ grant, category: "side" as const })),
    ];
    grants.forEach(({ grant, category }, grantIndex) => {
      const definition = effectMap.get(grant.effectId);
      if (!definition) errors.push(`${path}.effects[${grantIndex}] 引用不存在效果：${grant.effectId}`);
      else if (definition.category !== category) errors.push(`${path}.effects[${grantIndex}] 效果分类应为 ${category}：${grant.effectId}`);
    });
    [prototype.primaryEffect, ...prototype.secondaryEffects, ...prototype.sideEffects].forEach((grant, grantIndex) => {
      const definition = effectMap.get(grant.effectId);
      if (definition && (grant.value < definition.range.min || grant.value > definition.range.max)) errors.push(`${path}.effects[${grantIndex}].value 越出效果范围：${grant.effectId}`);
    });
    prototype.traits.forEach((traitId) => {
      if (!traitIds.has(traitId)) errors.push(`${path}.traits 引用不存在特质：${traitId}`);
    });
    prototype.idealFactors.forEach((ideal, idealIndex) => {
      const factor = factorMap.get(ideal.factorId);
      if (!factor || factor.valueType !== "number") errors.push(`${path}.idealFactors[${idealIndex}] 引用不存在或非数值因素：${ideal.factorId}`);
      if (ideal.idealMin > ideal.idealMax || ideal.penaltyPerStep < 0) errors.push(`${path}.idealFactors[${idealIndex}] 范围或惩罚非法`);
    });
    validateCondition(prototype.identityCondition, `${path}.identityCondition`, refs, errors, new Set());
  });

  for (let left = 0; left < config.pillPrototypes.length; left += 1) {
    for (let right = left + 1; right < config.pillPrototypes.length; right += 1) {
      const a = config.pillPrototypes[left];
      const b = config.pillPrototypes[right];
      if (a && b && a.priority === b.priority && countConditionLeaves(a.identityCondition) === countConditionLeaves(b.identityCondition) && stableStringify(a.identityCondition) === stableStringify(b.identityCondition)) {
        errors.push(`pillPrototypes 存在同优先级、同特异度且条件相同的冲突：${a.id} / ${b.id}`);
      }
    }
  }

  const validateActions = (actions: AlchemyConfig["modifierRules"][number]["actions"], path: string): void => {
    actions.forEach((action, index) => {
      const actionPath = `${path}[${index}]`;
      if ("value" in action && !finite(action.value)) errors.push(`${actionPath}.value 必须是有限数`);
      if (action.type === "scaleEffect" && (!finite(action.factor) || action.factor < 0)) errors.push(`${actionPath}.factor 必须是非负有限数`);
      if ((action.type === "grantEffect" || action.type === "scaleEffect") && !effectMap.has(action.effectId)) errors.push(`${actionPath} 引用不存在效果：${action.effectId}`);
      if (action.type === "grantTrait" && !traitIds.has(action.traitId)) errors.push(`${actionPath} 引用不存在特质：${action.traitId}`);
      if (action.type === "grantEvaluation" && !evaluationIds.has(action.evaluationId)) errors.push(`${actionPath} 引用不存在评价：${action.evaluationId}`);
    });
  };
  config.modifierRules.forEach((rule, index) => {
    const allowed = rule.phase === "danger" ? new Set<"qualityRange" | "dangerRange" | "formationRange">()
      : rule.phase === "formation" ? new Set<"qualityRange" | "dangerRange" | "formationRange">(["dangerRange"])
        : rule.phase === "quality" ? new Set<"qualityRange" | "dangerRange" | "formationRange">(["dangerRange", "formationRange"])
          : new Set<"qualityRange" | "dangerRange" | "formationRange">(["qualityRange", "dangerRange", "formationRange"]);
    validateCondition(rule.condition, `modifierRules[${index}].condition`, refs, errors, allowed);
    validateActions(rule.actions, `modifierRules[${index}].actions`);
    const legalAction = rule.actions.every((action) => {
      if (rule.phase === "danger") return action.type === "adjustDanger";
      if (rule.phase === "formation") return action.type === "adjustFormation";
      if (rule.phase === "quality") return action.type === "adjustQuality";
      return !["adjustDanger", "adjustFormation", "adjustQuality"].includes(action.type);
    });
    if (!legalAction) errors.push(`modifierRules[${index}] 包含不属于 ${rule.phase} 阶段的动作`);
  });
  config.mutationRules.forEach((rule, index) => {
    if (!finite(rule.probability) || rule.probability < 0 || rule.probability > 1) errors.push(`mutationRules[${index}].probability 必须在 0 至 1`);
    validateCondition(rule.condition, `mutationRules[${index}].condition`, refs, errors, new Set(["qualityRange", "dangerRange", "formationRange"]));
    validateActions(rule.actions, `mutationRules[${index}].actions`);
  });
  config.failureResults.forEach((failure, index) => {
    if ((failure.id === "residual" || failure.id === "waste") && (!failure.icon || !failure.primaryEffect || !failure.evaluationId)) errors.push(`failureResults[${index}] 的成形兜底必须定义图标、主效果和评价`);
    if (failure.primaryEffect && !effectMap.has(failure.primaryEffect.effectId)) errors.push(`failureResults[${index}].primaryEffect 引用不存在效果：${failure.primaryEffect.effectId}`);
  });
  config.presets.forEach((preset, index) => {
    if (preset.input.schemaVersion !== config.schemaVersion || preset.input.configVersion !== config.configVersion) errors.push(`presets[${index}].input 版本与配置不一致`);
    errors.push(...validateSimulationInput(preset.input, config).map((message) => `presets[${index}].${message}`));
    if (preset.expectation?.prototypeId) {
      const isFallback = preset.expectation.prototypeId === "fallback_residual" || preset.expectation.prototypeId === "fallback_waste";
      if (!isFallback && !config.pillPrototypes.some((item) => item.id === preset.expectation?.prototypeId)) errors.push(`presets[${index}].expectation.prototypeId 不存在：${preset.expectation.prototypeId}`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}
