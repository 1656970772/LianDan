import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  loadBrowserM1FireFlowFixture,
  type BrowserM1FireFlowLoaderOptions,
} from '../../config/browser-m1-fire-flow-loader.ts'

const FIXTURE_PATH = '/config/performance/m1-fire-flow.json'
const VALID_FIXTURE_TEXT = readFileSync(
  new URL('../../../public/config/performance/m1-fire-flow.json', import.meta.url),
  'utf8',
)

function loaderOptions(text: string): BrowserM1FireFlowLoaderOptions {
  return {
    fetch: async (input) =>
      String(input) === FIXTURE_PATH
        ? new Response(text, {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
        : new Response('', { status: 404 }),
  }
}

describe('loadBrowserM1FireFlowFixture', () => {
  it('加载、校验并深冻结 M1 浏览器 fixture', async () => {
    const result = await loadBrowserM1FireFlowFixture(
      loaderOptions(VALID_FIXTURE_TEXT),
    )

    expect(result).toMatchObject({
      ok: true,
      fixture: {
        id: 'm1-fire-flow',
        technicalProbes: [
          { id: 'pillar' },
          { id: 'gap' },
          { id: 'crowd' },
        ],
        performanceScenarios: [
          { id: 'm1-900', activePearlCount: 900 },
          { id: 'm1-2400', activePearlCount: 2400 },
        ],
      },
    })
    if (result.ok) {
      expect(Object.isFrozen(result.fixture)).toBe(true)
      expect(Object.isFrozen(result.fixture.technicalProbes[0])).toBe(true)
    }
  })

  it('在 JSON.parse 前拒绝转义后重复的逻辑键', async () => {
    const duplicate = VALID_FIXTURE_TEXT.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1, "schema\\u0056ersion": 1,',
    )

    const result = await loadBrowserM1FireFlowFixture(loaderOptions(duplicate))

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'CONFIG_DUPLICATE_JSON_KEY',
          filePath: FIXTURE_PATH,
          fieldPath: '/schemaVersion',
          messageZh: 'JSON 对象包含重复键“schemaVersion”',
        },
      ],
    })
  })

  it('Schema 通过后仍拒绝重复探针 ID 的语义错误', async () => {
    const fixture = JSON.parse(VALID_FIXTURE_TEXT) as {
      technicalProbes: Array<{ id: string }>
    }
    fixture.technicalProbes[1]!.id = 'pillar'

    const result = await loadBrowserM1FireFlowFixture(
      loaderOptions(JSON.stringify(fixture)),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'CONFIG_SCHEMA_VIOLATION',
            filePath: FIXTURE_PATH,
            fieldPath: '/technicalProbes/1/id',
          }),
        ]),
      )
      expect(
        result.issues.find((issue) => issue.fieldPath === '/technicalProbes/1/id')
          ?.messageZh,
      ).toContain('pillar')
    }
  })
})
