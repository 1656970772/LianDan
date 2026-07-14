import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  loadBrowserConfig,
  type BrowserConfigLoaderOptions,
} from '../../config/browser-loader'

const CONFIG_SET = {
  schemaVersion: 1,
  parameters: '/config/parameters.json',
  materials: ['/config/materials/prototype-herb.json'],
}
const MATERIAL = {
  schemaVersion: 1,
  id: 'prototype-herb',
  nameZh: '原型药材',
  compositionMapPath: '/assets/masks/prototype-herb-components.png',
}

function validPng(): Uint8Array {
  const png = new PNG({ width: 64, height: 64 })
  png.data.fill(0)
  png.data.set([0, 255, 255, 255], 0)
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6 })
}

function loaderOptions(
  parameters: unknown = { schemaVersion: 1 },
  rawDocuments: Readonly<Record<string, string>> = {},
): BrowserConfigLoaderOptions & {
  requests: string[]
} {
  const requests: string[] = []
  const jsonByPath = new Map<string, unknown>([
    ['/config/config-set.json', CONFIG_SET],
    ['/config/parameters.json', parameters],
    ['/config/materials/prototype-herb.json', MATERIAL],
  ])
  const png = validPng()
  return {
    requests,
    fetch: async (input) => {
      const path = String(input)
      requests.push(path)
      if (path === MATERIAL.compositionMapPath) {
        return new Response(Uint8Array.from(png).buffer)
      }
      if (Object.hasOwn(rawDocuments, path)) {
        return new Response(rawDocuments[path], {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      const json = jsonByPath.get(path)
      return json === undefined
        ? new Response('', { status: 404 })
        : Response.json(json)
    },
    decodePng: async (bytes, filePath) => {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      return {
        filePath,
        width: decoded.width,
        height: decoded.height,
        rgba: Uint8Array.from(decoded.data),
      }
    },
  }
}

describe('loadBrowserConfig', () => {
  it('真实请求 /config/parameters.json，返回深冻结配置和指纹', async () => {
    const options = loaderOptions()
    const result = await loadBrowserConfig(options)

    expect(options.requests).toContain('/config/parameters.json')
    expect(result).toMatchObject({
      ok: true,
      config: {
        parameters: {
          standardPearlVolume: 1,
          slagUnitVolume: 100,
          simulation: { fixedStepHz: 30, maxCatchUpSteps: 5 },
          flowField: {
            gridColumns: 80,
            gridRows: 45,
            cellSize: 20,
            circleCoverageSamplesPerAxis: 4,
            lateralSpread: 0.35,
            obstacleDeflection: 0.75,
            partialObstaclePenalty: 0.5,
            mergeRate: 0.15,
            fullObstacleThreshold: 0.95,
          },
        },
        materials: [{ targetPearlCount: 300 }],
      },
      simulationContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    if (result.ok) expect(Object.isFrozen(result.config.materials[0])).toBe(true)
  })

  it('将参数越界保持为稳定中文 ConfigIssue', async () => {
    const result = await loadBrowserConfig(
      loaderOptions({ schemaVersion: 1, standardPearlVolume: 0 }),
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          filePath: '/config/parameters.json',
          fieldPath: '/standardPearlVolume',
          messageZh: '标准珠体积必须是有限正数',
        },
      ],
    })
  })

  it.each(['network', 'json'] as const)('把 %s 加载异常收敛为 CONFIG_LOAD_FAILED', async (mode) => {
    const baseOptions = loaderOptions()
    const baseFetch = baseOptions.fetch!
    const options: BrowserConfigLoaderOptions = {
      ...baseOptions,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/config/parameters.json') {
          if (mode === 'network') throw new Error('offline')
          return new Response('{not-json')
        }
        return baseFetch(input, init)
      },
    }

    const result = await loadBrowserConfig(options)
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_LOAD_FAILED',
          filePath: '/config/parameters.json',
        },
      ],
    })
  })

  it.each([
    {
      filePath: '/config/config-set.json',
      fieldPath: '/parameters',
      messageZh: 'JSON 对象包含重复键“parameters”',
      raw: '{"schemaVersion":1,"parameters":"/config/parameters.json","param\\u0065ters":"/config/other.json","materials":["/config/materials/prototype-herb.json"]}',
    },
    {
      filePath: '/config/parameters.json',
      fieldPath: '/standardPearlVolume',
      messageZh: 'JSON 对象包含重复键“standardPearlVolume”',
      raw: '{"schemaVersion":1,"standardPearlVolume":1,"standardPearlVolume":2}',
    },
    {
      filePath: '/config/materials/prototype-herb.json',
      fieldPath: '/id',
      messageZh: 'JSON 对象包含重复键“id”',
      raw: '{"schemaVersion":1,"id":"prototype-herb","\\u0069d":"other","nameZh":"原型药材","compositionMapPath":"/assets/masks/prototype-herb-components.png"}',
    },
  ])('拒绝 $filePath 的重复 JSON 键', async ({ filePath, fieldPath, messageZh, raw }) => {
    const result = await loadBrowserConfig(
      loaderOptions(undefined, { [filePath]: raw }),
    )

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'CONFIG_DUPLICATE_JSON_KEY',
          filePath,
          fieldPath,
          messageZh,
        },
      ],
    })
  })
})
