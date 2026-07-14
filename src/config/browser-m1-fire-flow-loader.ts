import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'

import schemaText from '../../schemas/config/m1-fire-flow-performance.schema.json?raw'

import { configIssue, type ConfigIssue } from './errors.ts'
import {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
} from './m1-fire-flow-fixture.ts'
import { parseConfigJsonDocument } from './strict-json.ts'

const DEFAULT_FIXTURE_PATH = '/config/performance/m1-fire-flow.json'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface BrowserM1FireFlowLoaderOptions {
  readonly filePath?: string
  readonly fetch?: FetchLike
}

export type BrowserM1FireFlowLoadResult =
  | Readonly<{ ok: true; fixture: M1FireFlowFixture }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictNumbers: true,
  validateSchema: true,
})
const validateFixtureSchema = ajv.compile(JSON.parse(schemaText) as object)

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function schemaIssue(filePath: string, error: ErrorObject): ConfigIssue {
  let fieldPath = error.instancePath
  if (error.keyword === 'required') {
    fieldPath = `${fieldPath}/${escapeJsonPointerSegment(
      String(error.params.missingProperty),
    )}`
  }
  if (error.keyword === 'additionalProperties') {
    fieldPath = `${fieldPath}/${escapeJsonPointerSegment(
      String(error.params.additionalProperty),
    )}`
  }

  const code =
    error.keyword === 'required'
      ? 'CONFIG_REQUIRED_FIELD'
      : error.keyword === 'additionalProperties' ||
          error.keyword === 'unevaluatedProperties'
        ? 'CONFIG_UNKNOWN_FIELD'
        : error.keyword === 'type'
          ? 'CONFIG_INVALID_TYPE'
          : error.keyword === 'minimum' ||
              error.keyword === 'maximum' ||
              error.keyword === 'exclusiveMinimum' ||
              error.keyword === 'exclusiveMaximum'
            ? 'CONFIG_VALUE_OUT_OF_RANGE'
            : 'CONFIG_SCHEMA_VIOLATION'

  return configIssue(
    code,
    filePath,
    fieldPath,
    `M1 火流场景不符合 Schema：${error.message ?? error.keyword}`,
  )
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export async function loadBrowserM1FireFlowFixture(
  options: BrowserM1FireFlowLoaderOptions = {},
): Promise<BrowserM1FireFlowLoadResult> {
  const filePath = options.filePath ?? DEFAULT_FIXTURE_PATH
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)

  let response: Response
  try {
    response = await fetcher(filePath)
  } catch {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_LOAD_FAILED',
          filePath,
          '',
          'M1 火流场景加载失败：网络请求未完成',
        ),
      ],
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_LOAD_FAILED',
          filePath,
          '',
          `M1 火流场景加载失败：HTTP ${response.status}`,
        ),
      ],
    }
  }

  const parsed = parseConfigJsonDocument(await response.text(), filePath)
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] }

  if (!validateFixtureSchema(parsed.document.value)) {
    return {
      ok: false,
      issues: (validateFixtureSchema.errors ?? []).map((error) =>
        schemaIssue(filePath, error),
      ),
    }
  }

  const fixture = parsed.document.value as M1FireFlowFixture
  const semanticIssues = validateM1FireFlowFixtureSemantics(fixture)
  if (semanticIssues.length > 0) {
    return {
      ok: false,
      issues: semanticIssues.map((entry) =>
        configIssue(
          'CONFIG_SCHEMA_VIOLATION',
          filePath,
          entry.fieldPath,
          entry.messageZh,
        ),
      ),
    }
  }

  return { ok: true, fixture: deepFreeze(fixture) }
}
