import type {
  M1BehaviorMetadata,
  M1OverlayMode,
  M1ScenarioMetadata,
  M1Snapshot,
} from '../game/m1/contracts.ts'

import './m1-workbench.css'

export interface CreateM1WorkbenchOptions {
  readonly root: HTMLElement
  readonly scenarios: readonly M1ScenarioMetadata[]
  readonly behaviors: readonly M1BehaviorMetadata[]
  readonly initialScenarioId: string
  readonly initialOverlayMode: M1OverlayMode
  readonly simulationContentFingerprint: string
  readonly onScenarioChange: (scenarioId: string) => void
  readonly onOverlayChange: (mode: M1OverlayMode) => void
}

export interface M1WorkbenchHandle {
  readonly gameHost: HTMLElement
  update(snapshot: M1Snapshot): void
  destroy(): void
}

const OVERLAY_LABELS: Readonly<Record<M1OverlayMode, string>> = Object.freeze({
  fire: '火焰',
  reachable: '可达区',
  direction: '方向',
  obstacle: '障碍',
  timing: '耗时',
  none: '关闭',
})

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  return element
}

function appendMetric(
  document: Document,
  list: HTMLDListElement,
  label: string,
  key: string,
): HTMLElement {
  const group = createElement(document, 'div', 'm1-metric')
  const term = document.createElement('dt')
  term.textContent = label
  const value = document.createElement('dd')
  value.dataset.metric = key
  value.textContent = '0'
  group.append(term, value)
  list.append(group)
  return value
}

export function createM1Workbench(
  options: CreateM1WorkbenchOptions,
): M1WorkbenchHandle {
  const document = options.root.ownerDocument
  const workbench = createElement(document, 'div', 'm1-workbench')
  workbench.dataset.m1Workbench = ''

  const header = createElement(document, 'header', 'm1-header')
  const headingGroup = createElement(document, 'div', 'm1-header__heading')
  const kicker = createElement(document, 'p', 'm1-header__kicker')
  kicker.textContent = '炼丹萃取原型 / M1'
  const title = document.createElement('h1')
  title.textContent = '火流技术验证台'
  headingGroup.append(kicker, title)
  const headerStatus = createElement(document, 'p', 'm1-header__status')
  headerStatus.dataset.runtimeStatus = ''
  headerStatus.textContent = '正在建立固定步场景'
  header.append(headingGroup, headerStatus)

  const layout = createElement(document, 'div', 'm1-layout')
  const stage = createElement(document, 'main', 'm1-stage')
  stage.setAttribute('aria-label', '火流场景画布')
  const gameHost = createElement(document, 'div', 'game-shell')
  gameHost.dataset.gameHost = ''
  gameHost.dataset.simulationContentFingerprint =
    options.simulationContentFingerprint
  stage.append(gameHost)

  const panel = createElement(document, 'aside', 'm1-panel')
  panel.dataset.m1Panel = ''
  panel.setAttribute('aria-label', 'M1 技术控制与指标')

  const guideSection = createElement(
    document,
    'section',
    'm1-panel__section m1-guide',
  )
  const guideHeading = document.createElement('h2')
  guideHeading.textContent = '你正在看什么'
  const guideSummary = createElement(document, 'p', 'm1-guide__summary')
  guideSummary.dataset.scenarioSummary = ''
  guideSummary.textContent =
    options.scenarios.find((scenario) => scenario.id === options.initialScenarioId)
      ?.summaryZh ?? '观察火流如何绕过障碍并继续向上。'
  const guideLegend = createElement(document, 'dl', 'm1-guide__legend')
  for (const [termText, description] of [
    ['运动火流', '火真正前进的方向'],
    ['灰色物体', '火无法穿过的障碍'],
    ['暗区', '当前没有火到达的区域'],
  ] as const) {
    const row = createElement(document, 'div', 'm1-guide__legend-row')
    const term = document.createElement('dt')
    term.textContent = termText
    const detail = document.createElement('dd')
    detail.textContent = description
    row.append(term, detail)
    guideLegend.append(row)
  }
  guideSection.append(guideHeading, guideSummary, guideLegend)

  const sceneSection = createElement(document, 'section', 'm1-panel__section')
  const sceneHeading = document.createElement('h2')
  sceneHeading.textContent = '场景'
  const visualSceneLabel = createElement(
    document,
    'p',
    'm1-control-group__label',
  )
  visualSceneLabel.textContent = '正常水滴珠尺度'
  const visualSceneButtons = createElement(document, 'div', 'm1-control-grid')
  visualSceneButtons.dataset.scenarioGroup = 'visual'
  visualSceneButtons.setAttribute('role', 'group')
  visualSceneButtons.setAttribute('aria-label', '正常水滴珠尺度场景')
  const performanceSceneLabel = createElement(
    document,
    'p',
    'm1-control-group__label',
  )
  performanceSceneLabel.textContent = '性能基准（小圆代理）'
  const performanceSceneButtons = createElement(
    document,
    'div',
    'm1-control-grid',
  )
  performanceSceneButtons.dataset.scenarioGroup = 'performance'
  performanceSceneButtons.setAttribute('role', 'group')
  performanceSceneButtons.setAttribute('aria-label', '小圆代理性能基准')

  const overlaySection = createElement(document, 'section', 'm1-panel__section')
  const overlayHeading = document.createElement('h2')
  overlayHeading.textContent = '展示与调试'
  const overlayButtons = createElement(document, 'div', 'm1-control-grid')
  overlayButtons.setAttribute('role', 'group')
  overlayButtons.setAttribute('aria-label', '流场覆盖层')

  const listeners: Array<{
    element: HTMLButtonElement
    listener: () => void
  }> = []
  const scenarioButtonById = new Map<string, HTMLButtonElement>()
  const overlayButtonByMode = new Map<M1OverlayMode, HTMLButtonElement>()

  for (const scenario of options.scenarios) {
    const button = createElement(document, 'button', 'm1-control')
    button.type = 'button'
    button.dataset.scenarioId = scenario.id
    button.textContent = scenario.labelZh
    button.setAttribute(
      'aria-pressed',
      String(scenario.id === options.initialScenarioId),
    )
    const listener = (): void => options.onScenarioChange(scenario.id)
    button.addEventListener('click', listener)
    listeners.push({ element: button, listener })
    scenarioButtonById.set(scenario.id, button)
    const group =
      scenario.kind === 'performance'
        ? performanceSceneButtons
        : visualSceneButtons
    group.append(button)
  }
  sceneSection.append(
    sceneHeading,
    visualSceneLabel,
    visualSceneButtons,
    performanceSceneLabel,
    performanceSceneButtons,
  )

  for (const mode of Object.keys(OVERLAY_LABELS) as M1OverlayMode[]) {
    const button = createElement(document, 'button', 'm1-control')
    button.type = 'button'
    button.dataset.overlayMode = mode
    button.textContent = OVERLAY_LABELS[mode]
    button.setAttribute('aria-pressed', String(mode === options.initialOverlayMode))
    const listener = (): void => options.onOverlayChange(mode)
    button.addEventListener('click', listener)
    listeners.push({ element: button, listener })
    overlayButtonByMode.set(mode, button)
    overlayButtons.append(button)
  }
  overlaySection.append(overlayHeading, overlayButtons)

  const metricsSection = createElement(document, 'section', 'm1-panel__section')
  const metricsHeading = document.createElement('h2')
  metricsHeading.textContent = '运行指标'
  const metrics = createElement(document, 'dl', 'm1-metrics')
  const metricNodes = {
    fps: appendMetric(document, metrics, 'FPS', 'fps'),
    tickHz: appendMetric(document, metrics, 'Tick Hz', 'tick-hz'),
    flow: appendMetric(document, metrics, '流场耗时', 'flow-duration'),
    active: appendMetric(document, metrics, '活动珠', 'active-count'),
    generation: appendMetric(document, metrics, '场代次', 'generation'),
    tick: appendMetric(document, metrics, '提交 Tick', 'tick'),
    dropped: appendMetric(document, metrics, '丢弃 Tick', 'dropped-ticks'),
    seed: appendMetric(document, metrics, 'Seed', 'seed'),
  }
  metricsSection.append(metricsHeading, metrics)

  const evidenceSection = createElement(document, 'section', 'm1-panel__section')
  const evidenceHeading = document.createElement('h2')
  evidenceHeading.textContent = '可视行为证据'
  const behaviorList = createElement(document, 'ul', 'm1-behaviors')
  const behaviorItems = new Map<string, HTMLLIElement>()
  for (const behavior of options.behaviors) {
    const item = createElement(document, 'li', 'm1-behavior')
    item.dataset.behaviorId = behavior.id
    item.dataset.behaviorScenario = behavior.scenarioId
    const label = document.createElement('span')
    label.textContent = behavior.labelZh
    const scenarioLabel = document.createElement('small')
    scenarioLabel.textContent =
      options.scenarios.find((scenario) => scenario.id === behavior.scenarioId)
        ?.labelZh ?? behavior.scenarioId
    item.append(label, scenarioLabel)
    behaviorItems.set(behavior.id, item)
    behaviorList.append(item)
  }
  evidenceSection.append(evidenceHeading, behaviorList)

  const fingerprintSection = createElement(
    document,
    'section',
    'm1-panel__section m1-fingerprint',
  )
  const fingerprintHeading = document.createElement('h2')
  fingerprintHeading.textContent = '配置指纹'
  const fingerprint = document.createElement('code')
  fingerprint.dataset.fingerprint = ''
  fingerprint.textContent = options.simulationContentFingerprint
  fingerprint.title = options.simulationContentFingerprint
  fingerprintSection.append(fingerprintHeading, fingerprint)

  panel.append(
    guideSection,
    sceneSection,
    overlaySection,
    metricsSection,
    evidenceSection,
    fingerprintSection,
  )
  layout.append(stage, panel)
  workbench.append(header, layout)
  options.root.replaceChildren(workbench)

  function update(snapshot: M1Snapshot): void {
    headerStatus.textContent = snapshot.ready
      ? `运行中 / ${snapshot.scenarioId}`
      : `正在载入 / ${snapshot.scenarioId}`
    headerStatus.dataset.ready = String(snapshot.ready)
    for (const [id, button] of scenarioButtonById) {
      button.setAttribute('aria-pressed', String(id === snapshot.scenarioId))
    }
    for (const [mode, button] of overlayButtonByMode) {
      button.setAttribute('aria-pressed', String(mode === snapshot.overlayMode))
    }
    for (const item of behaviorItems.values()) {
      item.dataset.active = String(
        item.dataset.behaviorScenario === snapshot.scenarioId,
      )
    }
    metricNodes.fps.textContent = snapshot.fps.toFixed(0)
    metricNodes.tickHz.textContent = snapshot.tickHz.toFixed(0)
    metricNodes.flow.textContent = `${snapshot.lastFlowDurationMs.toFixed(3)} ms`
    metricNodes.active.textContent = String(snapshot.activePearlCount)
    metricNodes.generation.textContent = `${snapshot.fieldGeneration} / ${snapshot.renderedGeneration}`
    metricNodes.tick.textContent = `${snapshot.lastCommittedTick} / ${snapshot.nextTick}`
    metricNodes.dropped.textContent = String(snapshot.droppedTickCount)
    metricNodes.seed.textContent = String(snapshot.seed)
    panel.dataset.scenarioId = snapshot.scenarioId
    panel.dataset.overlayMode = snapshot.overlayMode
    panel.dataset.fieldGeneration = String(snapshot.fieldGeneration)
    panel.dataset.renderedGeneration = String(snapshot.renderedGeneration)
    panel.dataset.flowDigest = snapshot.flowDigest
    guideSummary.textContent =
      options.scenarios.find((scenario) => scenario.id === snapshot.scenarioId)
        ?.summaryZh ?? '观察火流如何绕过障碍并继续向上。'
  }

  return {
    gameHost,
    update,
    destroy: () => {
      for (const { element, listener } of listeners) {
        element.removeEventListener('click', listener)
      }
    },
  }
}
