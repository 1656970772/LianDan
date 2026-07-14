import { describe, expect, it } from 'vitest'

import {
  canonicalizeCompositionMap,
  validateCompositionMap,
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
