import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  alchemyConfig,
  defaultFactors,
  simulate,
  validateConfig,
} from "./domain";
import type {
  AlchemyConfig,
  FactorValue,
  MaterialInput,
  SimulationInput,
  SimulationResult,
} from "./domain/types";
import { FactorPanel } from "./components/FactorPanel";
import { MaterialPanel } from "./components/MaterialPanel";
import { RecipePanel } from "./components/RecipePanel";
import { ResultPanel } from "./components/ResultPanel";
import { WorkbenchToolbar } from "./components/WorkbenchToolbar";

interface DraftValidation {
  materialErrors: Record<string, string>;
  factorErrors: Record<string, string>;
  otherErrors: string[];
  summary: string | undefined;
}

interface ExportEnvelope {
  input: SimulationInput;
  result: SimulationResult | null;
}

function cloneInput(input: SimulationInput): SimulationInput {
  return JSON.parse(JSON.stringify(input)) as SimulationInput;
}

function defaultPreset(config: AlchemyConfig) {
  return config.presets.find((preset) => preset.name.includes("聚气散") && preset.name.includes("标准"))
    ?? config.presets[0];
}

function createDefaultInput(config: AlchemyConfig): SimulationInput {
  const preset = defaultPreset(config);
  if (preset) {
    const input = cloneInput(preset.input);
    input.factors = { ...defaultFactors(config), ...input.factors };
    return input;
  }
  return {
    schemaVersion: config.schemaVersion,
    configVersion: config.configVersion,
    materials: [],
    factors: defaultFactors(config),
    seed: 20260812,
  };
}

function factorOptionValues(config: AlchemyConfig, factorId: string): string[] {
  const factor = config.factors.find((item) => item.id === factorId);
  if (!factor) return [];
  if (factor.options) return factor.options.map((option) => option.value);
  return config.optionCatalogs
    .find((catalog) => catalog.id === factor.optionCatalogId)
    ?.options.map((option) => option.id) ?? [];
}

function validateDraft(input: SimulationInput, config: AlchemyConfig): DraftValidation {
  const materialErrors: Record<string, string> = {};
  const factorErrors: Record<string, string> = {};
  const otherErrors: string[] = [];

  if (input.schemaVersion !== config.schemaVersion) {
    otherErrors.push(`输入结构版本 ${input.schemaVersion} 与当前版本 ${config.schemaVersion} 不兼容。`);
  }
  if (input.configVersion !== config.configVersion) {
    otherErrors.push(`输入配置版本 ${input.configVersion} 与当前版本 ${config.configVersion} 不一致。`);
  }
  if (!Number.isSafeInteger(input.seed)) {
    otherErrors.push("随机种子必须是安全整数。");
  }
  if (!input.materials.length) {
    materialErrors.materials = "请至少加入一种药材。";
  }
  if (input.materials.length > config.meta.maxMaterials) {
    materialErrors.materials = `本炉最多选择 ${config.meta.maxMaterials} 种药材。`;
  }

  const seenMaterialIds = new Set<string>();
  const seenOrders = new Set<number>();
  const recipeSlots = Array.isArray(config.recipeSlots) ? config.recipeSlots : [];
  const inventoryEntries = Array.isArray(config.inventory) ? config.inventory : [];
  const validOrders = new Set(recipeSlots.map((slot) => slot.order));
  const inventoryById = new Map(inventoryEntries.map((entry) => [entry.materialId, entry.quantity]));
  for (const material of input.materials) {
    const definition = config.materials.find((item) => item.id === material.materialId);
    if (!definition) {
      materialErrors.materials = `输入引用了不存在的药材 ${material.materialId}。`;
      continue;
    }
    if (seenMaterialIds.has(material.materialId)) {
      materialErrors.materials = `${definition.name}重复出现，请合并数量。`;
    }
    seenMaterialIds.add(material.materialId);
    if (!Number.isSafeInteger(material.quantity) || material.quantity < 1) {
      materialErrors[`${material.materialId}.quantity`] = "数量必须是大于 0 的整数。";
    } else if (material.quantity > (inventoryById.get(material.materialId) ?? 0)) {
      materialErrors[`${material.materialId}.quantity`] = `${definition.name}超过背包库存。`;
    }
    if (!Number.isSafeInteger(material.years)
      || material.years < definition.yearRange.min
      || material.years > definition.yearRange.max) {
      materialErrors[`${material.materialId}.years`] = `${definition.ageLabel}必须在 ${definition.yearRange.min} 至 ${definition.yearRange.max}${definition.ageUnit}之间。`;
    }
    if (!config.materialStates.some((state) => state.id === material.stateId)) {
      materialErrors[`${material.materialId}.stateId`] = `${definition.name}引用了不存在的保存状态。`;
    } else if (!definition.allowedStateIds.includes(material.stateId)) {
      materialErrors[`${material.materialId}.stateId`] = `${definition.name}不能使用当前保存状态。`;
    }
    if (!config.materialOrigins.some((origin) => origin.id === material.originId)) {
      materialErrors[`${material.materialId}.originId`] = `${definition.name}引用了不存在的来源。`;
    } else if (!definition.allowedOriginIds.includes(material.originId)) {
      materialErrors[`${material.materialId}.originId`] = `${definition.name}不能使用当前来源。`;
    }
    if (!Number.isSafeInteger(material.order) || !validOrders.has(material.order)) {
      materialErrors.materials = "材料必须放入配置定义的丹方槽位。";
    } else if (seenOrders.has(material.order)) {
      materialErrors.materials = "每个丹方槽位只能放入一种药材。";
    }
    seenOrders.add(material.order);
  }

  for (const factor of config.factors) {
    const value = input.factors[factor.id];
    if (factor.valueType === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        factorErrors[factor.id] = "请输入有效数字。";
      } else if ((factor.min !== undefined && value < factor.min)
        || (factor.max !== undefined && value > factor.max)) {
        factorErrors[factor.id] = `合法范围为 ${factor.min ?? "不限"} 至 ${factor.max ?? "不限"}${factor.unit ?? ""}。`;
      }
    } else if (factor.valueType === "boolean") {
      if (typeof value !== "boolean") factorErrors[factor.id] = "该因素必须为开启或关闭。";
    } else {
      const options = factorOptionValues(config, factor.id);
      if (typeof value !== "string" || !options.includes(value)) {
        factorErrors[factor.id] = "请选择配置中存在的选项。";
      }
    }
  }

  const summary = otherErrors[0]
    ?? materialErrors.materials
    ?? Object.values(materialErrors)[0]
    ?? Object.values(factorErrors)[0];
  return { materialErrors, factorErrors, otherErrors, summary };
}

function configDiagnostics(value: unknown): string[] {
  if (value === undefined || value === null || value === true) return [];
  if (value === false) return ["配置校验未通过。"];
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const possibleLists = [record.errors, record.diagnostics, record.issues];
    const list = possibleLists.find(Array.isArray);
    if (Array.isArray(list)) {
      return list.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const issue = item as Record<string, unknown>;
          return String(issue.message ?? issue.detail ?? JSON.stringify(item));
        }
        return String(item);
      });
    }
    if (record.valid === false) return ["配置校验未通过，但没有返回具体诊断。"];
    return [];
  }
  return [String(value)];
}

function isSimulationInput(value: unknown): value is SimulationInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.schemaVersion === "string"
    && typeof input.configVersion === "string"
    && Array.isArray(input.materials)
    && Boolean(input.factors && typeof input.factors === "object" && !Array.isArray(input.factors))
    && typeof input.seed === "number";
}

function normalizedInput(input: SimulationInput): SimulationInput {
  const snapshot = cloneInput(input);
  snapshot.materials = [...snapshot.materials]
    .sort((a, b) => a.order - b.order);
  return snapshot;
}

export default function App() {
  const config = alchemyConfig;
  const recipeSlots = Array.isArray(config.recipeSlots) ? config.recipeSlots : [];
  const inventoryEntries = Array.isArray(config.inventory) ? config.inventory : [];
  const initialPreset = defaultPreset(config);
  const [draft, setDraft] = useState<SimulationInput>(() => createDefaultInput(config));
  const [selectedSlotId, setSelectedSlotId] = useState(recipeSlots[0]?.id ?? "");
  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset?.id ?? "");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [lastRunInput, setLastRunInput] = useState<SimulationInput | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "neutral"; text: string } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const validation = useMemo(() => validateDraft(draft, config), [draft, config]);
  const configurationErrors = useMemo(() => {
    try {
      return configDiagnostics(validateConfig(config));
    } catch (error) {
      return [`配置校验发生异常：${error instanceof Error ? error.message : String(error)}`];
    }
  }, [config]);
  const resultIsStale = Boolean(result && lastRunInput
    && JSON.stringify(draft) !== JSON.stringify(lastRunInput));

  const updateDraft = useCallback((updater: (current: SimulationInput) => SimulationInput) => {
    setDraft((current) => updater(current));
    setSelectedPresetId("");
    setNotice(null);
  }, []);

  const handleRun = useCallback(() => {
    if (configurationErrors.length || validation.summary) {
      setNotice({
        tone: "error",
        text: configurationErrors[0] ?? validation.summary ?? "请先修正输入。",
      });
      return;
    }
    const snapshot = normalizedInput(draft);
    try {
      const nextResult = simulate(snapshot, config);
      setResult(nextResult);
      setLastRunInput(snapshot);
      setExecutionError(null);
      setNotice({ tone: "success", text: "推演完成，结果和判定依据已更新。" });
    } catch (error) {
      setResult(null);
      setLastRunInput(snapshot);
      setExecutionError(error instanceof Error ? error.message : String(error));
      setNotice({ tone: "error", text: "规则执行异常，请查看结果栏中的诊断信息。" });
    }
  }, [config, configurationErrors, draft, validation.summary]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleRun();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleRun]);

  useEffect(() => {
    if (result || executionError) resultHeadingRef.current?.focus();
  }, [executionError, result]);

  function handlePresetChange(presetId: string) {
    if (!presetId) {
      setSelectedPresetId("");
      return;
    }
    const preset = config.presets.find((item) => item.id === presetId);
    if (!preset) return;
    const nextInput = cloneInput(preset.input);
    nextInput.factors = { ...defaultFactors(config), ...nextInput.factors };
    setDraft(nextInput);
    setSelectedPresetId(preset.id);
    setNotice({ tone: "neutral", text: `已载入预设“${preset.name}”，尚未执行推演。` });
    setExecutionError(null);
  }

  function handleAssignMaterial(
    slotOrder: number,
    materialId: string,
    quantity: number,
    mode: "increment" | "set",
  ) {
    updateDraft((current) => {
      const definition = config.materials.find((item) => item.id === materialId);
      if (!definition) return current;
      const inventory = inventoryEntries.find((entry) => entry.materialId === materialId)?.quantity ?? 0;
      if (inventory < 1) return current;
      const existing = current.materials.find((item) => item.materialId === materialId);
      const target = current.materials.find((item) => item.order === slotOrder);
      const nextQuantity = Math.max(1, Math.min(
        inventory,
        mode === "increment" ? (existing?.quantity ?? 0) + quantity : quantity,
      ));
      const material: MaterialInput = existing ? {
        ...existing,
        quantity: nextQuantity,
        order: slotOrder,
      } : {
        materialId,
        quantity: nextQuantity,
        stateId: definition.defaultStateId,
        originId: definition.defaultOriginId,
        years: definition.defaultYears,
        order: slotOrder,
      };
      return {
        ...current,
        materials: [
          ...current.materials.filter((item) => (
            item.materialId !== materialId
            && item.materialId !== target?.materialId
            && item.order !== slotOrder
          )),
          material,
        ].sort((left, right) => left.order - right.order),
      };
    });
  }

  function handleMaterialClick(materialId: string) {
    const selectedSlot = recipeSlots.find((slot) => slot.id === selectedSlotId);
    if (!selectedSlot) {
      setNotice({ tone: "neutral", text: "请先选择中间的一个丹方槽位。" });
      return;
    }
    handleAssignMaterial(selectedSlot.order, materialId, 1, "increment");
  }

  function handleDecrementSlot(slotOrder: number) {
    updateDraft((current) => ({
      ...current,
      materials: current.materials.flatMap((material) => {
        if (material.order !== slotOrder) return [material];
        return material.quantity > 1 ? [{ ...material, quantity: material.quantity - 1 }] : [];
      }),
    }));
  }

  function handleClearSlot(slotOrder: number) {
    updateDraft((current) => ({
      ...current,
      materials: current.materials.filter((material) => material.order !== slotOrder),
    }));
  }

  function handleFactorChange(factorId: string, value: FactorValue) {
    updateDraft((current) => ({
      ...current,
      factors: { ...current.factors, [factorId]: value },
    }));
  }

  function handleReset() {
    setDraft(createDefaultInput(config));
    setSelectedPresetId(initialPreset?.id ?? "");
    setResult(null);
    setLastRunInput(null);
    setExecutionError(null);
    setNotice({ tone: "success", text: "已恢复默认预设和因素值。" });
    setSelectedSlotId(recipeSlots[0]?.id ?? "");
  }

  async function handleImport(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const possibleInput = raw && typeof raw === "object" && "input" in raw
        ? (raw as Record<string, unknown>).input
        : raw;
      if (!isSimulationInput(possibleInput)) {
        throw new Error("JSON 不符合炼丹输入快照结构。");
      }
      const imported = normalizedInput(possibleInput);
      const importedValidation = validateDraft(imported, config);
      if (importedValidation.summary) throw new Error(importedValidation.summary);
      setDraft(imported);
      setSelectedPresetId("");
      setExecutionError(null);
      setNotice({ tone: "success", text: `已导入 ${file.name}，尚未执行推演。` });
    } catch (error) {
      setNotice({ tone: "error", text: `导入失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  function handleExport() {
    if (validation.summary) {
      setNotice({ tone: "error", text: `无法导出：${validation.summary}` });
      return;
    }
    const envelope: ExportEnvelope = {
      input: normalizedInput(draft),
      result: resultIsStale ? null : result,
    };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `炼丹测试案例-${draft.seed}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "success", text: resultIsStale ? "已导出当前输入，过期结果未写入案例。" : "已导出当前输入与有效结果。" });
  }

  function locateEvidence(factorId?: string, materialId?: string) {
    const target = factorId
      ? document.getElementById(`factor-${factorId}`)
      : materialId
        ? document.getElementById(`material-${materialId}`)
        : null;
    target?.focus();
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  const uiDisabled = configurationErrors.length > 0;

  return (
    <div className="app-shell">
      <WorkbenchToolbar
        configVersion={config.configVersion}
        presets={config.presets}
        selectedPresetId={selectedPresetId}
        seed={draft.seed}
        disabled={uiDisabled}
        notice={notice}
        onPresetChange={handlePresetChange}
        onSeedChange={(seed) => updateDraft((current) => ({ ...current, seed: Number(seed) }))}
        onExport={handleExport}
        onImport={handleImport}
        onReset={handleReset}
      />

      <main className="workbench">
        <MaterialPanel
          config={config}
          materials={draft.materials}
          selectedSlotLabel={recipeSlots.find((slot) => slot.id === selectedSlotId)?.label}
          disabled={uiDisabled}
          onMaterialClick={handleMaterialClick}
        />
        <div className="recipe-column">
          <RecipePanel
            config={config}
            materials={draft.materials}
            selectedSlotId={selectedSlotId}
            validationSummary={configurationErrors[0] ?? validation.summary}
            resultIsStale={resultIsStale}
            disabled={uiDisabled}
            onSelectSlot={setSelectedSlotId}
            onAssign={handleAssignMaterial}
            onDecrement={handleDecrementSlot}
            onClear={handleClearSlot}
            onRun={handleRun}
          />
          <ResultPanel
            ref={resultHeadingRef}
            config={config}
            result={result}
            stale={resultIsStale}
            configErrors={configurationErrors}
            executionError={executionError}
            onLocateEvidence={locateEvidence}
          />
        </div>
        <FactorPanel
          config={config}
          factors={draft.factors}
          errors={validation.factorErrors}
          disabled={uiDisabled}
          onChange={handleFactorChange}
        />
      </main>
    </div>
  );
}
