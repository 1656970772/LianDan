import { useMemo, useState } from "react";
import type {
  AlchemyConfig,
  MaterialDefinition,
  MaterialInput,
  TagCategory,
} from "../domain/types";
import { EntityIcon } from "./EntityIcon";

interface MaterialPanelProps {
  config: AlchemyConfig;
  materials: MaterialInput[];
  errors?: Record<string, string>;
  disabled?: boolean;
  onAdd: (materialId: string) => void;
  onChange: (materialId: string, patch: Partial<MaterialInput>) => void;
  onMove: (materialId: string, direction: -1 | 1) => void;
  onRemove: (materialId: string) => void;
}

const categoryNames: Record<TagCategory, string> = {
  nature: "药性",
  effect: "功效",
  reaction: "反应",
  risk: "风险",
  state: "状态",
};

const kindNames: Record<MaterialDefinition["kind"], string> = {
  herb: "灵草",
  flower: "灵花",
  fruit: "灵果",
  root: "灵根",
  core: "魔核",
  liquid: "灵液",
  wonder: "天地奇物",
};

function materialSearchText(material: MaterialDefinition, config: AlchemyConfig) {
  const tagNames = material.baseTags.map((tag) => (
    config.tagDefinitions.find((definition) => definition.id === tag.tagId)?.name ?? tag.tagId
  ));
  return [material.name, material.description, ...tagNames].join(" ").toLocaleLowerCase("zh-CN");
}

export function MaterialPanel({
  config,
  materials,
  errors = {},
  disabled = false,
  onAdd,
  onChange,
  onMove,
  onRemove,
}: MaterialPanelProps) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const selectedById = useMemo(
    () => new Map(materials.map((material) => [material.materialId, material])),
    [materials],
  );
  const visibleMaterials = config.materials.filter((material) => (
    !normalizedSearch || materialSearchText(material, config).includes(normalizedSearch)
  ));
  const orderedMaterials = [...materials].sort((a, b) => a.order - b.order);

  return (
    <section className="panel material-panel" aria-labelledby="materials-title">
      <div className="panel__header">
        <div>
          <p className="panel__index">输入 A</p>
          <h2 id="materials-title">药材与投料顺序</h2>
        </div>
        <output className="panel__count" aria-label={`已选择 ${materials.length} 种药材`}>
          {materials.length}/{config.meta.maxMaterials}
        </output>
      </div>

      <div className="material-library">
        <label className="search-field">
          <span>搜索药材或标签</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="例如：聚气、寒性、魔核"
            disabled={disabled}
          />
        </label>

        <div className="material-library__list" aria-label="药材库">
          {visibleMaterials.length ? visibleMaterials.map((material) => {
            const selected = selectedById.get(material.id);
            const topTags = material.baseTags.slice(0, 3).map((tag) => (
              config.tagDefinitions.find((definition) => definition.id === tag.tagId)?.name ?? tag.tagId
            ));
            return (
              <article className="library-item" key={material.id}>
                <EntityIcon src={material.icon} name={material.name} size="small" />
                <div className="library-item__body">
                  <h3>{material.name}</h3>
                  <p>{material.description}</p>
                  <div className="tag-line" aria-label="关键标签">
                    {topTags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                </div>
                <button
                  type="button"
                  className="button button--compact"
                  onClick={() => onAdd(material.id)}
                  disabled={disabled || Boolean(selected) || materials.length >= config.meta.maxMaterials}
                  aria-label={selected ? `${material.name}已加入，本炉共${selected.quantity}份` : `加入${material.name}`}
                >
                  {selected ? `${selected.quantity}份` : "加入"}
                </button>
              </article>
            );
          }) : (
            <div className="compact-empty" role="status">
              <strong>没有匹配药材</strong>
              <span>尝试搜索名称、药性或功效标签。</span>
            </div>
          )}
        </div>
      </div>

      <div className="selected-materials">
        <div className="subsection-heading">
          <h3>本炉材料</h3>
          <p>数量影响剂量和产量，不累加同名标签强度。</p>
        </div>

        {errors.materials ? <p className="field-error" role="alert">{errors.materials}</p> : null}

        {orderedMaterials.length ? (
          <ol className="selected-materials__list">
            {orderedMaterials.map((input, index) => {
              const definition = config.materials.find((material) => material.id === input.materialId);
              if (!definition) return null;
              const allowedStates = config.materialStates.filter((state) => definition.allowedStateIds.includes(state.id));
              const allowedOrigins = config.materialOrigins.filter((origin) => definition.allowedOriginIds.includes(origin.id));
              const quantityError = errors[`${input.materialId}.quantity`];
              const stateError = errors[`${input.materialId}.stateId`];
              const originError = errors[`${input.materialId}.originId`];
              const yearsError = errors[`${input.materialId}.years`];
              return (
                <li
                  className="selected-material"
                  key={input.materialId}
                  id={`material-${input.materialId}`}
                  tabIndex={-1}
                >
                  <div className="selected-material__heading">
                    <span className="order-number" aria-label={`投料顺序 ${index + 1}`}>{index + 1}</span>
                    <EntityIcon src={definition.icon} name={definition.name} size="small" />
                    <div>
                      <h4>{definition.name}</h4>
                      <span>{kindNames[definition.kind]} · 基础剂量 {definition.doseValue}</span>
                    </div>
                    <div className="row-actions" aria-label={`${definition.name}排序和移除`}>
                      <button type="button" className="text-action" aria-label={`${definition.name}上移`} onClick={() => onMove(input.materialId, -1)} disabled={disabled || index === 0}>上移</button>
                      <button type="button" className="text-action" aria-label={`${definition.name}下移`} onClick={() => onMove(input.materialId, 1)} disabled={disabled || index === orderedMaterials.length - 1}>下移</button>
                      <button type="button" className="text-action text-action--danger" aria-label={`移除${definition.name}`} onClick={() => onRemove(input.materialId)} disabled={disabled}>移除</button>
                    </div>
                  </div>

                  <div className="material-fields">
                    <label className="field-block">
                      <span>数量</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        aria-label={`${definition.name}数量`}
                        value={input.quantity}
                        onChange={(event) => onChange(input.materialId, { quantity: Number(event.target.value) })}
                        aria-invalid={Boolean(quantityError)}
                        disabled={disabled}
                      />
                      {quantityError ? <small className="field-error">{quantityError}</small> : null}
                    </label>
                    <label className="field-block">
                      <span>保存状态</span>
                      <select
                        value={input.stateId}
                        aria-label={`${definition.name}保存状态`}
                        onChange={(event) => onChange(input.materialId, { stateId: event.target.value })}
                        aria-invalid={Boolean(stateError)}
                        disabled={disabled}
                      >
                        {allowedStates.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
                      </select>
                      {stateError ? <small className="field-error">{stateError}</small> : null}
                    </label>
                    <label className="field-block">
                      <span>来源</span>
                      <select
                        value={input.originId}
                        aria-label={`${definition.name}来源`}
                        onChange={(event) => onChange(input.materialId, { originId: event.target.value })}
                        aria-invalid={Boolean(originError)}
                        disabled={disabled}
                      >
                        {allowedOrigins.map((origin) => <option key={origin.id} value={origin.id}>{origin.name}</option>)}
                      </select>
                      {originError ? <small className="field-error">{originError}</small> : null}
                    </label>
                  </div>

                  <div className="range-field range-field--material">
                    <div className="range-field__label">
                      <label htmlFor={`years-${input.materialId}`}>{definition.ageLabel}</label>
                      <span>{definition.yearRange.min} 至 {definition.yearRange.max}{definition.ageUnit}，{definition.maturityLabel} {definition.yearRange.mature}{definition.ageUnit}</span>
                    </div>
                    <div className="range-field__controls">
                      <input
                        id={`years-${input.materialId}`}
                        type="range"
                        min={definition.yearRange.min}
                        max={definition.yearRange.max}
                        step={1}
                        aria-label={`${definition.name}${definition.ageLabel}滑动条`}
                        value={Number.isFinite(input.years) ? input.years : definition.defaultYears}
                        onChange={(event) => onChange(input.materialId, { years: Number(event.target.value) })}
                        disabled={disabled}
                      />
                      <input
                        type="number"
                        aria-label={`${definition.name}${definition.ageLabel}数值`}
                        min={definition.yearRange.min}
                        max={definition.yearRange.max}
                        step={1}
                        value={input.years}
                        onChange={(event) => onChange(input.materialId, { years: Number(event.target.value) })}
                        aria-invalid={Boolean(yearsError)}
                        disabled={disabled}
                      />
                      <span>{definition.ageUnit}</span>
                    </div>
                    {yearsError ? <small className="field-error">{yearsError}</small> : null}
                  </div>

                  <details className="tag-details">
                    <summary>查看固有标签与来源说明</summary>
                    <div className="tag-details__grid">
                      {definition.baseTags.map((tag) => {
                        const tagDefinition = config.tagDefinitions.find((item) => item.id === tag.tagId);
                        return (
                          <div key={tag.tagId} className="tag-detail">
                            <span>{tagDefinition ? categoryNames[tagDefinition.category] : "标签"}</span>
                            <strong>{tagDefinition?.name ?? tag.tagId}</strong>
                            <code>{tag.strength}</code>
                            <p>{tagDefinition?.description}</p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="source-note">{definition.sourceNote}</p>
                  </details>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="panel-empty">
            <strong>尚未选择药材</strong>
            <p>从上方药材库加入材料，本炉材料会在这里合并并排序。</p>
          </div>
        )}
      </div>
    </section>
  );
}
