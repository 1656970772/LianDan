import type {
  AlchemyConfig,
  Condition,
  ConditionEvidence,
  EffectiveMaterial,
  FactorValue,
} from "../domain/types";

export interface RuleContext {
  materials: EffectiveMaterial[];
  factors: Record<string, FactorValue>;
  tags: Record<string, number>;
  danger?: number;
  formation?: number;
  quality?: number;
}

export interface ConditionEvaluation {
  matched: boolean;
  evidences: ConditionEvidence[];
}

function rangeExpected(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${min} 至 ${max}`;
  if (min !== undefined) return `不低于 ${min}`;
  if (max !== undefined) return `不高于 ${max}`;
  return "任意有限值";
}

function inRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function evidence(
  code: string,
  matched: boolean,
  description: string,
  extras: Omit<ConditionEvidence, "code" | "matched" | "description"> = {},
): ConditionEvaluation {
  return { matched, evidences: [{ code, matched, description, ...extras }] };
}

export function evaluateCondition(
  condition: Condition,
  context: RuleContext,
  config: AlchemyConfig,
): ConditionEvaluation {
  const materialNames = new Map(config.materials.map((item) => [item.id, item.name]));
  const factorNames = new Map(config.factors.map((item) => [item.id, item.label]));
  const tagNames = new Map(config.tagDefinitions.map((item) => [item.id, item.name]));
  const stateNames = new Map(config.materialStates.map((item) => [item.id, item.name]));
  const originNames = new Map(config.materialOrigins.map((item) => [item.id, item.name]));
  const materialById = new Map(context.materials.map((item) => [item.definitionId, item]));

  switch (condition.op) {
    case "all": {
      const children = condition.conditions.map((item) => evaluateCondition(item, context, config));
      return {
        matched: children.every((item) => item.matched),
        evidences: children.flatMap((item) => item.evidences),
      };
    }
    case "any": {
      const children = condition.conditions.map((item) => evaluateCondition(item, context, config));
      return {
        matched: children.some((item) => item.matched),
        evidences: children.flatMap((item) => item.evidences),
      };
    }
    case "not": {
      const child = evaluateCondition(condition.condition, context, config);
      return {
        matched: !child.matched,
        evidences: child.evidences.map((item) => ({
          ...item,
          code: `condition.not.${item.code}`,
          matched: !item.matched,
          description: `不应满足：${item.description}`,
        })),
      };
    }
    case "hasMaterial": {
      const found = materialById.has(condition.materialId);
      const name = materialNames.get(condition.materialId) ?? condition.materialId;
      return evidence(
        "condition.material.present",
        found,
        found ? `已投入${name}` : `缺少${name}`,
        { actual: found, expected: "已投入", relatedMaterialId: condition.materialId },
      );
    }
    case "materialQuantity": {
      const quantity = materialById.get(condition.materialId)?.quantity ?? 0;
      const matched = inRange(quantity, condition.min, condition.max);
      const name = materialNames.get(condition.materialId) ?? condition.materialId;
      return evidence(
        "condition.material.quantity",
        matched,
        `${name}数量 ${quantity}，要求${rangeExpected(condition.min, condition.max)}`,
        {
          actual: quantity,
          expected: rangeExpected(condition.min, condition.max),
          relatedMaterialId: condition.materialId,
        },
      );
    }
    case "tagRange": {
      const value = context.tags[condition.tagId] ?? 0;
      const matched = inRange(value, condition.min, condition.max);
      const name = tagNames.get(condition.tagId) ?? condition.tagId;
      return evidence(
        "condition.tag.range",
        matched,
        `${name}标签 ${value}，要求${rangeExpected(condition.min, condition.max)}`,
        { actual: value, expected: rangeExpected(condition.min, condition.max) },
      );
    }
    case "factorRange": {
      const raw = context.factors[condition.factorId];
      const value = typeof raw === "number" ? raw : Number.NaN;
      const matched = Number.isFinite(value) && inRange(value, condition.min, condition.max);
      const name = factorNames.get(condition.factorId) ?? condition.factorId;
      return evidence(
        "condition.factor.range",
        matched,
        `${name} ${String(raw)}，要求${rangeExpected(condition.min, condition.max)}`,
        {
          actual: raw ?? "缺失",
          expected: rangeExpected(condition.min, condition.max),
          relatedFactorId: condition.factorId,
        },
      );
    }
    case "factorEquals": {
      const raw = context.factors[condition.factorId];
      const matched = raw === condition.value;
      const name = factorNames.get(condition.factorId) ?? condition.factorId;
      return evidence(
        "condition.factor.equals",
        matched,
        `${name}当前为${String(raw)}，要求${String(condition.value)}`,
        {
          actual: raw ?? "缺失",
          expected: String(condition.value),
          relatedFactorId: condition.factorId,
        },
      );
    }
    case "materialState": {
      const material = materialById.get(condition.materialId);
      const matched = material?.stateId === condition.stateId;
      const materialName = materialNames.get(condition.materialId) ?? condition.materialId;
      const expectedName = stateNames.get(condition.stateId) ?? condition.stateId;
      const actualName = material ? (stateNames.get(material.stateId) ?? material.stateId) : "未投入";
      return evidence(
        "condition.material.state",
        matched,
        `${materialName}状态为${actualName}，要求${expectedName}`,
        { actual: actualName, expected: expectedName, relatedMaterialId: condition.materialId },
      );
    }
    case "materialOrigin": {
      const material = materialById.get(condition.materialId);
      const matched = material?.originId === condition.originId;
      const materialName = materialNames.get(condition.materialId) ?? condition.materialId;
      const expectedName = originNames.get(condition.originId) ?? condition.originId;
      const actualName = material ? (originNames.get(material.originId) ?? material.originId) : "未投入";
      return evidence(
        "condition.material.origin",
        matched,
        `${materialName}来源为${actualName}，要求${expectedName}`,
        { actual: actualName, expected: expectedName, relatedMaterialId: condition.materialId },
      );
    }
    case "orderBefore": {
      const first = materialById.get(condition.firstMaterialId);
      const second = materialById.get(condition.secondMaterialId);
      const matched = first !== undefined && second !== undefined && first.order < second.order;
      const firstName = materialNames.get(condition.firstMaterialId) ?? condition.firstMaterialId;
      const secondName = materialNames.get(condition.secondMaterialId) ?? condition.secondMaterialId;
      return evidence(
        "condition.material.order",
        matched,
        `${firstName}应早于${secondName}投入`,
        {
          actual: first && second ? `${first.order} < ${second.order}` : "材料不全",
          expected: `${firstName}早于${secondName}`,
          relatedMaterialId: condition.firstMaterialId,
        },
      );
    }
    case "qualityRange": {
      const value = context.quality;
      const matched = value !== undefined && inRange(value, condition.min, condition.max);
      return evidence(
        "condition.quality.range",
        matched,
        `品质分 ${value ?? "未计算"}，要求${rangeExpected(condition.min, condition.max)}`,
        { actual: value ?? "未计算", expected: rangeExpected(condition.min, condition.max) },
      );
    }
    case "dangerRange": {
      const value = context.danger;
      const matched = value !== undefined && inRange(value, condition.min, condition.max);
      return evidence(
        "condition.danger.range",
        matched,
        `危险分 ${value ?? "未计算"}，要求${rangeExpected(condition.min, condition.max)}`,
        { actual: value ?? "未计算", expected: rangeExpected(condition.min, condition.max) },
      );
    }
    case "formationRange": {
      const value = context.formation;
      const matched = value !== undefined && inRange(value, condition.min, condition.max);
      return evidence(
        "condition.formation.range",
        matched,
        `成形分 ${value ?? "未计算"}，要求${rangeExpected(condition.min, condition.max)}`,
        { actual: value ?? "未计算", expected: rangeExpected(condition.min, condition.max) },
      );
    }
  }
}

export function countConditionLeaves(condition: Condition): number {
  switch (condition.op) {
    case "all":
    case "any":
      return condition.conditions.reduce((sum, item) => sum + countConditionLeaves(item), 0);
    case "not":
      return countConditionLeaves(condition.condition);
    default:
      return 1;
  }
}
