import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PNG } from 'pngjs'

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
    interactions: readSchema('m2-interactions.schema.json'),
    presentation: readSchema('m2-presentation.schema.json'),
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
    ...(manifest.interactions === undefined
      ? []
      : [loadDocument(projectRoot, manifest.interactions)]),
    loadDocument(projectRoot, manifest.presentation),
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
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(
        readFileSync(resolvePublicUrl(projectRoot, target.appearancePath)),
      )
    } catch {
      appearanceIssues.push(
        configIssue(
          'CONFIG_ASSET_NOT_FOUND',
          target.appearancePath,
          '',
          '已登记的材料外观图文件不存在',
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
      const decoded = PNG.sync.read(Buffer.from(bytes))
      appearanceIssues.push(
        ...validateM2AppearanceMap(
          {
            filePath: target.appearancePath,
            width: decoded.width,
            height: decoded.height,
            rgba: Uint8Array.from(decoded.data),
          },
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
