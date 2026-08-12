import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AlchemyConfig, MaterialInput } from "../domain/types";
import { EntityIcon } from "./EntityIcon";

interface RecipePanelProps {
  config: AlchemyConfig;
  materials: MaterialInput[];
  selectedSlotId: string;
  validationSummary?: string | undefined;
  resultIsStale?: boolean;
  disabled?: boolean;
  onSelectSlot: (slotId: string) => void;
  onAssign: (slotOrder: number, materialId: string, quantity: number, mode: "increment" | "set") => void;
  onDecrement: (slotOrder: number) => void;
  onClear: (slotOrder: number) => void;
  onRun: () => void;
}

interface PendingDrop {
  slotOrder: number;
  materialId: string;
  quantity: number;
  max: number;
  top: number;
  left: number;
  moveFromLabel?: string | undefined;
}

export function RecipePanel({
  config,
  materials,
  selectedSlotId,
  validationSummary,
  resultIsStale = false,
  disabled = false,
  onSelectSlot,
  onAssign,
  onDecrement,
  onClear,
  onRun,
}: RecipePanelProps) {
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const slots = useMemo(
    () => [...(Array.isArray(config.recipeSlots) ? config.recipeSlots : [])]
      .sort((left, right) => left.order - right.order),
    [config.recipeSlots],
  );
  const materialByOrder = useMemo(
    () => new Map(materials.map((material) => [material.order, material])),
    [materials],
  );
  const definitionById = useMemo(
    () => new Map(config.materials.map((material) => [material.id, material])),
    [config.materials],
  );
  const inventoryById = useMemo(
    () => new Map((Array.isArray(config.inventory) ? config.inventory : [])
      .map((entry) => [entry.materialId, entry.quantity])),
    [config.inventory],
  );
  const pendingDefinition = pendingDrop ? definitionById.get(pendingDrop.materialId) : undefined;

  useEffect(() => {
    if (!pendingDrop) return;
    const frame = window.requestAnimationFrame(() => quantityInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingDrop]);

  function openQuantityDialog(slotOrder: number, materialId: string, clientX: number, clientY: number) {
    const max = inventoryById.get(materialId) ?? 0;
    if (max < 1) return;
    const existing = materials.find((material) => material.materialId === materialId);
    const moveFromLabel = existing && existing.order !== slotOrder
      ? slots.find((slot) => slot.order === existing.order)?.label
      : undefined;
    const width = 286;
    const height = 210;
    setPendingDrop({
      slotOrder,
      materialId,
      quantity: Math.min(3, max),
      max,
      moveFromLabel,
      left: Math.max(12, Math.min(clientX + 14, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(clientY - 24, window.innerHeight - height - 12)),
    });
  }

  return (
    <section className="panel recipe-panel" aria-labelledby="recipe-title">
      <div className="panel__header panel__header--ornate">
        <h2 id="recipe-title">丹方配伍</h2>
        <span>{materials.length}/6 槽</span>
      </div>

      <div className="recipe-slots" aria-label="丹方六个固定槽位">
        {slots.map((slot) => {
          const input = materialByOrder.get(slot.order);
          const definition = input ? definitionById.get(input.materialId) : undefined;
          const selected = selectedSlotId === slot.id;
          const dragOver = dragOverSlotId === slot.id;
          return (
            <article
              key={slot.id}
              id={definition ? `material-${definition.id}` : undefined}
              className={`recipe-slot recipe-slot--${slot.role}${selected ? " recipe-slot--selected" : ""}${dragOver ? " recipe-slot--drag-over" : ""}`}
              data-slot-id={slot.id}
              onDragOver={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragOverSlotId(slot.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverSlotId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverSlotId(null);
                if (disabled) return;
                const materialId = event.dataTransfer.getData("application/x-alchemy-material")
                  || event.dataTransfer.getData("text/plain");
                if (!definitionById.has(materialId)) return;
                onSelectSlot(slot.id);
                openQuantityDialog(slot.order, materialId, event.clientX, event.clientY);
              }}
            >
              <button
                type="button"
                className="recipe-slot__select"
                aria-label={definition
                  ? `${slot.label}，${definition.name}，数量 ${input?.quantity ?? 0}`
                  : `${slot.label}，空槽，点击选择`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelectSlot(slot.id)}
              >
                <span className="recipe-slot__label">{slot.label}</span>
                {definition && input ? (
                  <>
                    <EntityIcon src={definition.icon} name={definition.name} size="slot" />
                    <strong>{definition.name}</strong>
                    <span className="recipe-slot__quantity">投入 {input.quantity}</span>
                  </>
                ) : (
                  <>
                    <span className="recipe-slot__empty-mark" aria-hidden="true">丹</span>
                    <strong>点击选择药材</strong>
                    <span className="recipe-slot__quantity">或拖拽到此处</span>
                  </>
                )}
              </button>
              {definition && input ? (
                <div className="recipe-slot__actions">
                  <button
                    type="button"
                    aria-label={`${slot.label}${definition.name}减少一份`}
                    title="减少一份"
                    onClick={() => onDecrement(slot.order)}
                    disabled={disabled}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    aria-label={`清空${slot.label}`}
                    title="清空槽位"
                    onClick={() => onClear(slot.order)}
                    disabled={disabled}
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="recipe-runbar">
        <div aria-live="polite">
          {validationSummary ? (
            <span className="recipe-runbar__error">{validationSummary}</span>
          ) : resultIsStale ? (
            <span className="recipe-runbar__stale">配伍或属性已改变，结果待重新推演</span>
          ) : (
            <span>选择槽位后点击背包可逐份添加，拖拽可批量放入</span>
          )}
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={onRun}
          disabled={disabled || Boolean(validationSummary)}
          data-testid="simulate-button"
        >
          推演成丹
        </button>
      </div>

      {pendingDrop && pendingDefinition ? createPortal(
        <div
          className="quantity-popover-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDrop(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPendingDrop(null);
          }}
        >
          <div
            className="quantity-popover"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quantity-dialog-title"
            style={{ top: pendingDrop.top, left: pendingDrop.left }}
          >
            <div className="quantity-popover__heading">
              <div>
                <span>批量投放</span>
                <strong id="quantity-dialog-title">{pendingDefinition.name}</strong>
              </div>
              <button type="button" aria-label="取消放入" onClick={() => setPendingDrop(null)}>×</button>
            </div>
            {pendingDrop.moveFromLabel ? (
              <p className="quantity-popover__note">
                已在{pendingDrop.moveFromLabel}，确认后将移动到当前槽位；数量表示总投入量。
              </p>
            ) : null}
            <label htmlFor="drop-quantity">放入数量</label>
            <div className="quantity-popover__controls">
              <button
                type="button"
                aria-label="数量减一"
                onClick={() => setPendingDrop((current) => current
                  ? { ...current, quantity: Math.max(1, current.quantity - 1) }
                  : current)}
              >
                -
              </button>
              <input
                id="drop-quantity"
                type="range"
                min={1}
                max={pendingDrop.max}
                step={1}
                value={pendingDrop.quantity}
                onChange={(event) => setPendingDrop({ ...pendingDrop, quantity: Number(event.target.value) })}
              />
              <button
                type="button"
                aria-label="数量加一"
                onClick={() => setPendingDrop((current) => current
                  ? { ...current, quantity: Math.min(current.max, current.quantity + 1) }
                  : current)}
              >
                +
              </button>
            </div>
            <input
              ref={quantityInputRef}
              className="quantity-popover__number"
              type="number"
              aria-label="放入数量精确值"
              min={1}
              max={pendingDrop.max}
              value={pendingDrop.quantity}
              onChange={(event) => setPendingDrop({
                ...pendingDrop,
                quantity: Math.max(1, Math.min(pendingDrop.max, Number(event.target.value))),
              })}
            />
            <button
              type="button"
              className="button button--primary quantity-popover__confirm"
              onClick={() => {
                onAssign(pendingDrop.slotOrder, pendingDrop.materialId, pendingDrop.quantity, "set");
                setPendingDrop(null);
              }}
            >
              确认放入
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
