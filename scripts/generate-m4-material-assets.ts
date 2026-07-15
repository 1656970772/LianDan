import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PNG } from 'pngjs'

const APPEARANCE_SIZE = 512
const COMPOSITION_SIZE = 64
const CELL_SCALE = APPEARANCE_SIZE / COMPOSITION_SIZE
const COMPONENT_COLORS = {
  medicinalLiquid: [0, 255, 255, 255],
  slag: [128, 128, 128, 255],
  impurity: [128, 0, 128, 255],
} as const

export type M4MaterialAssetId =
  | 'red_whisker_ginseng'
  | 'azure_dew_leaf'
  | 'violet_star_flower'
  | 'golden_bell_fruit'
  | 'ash_spore_mushroom'
  | 'coiling_cloud_vine'
  | 'frost_marrow_crystal'
  | 'sinking_fragrance_bark'

const MATERIAL_IDS: readonly M4MaterialAssetId[] = [
  'red_whisker_ginseng',
  'azure_dew_leaf',
  'violet_star_flower',
  'golden_bell_fruit',
  'ash_spore_mushroom',
  'coiling_cloud_vine',
  'frost_marrow_crystal',
  'sinking_fragrance_bark',
]

type OccupiedCell = Readonly<{
  index: number
  x: number
  y: number
  normalizedX: number
  normalizedY: number
}>

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

function resampleToAppearance(source: PNG): PNG {
  const target = new PNG({ width: APPEARANCE_SIZE, height: APPEARANCE_SIZE })
  for (let y = 0; y < APPEARANCE_SIZE; y += 1) {
    const sourceY = Math.min(
      source.height - 1,
      Math.round(((y + 0.5) / APPEARANCE_SIZE) * source.height - 0.5),
    )
    for (let x = 0; x < APPEARANCE_SIZE; x += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.round(((x + 0.5) / APPEARANCE_SIZE) * source.width - 0.5),
      )
      const sourceOffset = (sourceY * source.width + sourceX) * 4
      const targetOffset = (y * APPEARANCE_SIZE + x) * 4
      target.data[targetOffset] = source.data[sourceOffset]!
      target.data[targetOffset + 1] = source.data[sourceOffset + 1]!
      target.data[targetOffset + 2] = source.data[sourceOffset + 2]!
      target.data[targetOffset + 3] = source.data[sourceOffset + 3]!
    }
  }
  return target
}

function occupiedCells(appearance: PNG): OccupiedCell[] {
  const result: OccupiedCell[] = []
  for (let cellY = 0; cellY < COMPOSITION_SIZE; cellY += 1) {
    for (let cellX = 0; cellX < COMPOSITION_SIZE; cellX += 1) {
      let alphaSum = 0
      let opaqueSamples = 0
      for (let localY = 0; localY < CELL_SCALE; localY += 1) {
        for (let localX = 0; localX < CELL_SCALE; localX += 1) {
          const x = cellX * CELL_SCALE + localX
          const y = cellY * CELL_SCALE + localY
          const alpha = appearance.data[(y * APPEARANCE_SIZE + x) * 4 + 3]!
          alphaSum += alpha
          if (alpha >= 96) opaqueSamples += 1
        }
      }
      const coverage = alphaSum / (CELL_SCALE * CELL_SCALE * 255)
      if (coverage < 0.36 || opaqueSamples < 12) continue
      result.push({
        index: cellY * COMPOSITION_SIZE + cellX,
        x: cellX,
        y: cellY,
        normalizedX: (cellX + 0.5) / COMPOSITION_SIZE - 0.5,
        normalizedY: (cellY + 0.5) / COMPOSITION_SIZE - 0.5,
      })
    }
  }
  if (result.length === 0) throw new Error('M4_ASSET_EMPTY_AFTER_ALPHA_ALIGNMENT')
  return result
}

function medicinalScore(id: M4MaterialAssetId, cell: OccupiedCell): number {
  const { normalizedX: x, normalizedY: y } = cell
  const radius = Math.hypot(x, y)
  switch (id) {
    case 'red_whisker_ginseng':
      return radius
    case 'azure_dew_leaf':
      return Math.min(
        Math.abs(x - Math.sin((y + 0.5) * 10) * 0.025),
        Math.abs(Math.abs(x) - (0.08 + Math.abs(y) * 0.34)),
      )
    case 'violet_star_flower':
      return Math.abs(radius - 0.38) + Math.abs(Math.sin(Math.atan2(y, x) * 8)) * 0.03
    case 'golden_bell_fruit':
      return radius + Math.abs(y) * 0.2
    case 'ash_spore_mushroom':
      return Math.abs(y + 0.08) + Math.abs(x) * 0.18
    case 'coiling_cloud_vine':
      return Math.abs(Math.sin(Math.atan2(y, x) * 4 + radius * 18))
    case 'frost_marrow_crystal':
      return Math.abs(Math.sin((x * 1.4 + y) * 34)) + radius * 0.08
    case 'sinking_fragrance_bark':
      return Math.abs(y)
  }
}

function impurityScore(id: M4MaterialAssetId, cell: OccupiedCell): number {
  const { normalizedX: x, normalizedY: y } = cell
  const radius = Math.hypot(x, y)
  switch (id) {
    case 'red_whisker_ginseng':
      return -radius + x * 0.06
    case 'azure_dew_leaf':
      return -Math.abs(x) + y * 0.08
    case 'violet_star_flower':
      return radius + Math.abs(Math.cos(Math.atan2(y, x) * 4)) * 0.04
    case 'golden_bell_fruit':
      return -y + Math.abs(x) * 0.1
    case 'ash_spore_mushroom':
      return -y + Math.abs(x) * 0.03
    case 'coiling_cloud_vine':
      return Math.abs(Math.cos(Math.atan2(y, x) * 3 - radius * 16))
    case 'frost_marrow_crystal':
      return Math.abs(Math.cos((x - y * 1.2) * 29)) - radius * 0.06
    case 'sinking_fragrance_bark':
      return Math.abs(y - 0.28)
  }
}

function createComposition(
  id: M4MaterialAssetId,
  cells: readonly OccupiedCell[],
): PNG {
  const composition = new PNG({
    width: COMPOSITION_SIZE,
    height: COMPOSITION_SIZE,
  })
  const medicinalCount = Math.round(cells.length * 0.25)
  const impurityCount = Math.round(cells.length * 0.15)
  const medicinal = new Set(
    [...cells]
      .sort((left, right) =>
        medicinalScore(id, left) - medicinalScore(id, right) ||
        left.index - right.index,
      )
      .slice(0, medicinalCount)
      .map((cell) => cell.index),
  )
  const impurity = new Set(
    cells
      .filter((cell) => !medicinal.has(cell.index))
      .sort((left, right) =>
        impurityScore(id, left) - impurityScore(id, right) ||
        left.index - right.index,
      )
      .slice(0, impurityCount)
      .map((cell) => cell.index),
  )
  for (const cell of cells) {
    const color = medicinal.has(cell.index)
      ? COMPONENT_COLORS.medicinalLiquid
      : impurity.has(cell.index)
        ? COMPONENT_COLORS.impurity
        : COMPONENT_COLORS.slag
    const offset = cell.index * 4
    composition.data[offset] = color[0]
    composition.data[offset + 1] = color[1]
    composition.data[offset + 2] = color[2]
    composition.data[offset + 3] = color[3]
  }
  return composition
}

function alignAppearanceAlpha(
  appearance: PNG,
  cells: readonly OccupiedCell[],
): PNG {
  const occupied = new Set(cells.map((cell) => cell.index))
  for (let cellY = 0; cellY < COMPOSITION_SIZE; cellY += 1) {
    for (let cellX = 0; cellX < COMPOSITION_SIZE; cellX += 1) {
      const cellIndex = cellY * COMPOSITION_SIZE + cellX
      if (!occupied.has(cellIndex)) {
        for (let localY = 0; localY < CELL_SCALE; localY += 1) {
          const startOffset =
            ((cellY * CELL_SCALE + localY) * APPEARANCE_SIZE +
              cellX * CELL_SCALE) *
            4
          appearance.data.fill(0, startOffset, startOffset + CELL_SCALE * 4)
        }
        continue
      }

      let red = 0
      let green = 0
      let blue = 0
      let weight = 0
      for (let localY = 0; localY < CELL_SCALE; localY += 1) {
        for (let localX = 0; localX < CELL_SCALE; localX += 1) {
          const x = cellX * CELL_SCALE + localX
          const y = cellY * CELL_SCALE + localY
          const offset = (y * APPEARANCE_SIZE + x) * 4
          const alpha = appearance.data[offset + 3]!
          if (alpha < 24) continue
          red += appearance.data[offset]! * alpha
          green += appearance.data[offset + 1]! * alpha
          blue += appearance.data[offset + 2]! * alpha
          weight += alpha
        }
      }
      const fallback = [
        Math.round(red / Math.max(1, weight)),
        Math.round(green / Math.max(1, weight)),
        Math.round(blue / Math.max(1, weight)),
      ] as const
      for (let localY = 0; localY < CELL_SCALE; localY += 1) {
        for (let localX = 0; localX < CELL_SCALE; localX += 1) {
          const x = cellX * CELL_SCALE + localX
          const y = cellY * CELL_SCALE + localY
          const offset = (y * APPEARANCE_SIZE + x) * 4
          if (appearance.data[offset + 3]! < 24) {
            appearance.data[offset] = fallback[0]
            appearance.data[offset + 1] = fallback[1]
            appearance.data[offset + 2] = fallback[2]
          }
          appearance.data[offset + 3] = 255
        }
      }
    }
  }
  return appearance
}

export type GenerateM4MaterialAssetsResult = Readonly<{
  id: M4MaterialAssetId
  appearanceChanged: boolean
  compositionChanged: boolean
  componentPixelCounts: Readonly<{
    medicinalLiquid: number
    slag: number
    impurity: number
  }>
}>

export function generateM4MaterialAssets(projectRoot: string): readonly GenerateM4MaterialAssetsResult[] {
  return MATERIAL_IDS.map((id) => {
    const source = PNG.sync.read(
      readFileSync(resolve(projectRoot, 'public/assets/materials', `${id}.png`)),
    )
    const resized = resampleToAppearance(source)
    const cells = occupiedCells(resized)
    const composition = createComposition(id, cells)
    const appearance = alignAppearanceAlpha(resized, cells)
    const componentPixelCounts = { medicinalLiquid: 0, slag: 0, impurity: 0 }
    for (let offset = 0; offset < composition.data.length; offset += 4) {
      if (composition.data[offset + 3] === 0) continue
      if (composition.data[offset] === 0) componentPixelCounts.medicinalLiquid += 1
      else if (composition.data[offset + 1] === 128) componentPixelCounts.slag += 1
      else componentPixelCounts.impurity += 1
    }
    return {
      id,
      appearanceChanged: writeIfChanged(
        resolve(projectRoot, 'public/assets/materials', `${id}.png`),
        encode(appearance),
      ),
      compositionChanged: writeIfChanged(
        resolve(projectRoot, 'public/assets/masks', `${id}-components.png`),
        encode(composition),
      ),
      componentPixelCounts,
    }
  })
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1]
  return (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(entryPath)).href
  )
}

if (isDirectExecution()) {
  process.stdout.write(`${JSON.stringify(generateM4MaterialAssets(process.cwd()), null, 2)}\n`)
}
