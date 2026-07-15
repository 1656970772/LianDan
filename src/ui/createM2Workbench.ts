import './m2-workbench.css'

export type M2WorkbenchStatus =
  | 'ready'
  | 'extracting'
  | 'failed'
  | 'completed'

export type M2RestartConfirmation = 'closed' | 'open'

export interface M2FireSourceView {
  readonly id: string
  readonly nameZh: string
  readonly descriptionZh?: string
}

export interface M2InventoryBatchView {
  readonly batchId: string
  readonly materialDefinitionId: string
  readonly nameZh: string
  readonly servings: number
  readonly imagePath?: string
}

export interface M2FireSizeRange {
  readonly min: number
  readonly max: number
}

export interface M2WorkbenchModel {
  readonly sessionId: string
  readonly status: M2WorkbenchStatus
  readonly tick: number
  readonly fireSources: readonly M2FireSourceView[]
  readonly equippedFireSourceId: string | null
  readonly fireSize: number
  readonly fireSizeRange: M2FireSizeRange
  readonly isSpraying: boolean
  readonly flameThrustEnabled: boolean
  readonly canFinish: boolean
  readonly lossWarningLevel: 0 | 1 | 2
  readonly caughtVolumes: Readonly<{
    medicinalLiquid: number
    slag: number
    impurity: number
  }>
  readonly normalSlagQuantity: number
  readonly failureResult: Readonly<{
    reason: 'excessiveMedicinalLoss'
    remainingEntityVolume: number
    slagQuantity: number
  }> | null
  readonly paused: boolean
  readonly restartConfirmation: M2RestartConfirmation
  readonly inventory: readonly M2InventoryBatchView[]
  readonly selectedMaterialBatchId: string | null
  readonly materialRemaining: number
  readonly activePearlCount: number
  readonly caughtPearlCount: number
}

export interface M2WorkbenchTheme {
  readonly background: string
  readonly surface: string
  readonly surfaceRaised: string
  readonly border: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly accentInk: string
  readonly radius: string
}

export interface CreateM2WorkbenchOptions {
  readonly root: HTMLElement
  readonly initialModel: M2WorkbenchModel
  readonly theme?: Partial<M2WorkbenchTheme>
  readonly onPreselectMaterial: (inventoryBatchId: string) => void
  readonly onCancelMaterialSelection: () => void
  readonly onAddSelectedMaterial: () => void
  readonly onSelectFireSource: (fireSourceId: string) => void
  readonly onFireSizeChange: (fireSize: number) => void
  readonly onFlameThrustChange: (enabled: boolean) => void
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onRequestRestart: () => void
  readonly onConfirmRestart: () => void
  readonly onCancelRestart: () => void
  readonly onRequestFinish: () => void
  readonly onAgain: () => void
}

export interface M2WorkbenchHandle {
  readonly gameHost: HTMLElement
  readonly stage: HTMLElement
  update(model: M2WorkbenchModel): void
  destroy(): void
}

export interface M2WorkbenchView {
  readonly statusLabel: string
  readonly pauseAction: 'pause' | 'resume'
  readonly pauseLabel: string
  readonly pauseDisabled: boolean
  readonly restartDisabled: boolean
  readonly controlsDisabled: boolean
  readonly fireSourceLocked: boolean
  readonly fireInstruction: string
  readonly addMaterialDisabled: boolean
  readonly cancelSelectionDisabled: boolean
  readonly finishDisabled: boolean
  readonly restartDialogOpen: boolean
  readonly completionDialogOpen: boolean
  readonly failureDialogOpen: boolean
  readonly lossWarningMessage: string
  readonly liveMessage: string
}

type M2DialogKind = 'restart' | 'failure' | 'completion'

const STATUS_LABELS: Readonly<Record<M2WorkbenchStatus, string>> = Object.freeze({
  ready: '待投药',
  extracting: '萃取中',
  failed: '萃取失败',
  completed: '已完成',
})

const THEME_PROPERTIES: Readonly<Record<keyof M2WorkbenchTheme, string>> =
  Object.freeze({
    background: '--m2-bg',
    surface: '--m2-surface',
    surfaceRaised: '--m2-surface-raised',
    border: '--m2-border',
    text: '--m2-text',
    muted: '--m2-muted',
    accent: '--m2-accent',
    accentInk: '--m2-accent-ink',
    radius: '--m2-radius',
  })

function isActiveStatus(status: M2WorkbenchStatus): boolean {
  return status === 'ready' || status === 'extracting'
}

export function deriveM2WorkbenchView(
  model: M2WorkbenchModel,
): M2WorkbenchView {
  const active = isActiveStatus(model.status)
  const restartDialogOpen = model.restartConfirmation === 'open'
  const controlsDisabled = !active || model.paused || restartDialogOpen
  const fireSourceLocked = model.equippedFireSourceId !== null
  const selectedMaterialAvailable = model.inventory.some(
    (batch) =>
      batch.batchId === model.selectedMaterialBatchId && batch.servings > 0,
  )
  let liveMessage: string

  if (restartDialogOpen) {
    liveMessage = '已暂停，等待确认是否重开。'
  } else if (model.status === 'completed') {
    liveMessage = '本炉萃取完成，可以再来一炉。'
  } else if (model.status === 'failed') {
    liveMessage = '本炉萃取失败。'
  } else if (model.paused) {
    liveMessage = '炼制已暂停。'
  } else if (model.canFinish) {
    liveMessage = '材料与精灵珠已全部结算，可以结束本炉。'
  } else if (!fireSourceLocked) {
    liveMessage = '请先选择火种。'
  } else {
    liveMessage = '火种已装备。'
  }

  return {
    statusLabel: STATUS_LABELS[model.status],
    pauseAction: model.paused ? 'resume' : 'pause',
    pauseLabel: model.paused ? '继续' : '暂停',
    pauseDisabled: !active,
    restartDisabled: !active || restartDialogOpen,
    controlsDisabled,
    fireSourceLocked,
    fireInstruction: !fireSourceLocked
      ? '选择火种后，按住游戏区左键喷火。'
      : model.isSpraying
        ? '正在喷火，松开左键停止。'
        : '火种已装备，按住游戏区左键喷火。',
    addMaterialDisabled:
      controlsDisabled || !selectedMaterialAvailable,
    cancelSelectionDisabled:
      controlsDisabled || !selectedMaterialAvailable,
    finishDisabled: controlsDisabled || !model.canFinish,
    restartDialogOpen,
    completionDialogOpen: model.status === 'completed',
    failureDialogOpen: model.status === 'failed',
    lossWarningMessage:
      model.lossWarningLevel === 2
        ? '药性濒临溃散，尽快收束火势。'
        : model.lossWarningLevel === 1
          ? '药气正在加速流失。'
          : '',
    liveMessage,
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  if (className !== undefined) element.className = className
  return element
}

function createButton(
  document: Document,
  label: string,
  className = 'm2-control',
): HTMLButtonElement {
  const button = createElement(document, 'button', className)
  button.type = 'button'
  button.textContent = label
  return button
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}

function applyTheme(shell: HTMLElement, theme: Partial<M2WorkbenchTheme>): void {
  for (const key of Object.keys(theme) as Array<keyof M2WorkbenchTheme>) {
    const value = theme[key]
    if (value !== undefined && value.trim().length > 0) {
      shell.style.setProperty(THEME_PROPERTIES[key], value)
    }
  }
}

export function createM2Workbench(
  options: CreateM2WorkbenchOptions,
): M2WorkbenchHandle {
  const document = options.root.ownerDocument
  const window = document.defaultView
  const shell = createElement(document, 'div', 'm2-workbench')
  shell.dataset.m2Shell = ''
  if (options.theme !== undefined) applyTheme(shell, options.theme)

  const header = createElement(document, 'header', 'm2-header')
  const titleGroup = createElement(document, 'div', 'm2-header__title')
  const title = document.createElement('h1')
  title.id = 'm2-page-title'
  title.textContent = '炼丹萃取'
  const statusBadge = createElement(document, 'span', 'm2-status-badge')
  statusBadge.dataset.statusLabel = ''
  titleGroup.append(title, statusBadge)

  const sessionMeta = createElement(document, 'p', 'm2-header__meta')
  sessionMeta.dataset.sessionStatus = ''

  const headerActions = createElement(document, 'div', 'm2-header__actions')
  headerActions.dataset.uiInteractive = ''
  const pauseButton = createButton(document, '暂停', 'm2-control m2-control--quiet')
  pauseButton.dataset.action = 'pause'
  const restartButton = createButton(document, '重开', 'm2-control m2-control--quiet')
  restartButton.dataset.action = 'restart'
  headerActions.append(pauseButton, restartButton)
  header.append(titleGroup, sessionMeta, headerActions)

  const layout = createElement(document, 'div', 'm2-layout')
  const stage = createElement(document, 'main', 'm2-stage')
  stage.dataset.m2Stage = ''
  stage.tabIndex = 0
  stage.setAttribute('aria-labelledby', title.id)
  stage.setAttribute('aria-describedby', 'm2-stage-instructions')
  const instructions = createElement(document, 'p', 'm2-sr-only')
  instructions.id = 'm2-stage-instructions'
  instructions.textContent =
    '选择火种和药材后，在游戏区按住左键喷火，使用 A 和 D 移动接液容器。'
  const gameHost = createElement(document, 'div', 'm2-game-host')
  gameHost.dataset.gameHost = ''
  gameHost.setAttribute('aria-hidden', 'true')
  stage.append(instructions, gameHost)

  const panel = createElement(document, 'aside', 'm2-panel')
  panel.setAttribute('aria-label', '炼制操作与状态')
  panel.dataset.uiInteractive = ''

  const fireSection = createElement(document, 'section', 'm2-panel__section')
  const fireHeading = document.createElement('h2')
  fireHeading.textContent = '选择火种'
  const fireInstruction = createElement(document, 'p', 'm2-section-help')
  fireInstruction.dataset.fireInstruction = ''
  const fireSourceList = createElement(document, 'div', 'm2-fire-source-list')
  fireSourceList.dataset.fireSourceList = ''
  fireSourceList.dataset.uiInteractive = ''
  fireSourceList.setAttribute('role', 'radiogroup')
  fireSourceList.setAttribute('aria-label', '可选火种')
  fireSection.append(fireHeading, fireInstruction, fireSourceList)

  const fireSizeSection = createElement(
    document,
    'section',
    'm2-panel__section m2-fire-size-section',
  )
  const fireSizeHeading = document.createElement('h2')
  fireSizeHeading.textContent = '火焰大小'
  const fireSizeRow = createElement(document, 'div', 'm2-range-row')
  const fireSizeLabel = document.createElement('label')
  fireSizeLabel.htmlFor = 'm2-fire-size'
  fireSizeLabel.textContent = '当前火力'
  const fireSizeOutput = document.createElement('output')
  fireSizeOutput.htmlFor = 'm2-fire-size'
  fireSizeOutput.dataset.fireSizeOutput = ''
  const fireSizeInput = document.createElement('input')
  fireSizeInput.id = 'm2-fire-size'
  fireSizeInput.type = 'range'
  fireSizeInput.dataset.fireSize = ''
  fireSizeInput.dataset.uiInteractive = ''
  fireSizeRow.append(fireSizeLabel, fireSizeOutput)

  const thrustRow = createElement(document, 'label', 'm3-thrust-row')
  thrustRow.htmlFor = 'm3-flame-thrust'
  const thrustCopy = createElement(document, 'span', 'm3-thrust-row__copy')
  const thrustName = document.createElement('strong')
  thrustName.textContent = '火势助推'
  const thrustHelp = document.createElement('span')
  thrustHelp.textContent = '让火流推动丹珠，接取更灵活。'
  thrustCopy.append(thrustName, thrustHelp)
  const thrustInput = document.createElement('input')
  thrustInput.id = 'm3-flame-thrust'
  thrustInput.type = 'checkbox'
  thrustInput.dataset.flameThrust = ''
  thrustInput.dataset.uiInteractive = ''
  thrustRow.append(thrustCopy, thrustInput)

  const metrics = createElement(document, 'dl', 'm2-metrics')
  const metricNodes = new Map<string, HTMLElement>()
  for (const [key, label] of [
    ['remaining', '剩余药材'],
    ['active', '活动珠'],
    ['caught', '接液皿'],
  ] as const) {
    const metric = createElement(document, 'div', 'm2-metric')
    const term = document.createElement('dt')
    term.textContent = label
    const value = document.createElement('dd')
    value.dataset.metric = key
    metric.append(term, value)
    metrics.append(metric)
    metricNodes.set(key, value)
  }
  fireSizeSection.append(
    fireSizeHeading,
    fireSizeRow,
    fireSizeInput,
    thrustRow,
    metrics,
  )

  const inventorySection = createElement(
    document,
    'section',
    'm2-panel__section m2-inventory-section',
  )
  const inventoryHeading = document.createElement('h2')
  inventoryHeading.textContent = '背包与待投药材'
  const inventoryList = createElement(document, 'div', 'm2-inventory-list')
  inventoryList.dataset.inventory = ''
  inventoryList.dataset.uiInteractive = ''
  inventoryList.setAttribute('role', 'group')
  inventoryList.setAttribute('aria-label', '可用药材')
  const selectedMaterial = createElement(document, 'div', 'm2-selected-material')
  selectedMaterial.dataset.selectedMaterial = ''
  selectedMaterial.dataset.uiInteractive = ''
  const selectedActions = createElement(document, 'div', 'm2-selected-actions')
  const addMaterialButton = createButton(document, '投入一份')
  addMaterialButton.dataset.action = 'add-material'
  const cancelSelectionButton = createButton(
    document,
    '取消选择',
    'm2-control m2-control--quiet',
  )
  cancelSelectionButton.dataset.action = 'cancel-material'
  selectedActions.append(addMaterialButton, cancelSelectionButton)
  inventorySection.append(
    inventoryHeading,
    inventoryList,
    selectedMaterial,
    selectedActions,
  )

  const actionSection = createElement(document, 'section', 'm2-panel__actions')
  const finishButton = createButton(
    document,
    '结束本炉',
    'm2-control m2-control--primary',
  )
  finishButton.dataset.action = 'finish'
  const statusLive = createElement(document, 'p', 'm2-status-live')
  statusLive.dataset.statusLive = ''
  statusLive.setAttribute('role', 'status')
  statusLive.setAttribute('aria-live', 'polite')
  statusLive.setAttribute('aria-atomic', 'true')
  const lossWarning = createElement(document, 'p', 'm3-loss-warning')
  lossWarning.dataset.lossWarning = ''
  lossWarning.hidden = true
  lossWarning.setAttribute('role', 'status')
  lossWarning.setAttribute('aria-live', 'assertive')
  actionSection.append(lossWarning, finishButton, statusLive)

  panel.append(fireSection, fireSizeSection, inventorySection, actionSection)
  layout.append(stage, panel)

  const restartDialog = createElement(document, 'div', 'm2-dialog')
  restartDialog.dataset.restartDialog = ''
  restartDialog.dataset.uiInteractive = ''
  restartDialog.hidden = true
  restartDialog.setAttribute('role', 'dialog')
  restartDialog.setAttribute('aria-modal', 'true')
  restartDialog.setAttribute('aria-labelledby', 'm2-restart-title')
  const restartCard = createElement(document, 'section', 'm2-dialog__card')
  const restartTitle = document.createElement('h2')
  restartTitle.id = 'm2-restart-title'
  restartTitle.textContent = '重开本炉？'
  const restartCopy = document.createElement('p')
  restartCopy.textContent = '当前炉次进度不会保留。确定重开吗？'
  const restartActions = createElement(document, 'div', 'm2-dialog__actions')
  const cancelRestartButton = createButton(
    document,
    '继续本炉',
    'm2-control m2-control--quiet',
  )
  cancelRestartButton.dataset.action = 'cancel-restart'
  const confirmRestartButton = createButton(
    document,
    '确认重开',
    'm2-control m2-control--primary',
  )
  confirmRestartButton.dataset.action = 'confirm-restart'
  restartActions.append(cancelRestartButton, confirmRestartButton)
  restartCard.append(restartTitle, restartCopy, restartActions)
  restartDialog.append(restartCard)

  const completionDialog = createElement(document, 'div', 'm2-dialog')
  completionDialog.dataset.completionDialog = ''
  completionDialog.dataset.uiInteractive = ''
  completionDialog.hidden = true
  completionDialog.setAttribute('role', 'dialog')
  completionDialog.setAttribute('aria-modal', 'true')
  completionDialog.setAttribute('aria-labelledby', 'm2-completion-title')
  const completionCard = createElement(document, 'section', 'm2-dialog__card')
  const completionTitle = document.createElement('h2')
  completionTitle.id = 'm2-completion-title'
  completionTitle.textContent = '本炉完成'
  const completionCopy = document.createElement('p')
  completionCopy.dataset.completionSummary = ''
  const againButton = createButton(
    document,
    '再来一炉',
    'm2-control m2-control--primary',
  )
  againButton.dataset.action = 'again'
  completionCard.append(completionTitle, completionCopy, againButton)
  completionDialog.append(completionCard)

  const failureDialog = createElement(document, 'div', 'm2-dialog m3-failure-dialog')
  failureDialog.dataset.failureDialog = ''
  failureDialog.dataset.uiInteractive = ''
  failureDialog.hidden = true
  failureDialog.setAttribute('role', 'dialog')
  failureDialog.setAttribute('aria-modal', 'true')
  failureDialog.setAttribute('aria-labelledby', 'm3-failure-title')
  const failureCard = createElement(document, 'section', 'm2-dialog__card m3-failure-card')
  const failureEyebrow = createElement(document, 'span', 'm3-failure-card__eyebrow')
  failureEyebrow.textContent = '药性溃散'
  const failureTitle = document.createElement('h2')
  failureTitle.id = 'm3-failure-title'
  failureTitle.textContent = '本炉化为药渣'
  const failureCopy = document.createElement('p')
  failureCopy.dataset.failureSummary = ''
  const failureAgainButton = createButton(
    document,
    '再来一炉',
    'm2-control m2-control--primary',
  )
  failureAgainButton.dataset.action = 'again'
  failureCard.append(
    failureEyebrow,
    failureTitle,
    failureCopy,
    failureAgainButton,
  )
  failureDialog.append(failureCard)

  shell.append(header, layout, restartDialog, failureDialog, completionDialog)
  options.root.replaceChildren(shell)
  if (stage.closest('[data-ui-interactive]') !== null) {
    throw new Error('M2 游戏区不能位于 UI 交互区域内。')
  }

  let currentModel = options.initialModel
  let activeDialog: M2DialogKind | null = null
  let returnFocus: HTMLElement | null = null
  let fireSourcesRenderKey: string | null = null
  let inventoryRenderKey: string | null = null
  let pendingFlameThrust: boolean | null = null
  let destroyed = false

  function getEventElement(event: Event): Element | null {
    const ElementConstructor = window?.Element
    return ElementConstructor !== undefined && event.target instanceof ElementConstructor
      ? event.target
      : null
  }

  function dialogElement(kind: M2DialogKind): HTMLElement {
    if (kind === 'restart') return restartDialog
    return kind === 'failure' ? failureDialog : completionDialog
  }

  function dialogPreferredFocus(kind: M2DialogKind): HTMLButtonElement {
    if (kind === 'restart') return cancelRestartButton
    return kind === 'failure' ? failureAgainButton : againButton
  }

  function restoreFocus(): void {
    const target = returnFocus
    returnFocus = null
    if (
      target !== null &&
      target.isConnected &&
      (!(target instanceof HTMLButtonElement) || !target.disabled)
    ) {
      target.focus()
    } else {
      stage.focus()
    }
  }

  function setActiveDialog(next: M2DialogKind | null): void {
    if (activeDialog === next) return
    const previous = activeDialog
    if (previous !== null) dialogElement(previous).hidden = true

    if (next === null) {
      activeDialog = null
      header.inert = false
      layout.inert = false
      restoreFocus()
      return
    }

    if (previous === null) {
      const active = document.activeElement
      const HTMLElementConstructor = window?.HTMLElement
      returnFocus =
        HTMLElementConstructor !== undefined &&
        active instanceof HTMLElementConstructor &&
        shell.contains(active)
          ? active
          : stage
    }
    activeDialog = next
    header.inert = true
    layout.inert = true
    const element = dialogElement(next)
    element.hidden = false
    queueMicrotask(() => {
      if (!destroyed && activeDialog === next) dialogPreferredFocus(next).focus()
    })
  }

  function handleAction(action: string): void {
    switch (action) {
      case 'add-material':
        options.onAddSelectedMaterial()
        break
      case 'cancel-material':
        options.onCancelMaterialSelection()
        break
      case 'pause':
        options.onPause()
        break
      case 'resume':
        options.onResume()
        break
      case 'restart':
        options.onRequestRestart()
        break
      case 'confirm-restart':
        options.onConfirmRestart()
        break
      case 'cancel-restart':
        options.onCancelRestart()
        break
      case 'finish':
        options.onRequestFinish()
        break
      case 'again':
        options.onAgain()
        break
    }
  }

  function handleClick(event: MouseEvent): void {
    const target = getEventElement(event)
    if (target === null) return
    const actionButton = target.closest<HTMLButtonElement>('button[data-action]')
    if (actionButton !== null && !actionButton.disabled) {
      handleAction(actionButton.dataset.action ?? '')
      return
    }
    const fireSourceButton = target.closest<HTMLButtonElement>(
      'button[data-fire-source-id]',
    )
    if (fireSourceButton !== null && !fireSourceButton.disabled) {
      const fireSourceId = fireSourceButton.dataset.fireSourceId
      if (fireSourceId !== undefined) options.onSelectFireSource(fireSourceId)
      return
    }
    const inventoryButton = target.closest<HTMLButtonElement>(
      'button[data-inventory-batch-id]',
    )
    if (inventoryButton !== null && !inventoryButton.disabled) {
      const inventoryBatchId = inventoryButton.dataset.inventoryBatchId
      if (inventoryBatchId !== undefined) {
        options.onPreselectMaterial(inventoryBatchId)
      }
    }
  }

  function handleInput(event: Event): void {
    if (event.target === fireSizeInput && !fireSizeInput.disabled) {
      const value = Number(fireSizeInput.value)
      if (Number.isFinite(value)) options.onFireSizeChange(value)
    } else if (event.target === thrustInput && !thrustInput.disabled) {
      pendingFlameThrust = thrustInput.checked
      options.onFlameThrustChange(thrustInput.checked)
    }
  }

  function handleContextMenu(event: MouseEvent): void {
    const target = getEventElement(event)
    if (
      target !== null &&
      target.closest('[data-selected-material]') !== null &&
      currentModel.selectedMaterialBatchId !== null
    ) {
      event.preventDefault()
      options.onCancelMaterialSelection()
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (activeDialog === null) return
    if (event.key === 'Escape' && activeDialog === 'restart') {
      event.preventDefault()
      options.onCancelRestart()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      dialogElement(activeDialog).querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ),
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  shell.addEventListener('click', handleClick)
  shell.addEventListener('input', handleInput)
  shell.addEventListener('contextmenu', handleContextMenu)
  shell.addEventListener('keydown', handleKeyDown)

  function renderFireSources(
    model: M2WorkbenchModel,
    view: M2WorkbenchView,
  ): void {
    const items: HTMLElement[] = []
    if (model.fireSources.length === 0) {
      const empty = createElement(document, 'p', 'm2-empty-state')
      empty.textContent = '当前没有可用火种。'
      items.push(empty)
    }

    for (const fireSource of model.fireSources) {
      const selected = fireSource.id === model.equippedFireSourceId
      const button = createButton(
        document,
        '',
        'm2-fire-source m2-control',
      )
      button.dataset.fireSourceId = fireSource.id
      button.dataset.state = selected
        ? 'equipped'
        : view.fireSourceLocked
          ? 'locked'
          : 'available'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(selected))
      button.disabled = view.controlsDisabled || view.fireSourceLocked
      const copy = createElement(document, 'span', 'm2-fire-source__copy')
      const name = createElement(document, 'strong', 'm2-fire-source__name')
      name.textContent = fireSource.nameZh
      const description = createElement(document, 'span', 'm2-fire-source__description')
      description.textContent = fireSource.descriptionZh ?? '基础炼制火种。'
      copy.append(name, description)
      const state = createElement(document, 'span', 'm2-fire-source__state')
      state.textContent = selected
        ? '已装备'
        : view.fireSourceLocked
          ? '本炉已锁定'
          : '可选择'
      button.append(copy, state)
      items.push(button)
    }
    fireSourceList.replaceChildren(...items)
  }

  function createMaterialImage(batch: M2InventoryBatchView): HTMLElement | null {
    if (batch.imagePath === undefined) return null
    const image = document.createElement('img')
    image.className = 'm2-material-image'
    image.src = batch.imagePath
    image.alt = ''
    image.draggable = false
    return image
  }

  function renderInventory(
    model: M2WorkbenchModel,
    view: M2WorkbenchView,
  ): void {
    const items: HTMLElement[] = []
    if (model.inventory.length === 0) {
      const empty = createElement(document, 'p', 'm2-empty-state')
      empty.textContent = '背包中没有可用药材。'
      items.push(empty)
    }
    for (const batch of model.inventory) {
      const selected =
        batch.batchId === model.selectedMaterialBatchId && batch.servings > 0
      const button = createButton(
        document,
        '',
        'm2-inventory-item m2-control',
      )
      button.dataset.inventoryBatchId = batch.batchId
      button.dataset.materialDefinitionId = batch.materialDefinitionId
      button.setAttribute('aria-pressed', String(selected))
      button.disabled = view.controlsDisabled || batch.servings <= 0
      const image = createMaterialImage(batch)
      const name = createElement(document, 'span', 'm2-inventory-item__name')
      name.textContent = batch.nameZh
      const count = createElement(document, 'span', 'm2-inventory-item__count')
      count.textContent = `${formatNumber(batch.servings)} 份`
      if (image !== null) button.append(image)
      button.append(name, count)
      items.push(button)
    }
    inventoryList.replaceChildren(...items)

    const selectedBatch = model.inventory.find(
      (batch) =>
        batch.batchId === model.selectedMaterialBatchId && batch.servings > 0,
    )
    selectedMaterial.dataset.empty = String(selectedBatch === undefined)
    if (selectedBatch === undefined) {
      const empty = createElement(document, 'p', 'm2-selected-material__empty')
      empty.textContent = '尚未选择药材。'
      selectedMaterial.replaceChildren(empty)
    } else {
      const image = createMaterialImage(selectedBatch)
      const copy = createElement(document, 'div', 'm2-selected-material__copy')
      const label = createElement(document, 'span', 'm2-selected-material__label')
      label.textContent = '待投药材'
      const name = createElement(document, 'strong', 'm2-selected-material__name')
      name.textContent = selectedBatch.nameZh
      copy.append(label, name)
      selectedMaterial.replaceChildren(...(image === null ? [copy] : [image, copy]))
    }
    addMaterialButton.disabled = view.addMaterialDisabled
    cancelSelectionButton.disabled = view.cancelSelectionDisabled
  }

  function update(model: M2WorkbenchModel): void {
    if (destroyed) return
    const focusedFireSourceId =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset.fireSourceId
        : undefined
    const focusedInventoryBatchId =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset.inventoryBatchId
        : undefined
    currentModel = model
    const view = deriveM2WorkbenchView(model)
    shell.dataset.domainStatus = model.status
    shell.dataset.sessionId = model.sessionId
    shell.dataset.tick = String(model.tick)
    shell.dataset.equippedFireSourceId = model.equippedFireSourceId ?? ''
    shell.dataset.isSpraying = String(model.isSpraying)
    shell.dataset.canFinish = String(model.canFinish)
    shell.dataset.paused = String(model.paused)
    statusBadge.textContent = view.statusLabel
    statusBadge.dataset.status = model.status
    sessionMeta.textContent = `炉次 ${model.sessionId} / Tick ${model.tick}`
    pauseButton.textContent = view.pauseLabel
    pauseButton.dataset.action = view.pauseAction
    pauseButton.disabled = view.pauseDisabled
    restartButton.disabled = view.restartDisabled
    fireInstruction.textContent = view.fireInstruction
    fireSizeInput.min = String(model.fireSizeRange.min)
    fireSizeInput.max = String(model.fireSizeRange.max)
    fireSizeInput.step = 'any'
    fireSizeInput.value = String(model.fireSize)
    fireSizeInput.disabled = view.controlsDisabled
    fireSizeInput.setAttribute('aria-valuetext', `${formatNumber(model.fireSize)} 档`)
    fireSizeOutput.value = formatNumber(model.fireSize)
    fireSizeOutput.textContent = formatNumber(model.fireSize)
    if (pendingFlameThrust === model.flameThrustEnabled) {
      pendingFlameThrust = null
    }
    thrustInput.checked = pendingFlameThrust ?? model.flameThrustEnabled
    thrustInput.disabled = view.controlsDisabled
    metricNodes.get('remaining')!.textContent = formatNumber(
      model.materialRemaining,
    )
    metricNodes.get('active')!.textContent = formatNumber(
      model.activePearlCount,
    )
    const contaminantVolume = model.caughtVolumes.slag + model.caughtVolumes.impurity
    metricNodes.get('caught')!.textContent =
      contaminantVolume <= 0
        ? model.caughtVolumes.medicinalLiquid > 0
          ? '澄澈'
          : '空'
        : contaminantVolume < model.caughtVolumes.medicinalLiquid
          ? '微浊'
          : '浑浊'
    const nextFireSourcesRenderKey = JSON.stringify([
      model.fireSources,
      model.equippedFireSourceId,
      view.controlsDisabled,
      view.fireSourceLocked,
    ])
    const nextInventoryRenderKey = JSON.stringify([
      model.inventory,
      model.selectedMaterialBatchId,
      view.controlsDisabled,
      view.addMaterialDisabled,
      view.cancelSelectionDisabled,
    ])
    const fireSourcesChanged = fireSourcesRenderKey !== nextFireSourcesRenderKey
    const inventoryChanged = inventoryRenderKey !== nextInventoryRenderKey
    if (fireSourcesChanged) {
      renderFireSources(model, view)
      fireSourcesRenderKey = nextFireSourcesRenderKey
    }
    if (inventoryChanged) {
      renderInventory(model, view)
      inventoryRenderKey = nextInventoryRenderKey
    }
    if (fireSourcesChanged && focusedFireSourceId !== undefined) {
      const replacement = Array.from(
        fireSourceList.querySelectorAll<HTMLButtonElement>(
          'button[data-fire-source-id]',
        ),
      ).find((button) => button.dataset.fireSourceId === focusedFireSourceId)
      if (replacement !== undefined && !replacement.disabled) replacement.focus()
    } else if (inventoryChanged && focusedInventoryBatchId !== undefined) {
      const replacement = Array.from(
        inventoryList.querySelectorAll<HTMLButtonElement>(
          'button[data-inventory-batch-id]',
        ),
      ).find(
        (button) =>
          button.dataset.inventoryBatchId === focusedInventoryBatchId,
      )
      if (replacement !== undefined && !replacement.disabled) replacement.focus()
    }
    finishButton.disabled = view.finishDisabled
    finishButton.dataset.available = String(!view.finishDisabled)
    if (statusLive.textContent !== view.liveMessage) {
      statusLive.textContent = view.liveMessage
    }
    lossWarning.hidden = view.lossWarningMessage.length === 0
    lossWarning.dataset.level = String(model.lossWarningLevel)
    lossWarning.textContent = view.lossWarningMessage
    completionCopy.textContent =
      `药液 ${formatNumber(model.caughtVolumes.medicinalLiquid)} 份量` +
      (model.normalSlagQuantity > 0
        ? `，另得药渣 × ${formatNumber(model.normalSlagQuantity)}。`
        : '，未收得额外药渣。')
    failureCopy.textContent = model.failureResult === null
      ? '损耗超过药性承受极限。'
      : `损耗超过药性承受极限，剩余炉料结为药渣 × ${formatNumber(
          model.failureResult.slagQuantity,
        )}。`

    const nextDialog = view.restartDialogOpen
      ? 'restart'
      : view.failureDialogOpen
        ? 'failure'
        : view.completionDialogOpen
          ? 'completion'
          : null
    setActiveDialog(nextDialog)
  }

  update(options.initialModel)

  return {
    gameHost,
    stage,
    update,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      shell.removeEventListener('click', handleClick)
      shell.removeEventListener('input', handleInput)
      shell.removeEventListener('contextmenu', handleContextMenu)
      shell.removeEventListener('keydown', handleKeyDown)
      if (activeDialog !== null) {
        dialogElement(activeDialog).hidden = true
        activeDialog = null
        header.inert = false
        layout.inert = false
        restoreFocus()
      }
    },
  }
}
