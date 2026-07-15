import {
  canonicalizeCompositionMap,
  isolateDecodedCompositionMap,
  validateCompositionMap,
  validateCompositionPngHeader,
} from './assets'
import { browserConfigSchemaBundle } from './browser-schema-bundle'
import { configIssue, type ConfigIssue } from './errors'
import { computeSimulationContentFingerprint } from './fingerprint'
import { createSimulationFingerprintInput } from './fingerprint-input'
import type {
  DecodedCompositionMap,
  NormalizedConfig,
  RawConfigDocument,
  RawConfigSet,
} from './model'
import { parseConfigJsonDocument } from './strict-json'
import {
  validateAndNormalizeConfigSet,
  validateConfigSetManifest,
} from './validate'

export type BrowserConfigLoadResult =
  | {
      readonly ok: true
      readonly config: NormalizedConfig
      readonly simulationContentFingerprint: string
    }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }

export type BrowserConfigWithAssetsLoadResult =
  | {
      readonly ok: true
      readonly config: NormalizedConfig
      readonly compositionMaps: readonly DecodedCompositionMap[]
      readonly simulationContentFingerprint: string
    }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type PngDecoder = (
  bytes: Uint8Array,
  filePath: string,
) => Promise<DecodedCompositionMap>

export interface BrowserConfigLoaderOptions {
  readonly configSetPath?: string
  readonly fetch?: FetchLike
  readonly decodePng?: PngDecoder
}

interface ManifestShape {
  readonly parameters: string
  readonly tags?: string
  readonly materials: string[]
}

type DocumentLoadResult =
  | { readonly ok: true; readonly document: RawConfigDocument }
  | { readonly ok: false; readonly issue: ConfigIssue }

async function fetchJsonDocument(
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
          `配置加载失败：HTTP ${response.status}`,
        ),
      }
    }
    try {
      return parseConfigJsonDocument(await response.text(), filePath)
    } catch {
      return {
        ok: false,
        issue: configIssue(
          'CONFIG_LOAD_FAILED',
          filePath,
          '',
          '配置加载失败：内容不是有效 JSON',
        ),
      }
    }
  } catch {
    return {
      ok: false,
      issue: configIssue(
        'CONFIG_LOAD_FAILED',
        filePath,
        '',
        '配置加载失败：网络请求未完成',
      ),
    }
  }
}

export async function decodeBrowserPng(
  bytes: Uint8Array,
  filePath: string,
): Promise<DecodedCompositionMap> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as BlobPart], { type: 'image/png' }),
    { colorSpaceConversion: 'none', premultiplyAlpha: 'none' },
  )
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Canvas 2D 不可用')
    context.drawImage(bitmap, 0, 0)
    return {
      filePath,
      width: bitmap.width,
      height: bitmap.height,
      rgba: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
    }
  } finally {
    bitmap.close()
  }
}

async function loadCompositionMap(
  fetcher: FetchLike,
  decoder: PngDecoder,
  filePath: string,
): Promise<{ map?: DecodedCompositionMap; issues: readonly ConfigIssue[] }> {
  let response: Response
  try {
    response = await fetcher(filePath)
  } catch {
    return {
      issues: [configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', '已登记的成分图无法加载')],
    }
  }
  if (!response.ok) {
    return {
      issues: [configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', `已登记的成分图不存在：HTTP ${response.status}`)],
    }
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch {
    return {
      issues: [configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', '已登记的成分图无法加载')],
    }
  }
  const headerIssues = validateCompositionPngHeader(filePath, bytes)
  if (headerIssues.length > 0) return { issues: headerIssues }
  try {
    const map = canonicalizeCompositionMap(await decoder(bytes, filePath))
    const issues = validateCompositionMap(map)
    return issues.length === 0 ? { map, issues } : { issues }
  } catch {
    return {
      issues: [configIssue('CONFIG_ASSET_INVALID_PNG', filePath, '', '已登记的成分图 PNG 解码失败')],
    }
  }
}

export async function loadBrowserConfigWithAssets(
  options: BrowserConfigLoaderOptions = {},
): Promise<BrowserConfigWithAssetsLoadResult> {
  const configSetPath = options.configSetPath ?? '/config/config-set.json'
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const decoder = options.decodePng ?? decodeBrowserPng
  try {
    const manifestLoad = await fetchJsonDocument(fetcher, configSetPath)
    if (!manifestLoad.ok) return { ok: false, issues: [manifestLoad.issue] }

    const manifestIssues = validateConfigSetManifest(
      manifestLoad.document,
      browserConfigSchemaBundle,
    )
    if (manifestIssues.length > 0) return { ok: false, issues: manifestIssues }
    const manifest = manifestLoad.document.value as ManifestShape

    const documentLoads = await Promise.all([
      fetchJsonDocument(fetcher, manifest.parameters),
      ...(manifest.tags === undefined
        ? []
        : [fetchJsonDocument(fetcher, manifest.tags)]),
      ...manifest.materials.map((filePath) => fetchJsonDocument(fetcher, filePath)),
    ])
    const loadIssues = documentLoads.flatMap((result) =>
      result.ok ? [] : [result.issue],
    )
    if (loadIssues.length > 0) return { ok: false, issues: loadIssues }
    const documents = documentLoads.map((result) => {
      if (!result.ok) throw new Error('unreachable')
      return result.document
    })
    const materialOffset = manifest.tags === undefined ? 1 : 2
    const raw: RawConfigSet = {
      configSet: manifestLoad.document,
      parameters: documents[0]!,
      ...(manifest.tags === undefined ? {} : { tags: documents[1]! }),
      materials: documents.slice(materialOffset),
    }
    const validated = validateAndNormalizeConfigSet(raw, browserConfigSchemaBundle)
    if (!validated.ok) return validated

    const assetLoads = await Promise.all(
      validated.config.materials.map((material) =>
        loadCompositionMap(fetcher, decoder, material.compositionMapPath),
      ),
    )
    const assetIssues = assetLoads.flatMap((result) => result.issues)
    if (assetIssues.length > 0) return { ok: false, issues: assetIssues }
    const maps = assetLoads.map((result) => {
      if (result.map === undefined) throw new Error('unreachable')
      return result.map
    })
    const readonlyMaps = Object.freeze(maps.map(isolateDecodedCompositionMap))
    const fingerprint = await computeSimulationContentFingerprint(
      createSimulationFingerprintInput(validated.config, readonlyMaps),
    )
    return {
      ok: true,
      config: validated.config,
      compositionMaps: readonlyMaps,
      simulationContentFingerprint: fingerprint.simulationContentFingerprint,
    }
  } catch {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_LOAD_FAILED',
          configSetPath,
          '',
          '配置加载失败：未预期的加载器错误',
        ),
      ],
    }
  }
}

export async function loadBrowserConfig(
  options: BrowserConfigLoaderOptions = {},
): Promise<BrowserConfigLoadResult> {
  const result = await loadBrowserConfigWithAssets(options)
  if (!result.ok) return result
  return {
    ok: true,
    config: result.config,
    simulationContentFingerprint: result.simulationContentFingerprint,
  }
}
