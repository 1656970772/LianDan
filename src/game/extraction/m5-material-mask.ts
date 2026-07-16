export const M5_MATERIAL_MASK_SOURCE_SIZE = 64

const SOURCE_PIXEL_COUNT =
  M5_MATERIAL_MASK_SOURCE_SIZE * M5_MATERIAL_MASK_SOURCE_SIZE
const SOURCE_RGBA_LENGTH = SOURCE_PIXEL_COUNT * 4

export type M5MaterialMaskRgb = readonly [
  red: number,
  green: number,
  blue: number,
]

export type M5MaterialMaskConfig = Readonly<{
  /** 输出宽高相对 64×64 规则网格的整数倍。 */
  maskScale: number
  /** 输出像素单位的溶解轮廓羽化宽度。 */
  edgeFeatherPixels: number
  /** 输出像素单位的热边与焦痕影响宽度。 */
  heatEdgeWidthPixels: number
  heatEdgeColor: M5MaterialMaskRgb
  heatEdgeAlpha: number
  charColor: M5MaterialMaskRgb
  charAlpha: number
}>

export type M5MaterialMaskInput = Readonly<{
  /** 与规则网格同尺寸的原始外观 RGBA。 */
  sourceRgba: ArrayLike<number>
  initialCellVolumes: ArrayLike<number>
  remainingCellVolumes: ArrayLike<number>
}>

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function interpolate(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

function smoothstep(start: number, end: number, value: number): number {
  if (start === end) return value < start ? 0 : 1
  const ratio = clamp01((value - start) / (end - start))
  return ratio * ratio * (3 - 2 * ratio)
}

function validateByte(value: number, errorCode: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new RangeError(errorCode)
  }
}

function validateRgb(value: M5MaterialMaskRgb, errorCode: string): void {
  if (value.length !== 3) throw new RangeError(errorCode)
  validateByte(value[0], errorCode)
  validateByte(value[1], errorCode)
  validateByte(value[2], errorCode)
}

function validateConfig(config: M5MaterialMaskConfig): void {
  if (!Number.isInteger(config.maskScale) || config.maskScale < 2) {
    throw new RangeError('M5_MATERIAL_MASK_SCALE_INVALID')
  }
  if (
    !Number.isFinite(config.edgeFeatherPixels) ||
    config.edgeFeatherPixels < 0
  ) {
    throw new RangeError('M5_MATERIAL_MASK_EDGE_FEATHER_INVALID')
  }
  if (
    !Number.isFinite(config.heatEdgeWidthPixels) ||
    config.heatEdgeWidthPixels < 0
  ) {
    throw new RangeError('M5_MATERIAL_MASK_HEAT_EDGE_WIDTH_INVALID')
  }
  validateRgb(
    config.heatEdgeColor,
    'M5_MATERIAL_MASK_HEAT_EDGE_COLOR_INVALID',
  )
  validateByte(
    config.heatEdgeAlpha,
    'M5_MATERIAL_MASK_HEAT_EDGE_ALPHA_INVALID',
  )
  validateRgb(config.charColor, 'M5_MATERIAL_MASK_CHAR_COLOR_INVALID')
  validateByte(config.charAlpha, 'M5_MATERIAL_MASK_CHAR_ALPHA_INVALID')
}

function validateInput(input: M5MaterialMaskInput): void {
  if (input.sourceRgba.length !== SOURCE_RGBA_LENGTH) {
    throw new RangeError('M5_MATERIAL_MASK_SOURCE_SIZE_INVALID')
  }
  if (input.initialCellVolumes.length !== SOURCE_PIXEL_COUNT) {
    throw new RangeError('M5_MATERIAL_MASK_INITIAL_VOLUME_SIZE_INVALID')
  }
  if (input.remainingCellVolumes.length !== SOURCE_PIXEL_COUNT) {
    throw new RangeError('M5_MATERIAL_MASK_REMAINING_VOLUME_SIZE_INVALID')
  }
}

function cellRatio(input: M5MaterialMaskInput, x: number, y: number): number {
  const index = y * M5_MATERIAL_MASK_SOURCE_SIZE + x
  const initial = input.initialCellVolumes[index] ?? 0
  const remaining = input.remainingCellVolumes[index] ?? 0
  if (
    !Number.isFinite(initial) ||
    !Number.isFinite(remaining) ||
    initial <= 0 ||
    remaining <= 0
  ) {
    return 0
  }
  return clamp01(remaining / initial)
}

function sampleAreaSupport(
  input: M5MaterialMaskInput,
  sourceX: number,
  sourceY: number,
): number {
  const boundedX = Math.max(
    0,
    Math.min(
      M5_MATERIAL_MASK_SOURCE_SIZE - 1e-9,
      sourceX + 0.5,
    ),
  )
  const boundedY = Math.max(
    0,
    Math.min(
      M5_MATERIAL_MASK_SOURCE_SIZE - 1e-9,
      sourceY + 0.5,
    ),
  )
  const cellX = Math.floor(boundedX)
  const cellY = Math.floor(boundedY)
  const ratio = cellRatio(input, cellX, cellY)
  if (ratio <= 0) return 0
  if (ratio >= 1) return 1

  // 8×8 稳定有序阈值让同一 cell 的正 alpha 面积随权威体积单调退让。
  // 不依赖帧号或随机数，因此 reset/replay 会得到完全相同的轮廓。
  const rankSize = 8
  const localColumn = Math.min(
    rankSize - 1,
    Math.floor((boundedX - cellX) * rankSize),
  )
  const localRow = Math.min(
    rankSize - 1,
    Math.floor((boundedY - cellY) * rankSize),
  )
  const threshold =
    (localRow * rankSize + localColumn + 0.5) / (rankSize * rankSize)
  return ratio + Number.EPSILON >= threshold ? 1 : 0
}

function sampleSourceChannel(
  source: ArrayLike<number>,
  sourceX: number,
  sourceY: number,
  channel: number,
): number {
  const maximum = M5_MATERIAL_MASK_SOURCE_SIZE - 1
  const x = Math.max(0, Math.min(maximum, sourceX))
  const y = Math.max(0, Math.min(maximum, sourceY))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(maximum, x0 + 1)
  const y1 = Math.min(maximum, y0 + 1)
  const ratioX = x - x0
  const ratioY = y - y0
  const top = interpolate(
    source[(y0 * M5_MATERIAL_MASK_SOURCE_SIZE + x0) * 4 + channel] ?? 0,
    source[(y0 * M5_MATERIAL_MASK_SOURCE_SIZE + x1) * 4 + channel] ?? 0,
    ratioX,
  )
  const bottom = interpolate(
    source[(y1 * M5_MATERIAL_MASK_SOURCE_SIZE + x0) * 4 + channel] ?? 0,
    source[(y1 * M5_MATERIAL_MASK_SOURCE_SIZE + x1) * 4 + channel] ?? 0,
    ratioX,
  )
  return interpolate(top, bottom, ratioY)
}

function channelByteAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  channel: number,
): number {
  const boundedX = Math.max(0, Math.min(width - 1, x))
  const boundedY = Math.max(0, Math.min(width - 1, y))
  return pixels[(boundedY * width + boundedX) * 4 + channel]!
}

/**
 * 将 64×64 权威规则体积连续采样为高分辨率表现遮罩。
 *
 * 函数只读取规则数据；热边、焦痕和羽化全部写入表现 RGBA。传入 output
 * 时会原地覆盖并返回同一实例，适合逐帧复用。
 */
export function renderM5MaterialMask(
  input: M5MaterialMaskInput,
  config: M5MaterialMaskConfig,
  output?: Uint8ClampedArray,
): Uint8ClampedArray {
  validateConfig(config)
  validateInput(input)

  const width = M5_MATERIAL_MASK_SOURCE_SIZE * config.maskScale
  const outputLength = width * width * 4
  const pixels = output ?? new Uint8ClampedArray(outputLength)
  if (pixels.length !== outputLength) {
    throw new RangeError('M5_MATERIAL_MASK_OUTPUT_SIZE_INVALID')
  }

  const featherRadiusPixels =
    config.edgeFeatherPixels > 0
      ? Math.max(1, Math.round(config.edgeFeatherPixels * 2))
      : 0
  const heatRadiusPixels =
    config.heatEdgeWidthPixels > 0
      ? Math.max(1, Math.round(config.heatEdgeWidthPixels))
      : 0
  const charOpacity = config.charAlpha / 255
  const heatOpacity = config.heatEdgeAlpha / 255

  // 第一遍把单调面积支撑写入 alpha，复用输出缓冲作为工作区。
  for (let outputY = 0; outputY < width; outputY += 1) {
    const sourceY = (outputY + 0.5) / config.maskScale - 0.5
    for (let outputX = 0; outputX < width; outputX += 1) {
      const sourceX = (outputX + 0.5) / config.maskScale - 0.5
      const coverage = sampleAreaSupport(input, sourceX, sourceY)
      const outputOffset = (outputY * width + outputX) * 4
      pixels[outputOffset + 3] = Math.round(coverage * 255)
    }
  }

  // 第二遍用两次线性距离变换计算材料一侧羽化；距离/coverage 暂存在 green。
  for (let outputY = 0; outputY < width; outputY += 1) {
    for (let outputX = 0; outputX < width; outputX += 1) {
      const outputOffset = (outputY * width + outputX) * 4
      if (pixels[outputOffset + 3] === 0) {
        pixels[outputOffset + 1] = 0
        continue
      }
      if (featherRadiusPixels === 0) {
        pixels[outputOffset + 1] = 255
        continue
      }
      const leftDistance =
        outputX > 0
          ? pixels[outputOffset - 4 + 1]! + 1
          : featherRadiusPixels
      const upperDistance =
        outputY > 0
          ? pixels[outputOffset - width * 4 + 1]! + 1
          : featherRadiusPixels
      pixels[outputOffset + 1] = Math.min(
        featherRadiusPixels,
        leftDistance,
        upperDistance,
      )
    }
  }
  if (featherRadiusPixels > 0) {
    for (let outputY = width - 1; outputY >= 0; outputY -= 1) {
      for (let outputX = width - 1; outputX >= 0; outputX -= 1) {
        const outputOffset = (outputY * width + outputX) * 4
        if (pixels[outputOffset + 3] === 0) continue
        const rightDistance =
          outputX + 1 < width
            ? pixels[outputOffset + 4 + 1]! + 1
            : featherRadiusPixels
        const lowerDistance =
          outputY + 1 < width
            ? pixels[outputOffset + width * 4 + 1]! + 1
            : featherRadiusPixels
        const distance = Math.min(
          pixels[outputOffset + 1]!,
          rightDistance,
          lowerDistance,
        )
        pixels[outputOffset + 1] = distance
      }
    }
    for (let outputY = 0; outputY < width; outputY += 1) {
      for (let outputX = 0; outputX < width; outputX += 1) {
        const outputOffset = (outputY * width + outputX) * 4
        pixels[outputOffset + 1] = Math.round(
          clamp01(pixels[outputOffset + 1]! / featherRadiusPixels) * 255,
        )
      }
    }
  }

  // 第三遍从羽化覆盖率场计算材料一侧的热边宽度；edge 暂存在 red。
  for (let outputY = 0; outputY < width; outputY += 1) {
    for (let outputX = 0; outputX < width; outputX += 1) {
      const outputOffset = (outputY * width + outputX) * 4
      const coverage = pixels[outputOffset + 1]! / 255
      if (heatRadiusPixels <= 0 || coverage <= 0) {
        pixels[outputOffset] = 0
        continue
      }
      const minimumNearbyCoverage =
        Math.min(
          channelByteAt(
            pixels,
            width,
            outputX - heatRadiusPixels,
            outputY,
            1,
          ),
          channelByteAt(
            pixels,
            width,
            outputX + heatRadiusPixels,
            outputY,
            1,
          ),
          channelByteAt(
            pixels,
            width,
            outputX,
            outputY - heatRadiusPixels,
            1,
          ),
          channelByteAt(
            pixels,
            width,
            outputX,
            outputY + heatRadiusPixels,
            1,
          ),
        ) / 255
      const edgeContrast = Math.max(0, coverage - minimumNearbyCoverage)
      pixels[outputOffset] = Math.round(
        smoothstep(0.02, 0.65, edgeContrast) * 255,
      )
    }
  }

  // 第四遍合成 source、焦痕与暖亮边，并把 alpha 还原为最终值。
  for (let outputY = 0; outputY < width; outputY += 1) {
    const sourceY = (outputY + 0.5) / config.maskScale - 0.5
    for (let outputX = 0; outputX < width; outputX += 1) {
      const sourceX = (outputX + 0.5) / config.maskScale - 0.5
      const outputOffset = (outputY * width + outputX) * 4
      const edgeStrength = pixels[outputOffset]! / 255
      const coverage = pixels[outputOffset + 1]! / 255
      const sourceAlpha = sampleSourceChannel(
        input.sourceRgba,
        sourceX,
        sourceY,
        3,
      )
      const alpha = Math.round(sourceAlpha * coverage)

      if (alpha <= 0) {
        pixels[outputOffset] = 0
        pixels[outputOffset + 1] = 0
        pixels[outputOffset + 2] = 0
        pixels[outputOffset + 3] = 0
        continue
      }

      let red = sampleSourceChannel(input.sourceRgba, sourceX, sourceY, 0)
      let green = sampleSourceChannel(input.sourceRgba, sourceX, sourceY, 1)
      let blue = sampleSourceChannel(input.sourceRgba, sourceX, sourceY, 2)

      if (edgeStrength > 0) {
        const charStrength =
          edgeStrength * smoothstep(0.62, 0.96, coverage) * charOpacity
        red = interpolate(red, config.charColor[0], charStrength)
        green = interpolate(green, config.charColor[1], charStrength)
        blue = interpolate(blue, config.charColor[2], charStrength)

        const heatProfile = clamp01(1 - Math.abs(coverage - 0.48) / 0.52)
        const heatStrength = edgeStrength * heatProfile * heatOpacity
        red = interpolate(red, config.heatEdgeColor[0], heatStrength)
        green = interpolate(green, config.heatEdgeColor[1], heatStrength)
        blue = interpolate(blue, config.heatEdgeColor[2], heatStrength)
      }

      pixels[outputOffset] = Math.round(red)
      pixels[outputOffset + 1] = Math.round(green)
      pixels[outputOffset + 2] = Math.round(blue)
      pixels[outputOffset + 3] = alpha
    }
  }

  return pixels
}
