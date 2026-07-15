import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PNG } from 'pngjs'

const COMPOSITION_SIZE = 64
const APPEARANCE_SIZE = 512
const APPEARANCE_SCALE = APPEARANCE_SIZE / COMPOSITION_SIZE
const OUTLINE_WIDTH = 5
const MEDICINAL_LIQUID_RGBA = [0, 255, 255, 255] as const
const SLAG_RGBA = [128, 128, 128, 255] as const
const IMPURITY_RGBA = [128, 0, 128, 255] as const
const OUTLINE_RGBA = [28, 42, 35, 255] as const
const INNER_OUTLINE_RGBA = [42, 64, 47, 255] as const
const LEAF_PALETTE = [
  [75, 122, 70, 255],
  [86, 137, 77, 255],
  [66, 109, 63, 255],
] as const
const VEIN_RGBA = [139, 165, 102, 255] as const

export interface GenerateM2PrototypeAssetsOptions {
  readonly compositionPath: string
  readonly appearancePath: string
}

export interface GenerateM2PrototypeAssetsResult {
  readonly compositionChanged: boolean
  readonly appearanceChanged: boolean
}

function setPixel(
  image: PNG,
  offset: number,
  rgba: readonly [number, number, number, number],
): void {
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3]
}

function assertCompositionDimensions(image: PNG): void {
  if (
    image.width !== COMPOSITION_SIZE ||
    image.height !== COMPOSITION_SIZE
  ) {
    throw new Error(
      `M2 prototype composition must be ${COMPOSITION_SIZE}x${COMPOSITION_SIZE}.`,
    )
  }
}

export function normalizePrototypeComposition(source: PNG): PNG {
  assertCompositionDimensions(source)
  const normalized = new PNG({
    width: COMPOSITION_SIZE,
    height: COMPOSITION_SIZE,
  })

  for (let offset = 0; offset < source.data.length; offset += 4) {
    const pixelIndex = offset / 4
    const x = pixelIndex % COMPOSITION_SIZE
    const y = Math.floor(pixelIndex / COMPOSITION_SIZE)
    const component =
      (x * 7 + y * 11) % 29 <= 1
        ? IMPURITY_RGBA
        : (x * 5 + y * 3) % 9 <= 1
          ? SLAG_RGBA
          : MEDICINAL_LIQUID_RGBA
    setPixel(
      normalized,
      offset,
      source.data[offset + 3] === 0
        ? ([0, 0, 0, 0] as const)
        : component,
    )
  }

  return normalized
}

function compositionContains(
  composition: PNG,
  appearanceX: number,
  appearanceY: number,
): boolean {
  if (
    appearanceX < 0 ||
    appearanceY < 0 ||
    appearanceX >= APPEARANCE_SIZE ||
    appearanceY >= APPEARANCE_SIZE
  ) {
    return false
  }
  const sourceX = Math.floor(appearanceX / APPEARANCE_SCALE)
  const sourceY = Math.floor(appearanceY / APPEARANCE_SCALE)
  const sourceOffset = (sourceY * composition.width + sourceX) * 4
  return composition.data[sourceOffset + 3] !== 0
}

function distanceToTransparent(
  composition: PNG,
  x: number,
  y: number,
): number {
  for (let radius = 1; radius <= OUTLINE_WIDTH; radius += 1) {
    for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
      for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) !== radius) continue
        if (!compositionContains(composition, x + deltaX, y + deltaY)) {
          return radius
        }
      }
    }
  }
  return Number.POSITIVE_INFINITY
}

function isVein(x: number, y: number): boolean {
  const centerX = APPEARANCE_SIZE / 2 + Math.round(Math.sin(y / 37) * 4)
  if (Math.abs(x - centerX) <= 2) return true

  const verticalDistance = Math.abs(y - APPEARANCE_SIZE / 2)
  const branchBand = Math.round(verticalDistance / 42)
  const branchY = APPEARANCE_SIZE / 2 +
    Math.sign(y - APPEARANCE_SIZE / 2 || 1) * branchBand * 42
  if (Math.abs(y - branchY) > 2 || branchBand === 0) return false
  const branchReach = Math.max(28, 126 - branchBand * 12)
  return Math.abs(x - centerX) <= branchReach
}

function interiorColor(x: number, y: number): readonly [number, number, number, number] {
  if (isVein(x, y)) return VEIN_RGBA
  const patch =
    (Math.floor((x + Math.floor(y / 29) * 7) / 31) +
      Math.floor(y / 47)) %
    LEAF_PALETTE.length
  return LEAF_PALETTE[patch]!
}

export function createPrototypeAppearance(composition: PNG): PNG {
  assertCompositionDimensions(composition)
  const appearance = new PNG({
    width: APPEARANCE_SIZE,
    height: APPEARANCE_SIZE,
  })

  for (let y = 0; y < APPEARANCE_SIZE; y += 1) {
    for (let x = 0; x < APPEARANCE_SIZE; x += 1) {
      const offset = (y * APPEARANCE_SIZE + x) * 4
      if (!compositionContains(composition, x, y)) {
        setPixel(appearance, offset, [0, 0, 0, 0])
        continue
      }

      const edgeDistance = distanceToTransparent(composition, x, y)
      if (edgeDistance <= 3) {
        setPixel(appearance, offset, OUTLINE_RGBA)
      } else if (edgeDistance <= OUTLINE_WIDTH) {
        setPixel(appearance, offset, INNER_OUTLINE_RGBA)
      } else {
        setPixel(appearance, offset, interiorColor(x, y))
      }
    }
  }

  return appearance
}

function encode(image: PNG): Buffer {
  return PNG.sync.write(image, {
    colorType: 6,
    inputColorType: 6,
    deflateLevel: 9,
    deflateStrategy: 3,
  })
}

function writeIfChanged(filePath: string, bytes: Buffer): boolean {
  if (existsSync(filePath) && readFileSync(filePath).equals(bytes)) return false
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, bytes)
  return true
}

export function generateM2PrototypeAssets(
  options: GenerateM2PrototypeAssetsOptions,
): GenerateM2PrototypeAssetsResult {
  const source = PNG.sync.read(readFileSync(options.compositionPath))
  const composition = normalizePrototypeComposition(source)
  const appearance = createPrototypeAppearance(composition)

  return {
    compositionChanged: writeIfChanged(
      options.compositionPath,
      encode(composition),
    ),
    appearanceChanged: writeIfChanged(options.appearancePath, encode(appearance)),
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1]
  return (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(entryPath)).href
  )
}

if (isDirectExecution()) {
  const projectRoot = process.cwd()
  const result = generateM2PrototypeAssets({
    compositionPath: resolve(
      projectRoot,
      'public/assets/masks/prototype-herb-components.png',
    ),
    appearancePath: resolve(
      projectRoot,
      'public/assets/materials/prototype-herb.png',
    ),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
