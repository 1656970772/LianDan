import {
  loadBrowserConfig,
  loadBrowserM1FireFlowFixture,
  validateM1RuntimeCompatibility,
  type ConfigIssue,
} from './config/index.ts'
import {
  createM1Game,
  GAME_LOGICAL_HEIGHT,
  GAME_LOGICAL_WIDTH,
  M1_OVERLAY_MODES,
  type M1BrowserApi,
  type M1GameHandle,
  type M1OverlayMode,
} from './game/index.ts'
import { M1_BEHAVIORS, listM1Scenarios } from './game/m1/scenarios.ts'
import './style.css'
import { createM1Workbench, renderConfigError } from './ui/index.ts'

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

function writeRuntimeQuery(scenarioId: string, overlayMode: M1OverlayMode): void {
  const url = new URL(window.location.href)
  url.searchParams.set('scenario', scenarioId)
  url.searchParams.set('overlay', overlayMode)
  window.history.replaceState(null, '', url)
}

const app = requireAppRoot()
document.body.dataset.appState = 'loading'

async function bootstrap(): Promise<void> {
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
      writeRuntimeQuery(currentScenarioId, currentOverlayMode)
    },
    onOverlayChange(mode) {
      currentOverlayMode = mode
      gameHandle?.setOverlayMode(mode)
      if (gameHandle !== null) workbench.update(gameHandle.getSnapshot())
      writeRuntimeQuery(currentScenarioId, currentOverlayMode)
    },
  })

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
      writeRuntimeQuery(currentScenarioId, currentOverlayMode)
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

void bootstrap().catch((error: unknown) => {
  console.error(error)
  renderConfigError(app, [unexpectedBootstrapIssue()])
})
