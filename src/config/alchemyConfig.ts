import type {
  AlchemyConfig,
  Condition,
  EffectDefinition,
  FactorDefinition,
  FactorValue,
  MaterialDefinition,
  MaterialInput,
  PillPrototype,
  SimulationInput,
} from "../domain/types";

const tagDefinitions: AlchemyConfig["tagDefinitions"] = [
  { id: "nature_cold", category: "nature", name: "寒性", description: "降火定躁，过盛则易寒气反噬。" },
  { id: "nature_hot", category: "nature", name: "热性", description: "灼烈通行，过盛则伤脉。" },
  { id: "nature_yin", category: "nature", name: "阴性", description: "沉降内敛的药性。" },
  { id: "nature_yang", category: "nature", name: "阳性", description: "升腾活化的药性。" },
  { id: "nature_mild", category: "nature", name: "温和", description: "能缓冲与调和其他药性。" },
  { id: "effect_gather_qi", category: "effect", name: "聚气", description: "引聚天地灵气。" },
  { id: "effect_restore_qi", category: "effect", name: "回气", description: "恢复体内真元。" },
  { id: "effect_hemostasis", category: "effect", name: "止血", description: "封合创口并减缓失血。" },
  { id: "effect_bone_heal", category: "effect", name: "生骨", description: "促进骨肉修复。" },
  { id: "effect_blood_move", category: "effect", name: "活血", description: "行气化瘀。" },
  { id: "effect_calm_mind", category: "effect", name: "清心", description: "定心护神，压制燥意。" },
  { id: "effect_heat_guard", category: "effect", name: "护脉", description: "形成抵御热力的药性护层。" },
  { id: "effect_soul_cleanse", category: "effect", name: "清魂", description: "清除魂魄中的异种力量。" },
  { id: "effect_soul_nourish", category: "effect", name: "养魂", description: "滋养灵魂与神识。" },
  { id: "effect_refine_flame", category: "effect", name: "炼火", description: "辅助化解与炼化封存火力。" },
  { id: "reaction_water_affinity", category: "reaction", name: "亲水", description: "易与水系灵力相融。" },
  { id: "reaction_temperature_sensitive", category: "reaction", name: "畏火", description: "对高温十分敏感。" },
  { id: "reaction_difficult_melt", category: "reaction", name: "难熔", description: "需要更强的控火与提纯才能化开。" },
  { id: "reaction_ice_fire", category: "reaction", name: "冰火共生", description: "同时容纳冰火两性。" },
  { id: "reaction_volatile", category: "reaction", name: "易挥发", description: "火候偏高时药力快速散失。" },
  { id: "reaction_fire_affinity", category: "reaction", name: "亲火", description: "易与火属性力量共鸣。" },
  { id: "risk_violent", category: "risk", name: "暴烈", description: "会显著放大炸炉风险。" },
  { id: "risk_toxic", category: "risk", name: "毒性", description: "成丹后仍可能留有毒副作用。" },
  { id: "risk_cold_backlash", category: "risk", name: "寒髓反噬", description: "极寒药力容易倒卷伤脉。" },
  { id: "risk_soul_shock", category: "risk", name: "魂力冲击", description: "混乱的魂力会损伤神识。" },
  { id: "state_fresh", category: "state", name: "鲜活", description: "药性完整，杂质较少。" },
  { id: "state_dry", category: "state", name: "干燥", description: "便于保存，但灵性略有损失。" },
  { id: "state_frozen", category: "state", name: "冰封", description: "寒性得到保留，熔解难度上升。" },
  { id: "state_decayed", category: "state", name: "衰败", description: "药性散失且杂质增多。" },
  { id: "state_potent", category: "state", name: "药力丰沛", description: "灵脉滋养后药力更盛。" },
  { id: "state_intact", category: "state", name: "完整", description: "核心或奇物结构完整，灵力循环未受损。" },
  { id: "state_cracked", category: "state", name: "破损", description: "结构出现裂隙，灵力持续逸散。" },
  { id: "state_sealed", category: "state", name: "封存", description: "以灵纹容器封存，灵性流失较少。" },
];

const materialStates: AlchemyConfig["materialStates"] = [
  {
    id: "state_fresh",
    name: "新鲜",
    description: "采摘不久，药性保留完整。",
    tagDeltas: { state_fresh: 35 },
    qualityDelta: 6,
    riskDelta: 0,
  },
  {
    id: "state_dried",
    name: "干燥",
    description: "常规炮制保存，药性稳定。",
    tagDeltas: { state_dry: 35 },
    qualityDelta: 0,
    riskDelta: 0,
  },
  {
    id: "state_frozen",
    name: "冰封",
    description: "以寒玉冰封，寒性增强且难以熔解。",
    tagDeltas: { state_frozen: 40, nature_cold: 8, reaction_difficult_melt: 8 },
    qualityDelta: 2,
    riskDelta: 4,
  },
  {
    id: "state_decayed",
    name: "衰败",
    description: "保存不当，药力已散失大半。",
    tagMultipliers: {
      effect_gather_qi: 0.65,
      effect_restore_qi: 0.65,
      effect_hemostasis: 0.65,
      effect_bone_heal: 0.65,
      effect_blood_move: 0.65,
      effect_calm_mind: 0.65,
      effect_heat_guard: 0.65,
      effect_soul_cleanse: 0.65,
      effect_soul_nourish: 0.65,
      effect_refine_flame: 0.65,
    },
    tagDeltas: { state_decayed: 55, risk_toxic: 18 },
    qualityDelta: -24,
    riskDelta: 18,
  },
  {
    id: "state_intact",
    name: "完整",
    description: "外壳与内部灵纹完整，灵力循环稳定。",
    tagDeltas: { state_intact: 35 },
    qualityDelta: 6,
    riskDelta: 0,
  },
  {
    id: "state_cracked",
    name: "破损",
    description: "外壳或晶体已有裂隙，药力逸散且更难控制。",
    tagDeltas: { state_cracked: 35 },
    qualityDelta: -5,
    riskDelta: 7,
  },
  {
    id: "state_sealed",
    name: "封存",
    description: "灵液经灵纹容器封存，药性保持稳定。",
    tagDeltas: { state_sealed: 35 },
    qualityDelta: 6,
    riskDelta: 0,
  },
];

const materialOrigins: AlchemyConfig["materialOrigins"] = [
  {
    id: "origin_wild",
    name: "荒野",
    description: "野生药性浓烈，但也更难驯服。",
    qualityDelta: 0,
    riskDelta: 3,
  },
  {
    id: "origin_garden",
    name: "药圃",
    description: "药圃培育稳定，杂质较少。",
    qualityDelta: 5,
    riskDelta: -2,
  },
  {
    id: "origin_leyline",
    name: "灵脉",
    description: "灵脉滋养使药力更盛，同时增加控制难度。",
    tagDeltas: { state_potent: 35 },
    qualityDelta: 10,
    riskDelta: 5,
  },
  {
    id: "origin_beast",
    name: "妖兽",
    description: "取自妖兽体内，属性与阶位较为明确。",
    qualityDelta: 5,
    riskDelta: -2,
  },
  {
    id: "origin_secret_realm",
    name: "秘境",
    description: "出自封闭秘境，灵性完整但来历难以复验。",
    qualityDelta: 5,
    riskDelta: -2,
  },
];

type MaterialProfileFields = Pick<MaterialDefinition,
  | "allowedStateIds"
  | "allowedOriginIds"
  | "defaultStateId"
  | "defaultOriginId"
  | "ageLabel"
  | "ageUnit"
  | "maturityLabel"
>;

const botanicalProfile: MaterialProfileFields = {
  allowedStateIds: ["state_fresh", "state_dried", "state_frozen", "state_decayed"],
  allowedOriginIds: ["origin_wild", "origin_garden", "origin_leyline"],
  defaultStateId: "state_fresh",
  defaultOriginId: "origin_garden",
  ageLabel: "年份",
  ageUnit: "年",
  maturityLabel: "成熟",
};

function kindProfile(
  id: MaterialDefinition["kind"],
  profile: MaterialProfileFields,
): AlchemyConfig["materialKindProfiles"][number] {
  return {
    id,
    ...profile,
    allowedStateIds: [...profile.allowedStateIds],
    allowedOriginIds: [...profile.allowedOriginIds],
  };
}

const materialKindProfiles: AlchemyConfig["materialKindProfiles"] = [
  kindProfile("herb", botanicalProfile),
  kindProfile("flower", botanicalProfile),
  kindProfile("fruit", botanicalProfile),
  kindProfile("root", botanicalProfile),
  kindProfile("core", {
    allowedStateIds: ["state_intact", "state_cracked", "state_frozen"],
    allowedOriginIds: ["origin_beast", "origin_secret_realm"],
    defaultStateId: "state_intact",
    defaultOriginId: "origin_beast",
    ageLabel: "兽龄",
    ageUnit: "年",
    maturityLabel: "凝核",
  }),
  kindProfile("liquid", {
    allowedStateIds: ["state_sealed", "state_frozen", "state_decayed"],
    allowedOriginIds: ["origin_leyline", "origin_wild", "origin_secret_realm"],
    defaultStateId: "state_sealed",
    defaultOriginId: "origin_leyline",
    ageLabel: "蕴生年限",
    ageUnit: "年",
    maturityLabel: "药力圆满",
  }),
  kindProfile("wonder", {
    allowedStateIds: ["state_intact", "state_cracked", "state_frozen"],
    allowedOriginIds: ["origin_secret_realm", "origin_leyline"],
    defaultStateId: "state_intact",
    defaultOriginId: "origin_secret_realm",
    ageLabel: "蕴化年限",
    ageUnit: "年",
    maturityLabel: "圆满",
  }),
];

function material(
  id: string,
  name: string,
  kind: MaterialDefinition["kind"],
  description: string,
  defaultYears: number,
  mature: number,
  doseValue: number,
  baseTags: MaterialDefinition["baseTags"],
  sourceNote: string,
): MaterialDefinition {
  const profile = materialKindProfiles.find((item) => item.id === kind);
  if (!profile) throw new Error(`Unknown material kind: ${kind}`);
  const { id: _profileId, ...profileFields } = profile;
  return {
    id,
    name,
    kind,
    description,
    ...profileFields,
    allowedStateIds: [...profileFields.allowedStateIds],
    allowedOriginIds: [...profileFields.allowedOriginIds],
    defaultYears,
    yearRange: { min: 1, mature, max: Math.max(mature * 4, defaultYears) },
    baseTags,
    doseValue,
    icon: `/assets/materials/${id.replace("material_", "")}.png`,
    sourceNote,
  };
}

const materials: MaterialDefinition[] = [
  material("material_moyelian", "墨叶莲", "herb", "叶色如墨，药液温润，是聚气散的主材。", 50, 50, 1, [
    { tagId: "effect_gather_qi", strength: 72 },
    { tagId: "nature_mild", strength: 68 },
    { tagId: "reaction_water_affinity", strength: 45 },
  ], "报告事实：聚气散核心材料；数值为项目补全。"),
  material("material_shexian_guo", "蛇涎果", "fruit", "果液阴寒甘酸，可调和过于刚烈的药性。", 30, 30, 1, [
    { tagId: "nature_cold", strength: 58 },
    { tagId: "nature_yin", strength: 50 },
    { tagId: "nature_mild", strength: 62 },
  ], "报告事实：聚气散材料，具阴寒调和语义。"),
  material("material_juling_cao", "聚灵草", "herb", "草尖有微光流转，蕴含精纯灵气。", 20, 20, 1, [
    { tagId: "effect_gather_qi", strength: 86 },
    { tagId: "effect_restore_qi", strength: 52 },
    { tagId: "reaction_volatile", strength: 38 },
  ], "报告事实：聚气散材料，提供纯净能量。"),
  material("material_water_core_2", "水系二阶魔核", "core", "魔核内的水系灵力为聚气药性提供稳定载体。", 80, 80, 2, [
    { tagId: "reaction_water_affinity", strength: 90 },
    { tagId: "effect_gather_qi", strength: 64 },
    { tagId: "nature_cold", strength: 38 },
  ], "报告事实：聚气散需水属性二阶魔核；兽龄与凝核年限为项目中的强度近似参数。"),
  material("material_ningxue_cao", "凝血草", "herb", "火候敏感的止血灵草，可使创口快速收敛。", 15, 15, 1, [
    { tagId: "effect_hemostasis", strength: 88 },
    { tagId: "effect_bone_heal", strength: 42 },
    { tagId: "reaction_temperature_sensitive", strength: 78 },
  ], "报告事实：凝血散材料，止血且对温度敏感。"),
  material("material_huoqi_guo", "活气果", "fruit", "果肉能行气活血，可化瘀并辅助伤势恢复。", 18, 18, 1, [
    { tagId: "effect_blood_move", strength: 84 },
    { tagId: "effect_hemostasis", strength: 46 },
    { tagId: "effect_bone_heal", strength: 45 },
    { tagId: "nature_yang", strength: 42 },
  ], "报告事实：凝血散材料，具活血化瘀语义。"),
  material("material_yingsu_hua", "罂粟花", "flower", "花露可镇痛敛血，过量则留下昏沉与毒性。", 10, 10, 1, [
    { tagId: "effect_hemostasis", strength: 66 },
    { tagId: "risk_toxic", strength: 48 },
    { tagId: "reaction_temperature_sensitive", strength: 56 },
  ], "报告事实：凝血散相关材料；风险数值为项目补全。"),
  material("material_shenggu_hua", "生骨花", "flower", "花瓣内有细密的生机灵纹，主生骨续伤。", 25, 25, 1, [
    { tagId: "effect_bone_heal", strength: 90 },
    { tagId: "nature_mild", strength: 58 },
  ], "报告事实：生骨疗伤线索；简化丹方为项目补全。"),
  material("material_huiling_chiguo", "回灵赤果", "fruit", "赤果内蕴含浓缩灵气，是回气丹的关键药引。", 40, 40, 2, [
    { tagId: "effect_restore_qi", strength: 92 },
    { tagId: "nature_yang", strength: 58 },
    { tagId: "reaction_volatile", strength: 35 },
  ], "报告事实：回气丹重要材料；辅料为项目补全。"),
  material("material_xuelian_jing", "血莲精", "wonder", "红色晶质内有浓重血气，可化作护脉血膜。", 120, 120, 3, [
    { tagId: "effect_heat_guard", strength: 94 },
    { tagId: "effect_blood_move", strength: 72 },
    { tagId: "nature_yang", strength: 66 },
  ], "报告事实：血莲丹核心材料。"),
  material("material_bingling_yancao", "冰灵焰草", "herb", "草叶一半如冰、一半如焰，冰火两性天然共生。", 100, 100, 2, [
    { tagId: "nature_cold", strength: 82 },
    { tagId: "nature_hot", strength: 82 },
    { tagId: "reaction_ice_fire", strength: 96 },
    { tagId: "risk_violent", strength: 58 },
  ], "报告事实：血莲丹关键材料，冰火共生。"),
  material("material_qingti_cao", "清体草", "herb", "药液清透，能梳理身魂杂质与燥意。", 60, 60, 1, [
    { tagId: "effect_soul_cleanse", strength: 68 },
    { tagId: "effect_calm_mind", strength: 76 },
    { tagId: "nature_mild", strength: 62 },
  ], "报告事实：清魂丹核心材料之一。"),
  material("material_binghuo_ronghun_guo", "冰火融魂果", "fruit", "果核中冰火魂力交织，能解离异种魂力。", 150, 150, 3, [
    { tagId: "effect_soul_cleanse", strength: 94 },
    { tagId: "effect_soul_nourish", strength: 82 },
    { tagId: "reaction_ice_fire", strength: 92 },
    { tagId: "risk_soul_shock", strength: 64 },
  ], "报告事实：清魂丹核心材料之一。"),
  material("material_shuiling_lianzi", "水灵莲子", "fruit", "莲子内含温润水灵，可在清魂后稳固神识。", 80, 80, 1, [
    { tagId: "effect_soul_nourish", strength: 88 },
    { tagId: "reaction_water_affinity", strength: 82 },
    { tagId: "nature_mild", strength: 72 },
  ], "报告事实：清魂丹核心材料之一。"),
  material("material_hansui_zhi", "寒髓枝", "root", "极寒灵液凝成的晶枝，难熔且易反噬经脉。", 200, 200, 2, [
    { tagId: "nature_cold", strength: 98 },
    { tagId: "reaction_difficult_melt", strength: 90 },
    { tagId: "risk_cold_backlash", strength: 84 },
    { tagId: "effect_calm_mind", strength: 60 },
  ], "报告事实：极寒凝成、难以炼化的天地灵物。"),
  material("material_huoling_gen", "火灵根", "root", "吸收地火生长的灵根，火力雄浑而急烈。", 70, 70, 2, [
    { tagId: "nature_hot", strength: 92 },
    { tagId: "reaction_fire_affinity", strength: 90 },
    { tagId: "effect_refine_flame", strength: 72 },
    { tagId: "risk_violent", strength: 78 },
  ], "报告语义参考；离火丹简化方为项目补全。"),
  material("material_fire_core_3", "火系三阶魔核", "core", "三阶火属性魔核，可供给持续的火行灵力。", 120, 120, 3, [
    { tagId: "nature_hot", strength: 88 },
    { tagId: "reaction_fire_affinity", strength: 86 },
    { tagId: "risk_violent", strength: 54 },
  ], "报告事实：血莲丹需三阶魔核；火属性为项目明确化。"),
  material("material_ice_core_2", "冰系二阶魔核", "core", "晶蓝魔核内存寒性灵力，可为清心药性定锚。", 80, 80, 2, [
    { tagId: "nature_cold", strength: 86 },
    { tagId: "effect_calm_mind", strength: 62 },
    { tagId: "reaction_difficult_melt", strength: 48 },
  ], "报告事实：冰心丹需冰属性魔核；阶位为项目补全。"),
];

const factorGroups: AlchemyConfig["factorGroups"] = [
  { id: "group_alchemist", name: "炼药师", description: "炼药师的品阶、魂力与真元基础。", order: 10 },
  { id: "group_craft", name: "火候工艺", description: "一次推演的工艺质量摘要。", order: 20 },
  { id: "group_equipment", name: "丹炉火种", description: "丹炉、火种与当前炉况。", order: 30 },
  { id: "group_world", name: "环境天时", description: "洞府环境与天象对本炉的影响。", order: 40 },
  { id: "group_mutation", name: "异变与随机", description: "只开放受因果条件约束的异变。", order: 50 },
];

function rangeFactor(
  id: string,
  label: string,
  groupId: string,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  unit: string,
  description: string,
): FactorDefinition {
  return { id, label, groupId, valueType: "number", controlType: "range", defaultValue, min, max, step, unit, description };
}

const factors: FactorDefinition[] = [
  rangeFactor("artisan_grade", "炼药师品阶", "group_alchemist", 4, 1, 9, 1, "品", "高阶丹药会要求最低炼药师品阶。"),
  rangeFactor("soul_power", "灵魂力", "group_alchemist", 75, 0, 100, 1, "%", "影响精细控制、成形与高阶丹药身份。"),
  rangeFactor("fire_control", "控火能力", "group_alchemist", 78, 0, 100, 1, "%", "抑制强火风险，并影响药性的保留。"),
  rangeFactor("recipe_mastery", "丹方熟练度", "group_alchemist", 72, 0, 100, 1, "%", "影响理想参数偏差对品质的惩罚。"),
  rangeFactor("qi_reserve", "真元储备", "group_alchemist", 75, 0, 100, 1, "%", "高阶丹药完成凝聚所需的力量储备。"),
  rangeFactor("furnace_temperature", "炉温", "group_craft", 72, 0, 100, 1, "%", "本次炼制的整体火候强度。"),
  rangeFactor("temperature_stability", "温控稳定度", "group_craft", 80, 0, 100, 1, "%", "炉温波动的综合摘要，越高越稳定。"),
  rangeFactor("extraction_purity", "萃取纯度", "group_craft", 80, 0, 100, 1, "%", "药液中杂质去除程度。"),
  rangeFactor("fusion", "融合度", "group_craft", 80, 0, 100, 1, "%", "不同药性的相融程度。"),
  rangeFactor("condensation", "凝丹契合", "group_craft", 80, 0, 100, 1, "%", "药液形成稳定丹体的契合度。"),
  rangeFactor("nourishment", "蕴养程度", "group_craft", 72, 0, 100, 1, "%", "收炉前的药力沉淀程度，主要影响品质。"),
  { id: "cauldron", label: "丹炉", groupId: "group_equipment", valueType: "string", controlType: "select", defaultValue: "cauldron_xuantie", optionCatalogId: "catalog_cauldron", description: "丹炉承载能力与对成形、品质的修正。" },
  { id: "flame", label: "火种", groupId: "group_equipment", valueType: "string", controlType: "select", defaultValue: "flame_ordinary", optionCatalogId: "catalog_flame", description: "火种强度与性质，强火并非无条件更好。" },
  { id: "furnace_condition", label: "炉况", groupId: "group_equipment", valueType: "string", controlType: "select", defaultValue: "condition_intact", optionCatalogId: "catalog_furnace_condition", description: "积垢和裂损会提高风险并降低成形。" },
  { id: "environment", label: "炼制环境", groupId: "group_world", valueType: "string", controlType: "select", defaultValue: "environment_quiet", optionCatalogId: "catalog_environment", description: "地脉与洞府对火候、药性的外部修正。" },
  { id: "celestial", label: "天象", groupId: "group_world", valueType: "string", controlType: "select", defaultValue: "celestial_ordinary", optionCatalogId: "catalog_celestial", description: "天象可提供有限修正，或作为异变的必要因果。" },
  { id: "allow_mutation", label: "允许异变", groupId: "group_mutation", valueType: "boolean", controlType: "toggle", defaultValue: false, description: "只在材料、环境与种子都满足已配置条件时发生。" },
];

const optionCatalogs: AlchemyConfig["optionCatalogs"] = [
  {
    id: "catalog_cauldron",
    name: "丹炉",
    options: [
      { id: "cauldron_qingshi", name: "青石药鼎", description: "入门药鼎，承火能力有限。", modifiers: [{ target: "danger", value: 2 }, { target: "quality", value: -2 }] },
      { id: "cauldron_xuantie", name: "玄铁丹炉", description: "炉体厚重稳定，适合常规调试。", modifiers: [{ target: "danger", value: -4 }, { target: "quality", value: 2 }] },
      { id: "cauldron_chiwen", name: "赤纹兽鼎", description: "善于引导强火，但会放大暴烈药性。", modifiers: [{ target: "formation", value: 4 }, { target: "quality", value: 3 }, { target: "danger", value: 2 }] },
    ],
  },
  {
    id: "catalog_flame",
    name: "火种",
    options: [
      { id: "flame_ordinary", name: "凡火", description: "平稳易控，高阶药材的熔炼能力较弱。", modifiers: [{ target: "danger", value: -2 }, { target: "quality", value: -2 }] },
      { id: "flame_beast", name: "兽火", description: "火力浓烈，成形较快，控制难度上升。", modifiers: [{ target: "danger", value: 6 }, { target: "formation", value: 3 }] },
      { id: "flame_qinglian", name: "青莲地心火", description: "地心异火，擅长炼化顽固药性。", modifiers: [{ target: "danger", value: 10 }, { target: "formation", value: 6 }, { target: "quality", value: 5 }, { target: "tag", targetId: "reaction_fire_affinity", value: 12 }] },
      { id: "flame_guling", name: "骨灵冷火", description: "外寒内烈，对魂力与寒性药材有特殊适配。", modifiers: [{ target: "danger", value: 8 }, { target: "formation", value: 4 }, { target: "quality", value: 5 }, { target: "tag", targetId: "nature_cold", value: 10 }] },
    ],
  },
  {
    id: "catalog_furnace_condition",
    name: "炉况",
    options: [
      { id: "condition_intact", name: "完好", description: "炉体与阵纹状态正常。", modifiers: [] },
      { id: "condition_stained", name: "积垢", description: "炉内残渣污染药性。", modifiers: [{ target: "danger", value: 4 }, { target: "formation", value: -5 }, { target: "quality", value: -7 }] },
      { id: "condition_cracked", name: "裂损", description: "炉体存在裂纹，强火下极易失控。", modifiers: [{ target: "danger", value: 18 }, { target: "formation", value: -12 }, { target: "quality", value: -10 }] },
    ],
  },
  {
    id: "catalog_environment",
    name: "炼制环境",
    options: [
      { id: "environment_quiet", name: "寻常静室", description: "无额外地脉干扰。", modifiers: [] },
      { id: "environment_cold_spring", name: "寒泉洞府", description: "寒气稳定炉火，但会放大极寒药性。", modifiers: [{ target: "danger", value: -3 }, { target: "quality", value: 2 }, { target: "tag", targetId: "nature_cold", value: 8 }] },
      { id: "environment_fire_vein", name: "地火灵脉", description: "地火可加快成形，也让炉况更难控制。", modifiers: [{ target: "danger", value: 5 }, { target: "formation", value: 4 }, { target: "tag", targetId: "reaction_fire_affinity", value: 8 }] },
      { id: "environment_spirit_peak", name: "山门灵峰", description: "灵气充沛且平稳。", modifiers: [{ target: "formation", value: 3 }, { target: "quality", value: 4 }] },
    ],
  },
  {
    id: "catalog_celestial",
    name: "天象",
    options: [
      { id: "celestial_ordinary", name: "平常", description: "天地灵气无明显波动。", modifiers: [] },
      { id: "celestial_full_moon", name: "满月", description: "阴性灵力清盛，利于温养神魂。", modifiers: [{ target: "quality", value: 2 }, { target: "tag", targetId: "nature_yin", value: 8 }] },
      { id: "celestial_thunder", name: "雷云", description: "雷意游离，容易放大烈性反应。", modifiers: [{ target: "danger", value: 7 }, { target: "tag", targetId: "risk_violent", value: 8 }] },
      { id: "celestial_tide", name: "天地潮汐", description: "灵气潮汐有利于共生药性完成对流。", modifiers: [{ target: "formation", value: 3 }, { target: "quality", value: 4 }, { target: "tag", targetId: "reaction_ice_fire", value: 8 }] },
    ],
  },
];

function effect(
  id: string,
  name: string,
  category: EffectDefinition["category"],
  description: string,
  unit = "%",
  min = 0,
  max = 100,
): EffectDefinition {
  return { id, name, category, description, unit, range: { min, max } };
}

const effects: EffectDefinition[] = [
  effect("effect_breakthrough_support", "聚气破境", "primary", "引聚灵气，提高突破关隘时的真元凝聚效率。"),
  effect("effect_hemostasis", "快速止血", "primary", "收敛创口并降低持续失血。"),
  effect("effect_qi_restore", "真元恢复", "primary", "在短时间内补充消耗的真元。"),
  effect("effect_bone_recovery", "生骨续伤", "primary", "促进骨骼与深层软组织恢复。"),
  effect("effect_mind_guard", "清心护神", "primary", "压制火毒燥意与心神浮动。"),
  effect("effect_heat_shield", "血莲护脉", "primary", "在经脉表层形成抵御高热的药性血膜。"),
  effect("effect_soul_purification", "清魂除异", "primary", "清理神魂中残留的异种力量。"),
  effect("effect_flame_refinement", "离火炼印", "primary", "辅助化解封印或经脉中的顽固火力。"),
  effect("effect_meridian_guard", "经脉护持", "secondary", "减少强药性对经脉的冲击。"),
  effect("effect_blood_recovery", "气血恢复", "secondary", "促进失血后的气血回升。"),
  effect("effect_pain_relief", "镇痛", "secondary", "减轻外伤与经脉损伤带来的痛楚。"),
  effect("effect_cold_resistance", "寒意抗性", "secondary", "暂时稳定寒性灵力侵袭。"),
  effect("effect_heat_resistance", "火性抗性", "secondary", "暂时减轻烈火与火毒对经脉的冲击。"),
  effect("effect_soul_nourishment", "神魂滋养", "secondary", "在清理异力后补益受损神识。"),
  effect("effect_icefire_adaptation", "冰火适应", "secondary", "短时平衡冰火两类灵力的侵袭。"),
  effect("effect_thunder_tempering", "雷意淬体", "secondary", "以受控雷意刺激经脉和身体。"),
  effect("effect_residual_essence", "微弱药力", "primary", "残留的主药性可提供有限效果。"),
  effect("effect_trace_medicine", "杂质药性", "primary", "废丹仅留微量无法稳定利用的药性。", "%", 0, 20),
  effect("side_meridian_strain", "经脉负荷", "side", "药力短时冲击经脉，不宜连续服用。"),
  effect("side_drowsiness", "昏沉", "side", "镇痛药性可导致短时昏沉。"),
  effect("side_cold_backlash", "寒气反噬", "side", "极寒药力可使经脉僵滞。"),
  effect("side_fire_toxin", "火毒残留", "side", "过强炉火在丹中留下燥烈火毒。"),
  effect("side_soul_fatigue", "神识疲倦", "side", "清理异种魂力后需要休养神识。"),
  effect("side_impurity", "丹毒杂质", "side", "低纯度或失衡的药性会沉积杂质。"),
];

const traits: AlchemyConfig["traits"] = [
  { id: "trait_gentle_qi", name: "温润聚气", description: "阴寒果液中和了聚气时的刚烈冲击。" },
  { id: "trait_external_powder", name: "外敷药散", description: "以药散形态直接敷于创口。" },
  { id: "trait_fast_absorption", name: "速融", description: "丹力易化，适合战斗间隙恢复。" },
  { id: "trait_bone_vitality", name: "生机入骨", description: "药性优先沉入骨肉伤处。" },
  { id: "trait_ice_mind", name: "冰心守一", description: "以寒性药力压制心火与燥意。" },
  { id: "trait_blood_lotus_armor", name: "血莲护膜", description: "药力在经脉外形成短时护膜。" },
  { id: "trait_clear_soul", name: "魂息清净", description: "清除异种魂力后不留额外灵性印记。" },
  { id: "trait_flame_seed", name: "离火之种", description: "丹中留有可受控的地心火性。" },
  { id: "trait_pure_essence", name: "药性无垢", description: "药性凝练纯净，杂质几不可见。" },
  { id: "trait_icefire_harmony", name: "冰火同炉", description: "冰火药性在灵气潮汐中形成受控共鸣。" },
  { id: "trait_thunder_mark", name: "雷纹", description: "丹体留有一缕受控雷意。" },
];

const evaluations: AlchemyConfig["evaluations"] = [
  { id: "normal", name: "正常丹", description: "正式丹方命中且未进入其他评价分支。" },
  { id: "residual", name: "残丹", description: "丹体已成，但核心药性或工艺存在明显缺口。" },
  { id: "waste", name: "废丹", description: "丹体已成但药性高度失衡，不作为有效丹药使用。" },
  { id: "mutated", name: "异丹", description: "在真实因果条件和固定种子共同作用下产生受控异变。" },
];

const all = (...conditions: Condition[]): Condition => ({ op: "all", conditions });
const has = (materialId: string): Condition => ({ op: "hasMaterial", materialId });
const quantity = (materialId: string, min: number): Condition => ({ op: "materialQuantity", materialId, min });
const tagMin = (tagId: string, min: number): Condition => ({ op: "tagRange", tagId, min });
const factorMin = (factorId: string, min: number): Condition => ({ op: "factorRange", factorId, min });

function pill(
  definition: Omit<PillPrototype, "icon">,
): PillPrototype {
  return {
    ...definition,
    icon: `/assets/pills/${definition.id.replace("pill_", "")}.png`,
  };
}

const commonIdeals = [
  { factorId: "furnace_temperature", idealMin: 58, idealMax: 80, penaltyPerStep: 0.45 },
  { factorId: "extraction_purity", idealMin: 72, idealMax: 100, penaltyPerStep: 0.2 },
  { factorId: "fusion", idealMin: 70, idealMax: 100, penaltyPerStep: 0.2 },
  { factorId: "condensation", idealMin: 68, idealMax: 100, penaltyPerStep: 0.2 },
];

const pillPrototypes: PillPrototype[] = [
  pill({
    id: "pill_juqi_san", name: "聚气散", form: "powder", grade: 4, priority: 50,
    description: "引聚灵气并辅助突破关隘的温润药散。",
    identityCondition: all(
      quantity("material_moyelian", 4), quantity("material_shexian_guo", 2),
      quantity("material_juling_cao", 1), quantity("material_water_core_2", 1),
      tagMin("effect_gather_qi", 70),
    ),
    idealFactors: commonIdeals,
    yield: { dosePerPill: 7, min: 1, max: 4 },
    primaryEffect: { effectId: "effect_breakthrough_support", value: 72 },
    secondaryEffects: [{ effectId: "effect_meridian_guard", value: 36 }],
    sideEffects: [{ effectId: "side_meridian_strain", value: 12 }],
    traits: ["trait_gentle_qi"],
    sourceNote: "报告支持四类核心材料与用途；剂量、数值和产量为项目补全。",
  }),
  pill({
    id: "pill_ningxue_san", name: "凝血散", form: "powder", grade: 1, priority: 45,
    description: "用于外敷止血与镇痛的细腻药散。",
    identityCondition: all(
      quantity("material_ningxue_cao", 1), quantity("material_huoqi_guo", 1),
      quantity("material_yingsu_hua", 1), { op: "factorRange", factorId: "furnace_temperature", max: 75 },
    ),
    idealFactors: [
      { factorId: "furnace_temperature", idealMin: 42, idealMax: 65, penaltyPerStep: 0.7 },
      { factorId: "extraction_purity", idealMin: 60, idealMax: 100, penaltyPerStep: 0.2 },
      { factorId: "fusion", idealMin: 58, idealMax: 100, penaltyPerStep: 0.2 },
    ],
    yield: { dosePerPill: 3, min: 1, max: 6 },
    primaryEffect: { effectId: "effect_hemostasis", value: 68 },
    secondaryEffects: [{ effectId: "effect_pain_relief", value: 42 }],
    sideEffects: [{ effectId: "side_drowsiness", value: 18 }],
    traits: ["trait_external_powder"],
    sourceNote: "报告支持三味材料、外用与畏火语义；数值为项目补全。",
  }),
  pill({
    id: "pill_huiqi_dan", name: "回气丹", form: "pill", grade: 3, priority: 55,
    description: "快速恢复真元，适合在消耗后服用。",
    identityCondition: all(
      quantity("material_huiling_chiguo", 2), quantity("material_juling_cao", 1),
      quantity("material_water_core_2", 1), tagMin("effect_restore_qi", 75),
    ),
    idealFactors: commonIdeals,
    yield: { dosePerPill: 6, min: 1, max: 5 },
    primaryEffect: { effectId: "effect_qi_restore", value: 74 },
    secondaryEffects: [{ effectId: "effect_meridian_guard", value: 24 }],
    sideEffects: [{ effectId: "side_meridian_strain", value: 8 }],
    traits: ["trait_fast_absorption"],
    sourceNote: "报告支持回灵赤果为重要材料；辅料、剂量与数值为项目补全。",
  }),
  pill({
    id: "pill_shenggu_dan", name: "生骨丹", form: "pill", grade: 2, priority: 60,
    description: "促进骨肉与深层伤势恢复的疗伤丹。",
    identityCondition: all(
      quantity("material_shenggu_hua", 2), quantity("material_ningxue_cao", 1),
      quantity("material_huoqi_guo", 1), tagMin("effect_bone_heal", 75),
    ),
    idealFactors: commonIdeals,
    yield: { dosePerPill: 4, min: 1, max: 5 },
    primaryEffect: { effectId: "effect_bone_recovery", value: 76 },
    secondaryEffects: [{ effectId: "effect_blood_recovery", value: 48 }],
    sideEffects: [], traits: ["trait_bone_vitality"],
    sourceNote: "报告支持生骨丹用途与工艺影响；简化三味方为项目补全。",
  }),
  pill({
    id: "pill_bingxin_dan", name: "冰心丹", form: "pill", grade: 2, priority: 65,
    description: "以极寒药性定心护神，压制烈火带来的燥意。",
    identityCondition: all(
      quantity("material_hansui_zhi", 1), quantity("material_qingti_cao", 1),
      quantity("material_ice_core_2", 1), factorMin("soul_power", 45), tagMin("effect_calm_mind", 68),
    ),
    idealFactors: [
      { factorId: "furnace_temperature", idealMin: 50, idealMax: 68, penaltyPerStep: 0.6 },
      { factorId: "extraction_purity", idealMin: 72, idealMax: 100, penaltyPerStep: 0.2 },
      { factorId: "temperature_stability", idealMin: 72, idealMax: 100, penaltyPerStep: 0.25 },
    ],
    yield: { dosePerPill: 5, min: 1, max: 4 },
    primaryEffect: { effectId: "effect_mind_guard", value: 78 },
    secondaryEffects: [{ effectId: "effect_cold_resistance", value: 45 }],
    sideEffects: [{ effectId: "side_cold_backlash", value: 16 }],
    traits: ["trait_ice_mind"],
    sourceNote: "报告支持冰心丹用途与冰属性魔核；寒髓枝、清体草为项目简化方。",
  }),
  pill({
    id: "pill_xuelian_dan", name: "血莲丹", form: "pill", grade: 5, priority: 80,
    description: "在经脉表层形成血莲护膜，用于抵御强热力量。",
    identityCondition: all(
      quantity("material_xuelian_jing", 1), quantity("material_bingling_yancao", 1),
      quantity("material_fire_core_3", 1), factorMin("artisan_grade", 5),
      factorMin("fire_control", 65), tagMin("effect_heat_guard", 80),
    ),
    idealFactors: [
      { factorId: "furnace_temperature", idealMin: 72, idealMax: 88, penaltyPerStep: 0.5 },
      { factorId: "fusion", idealMin: 76, idealMax: 100, penaltyPerStep: 0.25 },
      { factorId: "nourishment", idealMin: 74, idealMax: 100, penaltyPerStep: 0.2 },
    ],
    yield: { dosePerPill: 8, min: 1, max: 3 },
    primaryEffect: { effectId: "effect_heat_shield", value: 86 },
    secondaryEffects: [{ effectId: "effect_meridian_guard", value: 62 }],
    sideEffects: [{ effectId: "side_meridian_strain", value: 20 }],
    traits: ["trait_blood_lotus_armor"],
    sourceNote: "报告支持血莲精、冰灵焰草与三阶魔核；数值为项目补全。",
  }),
  pill({
    id: "pill_qinghun_dan", name: "清魂丹", form: "pill", grade: 6, priority: 100,
    description: "清除异种魂力并温养神识的高阶丹药。",
    identityCondition: all(
      quantity("material_qingti_cao", 2), quantity("material_binghuo_ronghun_guo", 1),
      quantity("material_shuiling_lianzi", 2), factorMin("artisan_grade", 6),
      factorMin("soul_power", 78), factorMin("qi_reserve", 72), tagMin("effect_soul_cleanse", 82),
    ),
    idealFactors: [
      { factorId: "furnace_temperature", idealMin: 58, idealMax: 74, penaltyPerStep: 0.6 },
      { factorId: "extraction_purity", idealMin: 84, idealMax: 100, penaltyPerStep: 0.3 },
      { factorId: "fusion", idealMin: 84, idealMax: 100, penaltyPerStep: 0.3 },
      { factorId: "nourishment", idealMin: 86, idealMax: 100, penaltyPerStep: 0.3 },
    ],
    yield: { dosePerPill: 8, min: 1, max: 2 },
    primaryEffect: { effectId: "effect_soul_purification", value: 92 },
    secondaryEffects: [{ effectId: "effect_soul_nourishment", value: 78 }],
    sideEffects: [{ effectId: "side_soul_fatigue", value: 18 }],
    traits: ["trait_clear_soul"],
    sourceNote: "报告支持三味核心材料与清魂养魂用途；数值为项目补全。",
  }),
  pill({
    id: "pill_lihuo_dan", name: "离火丹", form: "pill", grade: 5, priority: 90,
    description: "封存一缕受控地心火力，用于炼化顽固火印。",
    identityCondition: all(
      quantity("material_huoling_gen", 2), quantity("material_bingling_yancao", 1),
      quantity("material_fire_core_3", 1), { op: "factorEquals", factorId: "flame", value: "flame_qinglian" },
      factorMin("fire_control", 70), tagMin("effect_refine_flame", 65),
    ),
    idealFactors: [
      { factorId: "furnace_temperature", idealMin: 80, idealMax: 92, penaltyPerStep: 0.6 },
      { factorId: "fire_control", idealMin: 78, idealMax: 100, penaltyPerStep: 0.25 },
      { factorId: "fusion", idealMin: 78, idealMax: 100, penaltyPerStep: 0.25 },
    ],
    yield: { dosePerPill: 9, min: 1, max: 2 },
    primaryEffect: { effectId: "effect_flame_refinement", value: 88 },
    secondaryEffects: [{ effectId: "effect_heat_resistance", value: 42 }],
    sideEffects: [{ effectId: "side_fire_toxin", value: 24 }],
    traits: ["trait_flame_seed"],
    sourceNote: "报告支持离火丹的火力炼化用途；完整方与条件为项目补全。",
  }),
];

const scoreModels: AlchemyConfig["scoreModels"] = {
  danger: {
    base: 42,
    inputs: [
      { source: "factor", sourceId: "furnace_temperature", weight: 0.22 },
      { source: "factor", sourceId: "temperature_stability", weight: -0.18 },
      { source: "factor", sourceId: "fire_control", weight: -0.12 },
      { source: "factor", sourceId: "soul_power", weight: -0.06 },
      { source: "option_modifier", weight: 1 },
    ],
    min: 0,
    max: 100,
  },
  formation: {
    base: 0,
    inputs: [
      { source: "factor", sourceId: "extraction_purity", weight: 0.16 },
      { source: "factor", sourceId: "fusion", weight: 0.18 },
      { source: "factor", sourceId: "condensation", weight: 0.26 },
      { source: "factor", sourceId: "temperature_stability", weight: 0.12 },
      { source: "factor", sourceId: "soul_power", weight: 0.1 },
      { source: "factor", sourceId: "recipe_mastery", weight: 0.08 },
      { source: "factor", sourceId: "qi_reserve", weight: 0.05 },
      { source: "material_quality", weight: 0.05 },
      { source: "option_modifier", weight: 1 },
    ],
    min: 0,
    max: 100,
  },
  quality: {
    base: 8,
    inputs: [
      { source: "factor", sourceId: "extraction_purity", weight: 0.14 },
      { source: "factor", sourceId: "fusion", weight: 0.15 },
      { source: "factor", sourceId: "condensation", weight: 0.15 },
      { source: "factor", sourceId: "temperature_stability", weight: 0.12 },
      { source: "factor", sourceId: "nourishment", weight: 0.1 },
      { source: "factor", sourceId: "soul_power", weight: 0.09 },
      { source: "factor", sourceId: "recipe_mastery", weight: 0.08 },
      { source: "material_quality", weight: 0.1 },
      { source: "option_modifier", weight: 1 },
    ],
    min: 0,
    max: 100,
  },
  thresholds: {
    explosion: 72,
    formation: 48,
    qualities: [
      { quality: "lower", min: 0 },
      { quality: "middle", min: 55 },
      { quality: "upper", min: 70 },
      { quality: "supreme", min: 85 },
    ],
  },
};

const modifierRules: AlchemyConfig["modifierRules"] = [
  {
    id: "rule_danger_icefire_conflict",
    name: "冰火失衡",
    phase: "danger",
    priority: 100,
    condition: all(tagMin("nature_cold", 70), tagMin("nature_hot", 70), { op: "factorRange", factorId: "fusion", max: 55 }),
    actions: [{ type: "adjustDanger", value: 24 }],
    reason: { code: "danger.icefire.unbalanced", title: "冰火药性失衡", detail: "寒热药性同时强盛，但融合度不足以约束冲突。", tone: "negative" },
  },
  {
    id: "rule_danger_heat_instability",
    name: "过热失稳",
    phase: "danger",
    priority: 90,
    condition: all(factorMin("furnace_temperature", 88), { op: "factorRange", factorId: "temperature_stability", max: 45 }),
    actions: [{ type: "adjustDanger", value: 20 }],
    reason: { code: "danger.temperature.unstable", title: "过热且温控失稳", detail: "炉温过高且温控稳定度偏低，炉内灵压急剧上升。", tone: "negative" },
  },
  {
    id: "rule_danger_weak_alchemist_strong_flame",
    name: "强火越阶",
    phase: "danger",
    priority: 80,
    condition: all({ op: "factorEquals", factorId: "flame", value: "flame_qinglian" }, { op: "factorRange", factorId: "artisan_grade", max: 3 }),
    actions: [{ type: "adjustDanger", value: 18 }],
    reason: { code: "danger.flame.overgrade", title: "异火超出驾驭品阶", detail: "当前炼药师品阶不足以稳定驾驭青莲地心火。", tone: "negative" },
  },
  {
    id: "rule_danger_serpent_balance",
    name: "蛇涎果调和",
    phase: "danger",
    priority: 50,
    condition: all(has("material_shexian_guo"), { op: "factorRange", factorId: "furnace_temperature", max: 80 }),
    actions: [{ type: "adjustDanger", value: -5 }],
    reason: { code: "danger.material.serpent_balance", title: "蛇涎果缓和药性", detail: "蛇涎果的阴寒果液在可控炉温下缓和了烈性。", tone: "positive" },
  },
  {
    id: "rule_formation_high_cohesion",
    name: "药性高度契合",
    phase: "formation",
    priority: 70,
    condition: all(factorMin("fusion", 80), factorMin("condensation", 80)),
    actions: [{ type: "adjustFormation", value: 5 }],
    reason: { code: "formation.cohesion.high", title: "融合与凝丹契合", detail: "融合度与凝丹契合均达到 80，药性容易稳定成形。", tone: "positive" },
  },
  {
    id: "rule_formation_qi_depleted",
    name: "真元不足",
    phase: "formation",
    priority: 60,
    condition: { op: "factorRange", factorId: "qi_reserve", max: 35 },
    actions: [{ type: "adjustFormation", value: -12 }],
    reason: { code: "formation.qi.depleted", title: "真元不足以维持成形", detail: "真元储备过低，丹体在收束时缺少持续支撑。", tone: "negative" },
  },
  {
    id: "rule_quality_juqi_order",
    name: "聚气投料顺序",
    phase: "quality",
    priority: 80,
    condition: all(has("material_moyelian"), has("material_water_core_2"), { op: "orderBefore", firstMaterialId: "material_moyelian", secondMaterialId: "material_water_core_2" }),
    actions: [{ type: "adjustQuality", value: 3 }],
    reason: { code: "quality.order.juqi", title: "先润药性，后定水脉", detail: "墨叶莲先于水系魔核入炉，聚气药性更易定锚。", tone: "positive" },
  },
  {
    id: "rule_quality_deep_nourishment",
    name: "蕴养充分",
    phase: "quality",
    priority: 70,
    condition: factorMin("nourishment", 88),
    actions: [{ type: "adjustQuality", value: 4 }],
    reason: { code: "quality.nourishment.deep", title: "蕴养充分", detail: "蕴养程度达到 88，药力沉淀更完整。", tone: "positive" },
  },
  {
    id: "rule_quality_impure_extract",
    name: "萃取杂质过多",
    phase: "quality",
    priority: 60,
    condition: { op: "factorRange", factorId: "extraction_purity", max: 45 },
    actions: [{ type: "adjustQuality", value: -10 }],
    reason: { code: "quality.extraction.impure", title: "萃取纯度不足", detail: "萃取纯度不高于 45，杂质显著拉低丹药品质。", tone: "negative" },
  },
  {
    id: "rule_result_low_quality_residual",
    name: "低分残丹",
    phase: "result",
    priority: 90,
    condition: { op: "qualityRange", max: 44 },
    actions: [
      { type: "grantEvaluation", evaluationId: "residual" },
      { type: "grantEffect", effectId: "side_impurity", value: 22 },
      { type: "scaleEffect", effectId: "effect_breakthrough_support", factor: 0.75 },
    ],
    reason: { code: "modifier.quality.residual", title: "丹体勉强稳定", detail: "品质分不高于 44，丹药保留主效，但被标记为残丹并留有杂质。", tone: "negative" },
  },
  {
    id: "rule_result_fire_residue",
    name: "高危火毒残留",
    phase: "result",
    priority: 70,
    condition: { op: "dangerRange", min: 50, max: 71.9 },
    actions: [{ type: "grantEffect", effectId: "side_fire_toxin", value: 16 }],
    reason: { code: "modifier.danger.fire_residue", title: "丹体留有火毒", detail: "本炉未炸炉，但危险分已进入高位区间，丹体留下可追溯的火毒。", tone: "negative" },
  },
  {
    id: "rule_result_supreme_purity",
    name: "极品无垢",
    phase: "result",
    priority: 60,
    condition: { op: "qualityRange", min: 85 },
    actions: [{ type: "grantTrait", traitId: "trait_pure_essence" }],
    reason: { code: "modifier.quality.supreme_purity", title: "极品药性无垢", detail: "品质分达到 85，丹药获得药性无垢特质。", tone: "positive" },
  },
  {
    id: "rule_result_xuelian_synergy",
    name: "血莲冰焰护脉",
    phase: "result",
    priority: 50,
    condition: all(has("material_xuelian_jing"), has("material_bingling_yancao"), factorMin("nourishment", 82)),
    actions: [{ type: "grantEffect", effectId: "effect_meridian_guard", value: 72 }],
    reason: { code: "modifier.xuelian.nourished", title: "血莲护脉得到充分蕴养", detail: "血莲精与冰灵焰草同炉，且蕴养达到 82，经脉护持效果提升。", tone: "positive" },
  },
  {
    id: "rule_result_qinghun_nourish",
    name: "清魂后滋养",
    phase: "result",
    priority: 50,
    condition: all(has("material_binghuo_ronghun_guo"), has("material_shuiling_lianzi"), factorMin("soul_power", 88)),
    actions: [{ type: "grantEffect", effectId: "effect_soul_nourishment", value: 88 }],
    reason: { code: "modifier.qinghun.nourish", title: "清魂与养魂相续", detail: "高灵魂力使冰火融魂果与水灵莲子的药性顺利衔接。", tone: "positive" },
  },
];

const mutationRules: AlchemyConfig["mutationRules"] = [
  {
    id: "mutation_icefire_tide",
    name: "潮汐冰火共鸣",
    priority: 100,
    probability: 0.65,
    condition: all(
      { op: "factorEquals", factorId: "allow_mutation", value: true },
      { op: "factorEquals", factorId: "celestial", value: "celestial_tide" },
      { op: "any", conditions: [has("material_bingling_yancao"), has("material_binghuo_ronghun_guo")] },
      tagMin("reaction_ice_fire", 80),
      { op: "qualityRange", min: 70 },
    ),
    actions: [
      { type: "grantTrait", traitId: "trait_icefire_harmony" },
      { type: "grantEffect", effectId: "effect_icefire_adaptation", value: 56 },
      { type: "grantEvaluation", evaluationId: "mutated" },
    ],
    reason: { code: "modifier.mutation.icefire_tide", title: "冰火药性随潮汐共鸣", detail: "冰火共生材料、天地潮汐与达标品质构成异变因果，固定种子本次命中。", tone: "positive" },
  },
  {
    id: "mutation_thunder_mark",
    name: "雷纹淬丹",
    priority: 80,
    probability: 0.35,
    condition: all(
      { op: "factorEquals", factorId: "allow_mutation", value: true },
      { op: "factorEquals", factorId: "celestial", value: "celestial_thunder" },
      tagMin("reaction_fire_affinity", 60),
      { op: "dangerRange", min: 35, max: 71.9 },
    ),
    actions: [
      { type: "grantTrait", traitId: "trait_thunder_mark" },
      { type: "grantEffect", effectId: "effect_thunder_tempering", value: 44 },
      { type: "grantEvaluation", evaluationId: "mutated" },
    ],
    reason: { code: "modifier.mutation.thunder_mark", title: "丹体留下受控雷纹", detail: "雷云、亲火药性与可控危险区间构成异变因果，固定种子本次命中。", tone: "positive" },
  },
];

const failureResults: AlchemyConfig["failureResults"] = [
  { id: "not_formed", name: "药性散失", description: "成形分低于阈值，炉内只剩无法稳定凝聚的药浆与残渣。" },
  { id: "exploded", name: "炸炉", description: "炉内危险超过承受阈值，灵压与药性冲突导致炉体失控。", icon: "/assets/pills/explosion.png" },
  { id: "residual", name: "残灵丹", description: "丹体已成，且保留了最接近丹方的少量药性。", icon: "/assets/pills/residual_pill.png", evaluationId: "residual", primaryEffect: { effectId: "effect_residual_essence", value: 24 } },
  { id: "waste", name: "焦浊废丹", description: "丹体勉强成形，但药性分散且杂质过多。", icon: "/assets/pills/waste_pill.png", evaluationId: "waste", primaryEffect: { effectId: "effect_trace_medicine", value: 5 } },
];

const defaultFactorValues = Object.fromEntries(
  factors.map((factor) => [factor.id, factor.defaultValue]),
) as Record<string, FactorValue>;

interface PresetMaterialOverride {
  id: string;
  quantity: number;
  stateId?: string;
  originId?: string;
  years?: number;
}

function presetMaterials(entries: PresetMaterialOverride[]): MaterialInput[] {
  return entries.map((entry, order) => {
    const definition = materials.find((item) => item.id === entry.id);
    if (!definition) {
      throw new Error(`Unknown preset material: ${entry.id}`);
    }
    return {
      materialId: entry.id,
      quantity: entry.quantity,
      stateId: entry.stateId ?? definition.defaultStateId,
      originId: entry.originId ?? definition.defaultOriginId,
      years: entry.years ?? definition.defaultYears,
      order,
    };
  });
}

function presetInput(
  entries: PresetMaterialOverride[],
  overrides: Record<string, FactorValue> = {},
  seed = 20260812,
): SimulationInput {
  return {
    schemaVersion: "1.0",
    configVersion: "1.0.0",
    materials: presetMaterials(entries),
    factors: { ...defaultFactorValues, ...overrides },
    seed,
  };
}

const presets: AlchemyConfig["presets"] = [
  {
    id: "preset_juqi_upper", name: "聚气散·标准成丹", description: "四味核心材料齐全，工艺稳定的上品路线。",
    input: presetInput([{ id: "material_moyelian", quantity: 4 }, { id: "material_shexian_guo", quantity: 2 }, { id: "material_juling_cao", quantity: 1 }, { id: "material_water_core_2", quantity: 1 }]),
    expectation: { status: "success", prototypeId: "pill_juqi_san", quality: "upper", evaluations: ["normal"] },
  },
  {
    id: "preset_juqi_lower", name: "聚气散·低工艺", description: "丹方齐全，但萃取、融合与蕴养均偏低。",
    input: presetInput(
      [{ id: "material_moyelian", quantity: 4, stateId: "state_dried", originId: "origin_wild" }, { id: "material_shexian_guo", quantity: 2, stateId: "state_dried", originId: "origin_wild" }, { id: "material_juling_cao", quantity: 1, stateId: "state_dried", originId: "origin_wild" }, { id: "material_water_core_2", quantity: 1, stateId: "state_cracked", originId: "origin_beast" }],
      { extraction_purity: 40, fusion: 44, condensation: 50, temperature_stability: 55, soul_power: 55, recipe_mastery: 52, nourishment: 30 },
    ),
    expectation: { status: "success", prototypeId: "pill_juqi_san", quality: "lower" },
  },
  {
    id: "preset_huiqi_middle", name: "回气丹·战后回元", description: "回灵赤果为主，聚灵草与水系魔核辅助。",
    input: presetInput([{ id: "material_huiling_chiguo", quantity: 2 }, { id: "material_juling_cao", quantity: 1 }, { id: "material_water_core_2", quantity: 1 }], { extraction_purity: 65, fusion: 64, condensation: 66, nourishment: 50 }),
    expectation: { status: "success", prototypeId: "pill_huiqi_dan", quality: "middle", evaluations: ["normal"] },
  },
  {
    id: "preset_shenggu_upper", name: "生骨丹·疗伤上品", description: "生骨、止血与活血药性齐备。",
    input: presetInput([{ id: "material_shenggu_hua", quantity: 2 }, { id: "material_ningxue_cao", quantity: 1 }, { id: "material_huoqi_guo", quantity: 1 }], { extraction_purity: 86, fusion: 84, condensation: 84, nourishment: 80 }),
    expectation: { status: "success", prototypeId: "pill_shenggu_dan", quality: "upper", evaluations: ["normal"] },
  },
  {
    id: "preset_xuelian_upper", name: "血莲丹·护脉上品", description: "血莲精、冰灵焰草与火系三阶魔核形成护脉丹。",
    input: presetInput([{ id: "material_xuelian_jing", quantity: 1 }, { id: "material_bingling_yancao", quantity: 1 }, { id: "material_fire_core_3", quantity: 1 }], { artisan_grade: 6, soul_power: 80, fire_control: 84, qi_reserve: 86, furnace_temperature: 82, temperature_stability: 80, extraction_purity: 80, fusion: 80, condensation: 80, nourishment: 76, cauldron: "cauldron_xuantie", flame: "flame_beast" }),
    expectation: { status: "success", prototypeId: "pill_xuelian_dan", quality: "upper", evaluations: ["normal"] },
  },
  {
    id: "preset_qinghun_supreme", name: "清魂丹·极品", description: "高品阶、高灵魂力与三味核心材料的极品路线。",
    input: presetInput([{ id: "material_qingti_cao", quantity: 2, originId: "origin_leyline" }, { id: "material_binghuo_ronghun_guo", quantity: 1, originId: "origin_leyline" }, { id: "material_shuiling_lianzi", quantity: 2, originId: "origin_leyline" }], { artisan_grade: 7, soul_power: 96, fire_control: 92, recipe_mastery: 94, qi_reserve: 94, furnace_temperature: 66, temperature_stability: 95, extraction_purity: 96, fusion: 95, condensation: 94, nourishment: 96, cauldron: "cauldron_chiwen", flame: "flame_guling", environment: "environment_spirit_peak", celestial: "celestial_full_moon" }),
    expectation: { status: "success", prototypeId: "pill_qinghun_dan", quality: "supreme", evaluations: ["normal"] },
  },
  {
    id: "preset_bingxin_middle", name: "冰心丹·清心护神", description: "寒髓枝、清体草与冰系魔核的中品路线。",
    input: presetInput([{ id: "material_hansui_zhi", quantity: 1 }, { id: "material_qingti_cao", quantity: 1 }, { id: "material_ice_core_2", quantity: 1 }], { furnace_temperature: 60, soul_power: 58, fire_control: 74, recipe_mastery: 58, temperature_stability: 65, extraction_purity: 55, fusion: 55, condensation: 58, nourishment: 45, flame: "flame_guling", environment: "environment_cold_spring" }),
    expectation: { status: "success", prototypeId: "pill_bingxin_dan", quality: "middle", evaluations: ["normal"] },
  },
  {
    id: "preset_ningxue_powder", name: "凝血散·外敷药散", description: "低炉温保留止血与镇痛药性。",
    input: presetInput([{ id: "material_ningxue_cao", quantity: 1 }, { id: "material_huoqi_guo", quantity: 1 }, { id: "material_yingsu_hua", quantity: 1 }], { furnace_temperature: 58, soul_power: 60, recipe_mastery: 60, temperature_stability: 68, extraction_purity: 62, fusion: 58, condensation: 58, nourishment: 48 }),
    expectation: { status: "success", prototypeId: "pill_ningxue_san", quality: "middle", evaluations: ["normal"] },
  },
  {
    id: "preset_lihuo_upper", name: "离火丹·炼印上品", description: "以青莲地心火为必要火种的高热炼印路线。",
    input: presetInput([{ id: "material_huoling_gen", quantity: 2 }, { id: "material_bingling_yancao", quantity: 1 }, { id: "material_fire_core_3", quantity: 1 }], { artisan_grade: 6, soul_power: 80, fire_control: 85, recipe_mastery: 78, qi_reserve: 90, furnace_temperature: 86, temperature_stability: 78, extraction_purity: 75, fusion: 78, condensation: 76, nourishment: 72, cauldron: "cauldron_qingshi", flame: "flame_qinglian", environment: "environment_fire_vein" }),
    expectation: { status: "success", prototypeId: "pill_lihuo_dan", quality: "upper", evaluations: ["normal"] },
  },
  {
    id: "preset_not_formed", name: "未成丹·凝丹失败", description: "聚气材料齐全，但融合与凝丹契合过低。",
    input: presetInput([{ id: "material_moyelian", quantity: 4 }, { id: "material_shexian_guo", quantity: 2 }, { id: "material_juling_cao", quantity: 1 }, { id: "material_water_core_2", quantity: 1 }], { extraction_purity: 35, fusion: 12, condensation: 10, temperature_stability: 40, soul_power: 45, recipe_mastery: 38, qi_reserve: 30, nourishment: 25 }),
    expectation: { status: "not_formed" },
  },
  {
    id: "preset_residual", name: "残丹·聚气缺核", description: "工艺可以成形，但聚气方缺少水系魔核。",
    input: presetInput([{ id: "material_moyelian", quantity: 4 }, { id: "material_shexian_guo", quantity: 2 }, { id: "material_juling_cao", quantity: 1 }], { extraction_purity: 84, fusion: 84, condensation: 84, nourishment: 78 }),
    expectation: { status: "success", prototypeId: "fallback_residual", evaluations: ["residual"] },
  },
  {
    id: "preset_waste", name: "废丹·药性离散", description: "可以成形，但材料无法命中任何正式丹方。",
    input: presetInput([{ id: "material_yingsu_hua", quantity: 1 }, { id: "material_huoling_gen", quantity: 1 }], { extraction_purity: 82, fusion: 80, condensation: 84, nourishment: 70 }),
    expectation: { status: "success", prototypeId: "fallback_waste", evaluations: ["waste"] },
  },
  {
    id: "preset_explosion", name: "炸炉·冰火崩解", description: "极寒与暴烈火性同炉，过热、低稳定度与裂损炉况叠加。",
    input: presetInput([{ id: "material_hansui_zhi", quantity: 1 }, { id: "material_huoling_gen", quantity: 2 }, { id: "material_bingling_yancao", quantity: 1 }], { artisan_grade: 2, soul_power: 30, fire_control: 20, furnace_temperature: 100, temperature_stability: 15, extraction_purity: 40, fusion: 20, condensation: 30, cauldron: "cauldron_qingshi", flame: "flame_qinglian", furnace_condition: "condition_cracked", environment: "environment_fire_vein", celestial: "celestial_thunder" }),
    expectation: { status: "exploded" },
  },
  {
    id: "preset_mutation", name: "异丹·冰火潮汐", description: "血莲丹药性与天地潮汐共鸣，使用固定命中种子。",
    input: presetInput([{ id: "material_xuelian_jing", quantity: 1 }, { id: "material_bingling_yancao", quantity: 1 }, { id: "material_fire_core_3", quantity: 1 }], { artisan_grade: 6, soul_power: 90, fire_control: 90, recipe_mastery: 90, qi_reserve: 90, furnace_temperature: 82, temperature_stability: 90, extraction_purity: 92, fusion: 92, condensation: 90, nourishment: 90, cauldron: "cauldron_chiwen", flame: "flame_beast", celestial: "celestial_tide", allow_mutation: true }, 1),
    expectation: { status: "success", prototypeId: "pill_xuelian_dan", quality: "supreme", evaluations: ["normal", "mutated"] },
  },
];

export const alchemyConfig: AlchemyConfig = {
  schemaVersion: "1.0",
  configVersion: "1.0.0",
  meta: {
    name: "炼丹规则模拟器初版配置",
    description: "用于网页端规则调试与 Unity 确定性迁移的受控动态成丹配置。",
    maxMaterials: 20,
    maxCandidates: 8,
    maxPillQuantity: 12,
    residualMatchRatio: 0.6,
    qualityEffectMultipliers: { lower: 0.72, middle: 0.86, upper: 1, supreme: 1.12 },
    qualityYieldDeltas: { lower: -1, middle: 0, upper: 0, supreme: 1 },
  },
  tagDefinitions,
  materialStates,
  materialOrigins,
  materialKindProfiles,
  materials,
  factorGroups,
  factors,
  optionCatalogs,
  effects,
  traits,
  evaluations,
  scoreModels,
  pillPrototypes,
  modifierRules,
  mutationRules,
  failureResults,
  presets,
};

export function defaultFactors(config: AlchemyConfig = alchemyConfig): Record<string, FactorValue> {
  return Object.fromEntries(config.factors.map((factor) => [factor.id, factor.defaultValue]));
}
