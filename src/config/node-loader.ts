import { readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

import { configIssue } from './errors'
import type { ConfigSchemaBundle, JsonSchema, RawConfigSet } from './model'
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

export function loadAndValidatePublicConfig(projectRoot: string): ConfigValidationResult {
  const schemas = loadConfigSchemaBundle(projectRoot)
  const configSetPath = '/config/config-set.json'
  const manifestLoad = loadDocument(projectRoot, configSetPath)
  if (!manifestLoad.ok) return { ok: false, issues: [manifestLoad.issue] }
  const manifestDocument = manifestLoad.document
  const manifestIssues = validateConfigSetManifest(manifestDocument, schemas)
  if (manifestIssues.length > 0) return { ok: false, issues: manifestIssues }
  const manifest = manifestDocument.value as { parameters: string; materials: string[] }
  const parametersLoad = loadDocument(projectRoot, manifest.parameters)
  const materialLoads = manifest.materials.map((path) =>
    loadDocument(projectRoot, path),
  )
  const loadIssues = [parametersLoad, ...materialLoads].flatMap((result) =>
    result.ok ? [] : [result.issue],
  )
  if (loadIssues.length > 0) return { ok: false, issues: loadIssues }
  if (!parametersLoad.ok) throw new Error('unreachable')
  const raw: RawConfigSet = {
    configSet: manifestDocument,
    parameters: parametersLoad.document,
    materials: materialLoads.map((result) => {
      if (!result.ok) throw new Error('unreachable')
      return result.document
    }),
  }
  return validateAndNormalizeConfigSet(raw, schemas)
}
