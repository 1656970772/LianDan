import {
  loadBrowserConfig,
  loadBrowserM1FireFlowFixture,
  loadBrowserM2GameplayConfig,
  validateM1RuntimeCompatibility,
  type ConfigIssue,
  type NormalizedM2Config,
} from './config/index.ts'
import {
  createM1Game,
  createM2Game,
  GAME_LOGICAL_HEIGHT,
  GAME_LOGICAL_WIDTH,
  M1_OVERLAY_MODES,
  type M1BrowserApi,
  type M1GameHandle,
  type M1OverlayMode,
  type M2BrowserApi,
  type M2GameHandle,
} from './game/index.ts'
import { M1_BEHAVIORS, listM1Scenarios } from './game/m1/scenarios.ts'
import './style.css'
import {
  createM1Workbench,
  createM2Workbench,
  renderConfigError,
  type M2WorkbenchModel,
} from './ui/index.ts'

function requireAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#app')
  if (element === null) throw new Error('缺少应用根节点。')
  return element
}

function unexpectedBootstrapIssue(): ConfigIssue {
  return {
    code: 'CONFIG_LOAD_FAILED',
    filePath: '/src/main.ts',
    fieldPath: '',
    messageZh: '模拟器启动失败，请查看浏览器控制台。',
  }
}

function readOverlayMode(search: URLSearchParams): M1OverlayMode {
  const requested = search.get('overlay')
  return M1_OVERLAY_MODES.includes(requested as M1OverlayMode)
    ? (requested as M1OverlayMode)
    : 'fire'
}

function writeM1RuntimeQuery(
  scenarioId: string,
  overlayMode: M1OverlayMode,
): void {
  const url = new URL(window.location.href)
  url.searchParams.set('mode', 'technical')
  url.searchParams.set('scenario', scenarioId)
  url.searchParams.set('overlay', overlayMode)
  window.history.replaceState(null, '', url)
}

function initialM2WorkbenchModel(config: NormalizedM2Config): M2WorkbenchModel {
  const materialById = new Map(
    config.base.materials.map((material) => [material.id, material] as const),
  )
  return {
    sessionId: 'session-000001',
    status: 'ready',
    tick: 0,
    fireSources: config.gameplay.fireSources.map((source) => ({
      id: source.id,
      nameZh: source.nameZh,
      descriptionZh: '稳定、易控制的基础火种。',
    })),
    equippedFireSourceId: null,
    fireSize: config.gameplay.prototype.initialFireSize,
    fireSizeRange: {
      min: 0,
      max: 100,
    },
    isSpraying: false,
    flameThrustEnabled: false,
    canFinish: false,
    lossWarningLevel: 0,
    caughtVolumes: { medicinalLiquid: 0, slag: 0, impurity: 0 },
    normalSlagQuantity: 0,
    failureResult: null,
    paused: false,
    restartConfirmation: 'closed',
    inventory: config.gameplay.prototype.inventoryBatches.map((batch) => {
      const material = materialById.get(batch.materialDefinitionId)
      return {
        batchId: batch.batchId,
        materialDefinitionId: batch.materialDefinitionId,
        nameZh: material?.nameZh ?? batch.materialDefinitionId,
        servings: batch.servings,
        ...(material?.appearancePath === undefined
          ? {}
          : { imagePath: material.appearancePath }),
      }
    }),
    selectedMaterialBatchId: null,
    materialRemaining: 0,
    activePearlCount: 0,
    caughtPearlCount: 0,
  }
}

async function bootstrapM2(app: HTMLElement): Promise<void> {
  const loaded = await loadBrowserM2GameplayConfig()
  if (!loaded.ok) {
    renderConfigError(app, loaded.issues)
    return
  }

  let gameHandle: M2GameHandle | null = null
  const workbench = createM2Workbench({
    root: app,
    initialModel: initialM2WorkbenchModel(loaded.config),
    theme: {
      background: loaded.config.gameplay.prototype.theme.colors.background,
      surface: loaded.config.gameplay.prototype.theme.colors.surface,
      surfaceRaised:
        loaded.config.gameplay.prototype.theme.colors.surfaceRaised,
      border: loaded.config.gameplay.prototype.theme.colors.border,
      text: loaded.config.gameplay.prototype.theme.colors.text,
      muted: loaded.config.gameplay.prototype.theme.colors.muted,
      accent: loaded.config.gameplay.prototype.theme.colors.accent,
      accentInk: loaded.config.gameplay.prototype.theme.colors.surface,
      radius: `${loaded.config.gameplay.prototype.theme.radius}px`,
    },
    onPreselectMaterial: (batchId) => gameHandle?.preselectMaterial(batchId),
    onCancelMaterialSelection: () => gameHandle?.cancelMaterialSelection(),
    onAddSelectedMaterial: () => gameHandle?.addSelectedMaterial(),
    onSelectFireSource: (fireSourceId) =>
      gameHandle?.selectFireSource(fireSourceId),
    onFireSizeChange: (fireSize) => gameHandle?.setFireSize(fireSize),
    onFlameThrustChange: (enabled) => gameHandle?.setFlameThrust(enabled),
    onPause: () => gameHandle?.pause(),
    onResume: () => gameHandle?.resume(),
    onRequestRestart: () => gameHandle?.requestRestart(),
    onConfirmRestart: () => gameHandle?.confirmRestart(),
    onCancelRestart: () => gameHandle?.cancelRestart(),
    onRequestFinish: () => gameHandle?.requestFinish(),
    onAgain: () => gameHandle?.again(),
  })
  workbench.gameHost.dataset.simulationContentFingerprint =
    loaded.simulationContentFingerprint

  document.body.dataset.appMode = 'm2'
  document.body.dataset.appState = 'game-loading'
  gameHandle = createM2Game({
    parent: workbench.gameHost,
    inputStage: workbench.stage,
    config: loaded.config,
    compositionMaps: loaded.compositionMaps,
    simulationContentFingerprint: loaded.simulationContentFingerprint,
    onReady(metadata) {
      workbench.gameHost.dataset.phaserVersion = metadata.phaserVersion
      document.body.dataset.appState = 'ready'
      if (gameHandle !== null) workbench.update(gameHandle.getSnapshot())
    },
    onSnapshot(snapshot) {
      workbench.update(snapshot)
    },
  })
  workbench.update(gameHandle.getSnapshot())

  const browserApi: M2BrowserApi = Object.freeze({
    getSnapshot: () => gameHandle!.getSnapshot(),
    selectFireSource: (fireSourceId: string) =>
      gameHandle!.selectFireSource(fireSourceId),
    preselectMaterial: (inventoryBatchId: string) =>
      gameHandle!.preselectMaterial(inventoryBatchId),
    cancelMaterialSelection: () => gameHandle!.cancelMaterialSelection(),
    addSelectedMaterial: () => gameHandle!.addSelectedMaterial(),
    setFireSize: (size: number) => gameHandle!.setFireSize(size),
    setFlameThrust: (enabled: boolean) => gameHandle!.setFlameThrust(enabled),
    requestFinish: () => gameHandle!.requestFinish(),
    pause: () => gameHandle!.pause(),
    resume: () => gameHandle!.resume(),
    requestRestart: () => gameHandle!.requestRestart(),
    cancelRestart: () => gameHandle!.cancelRestart(),
    confirmRestart: () => gameHandle!.confirmRestart(),
    again: () => gameHandle!.again(),
  })
  window.__LIANDAN_M2__ = browserApi

  let destroyed = false
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('pagehide', destroy)
    if (window.__LIANDAN_M2__ === browserApi) delete window.__LIANDAN_M2__
    workbench.destroy()
    gameHandle?.destroy()
    gameHandle = null
  }
  window.addEventListener('pagehide', destroy)
}

async function bootstrapM1(app: HTMLElement): Promise<void> {
  const [loadedConfig, loadedFixture] = await Promise.all([
    loadBrowserConfig(),
    loadBrowserM1FireFlowFixture(),
  ])
  if (!loadedConfig.ok || !loadedFixture.ok) {
    renderConfigError(app, [
      ...(loadedConfig.ok ? [] : loadedConfig.issues),
      ...(loadedFixture.ok ? [] : loadedFixture.issues),
    ])
    return
  }

  const runtimeCompatibilityIssues = validateM1RuntimeCompatibility(
    loadedConfig.config,
    loadedFixture.fixture,
    { width: GAME_LOGICAL_WIDTH, height: GAME_LOGICAL_HEIGHT },
  )
  if (runtimeCompatibilityIssues.length > 0) {
    renderConfigError(app, runtimeCompatibilityIssues)
    return
  }

  const resolvedScenarios = listM1Scenarios(loadedFixture.fixture)
  const requestedScenarioId =
    new URLSearchParams(window.location.search).get('scenario') ?? 'pillar'
  const initialScenario =
    resolvedScenarios.find(
      (scenario) => scenario.metadata.id === requestedScenarioId,
    ) ?? resolvedScenarios.find((scenario) => scenario.metadata.id === 'pillar')!
  const initialOverlayMode = readOverlayMode(
    new URLSearchParams(window.location.search),
  )

  let gameHandle: M1GameHandle | null = null
  let currentScenarioId = initialScenario.metadata.id
  let currentOverlayMode = initialOverlayMode
  const workbench = createM1Workbench({
    root: app,
    scenarios: resolvedScenarios.map((scenario) => scenario.metadata),
    behaviors: M1_BEHAVIORS,
    initialScenarioId: currentScenarioId,
    initialOverlayMode: currentOverlayMode,
    simulationContentFingerprint: loadedConfig.simulationContentFingerprint,
    onScenarioChange(scenarioId) {
      currentScenarioId = scenarioId
      gameHandle?.selectScenario(scenarioId)
      if (gameHandle !== null) workbench.update(gameHandle.getSnapshot())
      writeM1RuntimeQuery(currentScenarioId, currentOverlayMode)
    },
    onOverlayChange(mode) {
      currentOverlayMode = mode
      gameHandle?.setOverlayMode(mode)
      if (gameHandle !== null) workbench.update(gameHandle.getSnapshot())
      writeM1RuntimeQuery(currentScenarioId, currentOverlayMode)
    },
  })

  document.body.dataset.appMode = 'technical'
  document.body.dataset.appState = 'game-loading'
  gameHandle = createM1Game({
    parent: workbench.gameHost,
    config: loadedConfig.config,
    fixture: loadedFixture.fixture,
    simulationContentFingerprint: loadedConfig.simulationContentFingerprint,
    initialScenarioId: currentScenarioId,
    initialOverlayMode: currentOverlayMode,
    onReady(metadata) {
      workbench.gameHost.dataset.phaserVersion = metadata.phaserVersion
      document.body.dataset.appState = 'ready'
      if (gameHandle !== null) workbench.update(gameHandle.getSnapshot())
    },
    onSnapshot(snapshot) {
      workbench.update(snapshot)
    },
  })
  workbench.update(gameHandle.getSnapshot())

  const browserApi: M1BrowserApi = Object.freeze({
    getSnapshot: () => gameHandle!.getSnapshot(),
    setOverlayMode: (mode: M1OverlayMode) => {
      if (!M1_OVERLAY_MODES.includes(mode)) {
        throw new Error('M1_OVERLAY_MODE_INVALID')
      }
      currentOverlayMode = mode
      gameHandle!.setOverlayMode(mode)
      workbench.update(gameHandle!.getSnapshot())
      writeM1RuntimeQuery(currentScenarioId, currentOverlayMode)
    },
    startSample: (durationMilliseconds: number) =>
      gameHandle!.startSample(durationMilliseconds),
  })
  window.__LIANDAN_M1__ = browserApi

  let destroyed = false
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('pagehide', destroy)
    if (window.__LIANDAN_M1__ === browserApi) delete window.__LIANDAN_M1__
    workbench.destroy()
    gameHandle?.destroy()
    gameHandle = null
  }
  window.addEventListener('pagehide', destroy)
}

const app = requireAppRoot()
document.body.dataset.appState = 'loading'

const bootstrap = async (): Promise<void> => {
  const mode = new URLSearchParams(window.location.search).get('mode')
  if (mode === 'technical') await bootstrapM1(app)
  else await bootstrapM2(app)
}

void bootstrap().catch((error: unknown) => {
  console.error(error)
  renderConfigError(app, [unexpectedBootstrapIssue()])
})
