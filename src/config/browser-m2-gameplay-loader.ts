import collectorSchemaText from '../../schemas/config/m2-collector.schema.json?raw'
import fireSourcesSchemaText from '../../schemas/config/m2-fire-sources.schema.json?raw'
import manifestSchemaText from '../../schemas/config/m2-config-set.schema.json?raw'
import pearlTypesSchemaText from '../../schemas/config/m2-pearl-types.schema.json?raw'
import prototypeSchemaText from '../../schemas/config/m2-prototype.schema.json?raw'
import interactionsSchemaText from '../../schemas/config/m2-interactions.schema.json?raw'
import presentationSchemaText from '../../schemas/config/m2-presentation.schema.json?raw'

import {
  decodeBrowserPng,
  loadBrowserConfigWithAssets,
  type BrowserConfigLoaderOptions,
  type PngDecoder,
} from './browser-loader'
import {
  selectM2AppearanceValidationTargets,
  validateAppearancePngHeader,
  validateM2AppearanceMap,
} from './assets'
import { configIssue, type ConfigIssue } from './errors'
import { computeSimulationContentFingerprint } from './fingerprint'
import { createM2SimulationFingerprintInput } from './m2-fingerprint-input'
import { computeM2PresentationContentFingerprint } from './m2-presentation-fingerprint'
import type {
  M2GameplaySchemaBundle,
  NormalizedM2Config,
  RawM2GameplayConfig,
} from './m2-gameplay-model'
import {
  validateAndNormalizeM2GameplayConfig,
  validateM2GameplayManifest,
} from './m2-gameplay-validate'
import type { DecodedCompositionMap, RawConfigDocument } from './model'
import { parseConfigJsonDocument } from './strict-json'

const DEFAULT_MANIFEST_PATH = '/config/m2-config-set.json'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export interface BrowserM2GameplayLoaderOptions {
  readonly manifestPath?: string
  readonly fetch?: FetchLike
  readonly decodePng?: PngDecoder
}

export type BrowserM2GameplayLoadResult =
  | Readonly<{
      ok: true
      config: NormalizedM2Config
      compositionMaps: readonly DecodedCompositionMap[]
      simulationContentFingerprint: string
      presentationContentFingerprint: string
    }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

interface ManifestShape {
  readonly baseConfigSet: string
  readonly prototype: string
  readonly fireSources: string
  readonly pearlTypes: string
  readonly collector: string
  readonly interactions?: string
  readonly presentation: string
}

type DocumentLoadResult =
  | Readonly<{ ok: true; document: RawConfigDocument }>
  | Readonly<{ ok: false; issue: ConfigIssue }>

const schemas: M2GameplaySchemaBundle = Object.freeze({
  manifest: JSON.parse(manifestSchemaText) as Record<string, unknown>,
  prototype: JSON.parse(prototypeSchemaText) as Record<string, unknown>,
  fireSources: JSON.parse(fireSourcesSchemaText) as Record<string, unknown>,
  pearlTypes: JSON.parse(pearlTypesSchemaText) as Record<string, unknown>,
  collector: JSON.parse(collectorSchemaText) as Record<string, unknown>,
  interactions: JSON.parse(interactionsSchemaText) as Record<string, unknown>,
  presentation: JSON.parse(presentationSchemaText) as Record<string, unknown>,
})

async function fetchDocument(
  fetcher: FetchLike,
  filePath: string,
): Promise<DocumentLoadResult> {
  try {
    const response = await fetcher(filePath)
    if (!response.ok) {
      return {
        ok: false,
        issue: configIssue(
          'CONFIG_LOAD_FAILED',
          filePath,
          '',
          `M2 gameplay 配置加载失败：HTTP ${response.status}`,
        ),
      }
    }
    return parseConfigJsonDocument(await response.text(), filePath)
  } catch {
    return {
      ok: false,
      issue: configIssue(
        'CONFIG_LOAD_FAILED',
        filePath,
        '',
        'M2 gameplay 配置加载失败：网络请求未完成',
      ),
    }
  }
}

export async function loadBrowserM2GameplayConfig(
  options: BrowserM2GameplayLoaderOptions = {},
): Promise<BrowserM2GameplayLoadResult> {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const manifestLoad = await fetchDocument(fetcher, manifestPath)
  if (!manifestLoad.ok) return { ok: false, issues: [manifestLoad.issue] }

  const manifestIssues = validateM2GameplayManifest(manifestLoad.document, schemas)
  if (manifestIssues.length > 0) return { ok: false, issues: manifestIssues }
  const manifest = manifestLoad.document.value as ManifestShape

  const baseOptions: BrowserConfigLoaderOptions = {
    configSetPath: manifest.baseConfigSet,
    fetch: fetcher,
    ...(options.decodePng === undefined ? {} : { decodePng: options.decodePng }),
  }
  const [baseResult, ...documentLoads] = await Promise.all([
    loadBrowserConfigWithAssets(baseOptions),
    fetchDocument(fetcher, manifest.prototype),
    fetchDocument(fetcher, manifest.fireSources),
    fetchDocument(fetcher, manifest.pearlTypes),
    fetchDocument(fetcher, manifest.collector),
    ...(manifest.interactions === undefined
      ? []
      : [fetchDocument(fetcher, manifest.interactions)]),
    fetchDocument(fetcher, manifest.presentation),
  ])
  if (!baseResult.ok) return baseResult

  const loadIssues = documentLoads.flatMap((result) =>
    result.ok ? [] : [result.issue],
  )
  if (loadIssues.length > 0) return { ok: false, issues: loadIssues }
  const documents = documentLoads.map((result) => {
    if (!result.ok) throw new Error('unreachable')
    return result.document
  })
  const raw: RawM2GameplayConfig = {
    manifest: manifestLoad.document,
    prototype: documents[0]!,
    fireSources: documents[1]!,
    pearlTypes: documents[2]!,
    collector: documents[3]!,
    ...(manifest.interactions === undefined ? {} : { interactions: documents[4]! }),
    presentation: documents[manifest.interactions === undefined ? 4 : 5]!,
  }
  const gameplayResult = validateAndNormalizeM2GameplayConfig(
    raw,
    schemas,
    baseResult.config,
    manifest.baseConfigSet,
  )
  if (!gameplayResult.ok) return gameplayResult

  const decoder = options.decodePng ?? decodeBrowserPng
  const appearanceSelection = selectM2AppearanceValidationTargets(
    baseResult.config.materials,
    baseResult.compositionMaps,
    gameplayResult.config.prototype.inventoryBatches.map(
      (batch) => batch.materialDefinitionId,
    ),
    raw.prototype.filePath,
  )
  const appearanceIssues: ConfigIssue[] = [...appearanceSelection.issues]
  for (const target of appearanceSelection.targets) {
    let response: Response
    try {
      response = await fetcher(target.appearancePath)
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_NOT_FOUND',
          target.appearancePath,
          '',
          '已登记的材料外观图无法加载',
        ),
      )
      continue
    }
    if (!response.ok) {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_NOT_FOUND',
          target.appearancePath,
          '',
          `已登记的材料外观图不存在：HTTP ${response.status}`,
        ),
      )
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_NOT_FOUND',
          target.appearancePath,
          '',
          '已登记的材料外观图无法加载',
        ),
      )
      continue
    }
    const headerIssues = validateAppearancePngHeader(target.appearancePath, bytes)
    if (headerIssues.length > 0) {
      appearanceIssues.push(...headerIssues)
      continue
    }
    try {
      const decoded = await decoder(bytes, target.appearancePath)
      appearanceIssues.push(
        ...validateM2AppearanceMap(
          decoded,
          target.composition,
        ),
      )
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_INVALID_PNG',
          target.appearancePath,
          '',
          '已登记的材料外观图 PNG 解码失败',
        ),
      )
    }
  }
  if (appearanceIssues.length > 0) return { ok: false, issues: appearanceIssues }

  const fingerprint = await computeSimulationContentFingerprint(
    createM2SimulationFingerprintInput(
      baseResult.config,
      gameplayResult.config,
      baseResult.compositionMaps,
    ),
  )
  const presentationContentFingerprint =
    await computeM2PresentationContentFingerprint(gameplayResult.presentation)
  return {
    ok: true,
    config: Object.freeze({
      schemaVersion: 1,
      base: baseResult.config,
      gameplay: gameplayResult.config,
      presentation: gameplayResult.presentation,
    }),
    compositionMaps: baseResult.compositionMaps,
    simulationContentFingerprint: fingerprint.simulationContentFingerprint,
    presentationContentFingerprint,
  }
}
