import Ajv2020 from 'ajv/dist/2020.js'

import schemaText from '../../schemas/config/m5-visual-performance.schema.json?raw'
import { configIssue, type ConfigIssue } from './errors.ts'
import {
  validateM5VisualPerformanceFixtureSemantics,
  type M5VisualPerformanceFixture,
} from './m5-visual-performance-fixture.ts'
import { parseConfigJsonDocument } from './strict-json.ts'

const DEFAULT_FIXTURE_PATH = '/config/performance/m5-visual.json'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type BrowserM5VisualPerformanceLoaderOptions = Readonly<{
  fixturePath?: string
  fetch?: FetchLike
}>

export type BrowserM5VisualPerformanceLoadResult =
  | Readonly<{ ok: true; fixture: M5VisualPerformanceFixture }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

const schema = JSON.parse(schemaText) as object
const validateSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  strictNumbers: true,
  validateSchema: true,
}).compile(schema)

export async function loadBrowserM5VisualPerformanceFixture(
  options: BrowserM5VisualPerformanceLoaderOptions = {},
): Promise<BrowserM5VisualPerformanceLoadResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  let response: Response
  try {
    response = await fetcher(fixturePath)
  } catch {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_LOAD_FAILED',
          fixturePath,
          '',
          'M5 正式表现性能 fixture 网络加载失败',
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
          fixturePath,
          '',
          `M5 正式表现性能 fixture 加载失败：HTTP ${response.status}`,
        ),
      ],
    }
  }
  const document = parseConfigJsonDocument(await response.text(), fixturePath)
  if (!document.ok) return { ok: false, issues: [document.issue] }
  if (!validateSchema(document.document.value)) {
    return {
      ok: false,
      issues: (validateSchema.errors ?? []).map((error) =>
        configIssue(
          'CONFIG_SCHEMA_VIOLATION',
          fixturePath,
          error.instancePath,
          `M5 正式表现性能 fixture 不符合 Schema：${error.message ?? error.keyword}`,
        ),
      ),
    }
  }
  const fixture = document.document.value as M5VisualPerformanceFixture
  const semanticIssues = validateM5VisualPerformanceFixtureSemantics(fixture)
  if (semanticIssues.length > 0) {
    return {
      ok: false,
      issues: semanticIssues.map((issue) =>
        configIssue(
          'CONFIG_RUNTIME_INCOMPATIBLE',
          fixturePath,
          issue.fieldPath,
          `${issue.code}：${issue.messageZh}`,
        ),
      ),
    }
  }
  return { ok: true, fixture }
}
