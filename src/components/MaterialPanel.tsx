import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AlchemyConfig, MaterialDefinition, MaterialInput } from "../domain/types";
import { EntityIcon } from "./EntityIcon";

interface MaterialPanelProps {
  config: AlchemyConfig;
  materials: MaterialInput[];
  selectedSlotLabel?: string | undefined;
  disabled?: boolean;
  onMaterialClick: (materialId: string) => void;
}

type BackpackCategory = "all" | "botanical" | "core" | "support";

const categoryOptions: Array<{ id: BackpackCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "botanical", label: "灵植" },
  { id: "core", label: "魔核" },
  { id: "support", label: "辅材" },
];

function materialSearchText(material: MaterialDefinition, config: AlchemyConfig) {
  const tagNames = material.baseTags.map((tag) => (
    config.tagDefinitions.find((definition) => definition.id === tag.tagId)?.name ?? tag.tagId
  ));
  return [material.name, material.description, ...tagNames].join(" ").toLocaleLowerCase("zh-CN");
}

function categoryMatches(material: MaterialDefinition, category: BackpackCategory) {
  if (category === "all") return true;
  if (category === "core") return material.kind === "core";
  if (category === "support") return material.kind === "liquid" || material.kind === "wonder";
  return ["herb", "flower", "fruit", "root"].includes(material.kind);
}

function propertyMatches(material: MaterialDefinition, tagIds: string[]) {
  if (!tagIds.length) return true;
  return tagIds.some((tagId) => material.baseTags.some((tag) => tag.tagId === tagId));
}

interface TooltipState {
  materialId: string;
  top: number;
  left: number;
}

export function MaterialPanel({
  config,
  materials,
  selectedSlotLabel,
  disabled = false,
  onMaterialClick,
}: MaterialPanelProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BackpackCategory>("all");
  const filters = Array.isArray(config.materialFilters) ? config.materialFilters : [];
  const [propertyFilterId, setPropertyFilterId] = useState(filters[0]?.id ?? "");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const usedById = useMemo(() => {
    const result = new Map<string, number>();
    materials.forEach((material) => result.set(
      material.materialId,
      (result.get(material.materialId) ?? 0) + material.quantity,
    ));
    return result;
  }, [materials]);
  const inventoryById = useMemo(
    () => new Map((Array.isArray(config.inventory) ? config.inventory : [])
      .map((entry) => [entry.materialId, entry.quantity])),
    [config.inventory],
  );
  const visibleMaterials = config.materials.filter((material) => (
    categoryMatches(material, category)
    && propertyMatches(
      material,
      filters.find((filter) => filter.id === propertyFilterId)?.tagIds ?? [],
    )
    && (!normalizedSearch || materialSearchText(material, config).includes(normalizedSearch))
  ));
  const tooltipMaterial = tooltip
    ? config.materials.find((material) => material.id === tooltip.materialId)
    : undefined;

  function showTooltip(materialId: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const width = 292;
    const left = Math.min(window.innerWidth - width - 12, rect.right + 10);
    const top = Math.min(window.innerHeight - 230, Math.max(12, rect.top - 18));
    setTooltip({ materialId, top, left: Math.max(12, left) });
  }

  return (
    <section className="panel material-panel" aria-labelledby="materials-title">
      <div className="panel__header panel__header--ornate">
        <h2 id="materials-title">药材背包</h2>
        <span>{config.materials.length} 种</span>
      </div>

      <div className="backpack-body">
        <nav className="property-filters" aria-label="药性筛选">
          <span className="property-filters__title">药性</span>
          {filters.map((filter) => (
            <button
              type="button"
              key={filter.id}
              className={propertyFilterId === filter.id
                ? "property-filter property-filter--active"
                : "property-filter"}
              aria-pressed={propertyFilterId === filter.id}
              onClick={() => {
                setPropertyFilterId(filter.id);
                setTooltip(null);
              }}
            >
              {filter.label}
            </button>
          ))}
        </nav>

        <div className="backpack-main">
          <div className="backpack-controls">
            <label className="search-field">
              <span className="sr-only">搜索药材或标签</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索药材或标签"
                disabled={disabled}
              />
            </label>
            <div className="category-tabs" aria-label="药材分类">
              {categoryOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={category === option.id ? "category-tab category-tab--active" : "category-tab"}
                  aria-pressed={category === option.id}
                  onClick={() => {
                    setCategory(option.id);
                    setTooltip(null);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="backpack-hint">
              {selectedSlotLabel ? `当前投放目标：${selectedSlotLabel}` : "先选择中间槽位，再点击药材放入 1 份"}
            </p>
          </div>

          <div className="backpack-grid" aria-label="药材背包图标">
            {visibleMaterials.map((material) => {
              const stock = inventoryById.get(material.id) ?? 0;
              const remaining = Math.max(0, stock - (usedById.get(material.id) ?? 0));
              return (
                <button
                  type="button"
                  className="backpack-item"
                  key={material.id}
                  aria-label={`${material.name}，背包剩余 ${remaining} 份`}
                  aria-describedby={tooltip?.materialId === material.id ? "material-tooltip" : undefined}
                  disabled={disabled || remaining <= 0}
                  draggable={!disabled && remaining > 0}
                  onClick={() => onMaterialClick(material.id)}
                  onDragStart={(event) => {
                    setTooltip(null);
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-alchemy-material", material.id);
                    event.dataTransfer.setData("text/plain", material.id);
                  }}
                  onMouseEnter={(event) => showTooltip(material.id, event.currentTarget)}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(event) => showTooltip(material.id, event.currentTarget)}
                  onBlur={() => setTooltip(null)}
                >
                  <EntityIcon src={material.icon} name={material.name} size="inventory" />
                  <span className="inventory-badge" aria-hidden="true">{remaining}</span>
                </button>
              );
            })}
            {!visibleMaterials.length ? (
              <div className="compact-empty" role="status">没有匹配的药材</div>
            ) : null}
          </div>
        </div>
      </div>

      {tooltip && tooltipMaterial ? createPortal(
        <div
          id="material-tooltip"
          className="material-tooltip"
          role="tooltip"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          <div className="material-tooltip__title">
            <EntityIcon src={tooltipMaterial.icon} name={tooltipMaterial.name} size="small" />
            <div>
              <strong>{tooltipMaterial.name}</strong>
              <span>基础剂量 {tooltipMaterial.doseValue}</span>
            </div>
          </div>
          <p>{tooltipMaterial.description}</p>
          <div className="material-tooltip__tags">
            {tooltipMaterial.baseTags.slice(0, 4).map((tag) => {
              const definition = config.tagDefinitions.find((item) => item.id === tag.tagId);
              return <span key={tag.tagId}>{definition?.name ?? tag.tagId} {tag.strength}</span>;
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
