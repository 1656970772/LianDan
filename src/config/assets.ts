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
  const signatureMatches =
    bytes.length >= 29 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) &&
    new TextDecoder().decode(bytes.subarray(12, 16)) === 'IHDR'
  if (!signatureMatches) {
    return [
      configIssue(
        'CONFIG_ASSET_INVALID_PNG',
        filePath,
        '',
        '已登记的成分图不是有效 PNG',
      ),
    ]
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  const bitDepth = bytes[24]
  const colorType = bytes[25]
  if (width !== 64 || height !== 64 || bitDepth !== 8 || colorType !== 6) {
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
