import type {
  AlchemyConfig,
  Condition,
  FactorDefinition,
  FactorValue,
} from "../domain/types";

interface FactorPanelProps {
  config: AlchemyConfig;
  factors: Record<string, FactorValue>;
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (factorId: string, value: FactorValue) => void;
}

function visibilityMatches(condition: Condition | undefined, factors: Record<string, FactorValue>): boolean {
  if (!condition) return true;
  switch (condition.op) {
    case "all":
      return condition.conditions.every((item) => visibilityMatches(item, factors));
    case "any":
      return condition.conditions.some((item) => visibilityMatches(item, factors));
    case "not":
      return !visibilityMatches(condition.condition, factors);
    case "factorEquals":
      return factors[condition.factorId] === condition.value;
    case "factorRange": {
      const value = factors[condition.factorId];
      if (typeof value !== "number") return false;
      if (condition.min !== undefined && value < condition.min) return false;
      if (condition.max !== undefined && value > condition.max) return false;
      return true;
    }
    default:
      return true;
  }
}

function optionsFor(factor: FactorDefinition, config: AlchemyConfig) {
  if (factor.options) return factor.options;
  const catalog = config.optionCatalogs.find((item) => item.id === factor.optionCatalogId);
  return catalog?.options.map((option) => ({
    value: option.id,
    label: option.name,
    description: option.description,
  })) ?? [];
}

interface FactorFieldProps {
  definition: FactorDefinition;
  config: AlchemyConfig;
  value: FactorValue;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: FactorValue) => void;
}

function FactorField({ definition, config, value, error, disabled, onChange }: FactorFieldProps) {
  const inputId = `factor-${definition.id}`;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const describedBy = [descriptionId, error ? errorId : null].filter(Boolean).join(" ");
  const options = optionsFor(definition, config);
  const selectedOption = options.find((option) => option.value === value);

  if (definition.controlType === "toggle") {
    return (
      <div className="factor-field factor-field--toggle" data-factor-id={definition.id}>
        <div>
          <label htmlFor={inputId}>{definition.label}</label>
          <p id={descriptionId}>{definition.description}</p>
        </div>
        <label className="toggle-control">
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            aria-describedby={describedBy}
            disabled={disabled}
          />
          <span aria-hidden="true" />
          <strong>{value === true ? "已开启" : "已关闭"}</strong>
        </label>
        {error ? <small className="field-error" id={errorId}>{error}</small> : null}
      </div>
    );
  }

  if (definition.controlType === "select") {
    return (
      <div className="factor-field" data-factor-id={definition.id}>
        <label htmlFor={inputId}>{definition.label}</label>
        <select
          id={inputId}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <p id={descriptionId}>{selectedOption?.description ?? definition.description}</p>
        {error ? <small className="field-error" id={errorId}>{error}</small> : null}
      </div>
    );
  }

  const numericValue = typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(definition.defaultValue);

  if (definition.controlType === "number") {
    return (
      <div className="factor-field" data-factor-id={definition.id}>
        <label htmlFor={inputId}>{definition.label}</label>
        <div className="number-field">
          <input
            id={inputId}
            type="number"
            min={definition.min}
            max={definition.max}
            step={definition.step}
            value={numericValue}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            disabled={disabled}
          />
          {definition.unit ? <span>{definition.unit}</span> : null}
        </div>
        <p id={descriptionId}>{definition.description}</p>
        {error ? <small className="field-error" id={errorId}>{error}</small> : null}
      </div>
    );
  }

  return (
    <div className="factor-field range-field" data-factor-id={definition.id}>
      <div className="range-field__label">
        <label htmlFor={inputId}>{definition.label}</label>
        <span>
          {definition.min ?? 0}-{definition.max ?? 100}{definition.unit ? ` ${definition.unit}` : ""}
        </span>
      </div>
      <div className="range-field__controls">
        <input
          id={inputId}
          type="range"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={numericValue}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={describedBy}
          disabled={disabled}
        />
        <input
          type="number"
          aria-label={`${definition.label}精确数值`}
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={numericValue}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
        />
        {definition.unit ? <span>{definition.unit}</span> : null}
      </div>
      <p id={descriptionId}>{definition.description}</p>
      {error ? <small className="field-error" id={errorId}>{error}</small> : null}
    </div>
  );
}

export function FactorPanel({
  config,
  factors,
  errors = {},
  disabled = false,
  onChange,
}: FactorPanelProps) {
  const orderedGroups = [...config.factorGroups].sort((a, b) => a.order - b.order);

  return (
    <section className="panel factor-panel" aria-labelledby="factors-title">
      <div className="panel__header panel__header--ornate">
        <h2 id="factors-title">炼制属性</h2>
        <span>配置驱动</span>
      </div>

      <div className="factor-groups">
        {orderedGroups.map((group) => {
          const groupFactors = config.factors.filter((factor) => (
            factor.groupId === group.id && visibilityMatches(factor.visibilityCondition, factors)
          ));
          if (!groupFactors.length) return null;
          return (
            <details className="factor-group" key={group.id} open>
              <summary>
                <span>{group.name}</span>
                <small>{groupFactors.length} 项</small>
              </summary>
              <fieldset>
                <legend className="sr-only">{group.name}</legend>
                <p className="factor-group__description">{group.description}</p>
                <div className="factor-group__fields">
                  {groupFactors.map((factor) => (
                    <FactorField
                      key={factor.id}
                      definition={factor}
                      config={config}
                      value={factors[factor.id] ?? factor.defaultValue}
                      error={errors[factor.id]}
                      disabled={disabled}
                      onChange={(value) => onChange(factor.id, value)}
                    />
                  ))}
                </div>
              </fieldset>
            </details>
          );
        })}
      </div>

    </section>
  );
}
