import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  alchemyConfig,
  simulate,
  validateConfig,
  validateSimulationInput,
  type AlchemyConfig,
} from "../domain";
import { XorShift32, normalizeSeed } from "../engine/random";

describe("炼丹规则引擎", () => {
  it("当前配置通过启动校验并覆盖初版内容", () => {
    const validation = validateConfig(alchemyConfig);
    expect(validation.errors).toEqual([]);
    expect(alchemyConfig.materials.length).toBeGreaterThanOrEqual(18);
    expect(alchemyConfig.pillPrototypes.length).toBeGreaterThanOrEqual(8);
    expect(alchemyConfig.presets.length).toBeGreaterThanOrEqual(6);
  });

  it("全部配置图标均为可加载的正式 PNG 文件", () => {
    const iconPaths = [
      ...alchemyConfig.materials.map((item) => item.icon),
      ...alchemyConfig.pillPrototypes.map((item) => item.icon),
      ...alchemyConfig.failureResults.flatMap((item) => item.icon ? [item.icon] : []),
    ];
    const missing = iconPaths.filter((icon) => !existsSync(join(process.cwd(), "public", icon)));
    expect(missing).toEqual([]);
  });

  it.each(alchemyConfig.presets.map((preset) => [preset.id, preset] as const))(
    "预设 %s 结果符合确定性期望",
    (_id, preset) => {
      const result = simulate(preset.input, alchemyConfig);
      expect(result.status, result.diagnostics.join("\n")).toBe(preset.expectation?.status);
      if (preset.expectation?.prototypeId) {
        expect(result.pill?.prototypeId).toBe(preset.expectation.prototypeId);
      }
      if (preset.expectation?.quality) {
        expect(result.pill?.quality).toBe(preset.expectation.quality);
      }
      for (const evaluation of preset.expectation?.evaluations ?? []) {
        expect(result.pill?.evaluations).toContain(evaluation);
      }
    },
  );

  it("相同配置、输入和种子产生完全相同的结果", () => {
    const preset = alchemyConfig.presets.find((item) => item.id === "preset_mutation");
    expect(preset).toBeDefined();
    const first = simulate(structuredClone(preset!.input), alchemyConfig);
    const second = simulate(structuredClone(preset!.input), alchemyConfig);
    expect(second).toEqual(first);
    expect(first.pill?.mutated).toBe(true);
    expect(first.reasons.some((item) => item.code === "modifier.mutation.icefire_tide")).toBe(true);
  });

  it("无异变因果时不会凭种子产生异丹", () => {
    const preset = alchemyConfig.presets.find((item) => item.id === "preset_juqi_upper");
    expect(preset).toBeDefined();
    const input = structuredClone(preset!.input);
    input.factors.allow_mutation = true;
    input.seed = 1;
    const result = simulate(input, alchemyConfig);
    expect(result.status).toBe("success");
    expect(result.pill?.mutated).toBe(false);
    expect(result.pill?.evaluations).not.toContain("mutated");
  });

  it("未成丹、炸炉、残丹与废丹分支均可达", () => {
    const ids = ["preset_not_formed", "preset_explosion", "preset_residual", "preset_waste"];
    const results = Object.fromEntries(ids.map((id) => {
      const preset = alchemyConfig.presets.find((item) => item.id === id)!;
      return [id, simulate(preset.input, alchemyConfig)];
    }));
    expect(results.preset_not_formed?.status).toBe("not_formed");
    expect(results.preset_explosion?.status).toBe("exploded");
    expect(results.preset_residual?.pill?.evaluations).toContain("residual");
    expect(results.preset_waste?.pill?.evaluations).toContain("waste");
  });

  it("成丹结果包含结构化原因、候选未命中信息和可追溯效果", () => {
    const preset = alchemyConfig.presets.find((item) => item.id === "preset_juqi_upper")!;
    const result = simulate(preset.input, alchemyConfig);
    expect(result.status).toBe("success");
    expect(result.reasons.some((item) => item.phase === "identity" && item.sourceId === "pill_juqi_san")).toBe(true);
    expect(result.reasons.some((item) => item.phase === "quality")).toBe(true);
    expect(result.candidates.some((item) => !item.matched && item.missingConditions.length > 0)).toBe(true);
    expect(result.pill?.primaryEffect.sourceRuleIds).toContain("pill_juqi_san");
  });

  it("非法输入与配置冲突返回明确诊断", () => {
    const preset = alchemyConfig.presets[0]!;
    const invalidInput = structuredClone(preset.input);
    invalidInput.seed = 1.5;
    const inputResult = simulate(invalidInput, alchemyConfig);
    expect(inputResult.status).toBe("config_error");
    expect(inputResult.diagnostics.join(" ")).toContain("seed");

    const invalidConfig = structuredClone(alchemyConfig) as AlchemyConfig;
    invalidConfig.materials.push(structuredClone(invalidConfig.materials[0]!));
    const validation = validateConfig(invalidConfig);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("重复 ID");
  });

  it("材料类别约束魔核状态、来源和兽龄语义", () => {
    const preset = alchemyConfig.presets.find((item) => item.id === "preset_juqi_upper")!;
    const waterCore = preset.input.materials.find((item) => item.materialId === "material_water_core_2")!;
    const definition = alchemyConfig.materials.find((item) => item.id === waterCore.materialId)!;

    expect(waterCore.stateId).toBe("state_intact");
    expect(waterCore.originId).toBe("origin_beast");
    expect(definition.ageLabel).toBe("兽龄");
    expect(validateSimulationInput(preset.input, alchemyConfig)).toEqual([]);

    const invalidInput = structuredClone(preset.input);
    const invalidCore = invalidInput.materials.find((item) => item.materialId === "material_water_core_2")!;
    invalidCore.stateId = "state_dried";
    invalidCore.originId = "origin_garden";
    const errors = validateSimulationInput(invalidInput, alchemyConfig);
    expect(errors.join(" ")).toContain("stateId 不适用于 水系二阶魔核");
    expect(errors.join(" ")).toContain("originId 不适用于 水系二阶魔核");
  });

  it("类别配置阻止魔核声明植物语义，缺失新字段时返回诊断而不抛出", () => {
    const wrongKindConfig = structuredClone(alchemyConfig) as AlchemyConfig;
    const core = wrongKindConfig.materials.find((item) => item.kind === "core")!;
    core.allowedStateIds.push("state_fresh");
    core.allowedOriginIds.push("origin_garden");
    const kindValidation = validateConfig(wrongKindConfig);
    expect(kindValidation.valid).toBe(false);
    expect(kindValidation.errors.join(" ")).toContain("不属于 core 类别的状态：state_fresh");
    expect(kindValidation.errors.join(" ")).toContain("不属于 core 类别的来源：origin_garden");

    const missingFieldConfig = structuredClone(alchemyConfig) as AlchemyConfig;
    delete (missingFieldConfig.materials[0] as Partial<typeof missingFieldConfig.materials[number]>).allowedStateIds;
    expect(() => validateConfig(missingFieldConfig)).not.toThrow();
    expect(validateConfig(missingFieldConfig).errors.join(" ")).toContain("allowedStateIds 不得为空");
  });

  it("六槽和库存配置损坏时返回诊断而不抛出", () => {
    const missingSlots = structuredClone(alchemyConfig) as AlchemyConfig;
    delete (missingSlots as Partial<AlchemyConfig>).recipeSlots;
    expect(() => validateConfig(missingSlots)).not.toThrow();
    expect(validateConfig(missingSlots).errors.join(" ")).toContain("recipeSlots 必须配置六个丹方槽位");

    const missingInventory = structuredClone(alchemyConfig) as AlchemyConfig;
    delete (missingInventory as Partial<AlchemyConfig>).inventory;
    expect(() => validateConfig(missingInventory)).not.toThrow();
    expect(validateConfig(missingInventory).errors.join(" ")).toContain("inventory 必须是数组");

    const brokenEntries = structuredClone(alchemyConfig) as AlchemyConfig;
    brokenEntries.recipeSlots[0] = null as unknown as AlchemyConfig["recipeSlots"][number];
    brokenEntries.inventory[0] = null as unknown as AlchemyConfig["inventory"][number];
    expect(() => validateConfig(brokenEntries)).not.toThrow();
    expect(validateConfig(brokenEntries).errors.join(" ")).toContain("recipeSlots[0] 必须是对象");
    expect(validateConfig(brokenEntries).errors.join(" ")).toContain("inventory[0] 必须是对象");

    const mismatchedCapacity = structuredClone(alchemyConfig) as AlchemyConfig;
    mismatchedCapacity.meta.maxMaterials = 20;
    expect(validateConfig(mismatchedCapacity).errors.join(" ")).toContain("maxMaterials 必须与 recipeSlots 数量一致");
  });

  it("xorshift32 使用无符号 32 位语义且零种子不锁死", () => {
    expect(normalizeSeed(0)).toBe(0x6d2b79f5);
    const first = new XorShift32(1);
    const second = new XorShift32(1);
    const values = [first.nextUint32(), first.nextUint32(), first.nextUint32()];
    expect(values).toEqual([second.nextUint32(), second.nextUint32(), second.nextUint32()]);
    expect(values).toEqual([270369, 67634689, 2647435461]);
  });
});
