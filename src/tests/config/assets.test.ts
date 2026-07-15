import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  canonicalizeCompositionMap,
  validateAppearancePngHeader,
  validateCompositionMap,
  validateM2AppearanceMap,
  validateM2MedicinalLiquidCompositionMap,
} from '../../config/assets'

function validPixels(): Uint8Array {
  const pixels = new Uint8Array(64 * 64 * 4)
  pixels.set([0x00, 0xff, 0xff, 0xff], 0)
  pixels.set([0x80, 0x80, 0x80, 0xff], 4)
  pixels.set([0x80, 0x00, 0x80, 0xff], 8)
  return pixels
}

describe('validateCompositionMap', () => {
  it('把全透明像素的隐藏 RGB 规范为零且不改写解码输入', () => {
    const rgba = validPixels()
    rgba.set([200, 100, 50, 0], 12)

    const canonical = canonicalizeCompositionMap({
      filePath: '/hidden-rgb.png',
      width: 64,
      height: 64,
      rgba,
    })

    expect(canonical.rgba.slice(12, 16)).toEqual(
      new Uint8Array([0, 0, 0, 0]),
    )
    expect(rgba.slice(12, 16)).toEqual(new Uint8Array([200, 100, 50, 0]))
    expect(validateCompositionMap(canonical)).toEqual([])
  })

  it('接受已解码的 64×64 正式成分图', () => {
    expect(
      validateCompositionMap({
        filePath: '/assets/masks/prototype-herb-components.png',
        width: 64,
        height: 64,
        rgba: validPixels(),
      }),
    ).toEqual([])
  })

  it.each([
    [63, 64, 'CONFIG_ASSET_INVALID_DIMENSIONS'],
    [64, 63, 'CONFIG_ASSET_INVALID_DIMENSIONS'],
  ])('拒绝错误尺寸 %sx%s', (width, height, code) => {
    expect(
      validateCompositionMap({
        filePath: '/asset.png',
        width,
        height,
        rgba: new Uint8Array(width * height * 4),
      }),
    ).toEqual([expect.objectContaining({ code })])
  })

  it('拒绝非法颜色、半透明与全空成分图', () => {
    const invalidColor = validPixels()
    invalidColor.set([1, 2, 3, 255], 12)
    const semitransparent = validPixels()
    semitransparent.set([0, 255, 255, 128], 12)

    expect(
      validateCompositionMap({ filePath: '/color.png', width: 64, height: 64, rgba: invalidColor }),
    ).toEqual([expect.objectContaining({ code: 'CONFIG_ASSET_INVALID_COLOR' })])
    expect(
      validateCompositionMap({ filePath: '/alpha.png', width: 64, height: 64, rgba: semitransparent }),
    ).toEqual([expect.objectContaining({ code: 'CONFIG_ASSET_INVALID_COLOR' })])
    expect(
      validateCompositionMap({
        filePath: '/empty.png',
        width: 64,
        height: 64,
        rgba: new Uint8Array(64 * 64 * 4),
      }),
    ).toEqual([expect.objectContaining({ code: 'CONFIG_ASSET_EMPTY' })])
  })
})

describe('validateAppearancePngHeader', () => {
  function png(width: number, height: number): Uint8Array {
    return PNG.sync.write(new PNG({ width, height }), {
      colorType: 6,
      inputColorType: 6,
    })
  }

  it('接受 512×512、8-bit RGBA 外观 PNG', () => {
    expect(
      validateAppearancePngHeader('/assets/materials/moon-leaf.png', png(512, 512)),
    ).toEqual([])
  })

  it('拒绝错误尺寸的外观 PNG', () => {
    expect(
      validateAppearancePngHeader('/assets/materials/moon-leaf.png', png(511, 512)),
    ).toEqual([
      expect.objectContaining({
        code: 'CONFIG_ASSET_INVALID_DIMENSIONS',
        filePath: '/assets/materials/moon-leaf.png',
      }),
    ])
  })

  it('拒绝只伪造 signature + IHDR 的 29 字节不完整 PNG', () => {
    const fake = new Uint8Array(29)
    fake.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    fake.set([0, 0, 0, 13], 8)
    fake.set(new TextEncoder().encode('IHDR'), 12)
    new DataView(fake.buffer).setUint32(16, 512, false)
    new DataView(fake.buffer).setUint32(20, 512, false)
    fake[24] = 8
    fake[25] = 6

    expect(validateAppearancePngHeader('/assets/materials/fake.png', fake)).toEqual([
      expect.objectContaining({ code: 'CONFIG_ASSET_INVALID_PNG' }),
    ])
  })
})

describe('M2 单药液素材边界', () => {
  function cyanComposition() {
    const rgba = new Uint8Array(64 * 64 * 4)
    rgba.set([0, 255, 255, 255], 0)
    return { filePath: '/composition.png', width: 64, height: 64, rgba }
  }

  function alignedAppearance() {
    const rgba = new Uint8Array(512 * 512 * 4)
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        rgba.set([64, 128, 72, 255], (y * 512 + x) * 4)
      }
    }
    return { filePath: '/appearance.png', width: 512, height: 512, rgba }
  }

  it('只接受全透明和药液青成分', () => {
    const valid = cyanComposition()
    const purple = cyanComposition()
    purple.rgba.set([128, 0, 128, 255], 0)

    expect(validateM2MedicinalLiquidCompositionMap(valid)).toEqual([])
    expect(validateM2MedicinalLiquidCompositionMap(purple)).toEqual([
      expect.objectContaining({
        code: 'CONFIG_ASSET_INVALID_COLOR',
        fieldPath: '/pixels/0/0',
      }),
    ])
  })

  it('要求 512 外观 alpha 与 64 成分轮廓的每个 8×8 区块严格对齐', () => {
    const composition = cyanComposition()
    const valid = alignedAppearance()
    const misaligned = alignedAppearance()
    misaligned.rgba.set([64, 128, 72, 255], 8 * 4)

    expect(validateM2AppearanceMap(valid, composition)).toEqual([])
    expect(validateM2AppearanceMap(misaligned, composition)).toEqual([
      expect.objectContaining({
        code: 'CONFIG_ASSET_INVALID_COLOR',
        fieldPath: '/pixels/0/8',
      }),
    ])
  })
})
