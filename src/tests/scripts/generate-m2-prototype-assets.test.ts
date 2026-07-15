import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createPrototypeAppearance,
  generateM2PrototypeAssets,
  normalizePrototypeComposition,
} from '../../../scripts/generate-m2-prototype-assets.ts'

const temporaryDirectories: string[] = []

function createComposition(): PNG {
  const image = new PNG({ width: 64, height: 64 })
  for (let y = 12; y < 52; y += 1) {
    for (let x = 12; x < 52; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = (x * 7) % 255
      image.data[offset + 1] = (y * 11) % 255
      image.data[offset + 2] = 96
      image.data[offset + 3] = x === 20 && y === 20 ? 128 : 255
    }
  }
  return image
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('M2 原型药材素材生成', () => {
  test('成分图将所有非透明像素规范化为单一药液青', () => {
    const normalized = normalizePrototypeComposition(createComposition())

    for (let offset = 0; offset < normalized.data.length; offset += 4) {
      if (normalized.data[offset + 3] === 0) {
        expect(Array.from(normalized.data.subarray(offset, offset + 4))).toEqual([
          0, 0, 0, 0,
        ])
      } else {
        expect(Array.from(normalized.data.subarray(offset, offset + 4))).toEqual([
          0, 255, 255, 255,
        ])
      }
    }
  })

  test('512 外观图与 64 成分轮廓严格对齐，描边位于轮廓内', () => {
    const normalized = normalizePrototypeComposition(createComposition())
    const appearance = createPrototypeAppearance(normalized)

    expect(appearance.width).toBe(512)
    expect(appearance.height).toBe(512)
    for (let y = 0; y < appearance.height; y += 1) {
      for (let x = 0; x < appearance.width; x += 1) {
        const sourceOffset =
          (Math.floor(y / 8) * normalized.width + Math.floor(x / 8)) * 4
        const appearanceOffset = (y * appearance.width + x) * 4
        expect(appearance.data[appearanceOffset + 3] > 0).toBe(
          normalized.data[sourceOffset + 3] > 0,
        )
      }
    }

    const boundaryOffset = (96 * appearance.width + 96) * 4
    const interiorOffset = (256 * appearance.width + 256) * 4
    const boundaryColor = Array.from(
      appearance.data.subarray(boundaryOffset, boundaryOffset + 4),
    )
    const interiorColor = Array.from(
      appearance.data.subarray(interiorOffset, interiorOffset + 4),
    )
    expect(boundaryColor[3]).toBe(255)
    expect(interiorColor[3]).toBe(255)
    expect(boundaryColor).not.toEqual(interiorColor)
    expect(boundaryColor[0]).toBeLessThan(interiorColor[0]!)
    expect(boundaryColor[1]).toBeLessThan(interiorColor[1]!)
  })

  test('生成脚本幂等，第二次运行不重写任何产物', () => {
    const directory = mkdtempSync(join(tmpdir(), 'liandan-m2-assets-'))
    temporaryDirectories.push(directory)
    const compositionPath = join(directory, 'prototype-herb-components.png')
    const appearancePath = join(directory, 'prototype-herb.png')
    writeFileSync(compositionPath, PNG.sync.write(createComposition()))

    const first = generateM2PrototypeAssets({
      compositionPath,
      appearancePath,
    })
    const compositionAfterFirst = readFileSync(compositionPath)
    const appearanceAfterFirst = readFileSync(appearancePath)
    const second = generateM2PrototypeAssets({
      compositionPath,
      appearancePath,
    })

    expect(first).toEqual({
      compositionChanged: true,
      appearanceChanged: true,
    })
    expect(second).toEqual({
      compositionChanged: false,
      appearanceChanged: false,
    })
    expect(readFileSync(compositionPath)).toEqual(compositionAfterFirst)
    expect(readFileSync(appearancePath)).toEqual(appearanceAfterFirst)
  })
})
