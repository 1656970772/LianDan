import collectorSchemaText from '../../schemas/config/m2-collector.schema.json?raw'
import fireSourcesSchemaText from '../../schemas/config/m2-fire-sources.schema.json?raw'
import manifestSchemaText from '../../schemas/config/m2-config-set.schema.json?raw'
import pearlTypesSchemaText from '../../schemas/config/m2-pearl-types.schema.json?raw'
import prototypeSchemaText from '../../schemas/config/m2-prototype.schema.json?raw'
import interactionsSchemaText from '../../schemas/config/m2-interactions.schema.json?raw'

import {
  decodeBrowserPng,
  loadBrowserConfigWithAssets,
  type BrowserConfigLoaderOptions,
  type PngDecoder,
} from './browser-loader'
import {
  validateAppearancePngHeader,
  validateM2AppearanceMap,
} from './assets'
import { configIssue, type ConfigIssue } from './errors'
import { computeSimulationContentFingerprint } from './fingerprint'
import { createM2SimulationFingerprintInput } from './m2-fingerprint-input'
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
    }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

interface ManifestShape {
  readonly baseConfigSet: string
  readonly prototype: string
  readonly fireSources: string
  readonly pearlTypes: string
  readonly collector: string
  readonly interactions?: string
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
  }
  const gameplayResult = validateAndNormalizeM2GameplayConfig(
    raw,
    schemas,
    baseResult.config,
    manifest.baseConfigSet,
  )
  if (!gameplayResult.ok) return gameplayResult

  const decoder = options.decodePng ?? decodeBrowserPng
  const compositionByPath = new Map(
    baseResult.compositionMaps.map((map) => [map.filePath, map] as const),
  )
  const materialsById = new Map(
    baseResult.config.materials.map((material) => [material.id, material] as const),
  )
  const requiredMaterialIds = new Set(
    gameplayResult.config.prototype.inventoryBatches.map(
      (batch) => batch.materialDefinitionId,
    ),
  )
  const appearanceIssues: ConfigIssue[] = []
  for (const materialId of requiredMaterialIds) {
    const material = materialsById.get(materialId)!
    if (material.appearancePath === undefined) {
      appearanceIssues.push(
        configIssue(
          'CONFIG_REQUIRED_FIELD',
          raw.prototype.filePath,
          '/inventoryBatches',
          `M2 库存材料 ${materialId} 必须登记 512×512 外观图`,
        ),
      )
      continue
    }
    try {
      const response = await fetcher(material.appearancePath)
      if (!response.ok) {
        appearanceIssues.push(
          configIssue(
            'CONFIG_ASSET_NOT_FOUND',
            material.appearancePath,
            '',
            `已登记的材料外观图不存在：HTTP ${response.status}`,
          ),
        )
        continue
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const headerIssues = validateAppearancePngHeader(material.appearancePath, bytes)
      if (headerIssues.length > 0) {
        appearanceIssues.push(...headerIssues)
        continue
      }
      const decoded = await decoder(bytes, material.appearancePath)
      appearanceIssues.push(
        ...validateM2AppearanceMap(
          decoded,
          compositionByPath.get(material.compositionMapPath)!,
        ),
      )
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_INVALID_PNG',
          material.appearancePath,
          '',
          '已登记的材料外观图 PNG 加载或解码失败',
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
  return {
    ok: true,
    config: Object.freeze({
      schemaVersion: 1,
      base: baseResult.config,
      gameplay: gameplayResult.config,
    }),
    compositionMaps: baseResult.compositionMaps,
    simulationContentFingerprint: fingerprint.simulationContentFingerprint,
  }
}
