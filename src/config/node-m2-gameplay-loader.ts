import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PNG } from 'pngjs'

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
import type { DecodedCompositionMap, JsonSchema, RawConfigDocument } from './model'
import {
  loadAndValidatePublicConfigWithAssets,
  resolvePublicUrl,
} from './node-loader'
import { parseConfigJsonDocument, parseStrictJson } from './strict-json'

const DEFAULT_MANIFEST_PATH = '/config/m2-config-set.json'

export type NodeM2GameplayLoadResult =
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
}

type DocumentLoadResult =
  | Readonly<{ ok: true; document: RawConfigDocument }>
  | Readonly<{ ok: false; issue: ConfigIssue }>

function loadSchemas(projectRoot: string): M2GameplaySchemaBundle {
  const schemaDirectory = resolve(projectRoot, 'schemas', 'config')
  const readSchema = (fileName: string): JsonSchema => {
    const parsed = parseStrictJson(
      readFileSync(resolve(schemaDirectory, fileName), 'utf8'),
    )
    if (!parsed.ok) throw new SyntaxError(`JSON Schema 无效：${fileName}`)
    return parsed.value as JsonSchema
  }
  return {
    manifest: readSchema('m2-config-set.schema.json'),
    prototype: readSchema('m2-prototype.schema.json'),
    fireSources: readSchema('m2-fire-sources.schema.json'),
    pearlTypes: readSchema('m2-pearl-types.schema.json'),
    collector: readSchema('m2-collector.schema.json'),
  }
}

function loadDocument(projectRoot: string, filePath: string): DocumentLoadResult {
  try {
    return parseConfigJsonDocument(
      readFileSync(resolvePublicUrl(projectRoot, filePath), 'utf8'),
      filePath,
    )
  } catch {
    return {
      ok: false,
      issue: configIssue(
        'CONFIG_LOAD_FAILED',
        filePath,
        '',
        'M2 gameplay 配置文件无法读取',
      ),
    }
  }
}

export async function loadAndValidatePublicM2GameplayConfig(
  projectRoot: string,
  manifestPath = DEFAULT_MANIFEST_PATH,
): Promise<NodeM2GameplayLoadResult> {
  let schemas: M2GameplaySchemaBundle
  try {
    schemas = loadSchemas(projectRoot)
  } catch {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_LOAD_FAILED',
          manifestPath,
          '',
          'M2 gameplay Schema 无法读取',
        ),
      ],
    }
  }

  const manifestLoad = loadDocument(projectRoot, manifestPath)
  if (!manifestLoad.ok) return { ok: false, issues: [manifestLoad.issue] }
  const manifestIssues = validateM2GameplayManifest(manifestLoad.document, schemas)
  if (manifestIssues.length > 0) return { ok: false, issues: manifestIssues }
  const manifest = manifestLoad.document.value as ManifestShape

  const baseResult = loadAndValidatePublicConfigWithAssets(
    projectRoot,
    manifest.baseConfigSet,
  )
  if (!baseResult.ok) return baseResult

  const documentLoads = [
    loadDocument(projectRoot, manifest.prototype),
    loadDocument(projectRoot, manifest.fireSources),
    loadDocument(projectRoot, manifest.pearlTypes),
    loadDocument(projectRoot, manifest.collector),
  ]
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
  }
  const gameplayResult = validateAndNormalizeM2GameplayConfig(
    raw,
    schemas,
    baseResult.config,
    manifest.baseConfigSet,
  )
  if (!gameplayResult.ok) return gameplayResult

  const compositionByPath = new Map(
    baseResult.compositionMaps.map((map) => [map.filePath, map] as const),
  )
  const materialsById = new Map(
    baseResult.config.materials.map((material) => [material.id, material] as const),
  )
  const appearanceIssues: ConfigIssue[] = []
  const requiredMaterialIds = new Set(
    gameplayResult.config.prototype.inventoryBatches.map(
      (batch) => batch.materialDefinitionId,
    ),
  )
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
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(
        readFileSync(resolvePublicUrl(projectRoot, material.appearancePath)),
      )
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_NOT_FOUND',
          material.appearancePath,
          '',
          '已登记的材料外观图文件不存在',
        ),
      )
      continue
    }
    const headerIssues = validateAppearancePngHeader(material.appearancePath, bytes)
    if (headerIssues.length > 0) {
      appearanceIssues.push(...headerIssues)
      continue
    }
    try {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      const composition = compositionByPath.get(material.compositionMapPath)!
      appearanceIssues.push(
        ...validateM2AppearanceMap(
          {
            filePath: material.appearancePath,
            width: decoded.width,
            height: decoded.height,
            rgba: Uint8Array.from(decoded.data),
          },
          composition,
        ),
      )
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_INVALID_PNG',
          material.appearancePath,
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
