import { useRef } from "react";
import type { SimulationPreset } from "../domain/types";

interface WorkbenchToolbarProps {
  configVersion: string;
  presets: SimulationPreset[];
  selectedPresetId: string;
  seed: number | string;
  disabled?: boolean;
  notice?: { tone: "error" | "success" | "neutral"; text: string } | null;
  onPresetChange: (presetId: string) => void;
  onSeedChange: (seed: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
}

export function WorkbenchToolbar({
  configVersion,
  presets,
  selectedPresetId,
  seed,
  disabled = false,
  notice,
  onPresetChange,
  onSeedChange,
  onExport,
  onImport,
  onReset,
}: WorkbenchToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <div className="brand-mark" aria-hidden="true">丹</div>
        <div>
          <h1>炼丹规则推演台</h1>
          <p>配置 {configVersion}</p>
        </div>
      </div>

      <div className="toolbar__controls">
        <label className="toolbar-field toolbar-field--preset">
          <span>测试预设</span>
          <select
            value={selectedPresetId}
            disabled={disabled}
            onChange={(event) => onPresetChange(event.target.value)}
            data-testid="preset-select"
          >
            <option value="">自定义输入</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </label>

        <label className="toolbar-field toolbar-field--seed">
          <span>随机种子</span>
          <input
            type="number"
            inputMode="numeric"
            value={seed}
            disabled={disabled}
            onChange={(event) => onSeedChange(event.target.value)}
            aria-describedby="seed-help"
            data-testid="seed-input"
          />
          <span id="seed-help" className="sr-only">使用整数，相同输入和种子会得到相同结果</span>
        </label>

        <div className="toolbar__actions" aria-label="输入输出操作">
          <button type="button" className="button button--quiet" onClick={onExport} disabled={disabled}>导出案例</button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            导入输入
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="选择要导入的 JSON 输入文件"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }}
          />
          <button type="button" className="button button--quiet" onClick={onReset} disabled={disabled}>恢复默认</button>
        </div>
      </div>

      {notice ? (
        <p className={`toolbar-notice toolbar-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </header>
  );
}
