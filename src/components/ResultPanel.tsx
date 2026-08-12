import { forwardRef, useMemo, useState } from "react";
import type {
  AlchemyConfig,
  CandidateResult,
  EffectResult,
  Quality,
  ReasonItem,
  SimulationResult,
  TraitResult,
} from "../domain/types";
import { EntityIcon } from "./EntityIcon";

interface ResultPanelProps {
  config: AlchemyConfig;
  result: SimulationResult | null;
  stale?: boolean;
  configErrors?: string[];
  executionError?: string | null;
  onLocateEvidence?: (factorId?: string, materialId?: string) => void;
}

const qualityNames: Record<Quality, string> = {
  lower: "下品",
  middle: "中品",
  upper: "上品",
  supreme: "极品",
};

const formNames = {
  pill: "丹丸",
  powder: "药散",
  liquid: "灵液",
} as const;

const phaseNames: Record<ReasonItem["phase"], string> = {
  identity: "身份判定",
  quality: "品质原因",
  modifier: "结果修正",
  formation: "成形依据",
  danger: "危险判断",
};

const phaseOrder: ReasonItem["phase"][] = ["identity", "quality", "modifier", "formation", "danger"];

function valueText(value: number | string | boolean | undefined) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function TechnicalError({ diagnostics }: { diagnostics: string[] }) {
  const [copyState, setCopyState] = useState("复制诊断信息");
  const diagnosticText = diagnostics.join("\n") || "未提供诊断信息。";

  async function copyDiagnostics() {
    try {
      if (!navigator.clipboard) throw new Error("当前浏览器不支持剪贴板接口");
      await navigator.clipboard.writeText(diagnosticText);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败，请手动选择");
    }
  }

  return (
    <div className="technical-error" role="alert">
      <p className="result-kicker">技术错误</p>
      <h3>规则配置或执行异常</h3>
      <p>这不是炼制失败。请修复配置冲突、非法引用或执行异常后再推演。</p>
      <pre tabIndex={0}>{diagnosticText}</pre>
      <button type="button" className="button button--quiet" onClick={copyDiagnostics}>{copyState}</button>
    </div>
  );
}

function Metrics({ result, config }: { result: SimulationResult; config: AlchemyConfig }) {
  const metrics = [
    {
      id: "danger",
      label: "危险分",
      value: result.metrics.danger,
      note: `炸炉阈值 ${config.scoreModels.thresholds.explosion}`,
    },
    {
      id: "formation",
      label: "成形分",
      value: result.metrics.formation,
      note: `成形阈值 ${config.scoreModels.thresholds.formation}`,
    },
    ...(result.metrics.quality === undefined ? [] : [{
      id: "quality",
      label: "品质分",
      value: result.metrics.quality,
      note: "品质阈值由配置决定",
    }]),
  ];

  return (
    <dl className="metric-grid" aria-label="本次推演指标">
      {metrics.map((metric) => (
        <div key={metric.id} data-testid={`metric-${metric.id}`}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
          <small>{metric.note}</small>
        </div>
      ))}
    </dl>
  );
}

function ReasonCard({
  reason,
  onLocateEvidence,
}: {
  reason: ReasonItem;
  onLocateEvidence?: ResultPanelProps["onLocateEvidence"];
}) {
  const canLocate = Boolean(reason.relatedFactorId || reason.relatedMaterialId);
  const content = (
    <>
      <div className="reason-card__heading">
        <span className={`reason-tone reason-tone--${reason.tone}`}>
          {reason.tone === "positive" ? "提升" : reason.tone === "negative" ? "降低" : "依据"}
        </span>
        <code>{reason.code}</code>
      </div>
      <strong>{reason.title}</strong>
      <p>{reason.detail}</p>
      {(reason.actual !== undefined || reason.expected || reason.impact !== undefined) ? (
        <dl className="reason-values">
          {reason.actual !== undefined ? <div><dt>实际</dt><dd>{valueText(reason.actual)}</dd></div> : null}
          {reason.expected ? <div><dt>要求</dt><dd>{reason.expected}</dd></div> : null}
          {reason.impact !== undefined ? <div><dt>影响</dt><dd>{reason.impact > 0 ? `+${reason.impact}` : reason.impact}</dd></div> : null}
        </dl>
      ) : null}
      {canLocate ? <span className="reason-card__locate">定位相关输入</span> : null}
    </>
  );

  return canLocate ? (
    <button
      type="button"
      className="reason-card reason-card--button"
      onClick={() => onLocateEvidence?.(reason.relatedFactorId, reason.relatedMaterialId)}
    >
      {content}
    </button>
  ) : <article className="reason-card">{content}</article>;
}

function Reasons({
  reasons,
  onLocateEvidence,
}: {
  reasons: ReasonItem[];
  onLocateEvidence?: ResultPanelProps["onLocateEvidence"];
}) {
  if (!reasons.length) {
    return <p className="compact-empty">本次结果没有返回结构化原因。</p>;
  }

  return (
    <div className="reason-groups">
      {phaseOrder.map((phase) => {
        const phaseReasons = reasons.filter((reason) => reason.phase === phase);
        if (!phaseReasons.length) return null;
        return (
          <section className="reason-group" key={phase} aria-labelledby={`reason-phase-${phase}`}>
            <h4 id={`reason-phase-${phase}`}>{phaseNames[phase]}</h4>
            <div className="reason-group__list">
              {phaseReasons.map((reason, index) => (
                <ReasonCard
                  key={`${reason.code}-${reason.sourceId}-${index}`}
                  reason={reason}
                  onLocateEvidence={onLocateEvidence}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EffectRow({ effect, label }: { effect: EffectResult; label: string }) {
  return (
    <article className="effect-row">
      <div>
        <span>{label}</span>
        <strong>{effect.name}</strong>
      </div>
      <output>{effect.value}{effect.unit}</output>
      <p>{effect.description}</p>
      {effect.sourceRuleIds.length ? <code>来源 {effect.sourceRuleIds.join(", ")}</code> : null}
    </article>
  );
}

function TraitRow({ trait }: { trait: TraitResult }) {
  return (
    <article className="trait-row">
      <strong>{trait.name}</strong>
      <p>{trait.description}</p>
      {trait.sourceRuleIds.length ? <code>来源 {trait.sourceRuleIds.join(", ")}</code> : null}
    </article>
  );
}

function Candidate({ candidate }: { candidate: CandidateResult }) {
  const evidence = candidate.matched ? candidate.conditions : candidate.missingConditions;
  return (
    <details className={`candidate candidate--${candidate.matched ? "matched" : "missed"}`}>
      <summary>
        <span>
          <strong>{candidate.name}</strong>
          <small>{candidate.matched ? "已命中" : "未命中"}</small>
        </span>
        <span className="candidate__score">{candidate.satisfiedCount}/{candidate.totalCount}</span>
      </summary>
      <dl className="candidate__meta">
        <div><dt>优先级</dt><dd>{candidate.priority}</dd></div>
        <div><dt>特异度</dt><dd>{candidate.specificity}</dd></div>
        <div><dt>规则 ID</dt><dd><code>{candidate.prototypeId}</code></dd></div>
      </dl>
      {evidence.length ? (
        <ul className="evidence-list">
          {evidence.map((condition, index) => (
            <li key={`${condition.code}-${index}`}>
              <span className={condition.matched ? "evidence-state evidence-state--match" : "evidence-state evidence-state--miss"}>
                {condition.matched ? "满足" : "未满足"}
              </span>
              <div>
                <strong>{condition.description}</strong>
                {(condition.actual !== undefined || condition.expected) ? (
                  <small>
                    {condition.actual !== undefined ? `实际 ${valueText(condition.actual)}` : ""}
                    {condition.actual !== undefined && condition.expected ? "，" : ""}
                    {condition.expected ? `要求 ${condition.expected}` : ""}
                  </small>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="compact-empty">没有额外条件证据。</p>}
    </details>
  );
}

export const ResultPanel = forwardRef<HTMLHeadingElement, ResultPanelProps>(function ResultPanel({
  config,
  result,
  stale = false,
  configErrors = [],
  executionError = null,
  onLocateEvidence,
}, ref) {
  const technicalDiagnostics = useMemo(() => [
    ...configErrors,
    ...(executionError ? [executionError] : []),
    ...(result?.status === "config_error" ? result.diagnostics : []),
  ], [configErrors, executionError, result]);

  const failureDefinition = result && result.status !== "success"
    ? config.failureResults.find((item) => item.id === result.status)
    : undefined;
  const evaluationNames = result?.pill?.evaluations.map((evaluationId) => (
    config.evaluations.find((item) => item.id === evaluationId)?.name ?? evaluationId
  )) ?? [];
  const resultAnnouncement = technicalDiagnostics.length
    ? "配置或执行发生错误，请查看诊断信息"
    : result?.status === "success" && result.pill
      ? `成丹成功，${result.pill.name}，${qualityNames[result.pill.quality]}，共 ${result.pill.quantity} 份`
      : result
        ? `推演完成，${failureDefinition?.name ?? (result.status === "exploded" ? "炸炉" : "未成丹")}`
        : "等待第一次推演";

  return (
    <section className="panel result-panel" aria-labelledby="result-title" aria-busy="false">
      <div className="panel__header result-panel__header">
        <div>
          <p className="panel__index">输出</p>
          <h2 id="result-title" ref={ref} tabIndex={-1} aria-live="polite" aria-atomic="true">
            成丹结果<span className="sr-only">：{resultAnnouncement}</span>
          </h2>
        </div>
        {stale ? <span className="stale-badge">结果已过期</span> : null}
      </div>

      {stale ? (
        <div className="stale-banner" role="status">
          当前结果仍对应上一次输入。重新推演后才会更新。
        </div>
      ) : null}

      {technicalDiagnostics.length ? (
        <TechnicalError diagnostics={technicalDiagnostics} />
      ) : !result ? (
        <div className="result-empty">
          <div className="result-empty__seal" aria-hidden="true">丹</div>
          <h3>等待第一次推演</h3>
          <p>选择药材并调整因素，然后点击“推演成丹”。这里会显示最终丹药、品质原因和候选缺失条件。</p>
          <span>不会播放或要求操作中间炼制过程</span>
        </div>
      ) : (
        <div className={stale ? "result-content result-content--stale" : "result-content"}>
          {result.status === "success" && result.pill ? (
            <div className="result-summary result-summary--success">
              <EntityIcon src={result.pill.icon} name={result.pill.name} size="large" />
              <div className="result-summary__title">
                <p className="result-kicker">成丹成功</p>
                <h3>{result.pill.name}</h3>
                <div className="result-badges">
                  <span>{qualityNames[result.pill.quality]}</span>
                  <span>{formNames[result.pill.form]}</span>
                  <span>{result.pill.quantity} 份</span>
                  {evaluationNames.map((name) => <span key={name}>{name}</span>)}
                  {result.pill.mutated ? <span>受约束异变</span> : null}
                </div>
              </div>
              <dl className="result-summary__meta">
                <div><dt>品质分</dt><dd data-testid="result-quality">{result.pill.qualityScore}</dd></div>
                <div><dt>品级</dt><dd>{result.pill.grade}</dd></div>
                <div><dt>种子</dt><dd>{result.seed}</dd></div>
              </dl>
            </div>
          ) : (
            <div className={`result-summary result-summary--${result.status}`}>
              {failureDefinition?.icon ? (
                <EntityIcon src={failureDefinition.icon} name={failureDefinition.name} size="large" />
              ) : (
                <div className="result-summary__status-mark" aria-hidden="true">
                  {result.status === "exploded" ? "危" : "散"}
                </div>
              )}
              <div className="result-summary__title">
                <p className="result-kicker">领域结果</p>
                <h3>{failureDefinition?.name ?? (result.status === "exploded" ? "炸炉" : "未成丹")}</h3>
                <p>{failureDefinition?.description ?? "本次输入没有形成可命名的正式丹药。"}</p>
              </div>
              <dl className="result-summary__meta">
                <div><dt>状态</dt><dd>{result.status === "exploded" ? "危险越界" : "成形失败"}</dd></div>
                <div><dt>种子</dt><dd>{result.seed}</dd></div>
              </dl>
            </div>
          )}

          <details className="result-details">
            <summary>查看完整判定依据</summary>
            <div className="result-details__body">
              <Metrics result={result} config={config} />

              {result.pill ? (
                <section className="result-section" aria-labelledby="effects-title">
                  <div className="result-section__heading">
                    <h3 id="effects-title">功效与特质</h3>
                    <span>每项保留配置来源</span>
                  </div>
                  <div className="effect-list">
                    <EffectRow effect={result.pill.primaryEffect} label="主功效" />
                    {result.pill.secondaryEffects.map((effect) => <EffectRow key={effect.id} effect={effect} label="次要功效" />)}
                    {result.pill.sideEffects.map((effect) => <EffectRow key={effect.id} effect={effect} label="副作用" />)}
                    {result.pill.traits.map((trait) => <TraitRow key={trait.id} trait={trait} />)}
                  </div>
                </section>
              ) : null}

              <section className="result-section" aria-labelledby="reasons-title">
                <div className="result-section__heading">
                  <h3 id="reasons-title">最终判定依据</h3>
                  <span>按语义分组，不是过程时间线</span>
                </div>
                <Reasons reasons={result.reasons} onLocateEvidence={onLocateEvidence} />
              </section>

              <section className="result-section" aria-labelledby="candidates-title">
                <div className="result-section__heading">
                  <h3 id="candidates-title">候选分析</h3>
                  <span>命中身份与最接近的缺失条件</span>
                </div>
                <div className="candidate-list">
                  {result.candidates.length
                    ? result.candidates.map((candidate) => <Candidate key={candidate.prototypeId} candidate={candidate} />)
                    : <p className="compact-empty">没有返回丹药候选。</p>}
                </div>
              </section>

              {result.diagnostics.length ? (
                <details className="diagnostics">
                  <summary>查看补充诊断</summary>
                  <pre>{result.diagnostics.join("\n")}</pre>
                </details>
              ) : null}
            </div>
          </details>
        </div>
      )}
    </section>
  );
});
