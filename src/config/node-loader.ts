import { readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

import { PNG } from 'pngjs'

import {
  canonicalizeCompositionMap,
  isolateDecodedCompositionMap,
  validateCompositionMap,
  validateCompositionPngHeader,
} from './assets'
import { configIssue, type ConfigIssue } from './errors'
import type {
  ConfigSchemaBundle,
  DecodedCompositionMap,
  JsonSchema,
  NormalizedConfig,
  RawConfigSet,
} from './model'
import { parseConfigJsonDocument, parseStrictJson } from './strict-json'
import {
  validateAndNormalizeConfigSet,
  validateConfigSetManifest,
  type ConfigValidationResult,
} from './validate'

function readJson(filePath: string): unknown {
  const result = parseStrictJson(readFileSync(filePath, 'utf8'))
  if (!result.ok) throw new SyntaxError(`JSON 文件无效：${filePath}`)
  return result.value
}

export function loadConfigSchemaBundle(projectRoot: string): ConfigSchemaBundle {
  const schemaDirectory = resolve(projectRoot, 'schemas', 'config')
  const readSchema = (name: string): JsonSchema =>
    readJson(resolve(schemaDirectory, name)) as JsonSchema
  return {
    configSet: readSchema('config-set.schema.json'),
    parameters: readSchema('parameters.schema.json'),
    material: readSchema('material.schema.json'),
    tags: readSchema('tags.schema.json'),
  }
}

export function resolvePublicUrl(projectRoot: string, urlPath: string): string {
  if (!urlPath.startsWith('/') || isAbsolute(urlPath.slice(1))) {
    throw new Error('静态资源路径必须是站点绝对 URL')
  }
  const publicRoot = resolve(projectRoot, 'public')
  const resolved = resolve(publicRoot, urlPath.slice(1))
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${sep}`)) {
    throw new Error('静态资源路径越界')
  }
  return resolved
}

function loadDocument(
  projectRoot: string,
  urlPath: string,
): ReturnType<typeof parseConfigJsonDocument> {
  try {
    return parseConfigJsonDocument(
      readFileSync(resolvePublicUrl(projectRoot, urlPath), 'utf8'),
      urlPath,
    )
  } catch {
    return {
      ok: false,
      issue: configIssue(
        'CONFIG_LOAD_FAILED',
        urlPath,
        '',
        '配置文件无法读取',
      ),
    }
  }
}

export function loadAndValidatePublicConfig(
  projectRoot: string,
  configSetPath = '/config/config-set.json',
): ConfigValidationResult {
  const schemas = loadConfigSchemaBundle(projectRoot)
  const manifestLoad = loadDocument(projectRoot, configSetPath)
  if (!manifestLoad.ok) return { ok: false, issues: [manifestLoad.issue] }
  const manifestDocument = manifestLoad.document
  const manifestIssues = validateConfigSetManifest(manifestDocument, schemas)
  if (manifestIssues.length > 0) return { ok: false, issues: manifestIssues }
  const manifest = manifestDocument.value as {
    parameters: string
    tags?: string
    materials: string[]
  }
  const parametersLoad = loadDocument(projectRoot, manifest.parameters)
  const tagsLoad =
    manifest.tags === undefined ? undefined : loadDocument(projectRoot, manifest.tags)
  const materialLoads = manifest.materials.map((path) =>
    loadDocument(projectRoot, path),
  )
  const loadIssues = [parametersLoad, ...(tagsLoad === undefined ? [] : [tagsLoad]), ...materialLoads].flatMap((result) =>
    result.ok ? [] : [result.issue],
  )
  if (loadIssues.length > 0) return { ok: false, issues: loadIssues }
  if (!parametersLoad.ok) throw new Error('unreachable')
  const raw: RawConfigSet = {
    configSet: manifestDocument,
    parameters: parametersLoad.document,
    ...(tagsLoad?.ok === true ? { tags: tagsLoad.document } : {}),
    materials: materialLoads.map((result) => {
      if (!result.ok) throw new Error('unreachable')
      return result.document
    }),
  }
  return validateAndNormalizeConfigSet(raw, schemas)
}

export type NodeConfigWithAssetsLoadResult =
  | Readonly<{
      ok: true
      config: NormalizedConfig
      compositionMaps: readonly DecodedCompositionMap[]
    }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

export function loadAndValidatePublicConfigWithAssets(
  projectRoot: string,
  configSetPath = '/config/config-set.json',
): NodeConfigWithAssetsLoadResult {
  const configResult = loadAndValidatePublicConfig(projectRoot, configSetPath)
  if (!configResult.ok) return configResult

  const maps: DecodedCompositionMap[] = []
  const issues: ConfigIssue[] = []
  for (const material of configResult.config.materials) {
    const filePath = material.compositionMapPath
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(resolvePublicUrl(projectRoot, filePath)))
    } catch {
      issues.push(
        configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', '已登记的成分图文件不存在'),
      )
      continue
    }
    const headerIssues = validateCompositionPngHeader(filePath, bytes)
    if (headerIssues.length > 0) {
      issues.push(...headerIssues)
      continue
    }
    try {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      const map = canonicalizeCompositionMap({
        filePath,
        width: decoded.width,
        height: decoded.height,
        rgba: Uint8Array.from(decoded.data),
      })
      const mapIssues = validateCompositionMap(map)
      if (mapIssues.length > 0) issues.push(...mapIssues)
      else maps.push(map)
    } catch {
      issues.push(
        configIssue(
          'CONFIG_ASSET_INVALID_PNG',
          filePath,
          '',
          '已登记的成分图 PNG 解码失败',
        ),
      )
    }
  }
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        config: configResult.config,
        compositionMaps: Object.freeze(maps.map(isolateDecodedCompositionMap)),
      }
}
