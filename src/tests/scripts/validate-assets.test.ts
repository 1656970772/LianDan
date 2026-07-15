import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'

import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader'

const fixtureRoots: string[] = []
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const validateAssetsScript = join(projectRoot, 'scripts', 'validate-assets.ts')

function createFixture(appearance: Uint8Array): string {
  const root = mkdtempSync(join(tmpdir(), 'liandan-assets-'))
  fixtureRoots.push(root)
  cpSync(join(projectRoot, 'schemas'), join(root, 'schemas'), { recursive: true })
  cpSync(join(projectRoot, 'public'), join(root, 'public'), { recursive: true })

  const configSetPath = join(root, 'public', 'config', 'config-set.json')
  const configSet = JSON.parse(readFileSync(configSetPath, 'utf8')) as {
    materials: string[]
  }
  configSet.materials.push('/config/materials/unused-herb.json')
  writeFileSync(configSetPath, JSON.stringify(configSet))
  writeFileSync(
    join(root, 'public', 'config', 'materials', 'unused-herb.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'unused-herb',
      nameZh: '未投入药材',
      targetPearlCount: 1,
      compositionMapPath: '/assets/masks/prototype-herb-components.png',
      appearancePath: '/assets/materials/unused-herb.png',
    }),
  )
  writeFileSync(
    join(root, 'public', 'assets', 'materials', 'unused-herb.png'),
    appearance,
  )
  return root
}

function runGate(root: string) {
  return spawnSync(
    process.execPath,
    [tsxCli, validateAssetsScript, '--project-root', root],
    { cwd: projectRoot, encoding: 'utf8' },
  )
}

function corruptPngWithPlausibleHeader(): Uint8Array {
  const bytes = new Uint8Array(45)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13], 0)
  bytes.set(new TextEncoder().encode('IHDR'), 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 512, false)
  view.setUint32(20, 512, false)
  bytes[24] = 8
  bytes[25] = 6
  bytes.set([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130], 33)
  return bytes
}

function appearancePng(mutator?: (png: PNG) => void): Uint8Array {
  const png = new PNG({ width: 512, height: 512 })
  png.data.fill(0)
  mutator?.(png)
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6 })
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('validate-assets 全登记外观素材门禁', () => {
  it.each([
    ['可疑 header/IEND 但无法解码', corruptPngWithPlausibleHeader(), 'CONFIG_ASSET_INVALID_PNG'],
    ['全透明空图', appearancePng(), 'CONFIG_ASSET_EMPTY'],
    [
      'alpha 轮廓错位',
      appearancePng((png) => png.data.set([64, 128, 72, 255], 0)),
      'CONFIG_ASSET_INVALID_COLOR',
    ],
  ] as const)('拒绝未被 M2 库存引用的%s', async (_case, appearance, code) => {
    const root = createFixture(appearance)

    const runtimeLoad = await loadAndValidatePublicM2GameplayConfig(root)
    expect(runtimeLoad.ok).toBe(true)

    const gate = runGate(root)
    expect(gate.status).toBe(1)
    expect(`${gate.stdout}\n${gate.stderr}`).toContain(code)
    expect(`${gate.stdout}\n${gate.stderr}`).toContain('/assets/materials/unused-herb.png')
  })
})
