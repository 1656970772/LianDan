import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { generateM4MaterialAssets } from '../../../scripts/generate-m4-material-assets.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('M4 药材资产生成器', () => {
  it('从正式透明外观确定性生成 8 张成分图，重跑不改字节', () => {
    const root = mkdtempSync(join(tmpdir(), 'liandan-m4-assets-'))
    roots.push(root)
    cpSync(
      fileURLToPath(new URL('../../../public/assets/materials/', import.meta.url)),
      join(root, 'public', 'assets', 'materials'),
      { recursive: true },
    )

    const first = generateM4MaterialAssets(root)
    const second = generateM4MaterialAssets(root)

    expect(first).toHaveLength(8)
    expect(first.every((result) => result.compositionChanged)).toBe(true)
    expect(second.every(
      (result) => !result.appearanceChanged && !result.compositionChanged,
    )).toBe(true)
    for (const result of second) {
      const counts = result.componentPixelCounts
      const total = counts.medicinalLiquid + counts.slag + counts.impurity
      expect(counts.medicinalLiquid / total).toBeCloseTo(0.25, 2)
      expect(counts.slag / total).toBeCloseTo(0.6, 2)
      expect(counts.impurity / total).toBeCloseTo(0.15, 2)
    }
  })
})
