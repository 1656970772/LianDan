import { describe, expect, it } from 'vitest'

import {
  M5_MATERIAL_MASK_SOURCE_SIZE,
  renderM5MaterialMask,
  type M5MaterialMaskConfig,
} from '../../game/extraction/m5-material-mask.ts'

const CELL_COUNT =
  M5_MATERIAL_MASK_SOURCE_SIZE * M5_MATERIAL_MASK_SOURCE_SIZE

const CONFIG = {
  maskScale: 4,
  edgeFeatherPixels: 3,
  heatEdgeWidthPixels: 8,
  heatEdgeColor: [255, 176, 72],
  heatEdgeAlpha: 224,
  charColor: [42, 19, 12],
  charAlpha: 132,
} as const satisfies M5MaterialMaskConfig

function createSource(
  red = 112,
  green = 136,
  blue = 84,
  alpha = 255,
): Uint8ClampedArray {
  const source = new Uint8ClampedArray(CELL_COUNT * 4)
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const offset = index * 4
    source[offset] = red
    source[offset + 1] = green
    source[offset + 2] = blue
    source[offset + 3] = alpha
  }
  return source
}

function createVolumes(value = 1): Float64Array {
  return new Float64Array(CELL_COUNT).fill(value)
}

function pixelAt(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const width = M5_MATERIAL_MASK_SOURCE_SIZE * CONFIG.maskScale
  const offset = (y * width + x) * 4
  return [
    pixels[offset]!,
    pixels[offset + 1]!,
    pixels[offset + 2]!,
    pixels[offset + 3]!,
  ]
}

function positiveAlphaPixelCount(pixels: Uint8ClampedArray): number {
  let count = 0
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 0) count += 1
  }
  return count
}

describe('M5 高分辨率材料表现遮罩', () => {
  it('完整材料保留 source 外观，不凭空增加边缘着色', () => {
    const pixels = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: createVolumes(),
        remainingCellVolumes: createVolumes(),
      },
      CONFIG,
    )

    expect(pixels).toHaveLength(256 * 256 * 4)
    expect(pixelAt(pixels, 0, 0)).toEqual([112, 136, 84, 255])
    expect(pixelAt(pixels, 127, 127)).toEqual([112, 136, 84, 255])
    expect(pixelAt(pixels, 255, 255)).toEqual([112, 136, 84, 255])
  })

  it('中心烧穿形成透明孔和连续软边，并同时留下暖亮边与焦痕', () => {
    const remaining = createVolumes()
    for (let y = 25; y < 39; y += 1) {
      for (let x = 25; x < 39; x += 1) {
        remaining[y * M5_MATERIAL_MASK_SOURCE_SIZE + x] = 0
      }
    }

    const pixels = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: createVolumes(),
        remainingCellVolumes: remaining,
      },
      CONFIG,
    )

    expect(pixelAt(pixels, 128, 128)[3]).toBe(0)

    const rowAlphas: number[] = []
    let hasWarmEdge = false
    let hasChar = false
    for (let x = 88; x <= 112; x += 1) {
      const [red, green, blue, alpha] = pixelAt(pixels, x, 128)
      rowAlphas.push(alpha)
      if (alpha > 0 && red > 150 && green > 105 && blue < 100) {
        hasWarmEdge = true
      }
      if (alpha > 0 && red < 100 && green < 120 && blue < 80) {
        hasChar = true
      }
    }

    expect(rowAlphas.some((alpha) => alpha > 0 && alpha < 255)).toBe(true)
    expect(
      Math.max(
        ...rowAlphas.slice(1).map((alpha, index) =>
          Math.abs(alpha - rowAlphas[index]!),
        ),
      ),
    ).toBeLessThan(150)
    expect(hasWarmEdge).toBe(true)
    expect(hasChar).toBe(true)
  })

  it('连续采样平滑相邻规则 cell 差异，不产生逐格棋盘硬缝', () => {
    const remaining = createVolumes()
    for (let y = 0; y < M5_MATERIAL_MASK_SOURCE_SIZE; y += 1) {
      for (let x = 0; x < M5_MATERIAL_MASK_SOURCE_SIZE; x += 1) {
        remaining[y * M5_MATERIAL_MASK_SOURCE_SIZE + x] =
          (x + y) % 2 === 0 ? 0.55 : 1
      }
    }

    const pixels = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: createVolumes(),
        remainingCellVolumes: remaining,
      },
      CONFIG,
    )
    let maximumAdjacentAlphaStep = 0
    const y = 126
    for (let x = 2; x < 254; x += 1) {
      maximumAdjacentAlphaStep = Math.max(
        maximumAdjacentAlphaStep,
        Math.abs(
          pixelAt(pixels, x, y)[3] - pixelAt(pixels, x - 1, y)[3],
        ),
      )
    }

    expect(maximumAdjacentAlphaStep).toBeLessThan(48)
  })

  it('部分溶解 cell 用面积退让表达体积下降，而不是整格只降低 alpha', () => {
    const initial = createVolumes()
    const remaining = createVolumes()
    remaining[32 * M5_MATERIAL_MASK_SOURCE_SIZE + 32] = 0.8627

    const full = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: initial,
        remainingCellVolumes: initial,
      },
      CONFIG,
    )
    const partiallyDissolved = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
      },
      CONFIG,
    )

    expect(positiveAlphaPixelCount(partiallyDissolved)).toBeLessThan(
      positiveAlphaPixelCount(full),
    )
    expect(pixelAt(partiallyDissolved, 8, 8)).toEqual(pixelAt(full, 8, 8))
  })

  it('低于半个可显示子像素的损耗不改变面积，跨过量化阈值后才单调减一', () => {
    const singleCellPositiveAlpha = (ratio: number): number => {
      const initial = createVolumes(0)
      const remaining = createVolumes(0)
      const cellIndex = 32 * M5_MATERIAL_MASK_SOURCE_SIZE + 32
      initial[cellIndex] = 1
      remaining[cellIndex] = ratio
      return positiveAlphaPixelCount(
        renderM5MaterialMask(
          {
            sourceRgba: createSource(),
            initialCellVolumes: initial,
            remainingCellVolumes: remaining,
          },
          {
            ...CONFIG,
            edgeFeatherPixels: 0,
            heatEdgeWidthPixels: 0,
          },
        ),
      )
    }

    expect(singleCellPositiveAlpha(1)).toBe(16)
    expect(singleCellPositiveAlpha(0.999_999)).toBe(16)
    expect(singleCellPositiveAlpha(0.99)).toBe(15)
    expect(singleCellPositiveAlpha(0.5)).toBe(8)
    expect(singleCellPositiveAlpha(0)).toBe(0)
  })

  it('自然损耗未跨量化阈值时不会让全材散点，局部灼烧仍会单调退让', () => {
    const initial = createVolumes()
    const remaining = createVolumes(0.999_994)
    const burnedCell = 32 * M5_MATERIAL_MASK_SOURCE_SIZE + 32
    remaining[burnedCell] = 0.8
    const noEffectsConfig = {
      ...CONFIG,
      edgeFeatherPixels: 0,
      heatEdgeWidthPixels: 0,
    }
    const full = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: initial,
        remainingCellVolumes: initial,
      },
      noEffectsConfig,
    )
    const eroded = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
      },
      noEffectsConfig,
    )
    const width = M5_MATERIAL_MASK_SOURCE_SIZE * CONFIG.maskScale
    const changedAlphaPixels: Readonly<{ x: number; y: number }>[] = []
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixelAt(full, x, y)[3] !== pixelAt(eroded, x, y)[3]) {
          changedAlphaPixels.push({ x, y })
        }
      }
    }

    expect(changedAlphaPixels.length).toBeGreaterThan(0)
    expect(
      changedAlphaPixels.every(
        ({ x, y }) =>
          Math.floor(x / CONFIG.maskScale) === 32 &&
          Math.floor(y / CONFIG.maskScale) === 32,
      ),
    ).toBe(true)
  })

  it('材料 alpha 只会裁切 source alpha，透明外形不会被边缘效果填回', () => {
    const source = createSource(112, 136, 84, 104)
    for (let y = 20; y < 44; y += 1) {
      for (let x = 20; x < 44; x += 1) {
        source[(y * M5_MATERIAL_MASK_SOURCE_SIZE + x) * 4 + 3] = 0
      }
    }
    const pixels = renderM5MaterialMask(
      {
        sourceRgba: source,
        initialCellVolumes: createVolumes(),
        remainingCellVolumes: createVolumes(),
      },
      CONFIG,
    )

    expect(pixelAt(pixels, 128, 128)[3]).toBe(0)
    expect(pixelAt(pixels, 16, 16)[3]).toBe(104)
    for (let offset = 3; offset < pixels.length; offset += 4) {
      expect(pixels[offset]).toBeLessThanOrEqual(104)
    }
  })

  it('拒绝错误的 source、规则网格、输出缓冲和缩放尺寸', () => {
    const validInput = {
      sourceRgba: createSource(),
      initialCellVolumes: createVolumes(),
      remainingCellVolumes: createVolumes(),
    }

    expect(() =>
      renderM5MaterialMask(
        { ...validInput, sourceRgba: new Uint8ClampedArray(12) },
        CONFIG,
      ),
    ).toThrow('M5_MATERIAL_MASK_SOURCE_SIZE_INVALID')
    expect(() =>
      renderM5MaterialMask(
        { ...validInput, initialCellVolumes: new Float64Array(12) },
        CONFIG,
      ),
    ).toThrow('M5_MATERIAL_MASK_INITIAL_VOLUME_SIZE_INVALID')
    expect(() =>
      renderM5MaterialMask(
        { ...validInput, remainingCellVolumes: new Float64Array(12) },
        CONFIG,
      ),
    ).toThrow('M5_MATERIAL_MASK_REMAINING_VOLUME_SIZE_INVALID')
    expect(() =>
      renderM5MaterialMask(
        validInput,
        CONFIG,
        new Uint8ClampedArray(12),
      ),
    ).toThrow('M5_MATERIAL_MASK_OUTPUT_SIZE_INVALID')
    expect(() =>
      renderM5MaterialMask(validInput, { ...CONFIG, maskScale: 1 }),
    ).toThrow('M5_MATERIAL_MASK_SCALE_INVALID')
  })

  it('调用方提供输出缓冲后原地覆盖并返回同一实例', () => {
    const output = new Uint8ClampedArray(256 * 256 * 4).fill(17)
    const result = renderM5MaterialMask(
      {
        sourceRgba: createSource(),
        initialCellVolumes: createVolumes(),
        remainingCellVolumes: createVolumes(),
      },
      CONFIG,
      output,
    )

    expect(result).toBe(output)
    expect(pixelAt(result, 128, 128)).toEqual([112, 136, 84, 255])
  })
})
