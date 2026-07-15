import { configIssue, type ConfigIssue } from './errors'
import type { DecodedCompositionMap } from './model'

const COMPOSITION_MAP_WIDTH = 64
const COMPOSITION_MAP_HEIGHT = 64
const BYTES_PER_PIXEL = 4
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const ALLOWED_OPAQUE_COLORS = new Set([
  '0,255,255,255',
  '128,128,128,255',
  '128,0,128,255',
])

type PngHeader = Readonly<{
  width: number
  height: number
  bitDepth: number
  colorType: number
}>

function readPngHeader(bytes: Uint8Array): PngHeader | null {
  const lastChunkOffset = bytes.length - 12
  const hasIend =
    lastChunkOffset >= 29 &&
    bytes[lastChunkOffset] === 0 &&
    bytes[lastChunkOffset + 1] === 0 &&
    bytes[lastChunkOffset + 2] === 0 &&
    bytes[lastChunkOffset + 3] === 0 &&
    new TextDecoder().decode(bytes.subarray(lastChunkOffset + 4, lastChunkOffset + 8)) ===
      'IEND' &&
    bytes[lastChunkOffset + 8] === 0xae &&
    bytes[lastChunkOffset + 9] === 0x42 &&
    bytes[lastChunkOffset + 10] === 0x60 &&
    bytes[lastChunkOffset + 11] === 0x82
  const signatureMatches =
    bytes.length >= 29 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) &&
    new TextDecoder().decode(bytes.subarray(12, 16)) === 'IHDR' &&
    hasIend
  if (!signatureMatches) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
    bitDepth: bytes[24]!,
    colorType: bytes[25]!,
  }
}

export function isolateDecodedCompositionMap(
  map: DecodedCompositionMap,
): DecodedCompositionMap {
  const rgba = Uint8Array.from(map.rgba)
  return Object.freeze({
    filePath: map.filePath,
    width: map.width,
    height: map.height,
    get rgba() {
      return Uint8Array.from(rgba)
    },
  })
}

export function canonicalizeCompositionMap(
  map: DecodedCompositionMap,
): DecodedCompositionMap {
  let canonicalRgba: Uint8Array | undefined
  for (let offset = 0; offset + 3 < map.rgba.length; offset += BYTES_PER_PIXEL) {
    if (
      map.rgba[offset + 3] === 0 &&
      (map.rgba[offset] !== 0 ||
        map.rgba[offset + 1] !== 0 ||
        map.rgba[offset + 2] !== 0)
    ) {
      canonicalRgba ??= Uint8Array.from(map.rgba)
      canonicalRgba.fill(0, offset, offset + BYTES_PER_PIXEL)
    }
  }
  return canonicalRgba === undefined ? map : { ...map, rgba: canonicalRgba }
}

export function validateCompositionPngHeader(
  filePath: string,
  bytes: Uint8Array,
): ConfigIssue[] {
  const header = readPngHeader(bytes)
  if (header === null) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_PNG',
        filePath,
        '',
        '已登记的成分图不是有效 PNG',
      ),
    ]
  }

  if (
    header.width !== 64 ||
    header.height !== 64 ||
    header.bitDepth !== 8 ||
    header.colorType !== 6
  ) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_DIMENSIONS',
        filePath,
        '',
        '成分图必须是 64×64、8-bit RGBA PNG',
      ),
    ]
  }
  return []
}

export function validateAppearancePngHeader(
  filePath: string,
  bytes: Uint8Array,
): ConfigIssue[] {
  const header = readPngHeader(bytes)
  if (header === null) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_PNG',
        filePath,
        '',
        '已登记的材料外观图不是有效 PNG',
      ),
    ]
  }
  if (
    header.width !== 512 ||
    header.height !== 512 ||
    header.bitDepth !== 8 ||
    header.colorType !== 6
  ) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_DIMENSIONS',
        filePath,
        '',
        '材料外观图必须是 512×512、8-bit RGBA PNG',
      ),
    ]
  }
  return []
}

export function validateCompositionMap(map: DecodedCompositionMap): ConfigIssue[] {
  if (
    map.width !== COMPOSITION_MAP_WIDTH ||
    map.height !== COMPOSITION_MAP_HEIGHT ||
    map.rgba.length !== map.width * map.height * BYTES_PER_PIXEL
  ) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_DIMENSIONS',
        map.filePath,
        '',
        '成分图必须是 64×64 RGBA PNG',
      ),
    ]
  }

  let nonEmptyPixelCount = 0
  for (let offset = 0; offset < map.rgba.length; offset += BYTES_PER_PIXEL) {
    const red = map.rgba[offset]!
    const green = map.rgba[offset + 1]!
    const blue = map.rgba[offset + 2]!
    const alpha = map.rgba[offset + 3]!

    if (red === 0 && green === 0 && blue === 0 && alpha === 0) continue

    const colorKey = `${red},${green},${blue},${alpha}`
    if (!ALLOWED_OPAQUE_COLORS.has(colorKey)) {
      const pixelIndex = offset / BYTES_PER_PIXEL
      const x = pixelIndex % map.width
      const y = Math.floor(pixelIndex / map.width)
      return [
        configIssue(
          'CONFIG_ASSET_INVALID_COLOR',
          map.filePath,
          `/pixels/${y}/${x}`,
          `成分图像素 (${x}, ${y}) 必须是全透明、药液 #00FFFF、药渣 #808080 或杂质 #800080`,
        ),
      ]
    }
    nonEmptyPixelCount += 1
  }

  if (nonEmptyPixelCount === 0) {
    return [
      configIssue(
        'CONFIG_ASSET_EMPTY',
        map.filePath,
        '/pixels',
        '成分图至少必须包含一个非空成分像素',
      ),
    ]
  }

  return []
}

export function validateM2MedicinalLiquidCompositionMap(
  map: DecodedCompositionMap,
): ConfigIssue[] {
  const rgba = map.rgba
  for (let offset = 0; offset < rgba.length; offset += BYTES_PER_PIXEL) {
    const red = rgba[offset]!
    const green = rgba[offset + 1]!
    const blue = rgba[offset + 2]!
    const alpha = rgba[offset + 3]!
    if (red === 0 && green === 0 && blue === 0 && alpha === 0) continue
    if (red === 0 && green === 255 && blue === 255 && alpha === 255) continue
    const pixelIndex = offset / BYTES_PER_PIXEL
    const x = pixelIndex % map.width
    const y = Math.floor(pixelIndex / map.width)
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_COLOR',
        map.filePath,
        `/pixels/${y}/${x}`,
        `M2 成分图像素 (${x}, ${y}) 只能是全透明或药液青 #00FFFF`,
      ),
    ]
  }
  return []
}

export function validateM2AppearanceMap(
  appearance: DecodedCompositionMap,
  composition: DecodedCompositionMap,
): ConfigIssue[] {
  if (
    appearance.width !== 512 ||
    appearance.height !== 512 ||
    appearance.rgba.length !== 512 * 512 * BYTES_PER_PIXEL
  ) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_DIMENSIONS',
        appearance.filePath,
        '',
        '材料外观图必须是 512×512 RGBA PNG',
      ),
    ]
  }
  if (composition.width !== 64 || composition.height !== 64) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_DIMENSIONS',
        composition.filePath,
        '',
        '成分图必须是 64×64 RGBA PNG',
      ),
    ]
  }

  const appearanceRgba = appearance.rgba
  const compositionRgba = composition.rgba
  let nonEmptyPixelCount = 0
  for (let offset = 3; offset < appearanceRgba.length; offset += BYTES_PER_PIXEL) {
    if (appearanceRgba[offset]! > 0) nonEmptyPixelCount += 1
  }
  if (nonEmptyPixelCount === 0) {
    return [
      configIssue(
        'CONFIG_ASSET_EMPTY',
        appearance.filePath,
        '/pixels',
        '材料外观图至少必须包含一个非透明像素',
      ),
    ]
  }

  for (let y = 0; y < appearance.height; y += 1) {
    for (let x = 0; x < appearance.width; x += 1) {
      const appearanceAlpha = appearanceRgba[(y * appearance.width + x) * 4 + 3]!
      const compositionX = Math.floor(x / 8)
      const compositionY = Math.floor(y / 8)
      const compositionAlpha =
        compositionRgba[(compositionY * composition.width + compositionX) * 4 + 3]!
      if ((appearanceAlpha > 0) !== (compositionAlpha > 0)) {
        return [
          configIssue(
            'CONFIG_ASSET_INVALID_COLOR',
            appearance.filePath,
            `/pixels/${y}/${x}`,
            `外观图 alpha 轮廓必须与成分图像素 (${compositionX}, ${compositionY}) 的 8×8 区块严格对齐`,
          ),
        ]
      }
    }
  }
  return []
}
