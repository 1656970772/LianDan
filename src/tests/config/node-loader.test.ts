import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadAndValidatePublicConfig } from '../../config/node-loader'
import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader'

const fixtureRoots: string[] = []

function createConfigFixture(
  overrides: Readonly<Record<string, string>>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'liandan-config-'))
  fixtureRoots.push(root)
  cpSync(
    fileURLToPath(new URL('../../../schemas/config/', import.meta.url)),
    join(root, 'schemas', 'config'),
    { recursive: true },
  )
  mkdirSync(join(root, 'public', 'config', 'materials'), { recursive: true })
  const documents: Record<string, string> = {
    '/config/config-set.json': JSON.stringify({
      schemaVersion: 1,
      parameters: '/config/parameters.json',
      materials: ['/config/materials/prototype-herb.json'],
    }),
    '/config/parameters.json': JSON.stringify({ schemaVersion: 1 }),
    '/config/materials/prototype-herb.json': JSON.stringify({
      schemaVersion: 1,
      id: 'prototype-herb',
      nameZh: '原型药材',
      compositionMapPath: '/assets/masks/prototype-herb-components.png',
    }),
    ...overrides,
  }
  for (const [urlPath, text] of Object.entries(documents)) {
    writeFileSync(join(root, 'public', ...urlPath.split('/').slice(1)), text)
  }
  return root
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('loadAndValidatePublicConfig strict JSON boundary', () => {
  it.each([
    {
      filePath: '/config/config-set.json',
      fieldPath: '/parameters',
      raw: '{"schemaVersion":1,"parameters":"/config/parameters.json","param\\u0065ters":"/config/other.json","materials":["/config/materials/prototype-herb.json"]}',
    },
    {
      filePath: '/config/parameters.json',
      fieldPath: '/standardPearlVolume',
      raw: '{"schemaVersion":1,"standardPearlVolume":1,"standardPearlVolume":2}',
    },
    {
      filePath: '/config/materials/prototype-herb.json',
      fieldPath: '/id',
      raw: '{"schemaVersion":1,"id":"prototype-herb","\\u0069d":"other","nameZh":"原型药材","compositionMapPath":"/assets/masks/prototype-herb-components.png"}',
    },
  ])('在 Node 加载阶段拒绝 $filePath 重复键', ({ filePath, fieldPath, raw }) => {
    const result = loadAndValidatePublicConfig(
      createConfigFixture({ [filePath]: raw }),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'CONFIG_DUPLICATE_JSON_KEY',
          filePath,
          fieldPath,
        },
      ],
    })
  })
})

describe('loadAndValidatePublicM2GameplayConfig', () => {
  it('加载仓库正式 M2 配置并返回统一 fingerprint', async () => {
    const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
    const result = await loadAndValidatePublicM2GameplayConfig(projectRoot)

    expect(result).toMatchObject({
      ok: true,
      config: {
        base: { materials: [{ id: 'prototype-herb' }] },
        gameplay: {
          prototype: { fireSizeWheelStep: 4 },
          pearlType: { pearlType: 'medicinalLiquid', materialRestitution: 0.25 },
        },
      },
      compositionMaps: [
        expect.objectContaining({
          filePath: '/assets/masks/prototype-herb-components.png',
        }),
      ],
      simulationContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    if (result.ok) {
      expect(Object.isFrozen(result.compositionMaps)).toBe(true)
      const map = result.compositionMaps[0]!
      const original = map.rgba[0]!
      map.rgba[0] = original ^ 0xff
      expect(map.rgba[0]).toBe(original)
    }
  })
})
