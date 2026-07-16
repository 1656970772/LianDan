import { createHash, randomUUID } from 'node:crypto'
import {
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import { PNG } from 'pngjs'

import { parseStrictJson } from '../src/config/strict-json.ts'

export const M5_VISUAL_IDENTITY_COLOR_MATRIX = Object.freeze([
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
])

export type M5VisualEvidenceSection =
  | 'layout'
  | 'fire'
  | 'coverage'
  | 'accessibility'
  | 'failure'

export type M5VisualEvidenceVisionMode =
  | 'normal'
  | 'grayscale'
  | 'protanopia'
  | 'deuteranopia'

export type M5VisualEvidenceViewport = Readonly<{
  width: number
  height: number
  deviceScaleFactor: number
}>

export type M5VisualEvidenceBrowserLaunchAuditEntry = Readonly<{
  id: string
  channel: string
  headed: boolean
  launchArgs: readonly string[]
  audioMutedByBrowser: boolean
}>

const M5_VISUAL_EVIDENCE_REQUIRED_BROWSERS = Object.freeze([
  Object.freeze({ id: 'stable-chrome', channel: 'chrome' }),
] as const)

export function m5VisualBrowserAudioMutedByLaunchArgs(
  launchArgs: readonly string[],
): boolean {
  return launchArgs.includes('--mute-audio')
}

export function evaluateM5VisualEvidenceBrowserLaunchAudit(
  browsers: readonly M5VisualEvidenceBrowserLaunchAuditEntry[],
): boolean {
  if (browsers.length !== M5_VISUAL_EVIDENCE_REQUIRED_BROWSERS.length) {
    return false
  }
  return M5_VISUAL_EVIDENCE_REQUIRED_BROWSERS.every((expected) => {
    const matches = browsers.filter(({ id }) => id === expected.id)
    if (matches.length !== 1) return false
    const browser = matches[0]!
    const mutedByExactLaunchArgs = m5VisualBrowserAudioMutedByLaunchArgs(
      browser.launchArgs,
    )
    return (
      browser.channel === expected.channel &&
      browser.headed === true &&
      mutedByExactLaunchArgs &&
      browser.audioMutedByBrowser === mutedByExactLaunchArgs
    )
  })
}

export type M5MaterialTopologySourceEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'

export type M5MaterialTopologyShapeThresholds = Readonly<{
  deepPenetrationMinimum: number
  narrowLateralCoverageMaximum: number
  shallowPenetrationMaximum: number
  wideLateralCoverageMinimum: number
  targetLateralRatio: number
  targetCorridorHalfWidthRatio: number
  maximumCenterOffsetRatio: number
  minimumThroughDepthSpanRatio: number
}>

export type M5MaterialTopologyPartialFrontConfig = Readonly<{
  lateralBinCount: number
  minimumCellErosionRatio: number
  minimumActiveLaneErosionRatio: number
  lateralCoverageQuantile: number
  minimumMeaningfulComponentCellCount: number
}>

export type M5MaterialTopologyPlacement = Readonly<{
  center: Readonly<{ x: number; y: number }>
  width: number
  height: number
  rotationRadians: number
}>

export type M5MaterialFireRay = Readonly<{
  origin: Readonly<{ x: number; y: number }>
  target: Readonly<{ x: number; y: number }>
}>

export type M5MaterialFireRayFrame = Readonly<{
  sourceEdge: M5MaterialTopologySourceEdge
  localOrigin: Readonly<{ x: number; y: number }>
  localTarget: Readonly<{ x: number; y: number }>
  direction: Readonly<{ x: number; y: number }>
  lateralAxis: Readonly<{ x: number; y: number }>
}>

function finitePoint(point: Readonly<{ x: number; y: number }>): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

export function assertM5MaterialEvidenceTargetMatchesContentCenter(input: Readonly<{
  caseId: string
  configuredTarget: Readonly<{ x: number; y: number }>
  contentCenter: Readonly<{ x: number; y: number }>
  epsilon: number
}>): Readonly<{ x: number; y: number }> {
  if (
    input.caseId.trim().length === 0 ||
    !finitePoint(input.configuredTarget) ||
    !finitePoint(input.contentCenter) ||
    !Number.isFinite(input.epsilon) ||
    input.epsilon <= 0
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TARGET_INPUT_INVALID')
  }
  const deltaX = Math.abs(
    input.configuredTarget.x - input.contentCenter.x,
  )
  const deltaY = Math.abs(
    input.configuredTarget.y - input.contentCenter.y,
  )
  if (deltaX > input.epsilon || deltaY > input.epsilon) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_MATERIAL_TARGET_CONTENT_CENTER_MISMATCH:${input.caseId}:${input.configuredTarget.x},${input.configuredTarget.y}:${input.contentCenter.x},${input.contentCenter.y}`,
    )
  }
  return Object.freeze({
    x: input.contentCenter.x,
    y: input.contentCenter.y,
  })
}

export function createM5MaterialFireRayFrame(input: Readonly<{
  placement: M5MaterialTopologyPlacement
  ray: M5MaterialFireRay
}>): M5MaterialFireRayFrame {
  const { placement, ray } = input
  if (
    !finitePoint(placement.center) ||
    !Number.isFinite(placement.width) ||
    placement.width <= 0 ||
    !Number.isFinite(placement.height) ||
    placement.height <= 0 ||
    !Number.isFinite(placement.rotationRadians) ||
    !finitePoint(ray.origin) ||
    !finitePoint(ray.target)
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
  }
  const sameWorldPoint =
    ray.origin.x === ray.target.x && ray.origin.y === ray.target.y
  const cosine = Math.cos(placement.rotationRadians)
  const sine = Math.sin(placement.rotationRadians)
  const toLocal = (point: Readonly<{ x: number; y: number }>) => {
    const x = point.x - placement.center.x
    const y = point.y - placement.center.y
    return Object.freeze({
      x: x * cosine + y * sine,
      y: -x * sine + y * cosine,
    })
  }
  const localOrigin = toLocal(ray.origin)
  const localTarget = toLocal(ray.target)
  if (!finitePoint(localOrigin) || !finitePoint(localTarget)) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
  }
  const deltaX = localTarget.x - localOrigin.x
  const deltaY = localTarget.y - localOrigin.y
  const directionScale = Math.max(Math.abs(deltaX), Math.abs(deltaY))
  if (!Number.isFinite(directionScale)) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
  }
  if (directionScale === 0) {
    throw new Error(
      sameWorldPoint
        ? 'M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ZERO_LENGTH'
        : 'M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID',
    )
  }
  const scaledDeltaX = deltaX / directionScale
  const scaledDeltaY = deltaY / directionScale
  const scaledLength = Math.hypot(scaledDeltaX, scaledDeltaY)
  if (!Number.isFinite(scaledLength) || scaledLength === 0) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
  }
  const interiorBoundaryRatio = 0.5 - Number.EPSILON * 64
  if (
    Math.abs(localOrigin.x / placement.width) < interiorBoundaryRatio &&
    Math.abs(localOrigin.y / placement.height) < interiorBoundaryRatio
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ORIGIN_INSIDE')
  }
  const direction = Object.freeze({
    x: scaledDeltaX / scaledLength,
    y: scaledDeltaY / scaledLength,
  })
  const sourceEdge: M5MaterialTopologySourceEdge =
    Math.abs(direction.x) > Math.abs(direction.y)
      ? direction.x < 0
        ? 'right'
        : 'left'
      : direction.y < 0
        ? 'bottom'
        : 'top'
  return Object.freeze({
    sourceEdge,
    localOrigin,
    localTarget,
    direction,
    lateralAxis: Object.freeze({ x: -direction.y, y: direction.x }),
  })
}

const M5_MATERIAL_TOPOLOGY_SOURCE_EDGES = Object.freeze([
  'top',
  'right',
  'bottom',
  'left',
] as const)

const M5_MATERIAL_TOPOLOGY_THRESHOLD_KEYS = Object.freeze([
  'deepPenetrationMinimum',
  'narrowLateralCoverageMaximum',
  'shallowPenetrationMaximum',
  'wideLateralCoverageMinimum',
  'targetLateralRatio',
  'targetCorridorHalfWidthRatio',
  'maximumCenterOffsetRatio',
  'minimumThroughDepthSpanRatio',
] as const satisfies readonly (keyof M5MaterialTopologyShapeThresholds)[])

export type M5MaterialTopologyClassification =
  | 'deep-narrow'
  | 'shallow-wide'
  | 'through-not-empty'
  | 'through-empty'
  | 'intermediate'

export type M5MaterialTopologyMetrics = Readonly<{
  classification: M5MaterialTopologyClassification
  initialVolume: number
  remainingVolume: number
  dissolvedVolumeRatio: number
  remainingRatio: number
  occupiedCellCount: number
  fullyDissolvedCellCount: number
  sourceErosionComponentCount: number
  penetrationRatio: number
  lateralCoverageRatio: number
  sourceBoundaryReached: boolean
  farBoundaryReached: boolean
  throughConnected: boolean
  primaryComponentCellCount: number
  primaryComponentLateralCenterRatio: number
  primaryComponentCenterOffsetRatio: number
  primaryComponentDepthSpanRatio: number
  primaryComponentWithinTargetCorridor: boolean
  topologyMetricSource: 'binary-component' | 'partial-front' | 'binary-through'
  fireRaySourceEdge: M5MaterialTopologySourceEdge
  partialFrontActiveLaneCount: number
  partialFrontErodedCellCount: number
  partialFrontTargetLateralRatio: number
  partialFrontCenterOffsetRatio: number
}>

export type M5MaterialTopologyStopCondition =
  | Readonly<{ mode: 'through-connected' }>
  | Readonly<{
      mode: 'topology-classification'
      classification: Extract<
        M5MaterialTopologyClassification,
        'deep-narrow' | 'shallow-wide'
      >
      minimumDissolvedVolumeRatio: number
      maximumDissolvedVolumeRatio: number
      minimumRemainingRatio: number
    }>

export function hasM5MaterialTopologyStopAuthority(
  metrics: M5MaterialTopologyMetrics,
  stop: M5MaterialTopologyStopCondition,
): boolean {
  return stop.mode === 'through-connected'
    ? metrics.throughConnected && metrics.remainingRatio > 0
    : metrics.classification === stop.classification &&
        metrics.topologyMetricSource === 'partial-front' &&
        metrics.sourceBoundaryReached &&
        metrics.dissolvedVolumeRatio >= stop.minimumDissolvedVolumeRatio &&
        metrics.dissolvedVolumeRatio <= stop.maximumDissolvedVolumeRatio &&
        metrics.remainingRatio >= stop.minimumRemainingRatio
}

type M5MaterialPartialRayAuthority = Readonly<{
  authorized: Uint8Array
  sourceGroupCount: number
}>

function createM5MaterialPartialRayAuthority(input: Readonly<{
  gridWidth: number
  gridHeight: number
  occupied: Uint8Array
  qualifying: Uint8Array
  gridOrigin: Readonly<{ x: number; y: number }>
  minimumMeaningfulComponentCellCount: number
}>): M5MaterialPartialRayAuthority {
  const { gridWidth: width, gridHeight: height } = input
  const cellCount = width * height
  const sourceByTarget = new Int32Array(cellCount)
  sourceByTarget.fill(-1)
  const sourceSeeds = new Uint8Array(cellCount)
  const reachableTargets: number[] = []
  const originX = input.gridOrigin.x
  const originY = input.gridOrigin.y
  const traversalEpsilon = 1e-10
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height
  const indexAt = (x: number, y: number): number => y * width + x

  const reachableSourceFor = (
    targetX: number,
    targetY: number,
  ): number => {
    const targetGridX = targetX + 0.5
    const targetGridY = targetY + 0.5
    const deltaX = targetGridX - originX
    const deltaY = targetGridY - originY
    let entry = 0
    let exit = 1
    for (const [origin, delta, maximum] of [
      [originX, deltaX, width],
      [originY, deltaY, height],
    ] as const) {
      if (Math.abs(delta) <= Number.EPSILON) {
        if (origin < 0 || origin > maximum) return -1
        continue
      }
      const first = (0 - origin) / delta
      const second = (maximum - origin) / delta
      entry = Math.max(entry, Math.min(first, second))
      exit = Math.min(exit, Math.max(first, second))
      if (entry > exit) return -1
    }
    const start = Math.min(1, Math.max(0, entry) + traversalEpsilon)
    const startX = originX + deltaX * start
    const startY = originY + deltaY * start
    let cellX = Math.min(
      width - 1,
      Math.max(0, Math.floor(Math.min(width - traversalEpsilon, startX))),
    )
    let cellY = Math.min(
      height - 1,
      Math.max(0, Math.floor(Math.min(height - traversalEpsilon, startY))),
    )
    const stepX = Math.sign(deltaX)
    const stepY = Math.sign(deltaY)
    let crossingX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : ((stepX > 0 ? cellX + 1 : cellX) - originX) / deltaX
    let crossingY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : ((stepY > 0 ? cellY + 1 : cellY) - originY) / deltaY
    const crossingStepX =
      stepX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaX)
    const crossingStepY =
      stepY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaY)
    let source = -1
    const passOccupiedCell = (x: number, y: number): boolean => {
      if (!inBounds(x, y)) return true
      const index = indexAt(x, y)
      if (input.occupied[index] === 0) return true
      if (input.qualifying[index] === 0) return false
      if (source < 0) source = index
      return true
    }

    for (let step = 0; step <= width + height + 2; step += 1) {
      if (!passOccupiedCell(cellX, cellY)) return -1
      if (cellX === targetX && cellY === targetY) return source
      if (
        crossingX > 1 + traversalEpsilon &&
        crossingY > 1 + traversalEpsilon
      ) {
        return -1
      }
      if (Math.abs(crossingX - crossingY) <= traversalEpsilon) {
        const sideX = cellX + stepX
        const sideY = cellY + stepY
        const sideIndices = [
          [sideX, cellY],
          [cellX, sideY],
        ] as const
        for (const [x, y] of sideIndices) {
          if (!passOccupiedCell(x, y)) return -1
        }
        cellX = sideX
        cellY = sideY
        crossingX += crossingStepX
        crossingY += crossingStepY
      } else if (crossingX < crossingY) {
        cellX += stepX
        crossingX += crossingStepX
      } else {
        cellY += stepY
        crossingY += crossingStepY
      }
      if (!inBounds(cellX, cellY)) return -1
    }
    return -1
  }

  for (let index = 0; index < cellCount; index += 1) {
    if (input.qualifying[index] === 0) continue
    const source = reachableSourceFor(index % width, Math.floor(index / width))
    if (source < 0) continue
    sourceByTarget[index] = source
    sourceSeeds[source] = 1
    reachableTargets.push(index)
  }

  const sourceGroupByCell = new Int32Array(cellCount)
  sourceGroupByCell.fill(-1)
  const queue = new Int32Array(cellCount)
  const sourceDirections = Object.freeze([
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],             [1, 0],
    [-1, 1],  [0, 1],   [1, 1],
  ] as const)
  let groupCount = 0
  for (let start = 0; start < cellCount; start += 1) {
    if (sourceSeeds[start] === 0 || sourceGroupByCell[start] >= 0) continue
    let head = 0
    let tail = 0
    queue[tail] = start
    tail += 1
    sourceGroupByCell[start] = groupCount
    while (head < tail) {
      const index = queue[head]!
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (const [deltaX, deltaY] of sourceDirections) {
        const nextX = x + deltaX
        const nextY = y + deltaY
        if (!inBounds(nextX, nextY)) continue
        const next = indexAt(nextX, nextY)
        if (
          sourceSeeds[next] === 0 ||
          sourceGroupByCell[next] >= 0
        ) {
          continue
        }
        sourceGroupByCell[next] = groupCount
        queue[tail] = next
        tail += 1
      }
    }
    groupCount += 1
  }

  const targetCountByGroup = new Int32Array(groupCount)
  for (const target of reachableTargets) {
    const group = sourceGroupByCell[sourceByTarget[target]!]!
    if (group >= 0) targetCountByGroup[group] += 1
  }
  const authorized = new Uint8Array(cellCount)
  let sourceGroupCount = 0
  for (const count of targetCountByGroup) {
    if (count >= input.minimumMeaningfulComponentCellCount) {
      sourceGroupCount += 1
    }
  }
  for (const target of reachableTargets) {
    const group = sourceGroupByCell[sourceByTarget[target]!]!
    if (
      group >= 0 &&
      targetCountByGroup[group]! >=
        input.minimumMeaningfulComponentCellCount
    ) {
      authorized[target] = 1
    }
  }
  return { authorized, sourceGroupCount }
}

type M5MaterialPartialFrontMetrics = Readonly<{
  penetrationRatio: number
  lateralCoverageRatio: number
  lateralCenterRatio: number
  centerOffsetRatio: number
  withinTargetCorridor: boolean
  sourceBoundaryReached: boolean
  sourceComponentCount: number
  activeLaneCount: number
  erodedCellCount: number
  targetLateralRatio: number
}>

function weightedQuantile(
  samples: readonly Readonly<{ value: number; weight: number }>[],
  quantile: number,
): number {
  if (samples.length === 0) return 0
  const ordered = [...samples].sort((left, right) => left.value - right.value)
  const totalWeight = ordered.reduce((sum, sample) => sum + sample.weight, 0)
  if (!(totalWeight > 0)) return ordered.at(-1)!.value
  const targetWeight = totalWeight * quantile
  let cumulativeWeight = 0
  for (const sample of ordered) {
    cumulativeWeight += sample.weight
    if (cumulativeWeight >= targetWeight) return sample.value
  }
  return ordered.at(-1)!.value
}

function measureM5MaterialPartialFront(input: Readonly<{
  gridWidth: number
  gridHeight: number
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
  epsilon: number
  placement: M5MaterialTopologyPlacement
  frame: M5MaterialFireRayFrame
  config: M5MaterialTopologyPartialFrontConfig
  targetLateralRatio: number
  targetCorridorHalfWidthRatio: number
}>): M5MaterialPartialFrontMetrics {
  const normalizedOriginX =
    input.frame.localOrigin.x / input.placement.width
  const normalizedOriginY =
    input.frame.localOrigin.y / input.placement.height
  const gridOrigin = Object.freeze({
    x: (normalizedOriginX + 0.5) * input.gridWidth,
    y: (normalizedOriginY + 0.5) * input.gridHeight,
  })
  if (
    !Number.isFinite(normalizedOriginX) ||
    !Number.isFinite(normalizedOriginY) ||
    !finitePoint(gridOrigin)
  ) {
    throw new Error(
      'M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_NORMALIZED_ORIGIN_INVALID',
    )
  }
  const projections: Array<Readonly<{
    index: number
    x: number
    y: number
    along: number
    lateral: number
    initial: number
    remaining: number
  }>> = []
  const occupied = new Uint8Array(input.gridWidth * input.gridHeight)
  let minimumAlong = Number.POSITIVE_INFINITY
  let maximumAlong = Number.NEGATIVE_INFINITY
  let minimumLateral = Number.POSITIVE_INFINITY
  let maximumLateral = Number.NEGATIVE_INFINITY
  for (let y = 0; y < input.gridHeight; y += 1) {
    for (let x = 0; x < input.gridWidth; x += 1) {
      const index = y * input.gridWidth + x
      const initial = input.initialCellVolumes[index]!
      if (initial <= input.epsilon) continue
      occupied[index] = 1
      const localX =
        ((x + 0.5) / input.gridWidth - 0.5) * input.placement.width
      const localY =
        ((y + 0.5) / input.gridHeight - 0.5) * input.placement.height
      const relativeX = localX - input.frame.localOrigin.x
      const relativeY = localY - input.frame.localOrigin.y
      const along =
        relativeX * input.frame.direction.x +
        relativeY * input.frame.direction.y
      const lateral =
        relativeX * input.frame.lateralAxis.x +
        relativeY * input.frame.lateralAxis.y
      minimumAlong = Math.min(minimumAlong, along)
      maximumAlong = Math.max(maximumAlong, along)
      minimumLateral = Math.min(minimumLateral, lateral)
      maximumLateral = Math.max(maximumLateral, lateral)
      projections.push({
        index,
        x,
        y,
        along,
        lateral,
        initial,
        remaining: input.remainingCellVolumes[index]!,
      })
    }
  }
  const alongSpan = maximumAlong - minimumAlong
  const lateralSpan = maximumLateral - minimumLateral
  if (!(alongSpan > input.epsilon) || !(lateralSpan > input.epsilon)) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_PARTIAL_FRONT_SPAN_INVALID')
  }
  const qualifying = new Uint8Array(input.gridWidth * input.gridHeight)
  const erodedVolumeByIndex = new Float64Array(
    input.gridWidth * input.gridHeight,
  )
  for (const projection of projections) {
    const erodedVolume = Math.max(
      0,
      Math.min(projection.initial, projection.initial - projection.remaining),
    )
    erodedVolumeByIndex[projection.index] = erodedVolume
    if (
      erodedVolume / projection.initial >=
      input.config.minimumCellErosionRatio
    ) {
      qualifying[projection.index] = 1
    }
  }
  const { authorized, sourceGroupCount: sourceComponentCount } =
    createM5MaterialPartialRayAuthority({
      gridWidth: input.gridWidth,
      gridHeight: input.gridHeight,
      occupied,
      qualifying,
      gridOrigin,
      minimumMeaningfulComponentCellCount:
        input.config.minimumMeaningfulComponentCellCount,
    })
  const bins = Array.from(
    { length: input.config.lateralBinCount },
    () => ({
      initialVolume: 0,
      qualifyingErodedVolume: 0,
    }),
  )
  const erodedCells: Array<Readonly<{
    bin: number
    lateralRatio: number
    weight: number
  }>> = []
  let authorizedErodedVolume = 0
  let totalInitialVolume = 0
  const binFor = (lateral: number): number =>
    Math.min(
      input.config.lateralBinCount - 1,
      Math.max(
        0,
        Math.floor(
          ((lateral - minimumLateral) / lateralSpan) *
            input.config.lateralBinCount,
        ),
      ),
    )
  for (const projection of projections) {
    const bin = binFor(projection.lateral)
    bins[bin]!.initialVolume += projection.initial
    totalInitialVolume += projection.initial
    if (authorized[projection.index] === 0) continue
    const erodedVolume = erodedVolumeByIndex[projection.index]!
    authorizedErodedVolume += erodedVolume
    bins[bin]!.qualifyingErodedVolume += erodedVolume
    erodedCells.push({
      bin,
      lateralRatio: Math.max(
        0,
        Math.min(1, (projection.lateral - minimumLateral) / lateralSpan),
      ),
      // Shape centering must not be biased by the material's composition
      // density. Weight the front by each cell's erosion fraction while the
      // dissolved-volume and penetration metrics continue using real volume.
      weight: erodedVolume / projection.initial,
    })
  }
  const activeBins = new Set<number>()
  let occupiedBinCount = 0
  for (let bin = 0; bin < bins.length; bin += 1) {
    const values = bins[bin]!
    if (values.initialVolume <= input.epsilon) continue
    occupiedBinCount += 1
    if (
      values.qualifyingErodedVolume / values.initialVolume >=
      input.config.minimumActiveLaneErosionRatio
    ) {
      activeBins.add(bin)
    }
  }
  const activeCells = erodedCells.filter(({ bin }) => activeBins.has(bin))
  const targetLateralRatio = input.targetLateralRatio
  if (activeCells.length === 0 || occupiedBinCount === 0) {
    return {
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
      lateralCenterRatio: targetLateralRatio,
      centerOffsetRatio: 1,
      withinTargetCorridor: false,
      sourceBoundaryReached: false,
      sourceComponentCount: 0,
      activeLaneCount: 0,
      erodedCellCount: erodedCells.length,
      targetLateralRatio,
    }
  }
  const tailQuantile = (1 - input.config.lateralCoverageQuantile) * 0.5
  const lateralSamples = activeCells.map(({ lateralRatio, weight }) => ({
    value: lateralRatio,
    weight,
  }))
  const lowerLateral = weightedQuantile(lateralSamples, tailQuantile)
  const upperLateral = weightedQuantile(lateralSamples, 1 - tailQuantile)
  const lowerBin = binFor(minimumLateral + lowerLateral * lateralSpan)
  const upperBin = binFor(minimumLateral + upperLateral * lateralSpan)
  const lateralCoverageRatio = Math.min(
    1,
    (Math.abs(upperBin - lowerBin) + 1) / occupiedBinCount,
  )
  const penetrationRatio = Math.min(
    1,
    authorizedErodedVolume / totalInitialVolume / lateralCoverageRatio,
  )
  // The same weighted quantile envelope that rejects sparse lateral outliers
  // defines the front center. This keeps the center tied to the configured
  // partial-front evidence lanes instead of material-density skew within one
  // lane, while an off-centre envelope still remains off-centre.
  const lateralCenterRatio = (lowerLateral + upperLateral) * 0.5
  const centerOffsetRatio = Math.abs(
    lateralCenterRatio - targetLateralRatio,
  )
  return {
    penetrationRatio,
    lateralCoverageRatio,
    lateralCenterRatio,
    centerOffsetRatio,
    withinTargetCorridor:
      centerOffsetRatio <= input.targetCorridorHalfWidthRatio,
    sourceBoundaryReached: sourceComponentCount > 0,
    sourceComponentCount,
    activeLaneCount: activeBins.size,
    erodedCellCount: erodedCells.length,
    targetLateralRatio,
  }
}

export function classifyM5MaterialTopology(input: Readonly<{
  gridWidth: number
  gridHeight: number
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
  sourceEdge: M5MaterialTopologySourceEdge
  epsilon: number
  shapeThresholds: M5MaterialTopologyShapeThresholds
  partialFront?: M5MaterialTopologyPartialFrontConfig
  placement?: M5MaterialTopologyPlacement
  fireRay?: M5MaterialFireRay
}>): M5MaterialTopologyMetrics {
  const { gridWidth: width, gridHeight: height, epsilon } = input
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    input.initialCellVolumes.length !== width * height ||
    input.remainingCellVolumes.length !== width * height ||
    !Number.isFinite(epsilon) ||
    epsilon < 0 ||
    !M5_MATERIAL_TOPOLOGY_SOURCE_EDGES.includes(input.sourceEdge)
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_INPUT_INVALID')
  }
  const thresholds = input.shapeThresholds
  const thresholdValues = M5_MATERIAL_TOPOLOGY_THRESHOLD_KEYS.map(
    (key) => thresholds?.[key],
  )
  if (
    !thresholdValues.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    thresholds.targetCorridorHalfWidthRatio <= 0 ||
    thresholds.minimumThroughDepthSpanRatio <= 0 ||
    thresholds.shallowPenetrationMaximum >=
      thresholds.deepPenetrationMinimum ||
    thresholds.narrowLateralCoverageMaximum >
      thresholds.wideLateralCoverageMinimum ||
    thresholds.maximumCenterOffsetRatio >
      thresholds.targetCorridorHalfWidthRatio
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_THRESHOLDS_INVALID')
  }
  const hasPartialFront = input.partialFront !== undefined
  const hasFireGeometry = input.placement !== undefined && input.fireRay !== undefined
  if (
    (input.placement === undefined) !== (input.fireRay === undefined) ||
    hasPartialFront !== hasFireGeometry
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_PARTIAL_FRONT_INPUT_INCOMPLETE')
  }
  const partialFront = input.partialFront
  if (
    partialFront !== undefined &&
    (!Number.isSafeInteger(partialFront.lateralBinCount) ||
      partialFront.lateralBinCount < 2 ||
      !Number.isFinite(partialFront.minimumCellErosionRatio) ||
      partialFront.minimumCellErosionRatio <= 0 ||
      partialFront.minimumCellErosionRatio > 1 ||
      !Number.isFinite(partialFront.minimumActiveLaneErosionRatio) ||
      partialFront.minimumActiveLaneErosionRatio <= 0 ||
      partialFront.minimumActiveLaneErosionRatio > 1 ||
      !Number.isFinite(partialFront.lateralCoverageQuantile) ||
      partialFront.lateralCoverageQuantile <= 0 ||
      partialFront.lateralCoverageQuantile > 1 ||
      !Number.isSafeInteger(partialFront.minimumMeaningfulComponentCellCount) ||
      partialFront.minimumMeaningfulComponentCellCount <= 0)
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_PARTIAL_FRONT_CONFIG_INVALID')
  }
  const rayFrame = hasFireGeometry
    ? createM5MaterialFireRayFrame({
        placement: input.placement!,
        ray: input.fireRay!,
      })
    : undefined
  if (rayFrame !== undefined && rayFrame.sourceEdge !== input.sourceEdge) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_SOURCE_EDGE_MISMATCH')
  }
  const sourceEdge = input.sourceEdge

  const cellCount = width * height
  const occupied = new Uint8Array(cellCount)
  const dissolved = new Uint8Array(cellCount)
  const sourceBoundary = new Uint8Array(cellCount)
  const farBoundary = new Uint8Array(cellCount)
  let initialVolume = 0
  let remainingVolume = 0
  let occupiedCellCount = 0
  let fullyDissolvedCellCount = 0
  for (let index = 0; index < cellCount; index += 1) {
    const initial = input.initialCellVolumes[index]!
    const remaining = input.remainingCellVolumes[index]!
    if (
      !Number.isFinite(initial) ||
      !Number.isFinite(remaining) ||
      initial < 0 ||
      remaining < -epsilon ||
      remaining > initial + epsilon
    ) {
      throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_VOLUME_INVALID')
    }
    initialVolume += initial
    remainingVolume += Math.max(0, Math.min(initial, remaining))
    if (initial <= epsilon) continue
    occupied[index] = 1
    occupiedCellCount += 1
    if (remaining <= epsilon) {
      dissolved[index] = 1
      fullyDissolvedCellCount += 1
    }
  }
  if (initialVolume <= epsilon || occupiedCellCount === 0) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_EMPTY_INITIAL')
  }

  const vertical = sourceEdge === 'top' || sourceEdge === 'bottom'
  const laneCount = vertical ? width : height
  const sourceDepthByLane = new Int32Array(laneCount)
  const farDepthByLane = new Int32Array(laneCount)
  const laneDepthSpan = new Int32Array(laneCount)
  sourceDepthByLane.fill(-1)
  farDepthByLane.fill(-1)
  let occupiedLaneCount = 0
  let globalMinimumDepth = Number.POSITIVE_INFINITY
  let globalMaximumDepth = Number.NEGATIVE_INFINITY
  for (let lane = 0; lane < laneCount; lane += 1) {
    let minimum = Number.POSITIVE_INFINITY
    let maximum = Number.NEGATIVE_INFINITY
    const depthCount = vertical ? height : width
    for (let depth = 0; depth < depthCount; depth += 1) {
      const x = vertical ? lane : depth
      const y = vertical ? depth : lane
      if (occupied[y * width + x] === 0) continue
      minimum = Math.min(minimum, depth)
      maximum = Math.max(maximum, depth)
    }
    if (!Number.isFinite(minimum)) continue
    occupiedLaneCount += 1
    const sourceUsesMinimum =
      sourceEdge === 'top' || sourceEdge === 'left'
    const sourceDepth = sourceUsesMinimum ? minimum : maximum
    const farDepth = sourceUsesMinimum ? maximum : minimum
    sourceDepthByLane[lane] = sourceDepth
    farDepthByLane[lane] = farDepth
    laneDepthSpan[lane] = Math.abs(farDepth - sourceDepth) + 1
    globalMinimumDepth = Math.min(globalMinimumDepth, minimum)
    globalMaximumDepth = Math.max(globalMaximumDepth, maximum)
    const sourceX = vertical ? lane : sourceDepth
    const sourceY = vertical ? sourceDepth : lane
    const farX = vertical ? lane : farDepth
    const farY = vertical ? farDepth : lane
    sourceBoundary[sourceY * width + sourceX] = 1
    farBoundary[farY * width + farX] = 1
  }
  const globalDepthSpan = globalMaximumDepth - globalMinimumDepth + 1

  const visited = new Uint8Array(cellCount)
  const queue = new Int32Array(cellCount)
  let sourceErosionComponentCount = 0
  let primaryComponentCellCount = 0
  let primaryComponentLateralCenterRatio = thresholds.targetLateralRatio
  let primaryComponentCenterOffsetRatio = 1
  let primaryComponentDepthSpanRatio = 0
  let primaryComponentLateralCoverageRatio = 0
  let primaryComponentTouchesSource = false
  let primaryComponentTouchesFar = false
  let primaryComponentWithinTargetCorridor = false
  let primaryComponentIsCenteredThrough = false
  let primaryComponentIsMeaningful = false
  const directions = [-1, 0, 1, 0, -1] as const
  const laneRatio = (lane: number): number => (lane + 0.5) / laneCount
  const inTargetCorridor = (lane: number): boolean =>
    Math.abs(laneRatio(lane) - thresholds.targetLateralRatio) <=
    thresholds.targetCorridorHalfWidthRatio
  for (let start = 0; start < cellCount; start += 1) {
    if (dissolved[start] === 0 || visited[start] !== 0) continue
    let head = 0
    let tail = 0
    queue[tail] = start
    tail += 1
    visited[start] = 1
    let componentTouchesSource = false
    let componentTouchesSourceInTargetCorridor = false
    let componentTouchesMeaningfulFarInTargetCorridor = false
    let componentMaximumPenetration = 0
    let componentMinimumLane = laneCount
    let componentMaximumLane = -1
    const componentReachedLanes = new Uint8Array(laneCount)
    while (head < tail) {
      const index = queue[head]!
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      const lane = vertical ? x : y
      const depth = vertical ? y : x
      componentReachedLanes[lane] = 1
      componentMinimumLane = Math.min(componentMinimumLane, lane)
      componentMaximumLane = Math.max(componentMaximumLane, lane)
      const touchesSource = sourceBoundary[index] !== 0
      componentTouchesSource ||= touchesSource
      componentTouchesSourceInTargetCorridor ||=
        touchesSource && inTargetCorridor(lane)
      componentTouchesMeaningfulFarInTargetCorridor ||=
        farBoundary[index] !== 0 &&
        inTargetCorridor(lane) &&
        laneDepthSpan[lane]! / globalDepthSpan >=
          thresholds.minimumThroughDepthSpanRatio
      const sourceDepth = sourceDepthByLane[lane]!
      if (sourceDepth >= 0) {
        const depthSpan = laneDepthSpan[lane]!
        const penetrationDepthSpan =
          depthSpan / globalDepthSpan >=
          thresholds.minimumThroughDepthSpanRatio
            ? depthSpan
            : globalDepthSpan
        componentMaximumPenetration = Math.max(
          componentMaximumPenetration,
          (Math.abs(depth - sourceDepth) + 1) / penetrationDepthSpan,
        )
      }
      for (let direction = 0; direction < 4; direction += 1) {
        const nextX = x + directions[direction]!
        const nextY = y + directions[direction + 1]!
        if (
          nextX < 0 ||
          nextX >= width ||
          nextY < 0 ||
          nextY >= height
        ) {
          continue
        }
        const next = nextY * width + nextX
        if (dissolved[next] === 0 || visited[next] !== 0) continue
        visited[next] = 1
        queue[tail] = next
        tail += 1
      }
    }
    if (!componentTouchesSource) continue
    sourceErosionComponentCount += 1
    if (!componentTouchesSourceInTargetCorridor) continue
    let reachedLaneCount = 0
    for (let lane = 0; lane < componentReachedLanes.length; lane += 1) {
      reachedLaneCount += componentReachedLanes[lane]!
    }
    const componentCenterRatio =
      (laneRatio(componentMinimumLane) + laneRatio(componentMaximumLane)) * 0.5
    const componentCenterOffset = Math.abs(
      componentCenterRatio - thresholds.targetLateralRatio,
    )
    const componentIsCenteredThrough =
      componentTouchesMeaningfulFarInTargetCorridor &&
      componentCenterOffset <= thresholds.maximumCenterOffsetRatio
    const componentIsMeaningful =
      tail >= (partialFront?.minimumMeaningfulComponentCellCount ?? 1)
    const hasHigherThroughPriority =
      componentIsCenteredThrough && !primaryComponentIsCenteredThrough
    const hasSameThroughPriority =
      componentIsCenteredThrough === primaryComponentIsCenteredThrough
    const hasHigherMeaningfulPriority =
      hasSameThroughPriority &&
      componentIsMeaningful &&
      !primaryComponentIsMeaningful
    const hasSameMeaningfulPriority =
      hasSameThroughPriority &&
      componentIsMeaningful === primaryComponentIsMeaningful
    const hasGreaterDepth =
      hasSameMeaningfulPriority &&
      componentMaximumPenetration > primaryComponentDepthSpanRatio
    const equallyDeepButLarger =
      hasSameMeaningfulPriority &&
      componentMaximumPenetration === primaryComponentDepthSpanRatio &&
      tail > primaryComponentCellCount
    const isCloserToTarget =
      hasSameMeaningfulPriority &&
      componentMaximumPenetration === primaryComponentDepthSpanRatio &&
      tail === primaryComponentCellCount &&
      componentCenterOffset < primaryComponentCenterOffsetRatio
    if (
      !hasHigherThroughPriority &&
      !hasHigherMeaningfulPriority &&
      !hasGreaterDepth &&
      !equallyDeepButLarger &&
      !isCloserToTarget
    ) {
      continue
    }
    primaryComponentCellCount = tail
    primaryComponentLateralCenterRatio = componentCenterRatio
    primaryComponentCenterOffsetRatio = componentCenterOffset
    primaryComponentDepthSpanRatio = Math.min(1, componentMaximumPenetration)
    primaryComponentLateralCoverageRatio =
      occupiedLaneCount === 0 ? 0 : reachedLaneCount / occupiedLaneCount
    primaryComponentTouchesSource = true
    primaryComponentTouchesFar = componentTouchesMeaningfulFarInTargetCorridor
    primaryComponentWithinTargetCorridor = true
    primaryComponentIsCenteredThrough = componentIsCenteredThrough
    primaryComponentIsMeaningful = componentIsMeaningful
  }
  const dissolvedVolumeRatio = Math.max(
    0,
    Math.min(1, (initialVolume - remainingVolume) / initialVolume),
  )
  const remainingRatio = Math.max(
    0,
    Math.min(1, remainingVolume / initialVolume),
  )
  const sourceBoundaryReached = primaryComponentTouchesSource
  const farBoundaryReached = primaryComponentTouchesFar
  const throughConnected =
    primaryComponentTouchesSource && primaryComponentTouchesFar
  const partialMetrics =
    partialFront === undefined || rayFrame === undefined
      ? undefined
      : measureM5MaterialPartialFront({
          gridWidth: width,
          gridHeight: height,
          initialCellVolumes: input.initialCellVolumes,
          remainingCellVolumes: input.remainingCellVolumes,
          epsilon,
          placement: input.placement!,
          frame: rayFrame,
          config: partialFront,
          targetLateralRatio: thresholds.targetLateralRatio,
          targetCorridorHalfWidthRatio:
            thresholds.targetCorridorHalfWidthRatio,
        })
  const topologyMetricSource = throughConnected
    ? 'binary-through'
    : partialMetrics === undefined
      ? 'binary-component'
      : 'partial-front'
  const maximumPenetration = throughConnected
    ? primaryComponentDepthSpanRatio
    : (partialMetrics?.penetrationRatio ?? primaryComponentDepthSpanRatio)
  const lateralCoverageRatio = throughConnected
    ? primaryComponentLateralCoverageRatio
    : (partialMetrics?.lateralCoverageRatio ??
      primaryComponentLateralCoverageRatio)
  const centeredPrimaryComponent = partialMetrics === undefined
    ? primaryComponentWithinTargetCorridor &&
      primaryComponentCenterOffsetRatio <= thresholds.maximumCenterOffsetRatio
    : partialMetrics.sourceBoundaryReached &&
      partialMetrics.withinTargetCorridor &&
      partialMetrics.centerOffsetRatio <= thresholds.maximumCenterOffsetRatio
  const classification: M5MaterialTopologyClassification = throughConnected
    ? remainingVolume > epsilon
      ? 'through-not-empty'
      : 'through-empty'
    : centeredPrimaryComponent &&
        maximumPenetration >= thresholds.deepPenetrationMinimum &&
        lateralCoverageRatio <= thresholds.narrowLateralCoverageMaximum
      ? 'deep-narrow'
      : centeredPrimaryComponent &&
          maximumPenetration <= thresholds.shallowPenetrationMaximum &&
          lateralCoverageRatio >= thresholds.wideLateralCoverageMinimum
        ? 'shallow-wide'
        : 'intermediate'
  return {
    classification,
    initialVolume,
    remainingVolume,
    dissolvedVolumeRatio,
    remainingRatio,
    occupiedCellCount,
    fullyDissolvedCellCount,
    sourceErosionComponentCount:
      throughConnected || partialMetrics === undefined
        ? sourceErosionComponentCount
        : partialMetrics.sourceComponentCount,
    penetrationRatio: Math.min(1, maximumPenetration),
    lateralCoverageRatio,
    sourceBoundaryReached:
      throughConnected || partialMetrics === undefined
        ? sourceBoundaryReached
        : partialMetrics.sourceBoundaryReached,
    farBoundaryReached,
    throughConnected,
    primaryComponentCellCount,
    primaryComponentLateralCenterRatio,
    primaryComponentCenterOffsetRatio,
    primaryComponentDepthSpanRatio,
    primaryComponentWithinTargetCorridor,
    topologyMetricSource,
    fireRaySourceEdge: sourceEdge,
    partialFrontActiveLaneCount: partialMetrics?.activeLaneCount ?? 0,
    partialFrontErodedCellCount: partialMetrics?.erodedCellCount ?? 0,
    partialFrontTargetLateralRatio:
      partialMetrics?.targetLateralRatio ?? thresholds.targetLateralRatio,
    partialFrontCenterOffsetRatio:
      partialMetrics?.centerOffsetRatio ?? primaryComponentCenterOffsetRatio,
  }
}

export type M5VisualCollectorAlignmentConfig = Readonly<{
  leftKey: string
  rightKey: string
  maximumCenterOffset: number
  deadlineMilliseconds: number
  pollIntervalMilliseconds: number
  maximumCorrectionHoldMilliseconds: number
  settlePaddingMilliseconds: number
  feedbackActivationDirectionChanges: number
  feedbackPulseTicks: number
  feedbackVelocityTolerance: number
}>

export type M5VisualCollectorMotionConfig = Readonly<{
  acceleration: number
  deceleration: number
  maxSpeed: number
}>

export type M5VisualCollectorAlignmentPosition = Readonly<{
  collectorCenterX: number
  materialCenterX: number
  velocityX?: number
  tick?: number
}>

export type M5VisualCollectorAlignmentResult = Readonly<{
  initialOffset: number
  finalOffset: number
  correctionCount: number
}>

function collectorCorrectionTiming(
  distance: number,
  motion: M5VisualCollectorMotionConfig,
  maximumHoldMilliseconds: number,
): Readonly<{ holdMilliseconds: number; settleMilliseconds: number }> {
  const timeToMaxSpeed = motion.maxSpeed / motion.acceleration
  const accelerationDistance =
    0.5 * motion.acceleration * timeToMaxSpeed * timeToMaxSpeed
  const coastFromMaxSpeed =
    (motion.maxSpeed * motion.maxSpeed) / (2 * motion.deceleration)
  const triangularHoldSeconds = Math.sqrt(
    distance /
      (0.5 * motion.acceleration +
        (motion.acceleration * motion.acceleration) /
          (2 * motion.deceleration)),
  )
  const holdSeconds =
    triangularHoldSeconds <= timeToMaxSpeed
      ? triangularHoldSeconds
      : timeToMaxSpeed +
        Math.max(0, distance - accelerationDistance - coastFromMaxSpeed) /
          motion.maxSpeed
  const holdMilliseconds = Math.max(
    1,
    Math.min(maximumHoldMilliseconds, holdSeconds * 1_000),
  )
  const releaseSpeed = Math.min(
    motion.maxSpeed,
    motion.acceleration * (holdMilliseconds / 1_000),
  )
  return {
    holdMilliseconds,
    settleMilliseconds: (releaseSpeed / motion.deceleration) * 1_000,
  }
}

export async function alignM5VisualCollector(input: Readonly<{
  config: M5VisualCollectorAlignmentConfig
  motion: M5VisualCollectorMotionConfig
  readPosition: () => Promise<M5VisualCollectorAlignmentPosition>
  focus: () => Promise<void>
  keyDown: (key: string) => Promise<void>
  keyUp: (key: string) => Promise<void>
  waitForMilliseconds: (milliseconds: number) => Promise<void>
  now?: () => number
}>): Promise<M5VisualCollectorAlignmentResult> {
  const { config, motion } = input
  if (
    config.leftKey.length === 0 ||
    config.rightKey.length === 0 ||
    config.leftKey === config.rightKey ||
    !Number.isFinite(config.maximumCenterOffset) ||
    config.maximumCenterOffset < 0 ||
    !Number.isFinite(config.deadlineMilliseconds) ||
    config.deadlineMilliseconds <= 0 ||
    !Number.isFinite(config.pollIntervalMilliseconds) ||
    config.pollIntervalMilliseconds <= 0 ||
    !Number.isFinite(config.maximumCorrectionHoldMilliseconds) ||
    config.maximumCorrectionHoldMilliseconds <= 0 ||
    !Number.isFinite(config.settlePaddingMilliseconds) ||
    config.settlePaddingMilliseconds < 0 ||
    !Number.isSafeInteger(config.feedbackActivationDirectionChanges) ||
    config.feedbackActivationDirectionChanges <= 0 ||
    !Number.isSafeInteger(config.feedbackPulseTicks) ||
    config.feedbackPulseTicks <= 0 ||
    !Number.isFinite(config.feedbackVelocityTolerance) ||
    config.feedbackVelocityTolerance < 0 ||
    !Number.isFinite(motion.acceleration) ||
    motion.acceleration <= 0 ||
    !Number.isFinite(motion.deceleration) ||
    motion.deceleration <= 0 ||
    !Number.isFinite(motion.maxSpeed) ||
    motion.maxSpeed <= 0
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_CONFIG_INVALID')
  }
  const now = input.now ?? Date.now
  const startedAt = now()
  const deadline = startedAt + config.deadlineMilliseconds
  const wallDeadline = Date.now() + config.deadlineMilliseconds
  const timeoutError = (): Error =>
    new Error('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT')
  const remainingMilliseconds = (): number =>
    Math.min(deadline - now(), wallDeadline - Date.now())
  const runBeforeDeadline = async <T>(
    operation: () => Promise<T>,
    attemptAfterDeadline = false,
    onLateFulfill?: (value: T) => void,
  ): Promise<T> => {
    if (!attemptAfterDeadline && remainingMilliseconds() <= 0) {
      throw timeoutError()
    }
    let operationPromise: Promise<T>
    try {
      operationPromise = Promise.resolve(operation())
    } catch (error) {
      throw error
    }
    const remaining = remainingMilliseconds()
    if (remaining <= 0) {
      void operationPromise.then(
        (value) => onLateFulfill?.(value),
        () => undefined,
      )
      throw timeoutError()
    }
    return new Promise<T>((resolvePromise, rejectPromise) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        rejectPromise(timeoutError())
      }, Math.max(1, Math.ceil(remaining)))
      void operationPromise.then(
        (value) => {
          if (settled) {
            onLateFulfill?.(value)
            return
          }
          settled = true
          clearTimeout(timer)
          resolvePromise(value)
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          rejectPromise(error)
        },
      )
    })
  }
  let correctionCount = 0
  let directionChangeCount = 0
  let feedbackMode = false
  let position = await runBeforeDeadline(() => input.readPosition())
  const offset = (): number => {
    const value = position.materialCenterX - position.collectorCenterX
    if (!Number.isFinite(value)) {
      throw new Error('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_POSITION_INVALID')
    }
    return value
  }
  const initialOffset = Math.abs(offset())
  let previousDelta = offset()
  while (Math.abs(offset()) > config.maximumCenterOffset) {
    if (now() >= deadline) {
      throw timeoutError()
    }
    const delta = offset()
    if (Math.sign(delta) !== Math.sign(previousDelta)) directionChangeCount += 1
    feedbackMode ||=
      directionChangeCount >= config.feedbackActivationDirectionChanges &&
      Number.isSafeInteger(position.tick) &&
      Number.isFinite(position.velocityX)
    if (feedbackMode) {
      while (Math.abs(position.velocityX!) > config.feedbackVelocityTolerance) {
        await runBeforeDeadline(() =>
          input.waitForMilliseconds(config.pollIntervalMilliseconds),
        )
        position = await runBeforeDeadline(() => input.readPosition())
      }
      if (Math.abs(offset()) <= config.maximumCenterOffset) {
        previousDelta = delta
        continue
      }
    }
    const correctedDelta = offset()
    const key = correctedDelta < 0 ? config.leftKey : config.rightKey
    const timing = collectorCorrectionTiming(
      Math.abs(delta),
      motion,
      config.maximumCorrectionHoldMilliseconds,
    )
    const remainingBeforeHold = deadline - now()
    const holdMilliseconds = Math.min(
      feedbackMode ? config.pollIntervalMilliseconds : timing.holdMilliseconds,
      remainingBeforeHold,
    )
    if (holdMilliseconds <= 0) {
      throw timeoutError()
    }
    await runBeforeDeadline(() => input.focus())
    let keyDownAttempted = false
    const releaseAfterLateKeyDown = (): void => {
      let releasePromise: Promise<void>
      try {
        releasePromise = Promise.resolve(input.keyUp(key))
      } catch {
        return
      }
      void releasePromise.catch(() => undefined)
    }
    try {
      await runBeforeDeadline(
        () => {
          keyDownAttempted = true
          return input.keyDown(key)
        },
        false,
        releaseAfterLateKeyDown,
      )
      if (!feedbackMode) {
        await runBeforeDeadline(() => input.waitForMilliseconds(holdMilliseconds))
      } else {
        const startTick = position.tick!
        while (position.tick! < startTick + config.feedbackPulseTicks) {
          await runBeforeDeadline(() =>
            input.waitForMilliseconds(config.pollIntervalMilliseconds),
          )
          position = await runBeforeDeadline(() => input.readPosition())
        }
      }
    } finally {
      if (keyDownAttempted) {
        await runBeforeDeadline(() => input.keyUp(key), true)
      }
    }
    correctionCount += 1
    if (feedbackMode) {
      while (Math.abs(position.velocityX!) > config.feedbackVelocityTolerance) {
        await runBeforeDeadline(() =>
          input.waitForMilliseconds(config.pollIntervalMilliseconds),
        )
        position = await runBeforeDeadline(() => input.readPosition())
      }
      previousDelta = delta
      continue
    }
    const remainingBeforeSettle = deadline - now()
    const settleMilliseconds = Math.min(
      timing.settleMilliseconds + config.settlePaddingMilliseconds,
      Math.max(0, remainingBeforeSettle),
    )
    if (settleMilliseconds > 0) {
      await runBeforeDeadline(() => input.waitForMilliseconds(settleMilliseconds))
    }
    const remainingBeforePoll = deadline - now()
    if (remainingBeforePoll > 0) {
      await runBeforeDeadline(() =>
        input.waitForMilliseconds(
          Math.min(config.pollIntervalMilliseconds, remainingBeforePoll),
        ),
      )
    }
    position = await runBeforeDeadline(() => input.readPosition())
    previousDelta = delta
  }
  return {
    initialOffset,
    finalOffset: Math.abs(offset()),
    correctionCount,
  }
}

export const M5_VISUAL_LAYOUT_CORE_CONTROLS = Object.freeze([
  Object.freeze({
    id: 'pause-or-resume',
    selector: '[data-action="pause"], [data-action="resume"]',
  }),
  Object.freeze({ id: 'restart', selector: '[data-action="restart"]' }),
  Object.freeze({
    id: 'fire-sources',
    selector: '[data-fire-source-list] button',
  }),
  Object.freeze({ id: 'fire-size', selector: '[data-fire-size]' }),
  Object.freeze({ id: 'flame-thrust', selector: '[data-flame-thrust]' }),
  Object.freeze({ id: 'audio-volume', selector: '[data-audio-volume]' }),
  Object.freeze({ id: 'audio-muted', selector: '[data-audio-muted]' }),
  Object.freeze({
    id: 'inventory-materials',
    selector: '[data-inventory] button',
  }),
  Object.freeze({
    id: 'add-material',
    selector: '[data-action="add-material"]',
  }),
  Object.freeze({
    id: 'cancel-material',
    selector: '[data-action="cancel-material"]',
  }),
  Object.freeze({ id: 'finish', selector: '[data-action="finish"]' }),
])

export type M5VisualLayoutCoreControlObservation = Readonly<{
  id: string
  matchCount: number
  visibleCount: number
  nonZeroRectCount: number
  reachableCount: number
  hitTestCount: number
  clippedByAncestorCount: number
  disabledCount: number
}>

export type M5VisualLayoutObservation = Readonly<{
  hasCore: boolean
  stageContainsCanvas: boolean
  horizontalOverflow: boolean
  scrollHeight: number
  innerWidth: number
  innerHeight: number
  maximumScrollY: number
  observedMaximumScrollY: number
  controls: readonly M5VisualLayoutCoreControlObservation[]
}>

export function createM5VisualLayoutChecks(input: Readonly<{
  viewport: M5VisualEvidenceViewport
  narrowMaximumWidth: number
  measured: M5VisualLayoutObservation
}>): readonly M5VisualEvidenceCheck[] {
  const narrow = input.viewport.width <= input.narrowMaximumWidth
  const observationsById = new Map(
    input.measured.controls.map((observation) => [
      observation.id,
      observation,
    ]),
  )
  const controlContractPassed =
    input.measured.controls.length === M5_VISUAL_LAYOUT_CORE_CONTROLS.length &&
    observationsById.size === M5_VISUAL_LAYOUT_CORE_CONTROLS.length &&
    M5_VISUAL_LAYOUT_CORE_CONTROLS.every(({ id }) => {
      const observation = observationsById.get(id)
      return (
        observation !== undefined &&
        observation.matchCount > 0 &&
        observation.visibleCount === observation.matchCount &&
        observation.nonZeroRectCount === observation.matchCount &&
        observation.reachableCount === observation.matchCount &&
        observation.hitTestCount === observation.matchCount &&
        observation.clippedByAncestorCount === 0
      )
    })
  const verticalScrollProven =
    !narrow ||
    (input.measured.scrollHeight > input.measured.innerHeight + 1 &&
      input.measured.maximumScrollY > 1 &&
      input.measured.observedMaximumScrollY > 0)
  const controlSummary = M5_VISUAL_LAYOUT_CORE_CONTROLS.map(({ id }) => {
    const observation = observationsById.get(id)
    return observation === undefined
      ? `${id}=missing`
      : `${id}=${observation.reachableCount}/${observation.matchCount},visible=${observation.visibleCount},rect=${observation.nonZeroRectCount},hit=${observation.hitTestCount},clipped=${observation.clippedByAncestorCount},disabled=${observation.disabledCount}`
  }).join(';')
  return [
    {
      id: 'viewport-exact',
      passed:
        input.measured.innerWidth === input.viewport.width &&
        input.measured.innerHeight === input.viewport.height,
      actual: `${input.measured.innerWidth}x${input.measured.innerHeight}`,
      expected: `${input.viewport.width}x${input.viewport.height}`,
    },
    {
      id: 'core-area-present',
      passed: input.measured.hasCore,
      actual: input.measured.hasCore,
      expected: true,
    },
    {
      id: 'canvas-not-clipped-by-stage',
      passed: input.measured.stageContainsCanvas,
      actual: input.measured.stageContainsCanvas,
      expected: true,
    },
    {
      id: 'no-horizontal-page-clipping',
      passed: !input.measured.horizontalOverflow,
      actual: input.measured.horizontalOverflow,
      expected: false,
    },
    {
      id: 'core-controls-visible-nonzero-scroll-reachable',
      passed: controlContractPassed && verticalScrollProven,
      actual: `${controlSummary};scroll=${input.measured.observedMaximumScrollY}/${input.measured.maximumScrollY};scrollHeight=${input.measured.scrollHeight}`,
      expected: narrow
        ? 'all-fixed-controls-visible/nonzero/unclipped/reachable;real-vertical-scroll'
        : 'all-fixed-controls-visible/nonzero/unclipped/reachable',
    },
  ]
}

export type M5VisualEvidenceBrowserFixture = Readonly<{
  id: 'stable-chrome'
  channel: 'chrome'
}>

export type M5VisualEvidenceFixture = Readonly<{
  schemaVersion: 1
  protocol: Readonly<{
    productionMode: 'm2'
    headed: true
    host: string
    defaultPort: number
    deterministicSeed: number
    galleryScenarioId: 'visual-normal'
    screenshotMode: M5VisualEvidenceScreenshotMode
    browserLaunchArgs: readonly string[]
    clock: Readonly<{
      pauseLeadMilliseconds: number
      pauseMaximumAttempts: number
      maximumCaptureMilliseconds: number
      resumeReserveMilliseconds: number
      sequenceStepMilliseconds: number
    }>
    timeouts: Readonly<{
      buildMilliseconds: number
      previewReadyMilliseconds: number
      browserOperationMilliseconds: number
      failureTriggerMilliseconds: number
      failurePhaseMilliseconds: number
      cleanupMilliseconds: number
      lateCleanupDrainMilliseconds: number
    }>
  }>
  layout: Readonly<{
    browsers: readonly M5VisualEvidenceBrowserFixture[]
    viewports: readonly Readonly<{ width: number; height: number }>[]
    highDprViewport: M5VisualEvidenceViewport
    narrowViewportMaximumWidth: number
  }>
  fire: Readonly<{
    browserId: M5VisualEvidenceBrowserFixture['id']
    viewport: M5VisualEvidenceViewport
    fireSourceId: string
    sizes: readonly number[]
    directions: readonly Readonly<{
      id: 'center' | 'left' | 'right'
      logicalTarget: Readonly<{ x: number; y: number }>
    }>[]
    phaseTrace: Readonly<{
      size: number
      directionId: 'center' | 'left' | 'right'
    }>
    stableWarmupMilliseconds: number
    maximumSampleLatenessMilliseconds: number
    phases: readonly Readonly<{
      id: 'startup' | 'steady' | 'release'
      sampleOffsetsMilliseconds: readonly number[]
    }>[]
    contactSheet: Readonly<{
      columns: number
      gapPixels: number
      backgroundColor: string
    }>
  }>
  coverage: Readonly<{
    viewport: M5VisualEvidenceViewport
    cases: readonly Readonly<{
      id: string
      automation:
        | 'm2-material-topology'
        | 'm2-material-pair-non-overlap'
        | 'gallery'
        | 'm2-thrust-off'
        | 'm2-thrust-on'
        | 'm2-loss-warning'
      requiredStates: readonly string[]
      fireSourceId?: string
      materialBatchId?: string
      materialDefinitionId?: string
      materialBatchIds?: readonly string[]
      materialDefinitionIds?: readonly string[]
      fireSize?: number
      flameThrust?: false
      logicalTarget?: Readonly<{ x: number; y: number }>
      sourceEdge?: M5MaterialTopologySourceEdge
      epsilon?: number
      settleMilliseconds?: number
      pollIntervalMilliseconds?: number
      maximumWaitMilliseconds?: number
      stopCondition?:
        | Readonly<{
            mode: 'topology-classification'
            classification: Extract<
              M5MaterialTopologyClassification,
              'deep-narrow' | 'shallow-wide'
            >
            minimumDissolvedVolumeRatio: number
            maximumDissolvedVolumeRatio: number
            minimumRemainingRatio: number
          }>
        | Readonly<{ mode: 'through-connected' }>
      shapeThresholds?: M5MaterialTopologyShapeThresholds
      partialFront?: M5MaterialTopologyPartialFrontConfig
      expectedTopology?: Readonly<{
        classification: Extract<
          M5MaterialTopologyClassification,
          'deep-narrow' | 'shallow-wide' | 'through-not-empty'
        >
        minimumDissolvedVolumeRatio: number
        maximumDissolvedVolumeRatio: number
        minimumRemainingRatio: number
        maximumCollectorCenterOffset: number
        minimumPenetrationRatio: number
        maximumPenetrationRatio: number
        minimumLateralCoverageRatio: number
        maximumLateralCoverageRatio: number
        throughConnected: boolean
      }>
      warningLevel?: 1 | 2
      expectedEffect?: 'warningOne' | 'warningTwo'
      expectedMessageZh?: string
    }>[]
    materialAlignment: M5VisualCollectorAlignmentConfig
    warningFlow: Readonly<{
      fireSourceId: string
      fireSize: 100
      materialBatchId: string
      materialDefinitionId: string
      flameThrust: false
      logicalTarget: Readonly<{ x: number; y: number }>
      collectorMoveKey: string
      collectorMoveMilliseconds: number
      collectorSettleMilliseconds: number
      stopSprayingAtWarningLevel: 2
      maximumStoppedCaptureTickDrift: 4
      maximumWaitMilliseconds: number
    }>
  }>
  accessibility: Readonly<{
    browserId: M5VisualEvidenceBrowserFixture['id']
    viewport: M5VisualEvidenceViewport
    galleryRequiredStates: readonly string[]
    captureStates: readonly ('gallery' | 'warning-one' | 'warning-two')[]
    modes: readonly Readonly<{
      id: 'grayscale' | 'protanopia' | 'deuteranopia' | 'reduced-motion'
      visionMode: M5VisualEvidenceVisionMode
      reducedMotion: boolean
      colorMatrix: readonly number[]
    }>[]
  }>
  failure: Readonly<{
    browserId: M5VisualEvidenceBrowserFixture['id']
    viewport: M5VisualEvidenceViewport
    fireSourceId: string
    fireSize: number
    materialBatchId: string
    materialDefinitionId: string
    interceptedTargetPearlCount: number
    collectorMoveKey: string
    collectorMoveMilliseconds: number
    collectorSettleMilliseconds: number
    screenshotMode: 'viewport'
    phases: readonly ('trigger' | 'charring' | 'shattering' | 'gathering' | 'flying' | 'result')[]
    motionModes: readonly Readonly<{
      id: 'normal' | 'reduced'
      reducedMotion: boolean
    }>[]
  }>
}>

export type M5VisualEvidenceExpectedCell = Readonly<{
  id: string
  section: M5VisualEvidenceSection
  kind: 'raw-frame' | 'contact-sheet' | 'coverage-frame'
  expectedStatus: 'capture' | 'manual-blocked'
  manualReasonZh?: string
  sourceCaseIds?: readonly string[]
}>

export type M5VisualEvidenceCheck = Readonly<{
  id: string
  passed: boolean
  actual: string | number | boolean
  expected?: string | number | boolean
}>

export type M5VisualWarningTransitionLatch = Readonly<{
  sessionId: string
  tick: number
  eventObserved: true
  eventType: 'LossWarningChanged'
  level: 1 | 2
  effectKind: 'warningOne' | 'warningTwo'
}>

export type M5VisualWarningBoundaryObservation = Readonly<{
  sessionId: string
  tick: number
  domainStatus: string
  failurePresentationState: string
  actualLevel: number
  domLevel: string
  domText: string
  domVisible: boolean
  activeEffectKinds: readonly string[]
}>

export function createM5VisualWarningBoundaryChecks(input: Readonly<{
  boundary: 'before' | 'after'
  expectedLevel: 1 | 2
  expectedMessageZh: string
  expectedEffect: 'warningOne' | 'warningTwo'
  latchedWarning: M5VisualWarningTransitionLatch
  maximumCaptureTickDrift?: number
  current: M5VisualWarningBoundaryObservation
}>): readonly M5VisualEvidenceCheck[] {
  const { boundary, current, latchedWarning } = input
  return [
    {
      id: `warning-transition-latched-${boundary}`,
      passed:
        latchedWarning.eventObserved &&
        latchedWarning.eventType === 'LossWarningChanged' &&
        latchedWarning.level === input.expectedLevel &&
        latchedWarning.effectKind === input.expectedEffect,
      actual: `${latchedWarning.eventObserved}/${latchedWarning.eventType}/${latchedWarning.level}/${latchedWarning.effectKind}`,
      expected: `true/LossWarningChanged/${input.expectedLevel}/${input.expectedEffect}`,
    },
    {
      id: `warning-session-stable-${boundary}`,
      passed: latchedWarning.sessionId === current.sessionId,
      actual: `${latchedWarning.sessionId}/${current.sessionId}`,
      expected: 'same-session',
    },
    {
      id: `warning-latched-tick-not-after-boundary-${boundary}`,
      passed: latchedWarning.tick <= current.tick,
      actual: `${latchedWarning.tick}/${current.tick}`,
      expected: 'latched-tick<=current-tick',
    },
    ...(input.maximumCaptureTickDrift === undefined
      ? []
      : [
          {
            id: `warning-latched-tick-drift-bounded-${boundary}`,
            passed:
              current.tick - latchedWarning.tick >= 0 &&
              current.tick - latchedWarning.tick <=
                input.maximumCaptureTickDrift,
            actual: current.tick - latchedWarning.tick,
            expected: `<=${input.maximumCaptureTickDrift}`,
          },
        ]),
    {
      id: `warning-domain-extracting-${boundary}`,
      passed: current.domainStatus === 'extracting',
      actual: current.domainStatus,
      expected: 'extracting',
    },
    {
      id: `warning-failure-presentation-idle-${boundary}`,
      passed: current.failurePresentationState === 'idle',
      actual: current.failurePresentationState,
      expected: 'idle',
    },
    {
      id: `warning-authoritative-level-${boundary}`,
      passed: current.actualLevel === input.expectedLevel,
      actual: current.actualLevel,
      expected: input.expectedLevel,
    },
    {
      id: `warning-dom-current-chinese-${boundary}`,
      passed:
        current.domVisible &&
        current.domLevel === String(input.expectedLevel) &&
        current.domText.includes(input.expectedMessageZh),
      actual: `${current.domVisible}/${current.domLevel}/${current.domText}`,
      expected: `true/${input.expectedLevel}/${input.expectedMessageZh}`,
    },
    {
      id: `warning-presentation-effect-${boundary}`,
      passed: current.activeEffectKinds.includes(input.expectedEffect),
      actual: current.activeEffectKinds.join(','),
      expected: input.expectedEffect,
    },
  ]
}

export type M5VisualMaterialTopologyBoundaryIdentity = Readonly<{
  sessionId: string
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: Readonly<{
    center: Readonly<{ x: number; y: number }>
    width: number
    height: number
    rotationRadians: number
    layer: number
  }>
  gridWidth: number
  gridHeight: number
  initialGridSha256: string
  remainingGridSha256: string
}>

export function createM5VisualMaterialTopologyBoundaryChecks(input: Readonly<{
  before: M5VisualMaterialTopologyBoundaryIdentity
  after: M5VisualMaterialTopologyBoundaryIdentity
}>): readonly M5VisualEvidenceCheck[] {
  const { before, after } = input
  return [
    {
      id: 'material-session-stable-across-screenshot',
      passed: before.sessionId === after.sessionId,
      actual: `${before.sessionId}/${after.sessionId}`,
      expected: 'same-session',
    },
    {
      id: 'material-instance-stable-across-screenshot',
      passed: before.materialInstanceId === after.materialInstanceId,
      actual: `${before.materialInstanceId}/${after.materialInstanceId}`,
      expected: 'same-material-instance',
    },
    {
      id: 'material-identity-stable-across-screenshot',
      passed:
        before.materialDefinitionId === after.materialDefinitionId &&
        before.inventoryBatchId === after.inventoryBatchId,
      actual: `${before.materialDefinitionId}/${before.inventoryBatchId}|${after.materialDefinitionId}/${after.inventoryBatchId}`,
      expected: 'same-material-definition-and-inventory-batch',
    },
    {
      id: 'material-placement-stable-across-screenshot',
      passed: JSON.stringify(before.placement) === JSON.stringify(after.placement),
      actual: `${JSON.stringify(before.placement)}|${JSON.stringify(after.placement)}`,
      expected: 'same-authoritative-placement',
    },
    {
      id: 'material-grid-dimensions-stable-across-screenshot',
      passed:
        before.gridWidth === after.gridWidth &&
        before.gridHeight === after.gridHeight,
      actual: `${before.gridWidth}x${before.gridHeight}/${after.gridWidth}x${after.gridHeight}`,
      expected: 'same-grid-dimensions',
    },
    {
      id: 'material-initial-grid-stable-across-screenshot',
      passed: before.initialGridSha256 === after.initialGridSha256,
      actual: `${before.initialGridSha256}/${after.initialGridSha256}`,
      expected: 'same-authoritative-initial-grid',
    },
    {
      id: 'material-remaining-grid-stable-across-screenshot',
      passed: before.remainingGridSha256 === after.remainingGridSha256,
      actual: `${before.remainingGridSha256}/${after.remainingGridSha256}`,
      expected: 'same-authoritative-remaining-grid',
    },
  ]
}

export type M5VisualMaterialPairPlacement = Readonly<{
  center: Readonly<{ x: number; y: number }>
  width: number
  height: number
  rotationRadians: number
  layer: number
}>

export type M5VisualMaterialPairBoundaryMaterial = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: M5VisualMaterialPairPlacement
  contentPlacement: M5VisualMaterialPairPlacement
  initialVolume: number
  remainingVolume: number
  initialGridSha256: string
  remainingGridSha256: string
  initialNonEmptyCellCount: number
  remainingNonEmptyCellCount: number
}>

export type M5VisualMaterialPairBoundaryObservation = Readonly<{
  sessionId: string
  tick: number
  equippedFireSourceId: string | null
  isSpraying: boolean
  firePresentationState: string
  fireVisualIntensity: number
  activePearlCount: number
  audioMuted: boolean
  materials: readonly M5VisualMaterialPairBoundaryMaterial[]
}>

function validM5VisualMaterialPairPlacement(
  placement: M5VisualMaterialPairPlacement,
): boolean {
  return (
    finitePoint(placement.center) &&
    Number.isFinite(placement.width) &&
    placement.width > 0 &&
    Number.isFinite(placement.height) &&
    placement.height > 0 &&
    Number.isFinite(placement.rotationRadians) &&
    Number.isFinite(placement.layer)
  )
}

/**
 * Evidence-only OBB SAT. This deliberately does not import the runtime
 * placement helper so the formal evidence has an independent geometry oracle.
 * Boundary contact is accepted; only positive-area interior intersection fails.
 */
export function m5VisualMaterialPlacementsHaveInteriorIntersection(
  left: M5VisualMaterialPairPlacement,
  right: M5VisualMaterialPairPlacement,
  epsilon: number,
): boolean {
  if (
    !validM5VisualMaterialPairPlacement(left) ||
    !validM5VisualMaterialPairPlacement(right) ||
    !Number.isFinite(epsilon) ||
    epsilon < 0
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MATERIAL_PAIR_SAT_INPUT_INVALID')
  }
  const axesFor = (placement: M5VisualMaterialPairPlacement) => {
    const cosine = Math.cos(placement.rotationRadians)
    const sine = Math.sin(placement.rotationRadians)
    return Object.freeze([
      Object.freeze({ x: cosine, y: sine }),
      Object.freeze({ x: -sine, y: cosine }),
    ])
  }
  const leftAxes = axesFor(left)
  const rightAxes = axesFor(right)
  const centerDelta = {
    x: right.center.x - left.center.x,
    y: right.center.y - left.center.y,
  }
  const projectionRadius = (
    placement: M5VisualMaterialPairPlacement,
    axes: ReturnType<typeof axesFor>,
    axis: Readonly<{ x: number; y: number }>,
  ): number =>
    (placement.width / 2) *
      Math.abs(axes[0].x * axis.x + axes[0].y * axis.y) +
    (placement.height / 2) *
      Math.abs(axes[1].x * axis.x + axes[1].y * axis.y)

  for (const axis of [...leftAxes, ...rightAxes]) {
    const centerDistance = Math.abs(
      centerDelta.x * axis.x + centerDelta.y * axis.y,
    )
    const radiusSum =
      projectionRadius(left, leftAxes, axis) +
      projectionRadius(right, rightAxes, axis)
    if (centerDistance >= radiusSum - epsilon) return false
  }
  return true
}

function materialPairBoundaryIdentity(
  materials: readonly M5VisualMaterialPairBoundaryMaterial[],
): string {
  return JSON.stringify(
    materials.map((material) => ({
      materialInstanceId: material.materialInstanceId,
      materialDefinitionId: material.materialDefinitionId,
      inventoryBatchId: material.inventoryBatchId,
    })),
  )
}

function materialPairBoundaryTopology(
  materials: readonly M5VisualMaterialPairBoundaryMaterial[],
): string {
  return JSON.stringify(
    materials.map((material) => ({
      initialVolume: material.initialVolume,
      remainingVolume: material.remainingVolume,
      initialGridSha256: material.initialGridSha256,
      remainingGridSha256: material.remainingGridSha256,
      initialNonEmptyCellCount: material.initialNonEmptyCellCount,
      remainingNonEmptyCellCount: material.remainingNonEmptyCellCount,
    })),
  )
}

export function createM5VisualMaterialPairBoundaryChecks(input: Readonly<{
  expectedMaterials: readonly Readonly<{
    materialDefinitionId: string
    inventoryBatchId: string
  }>[]
  epsilon: number
  before: M5VisualMaterialPairBoundaryObservation
  after: M5VisualMaterialPairBoundaryObservation
}>): readonly M5VisualEvidenceCheck[] {
  const checks: M5VisualEvidenceCheck[] = []
  const expectedIdentity = input.expectedMaterials.map(
    ({ materialDefinitionId, inventoryBatchId }) =>
      [materialDefinitionId, inventoryBatchId] as const,
  )
  const expectedIdentityText = JSON.stringify(expectedIdentity)
  for (const [boundary, observation] of [
    ['before', input.before],
    ['after', input.after],
  ] as const) {
    const actualExpectedIdentity = observation.materials.map(
      ({ materialDefinitionId, inventoryBatchId }) =>
        [materialDefinitionId, inventoryBatchId] as const,
    )
    const actualExpectedIdentityText = JSON.stringify(actualExpectedIdentity)
    const authorityMatches =
      actualExpectedIdentity.length === expectedIdentity.length &&
      actualExpectedIdentity.every(
        ([materialDefinitionId, inventoryBatchId], index) =>
          materialDefinitionId === expectedIdentity[index]?.[0] &&
          inventoryBatchId === expectedIdentity[index]?.[1],
      )
    const instanceIds = observation.materials.map(
      ({ materialInstanceId }) => materialInstanceId,
    )
    const definitionIds = observation.materials.map(
      ({ materialDefinitionId }) => materialDefinitionId,
    )
    const batchIds = observation.materials.map(
      ({ inventoryBatchId }) => inventoryBatchId,
    )
    const placementsValid = observation.materials.every(
      ({ placement, contentPlacement }) =>
        validM5VisualMaterialPairPlacement(placement) &&
        validM5VisualMaterialPairPlacement(contentPlacement),
    )
    let noInteriorOverlap = false
    if (observation.materials.length === 2 && placementsValid) {
      noInteriorOverlap =
        !m5VisualMaterialPlacementsHaveInteriorIntersection(
          observation.materials[0]!.contentPlacement,
          observation.materials[1]!.contentPlacement,
          input.epsilon,
        )
    }
    const fireInactive =
      observation.equippedFireSourceId === null &&
      observation.isSpraying === false &&
      observation.firePresentationState === 'off' &&
      Number.isFinite(observation.fireVisualIntensity) &&
      observation.fireVisualIntensity === 0 &&
      Number.isSafeInteger(observation.activePearlCount) &&
      observation.activePearlCount === 0
    const volumesUnchanged = observation.materials.every(
      ({ initialVolume, remainingVolume }) =>
        Number.isFinite(initialVolume) &&
        initialVolume > 0 &&
        Number.isFinite(remainingVolume) &&
        remainingVolume > 0 &&
        remainingVolume <= initialVolume,
    )
    const gridsUnchanged = observation.materials.every(
      ({
        initialGridSha256,
        remainingGridSha256,
        initialNonEmptyCellCount,
        remainingNonEmptyCellCount,
      }) =>
        /^[0-9a-f]{64}$/.test(initialGridSha256) &&
        /^[0-9a-f]{64}$/.test(remainingGridSha256) &&
        Number.isSafeInteger(initialNonEmptyCellCount) &&
        initialNonEmptyCellCount > 0 &&
        Number.isSafeInteger(remainingNonEmptyCellCount) &&
        initialNonEmptyCellCount === remainingNonEmptyCellCount,
    )
    checks.push(
      {
        id: `material-pair-count-${boundary}`,
        passed: observation.materials.length === 2,
        actual: observation.materials.length,
        expected: 2,
      },
      {
        id: `material-pair-authority-${boundary}`,
        passed: authorityMatches,
        actual: actualExpectedIdentityText,
        expected: expectedIdentityText,
      },
      {
        id: `material-pair-distinct-identity-${boundary}`,
        passed:
          instanceIds.every((id) => id.length > 0) &&
          new Set(instanceIds).size === 2 &&
          new Set(definitionIds).size === 2 &&
          new Set(batchIds).size === 2,
        actual: `${instanceIds.join(',')}|${definitionIds.join(',')}|${batchIds.join(',')}`,
        expected: '2-distinct-instance/definition/batch-identities',
      },
      {
        id: `material-pair-placement-valid-${boundary}`,
        passed: placementsValid,
        actual: JSON.stringify(
          observation.materials.map(({ placement, contentPlacement }) => ({
            placement,
            contentPlacement,
          })),
        ),
        expected:
          'finite full/content center/rotation/layer-and-positive-size',
      },
      {
        id: `material-pair-no-interior-overlap-${boundary}`,
        passed: noInteriorOverlap,
        actual: noInteriorOverlap,
        expected: true,
      },
      {
        id: `material-pair-not-equipped-or-spraying-${boundary}`,
        passed:
          observation.equippedFireSourceId === null &&
          observation.isSpraying === false,
        actual: `${String(observation.equippedFireSourceId)}/${observation.isSpraying}`,
        expected: 'null/false',
      },
      {
        id: `material-pair-fire-inactive-${boundary}`,
        passed: fireInactive,
        actual: `${String(observation.equippedFireSourceId)}/${observation.isSpraying}/${observation.firePresentationState}/${observation.fireVisualIntensity}/${observation.activePearlCount}`,
        expected: 'null/false/off/0/0',
      },
      {
        id: `material-pair-app-muted-${boundary}`,
        passed: observation.audioMuted,
        actual: observation.audioMuted,
        expected: true,
      },
      {
        id: `material-pair-volume-uneroded-${boundary}`,
        passed: volumesUnchanged,
        actual: observation.materials
          .map(({ initialVolume, remainingVolume }) =>
            `${initialVolume}/${remainingVolume}`,
          )
          .join('|'),
        expected: 'finite 0<remaining<=initial for both materials',
      },
      {
        id: `material-pair-grid-uneroded-${boundary}`,
        passed: gridsUnchanged,
        actual: materialPairBoundaryTopology(observation.materials),
        expected:
          'valid initial/remaining grid hashes and unchanged non-empty cell count',
      },
    )
  }
  checks.push(
    {
      id: 'material-pair-session-tick-stable-across-screenshot',
      passed:
        input.before.sessionId === input.after.sessionId &&
        input.before.tick === input.after.tick,
      actual: `${input.before.sessionId}/${input.before.tick}|${input.after.sessionId}/${input.after.tick}`,
      expected: 'same-session-and-tick',
    },
    {
      id: 'material-pair-identity-stable-across-screenshot',
      passed:
        materialPairBoundaryIdentity(input.before.materials) ===
        materialPairBoundaryIdentity(input.after.materials),
      actual: `${materialPairBoundaryIdentity(input.before.materials)}|${materialPairBoundaryIdentity(input.after.materials)}`,
      expected: 'same-material-identities',
    },
    {
      id: 'material-pair-placement-stable-across-screenshot',
      passed:
        JSON.stringify(
          input.before.materials.map(({ placement, contentPlacement }) => ({
            placement,
            contentPlacement,
          })),
        ) ===
        JSON.stringify(
          input.after.materials.map(({ placement, contentPlacement }) => ({
            placement,
            contentPlacement,
          })),
        ),
      actual: `${JSON.stringify(input.before.materials.map(({ placement, contentPlacement }) => ({ placement, contentPlacement })))}|${JSON.stringify(input.after.materials.map(({ placement, contentPlacement }) => ({ placement, contentPlacement })))}`,
      expected: 'same-authoritative-full-and-content-placements',
    },
    {
      id: 'material-pair-topology-stable-across-screenshot',
      passed:
        materialPairBoundaryTopology(input.before.materials) ===
        materialPairBoundaryTopology(input.after.materials),
      actual: `${materialPairBoundaryTopology(input.before.materials)}|${materialPairBoundaryTopology(input.after.materials)}`,
      expected: 'same-authoritative-topology-hashes-and-volumes',
    },
  )
  return checks
}

export type M5VisualEvidenceCaptureContext = Readonly<{
  domainEvents: readonly string[]
  presentationState: string
  build: Readonly<{ runId: string; distSha256: string }>
  fingerprints: Readonly<{ simulation: string; presentation: string }>
  viewport: M5VisualEvidenceViewport
  browser: Readonly<{
    id: string
    engine: 'chromium'
    channel: string
    version: string
  }>
  environment: M5VisualEvidenceBrowserEnvironment
  screenshotMode: M5VisualEvidenceScreenshotMode
  os: Readonly<{ platform: string; release: string; arch: string }>
  reducedMotion: boolean
  visionMode: M5VisualEvidenceVisionMode
  colorMatrix: readonly number[]
  seed: number
  sessionId: string
  tick: number
  consoleErrors: readonly string[]
  pageErrors: readonly string[]
  requestErrors: readonly string[]
  checks: readonly M5VisualEvidenceCheck[]
  configuredSampleOffsetMilliseconds?: number
  actualSampleOffsetMilliseconds?: number
  screenshotStartedOffsetMilliseconds?: number
  screenshotFinishedOffsetMilliseconds?: number
  observableState?: Readonly<Record<string, unknown>>
}>

export type M5VisualEvidenceBrowserEnvironment = Readonly<{
  innerWidth: number
  innerHeight: number
  documentClientWidth: number
  documentClientHeight: number
  documentScrollWidth: number
  documentScrollHeight: number
  devicePixelRatio: number
  prefersReducedMotion: boolean
  computedFilter: string
  visionModeDataset: string
  colorMatrixDataset: string
  audioMutedByBrowser: boolean
}>

export type M5VisualEvidenceScreenshotMode = 'full-page' | 'viewport'

export type M5VisualEvidenceCaptureRecord = Readonly<{
  caseId: string
  section: M5VisualEvidenceSection
  kind: M5VisualEvidenceExpectedCell['kind']
  status: 'captured'
  capturedAt: string
  artifact: Readonly<{
    relativePath: string
    width: number
    height: number
    sha256: string
  }>
  sourceCaseIds?: readonly string[]
  context: M5VisualEvidenceCaptureContext
}>

export type M5VisualEvidenceSerializedError = Readonly<{
  stage: string
  name: string
  message: string
  stack?: string
  cause?: M5VisualEvidenceSerializedError
  errors?: readonly M5VisualEvidenceSerializedError[]
}>

function serializeM5VisualEvidenceErrorRecursive(
  error: unknown,
  stage: string,
  ancestors: ReadonlySet<unknown>,
): M5VisualEvidenceSerializedError {
  if (!(error instanceof Error)) {
    return { stage, name: 'Error', message: String(error) }
  }
  if (ancestors.has(error)) {
    return { stage, name: error.name, message: '[circular error]' }
  }
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(error)
  const aggregateErrors =
    error instanceof AggregateError ? Array.from(error.errors) : []
  return {
    stage,
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.cause === undefined
      ? {}
      : {
          cause: serializeM5VisualEvidenceErrorRecursive(
            error.cause,
            `${stage}:cause`,
            nextAncestors,
          ),
        }),
    ...(aggregateErrors.length === 0
      ? {}
      : {
          errors: aggregateErrors.map((nested, index) =>
            serializeM5VisualEvidenceErrorRecursive(
              nested,
              `${stage}:errors[${index}]`,
              nextAncestors,
            ),
          ),
        }),
  }
}

export function serializeM5VisualEvidenceError(
  error: unknown,
  stage = 'runtime',
): M5VisualEvidenceSerializedError {
  return serializeM5VisualEvidenceErrorRecursive(error, stage, new Set())
}

export type M5VisualEvidenceUnavailableRecord = Readonly<{
  caseId: string
  section: M5VisualEvidenceSection
  kind: M5VisualEvidenceExpectedCell['kind']
  status: 'manual-blocked' | 'failed'
  reasonZh: string
  error?: M5VisualEvidenceSerializedError
}>

export const M5_VISUAL_EVIDENCE_INITIAL_FAILURE_REASON_ZH = '采集尚未执行。'

export function isM5VisualEvidenceInitialFailurePlaceholder(
  record: M5VisualEvidenceRecord | undefined,
): boolean {
  return (
    record?.status === 'failed' &&
    record.reasonZh === M5_VISUAL_EVIDENCE_INITIAL_FAILURE_REASON_ZH &&
    record.error === undefined
  )
}

export function createM5VisualEvidenceFailedRecord(input: Readonly<{
  caseId: string
  section: M5VisualEvidenceSection
  kind: M5VisualEvidenceExpectedCell['kind']
  error: unknown
}>): M5VisualEvidenceUnavailableRecord & Readonly<{ status: 'failed' }> {
  const error = serializeM5VisualEvidenceError(input.error)
  return {
    caseId: input.caseId,
    section: input.section,
    kind: input.kind,
    status: 'failed',
    reasonZh: error.message,
    error,
  }
}

export type M5VisualEvidenceRecord =
  | M5VisualEvidenceCaptureRecord
  | M5VisualEvidenceUnavailableRecord

export type M5VisualManualReview = Readonly<{
  status: 'pending'
  independentReviewer: null
  user: null
  reviewedAt: null
  notesZh: ''
}>

const REQUIRED_LAYOUT_VIEWPORTS = Object.freeze([
  '2560x1440',
  '1920x1080',
  '1366x768',
  '1280x720',
  '950x700',
  '900x700',
])
const REQUIRED_FIRE_SIZES = Object.freeze([20, 60, 100])
const REQUIRED_FIRE_DIRECTIONS = Object.freeze(['center', 'left', 'right'])
const REQUIRED_FIRE_PHASES = Object.freeze(['startup', 'steady', 'release'])
const REQUIRED_FIRE_PHASE_SAMPLE_COUNTS = Object.freeze({
  startup: 4,
  steady: 3,
  release: 5,
})
const REQUIRED_ACCESSIBILITY_MODES = Object.freeze([
  'grayscale',
  'protanopia',
  'deuteranopia',
  'reduced-motion',
])
const REQUIRED_FAILURE_PHASES = Object.freeze([
  'trigger',
  'charring',
  'shattering',
  'gathering',
  'flying',
  'result',
])
const REQUIRED_COVERAGE_CASES = Object.freeze([
  'material-center-hole',
  'material-wide-strip',
  'material-burn-through',
  'pearl-effects-gallery',
  'max-fire-light-thrust-off',
  'max-fire-light-thrust-on',
  'loss-warning-one',
  'loss-warning-two',
  'material-pair-non-overlap',
])
const REQUIRED_COVERAGE_AUTOMATION = Object.freeze({
  'material-center-hole': 'm2-material-topology',
  'material-wide-strip': 'm2-material-topology',
  'material-burn-through': 'm2-material-topology',
  'pearl-effects-gallery': 'gallery',
  'max-fire-light-thrust-off': 'm2-thrust-off',
  'max-fire-light-thrust-on': 'm2-thrust-on',
  'loss-warning-one': 'm2-loss-warning',
  'loss-warning-two': 'm2-loss-warning',
  'material-pair-non-overlap': 'm2-material-pair-non-overlap',
} as const)
const REQUIRED_COVERAGE_STATES = Object.freeze({
  'material-center-hole': Object.freeze(['material-mask-center-hole']),
  'material-wide-strip': Object.freeze(['material-mask-wide-strip']),
  'material-burn-through': Object.freeze(['material-mask-burn-through']),
  'pearl-effects-gallery': Object.freeze([
    'fire',
    'medicinalLiquid',
    'slag',
    'impurity',
    'shield',
    'damage',
    'steam',
    'fight',
    'localLight',
  ]),
  'max-fire-light-thrust-off': Object.freeze([
    'maximum-fire',
    'localLight',
    'thrust-off',
  ]),
  'max-fire-light-thrust-on': Object.freeze([
    'maximum-fire',
    'localLight',
    'thrust-on',
  ]),
  'loss-warning-one': Object.freeze(['warningOne']),
  'loss-warning-two': Object.freeze(['warningTwo']),
  'material-pair-non-overlap': Object.freeze([
    'material-pair-non-overlap',
  ]),
} as const)
const REQUIRED_WARNING_FORMAL_CONTRACT = Object.freeze({
  'loss-warning-one': Object.freeze({
    warningLevel: 1,
    expectedEffect: 'warningOne',
    expectedMessageZh: '药气正在加速流失。',
  }),
  'loss-warning-two': Object.freeze({
    warningLevel: 2,
    expectedEffect: 'warningTwo',
    expectedMessageZh: '药性濒临溃散，尽快收束火势。',
  }),
} as const)
const REQUIRED_MATERIAL_SHAPE_THRESHOLDS = Object.freeze({
  deepPenetrationMinimum: 0.35,
  narrowLateralCoverageMaximum: 0.45,
  shallowPenetrationMaximum: 0.28,
  wideLateralCoverageMinimum: 0.45,
  targetLateralRatio: 0.5,
  targetCorridorHalfWidthRatio: 0.25,
  maximumCenterOffsetRatio: 0.2,
  minimumThroughDepthSpanRatio: 0.5,
})
const REQUIRED_MATERIAL_PARTIAL_FRONT = Object.freeze({
  lateralBinCount: 20,
  minimumCellErosionRatio: 0.1,
  minimumActiveLaneErosionRatio: 0.2,
  lateralCoverageQuantile: 0.8,
  minimumMeaningfulComponentCellCount: 4,
})
const REQUIRED_MATERIAL_COMMON_FORMAL_CONTRACT = Object.freeze({
  fireSourceId: 'basic-fire',
  materialBatchId: 'red_whisker_ginseng_fresh_wild_10',
  materialDefinitionId: 'red_whisker_ginseng',
  flameThrust: false,
  logicalTarget: Object.freeze({ x: 711, y: 525 }),
  sourceEdge: 'bottom',
  epsilon: 0.000001,
  pollIntervalMilliseconds: 100,
  maximumWaitMilliseconds: 60_000,
  shapeThresholds: REQUIRED_MATERIAL_SHAPE_THRESHOLDS,
  partialFront: REQUIRED_MATERIAL_PARTIAL_FRONT,
})
const REQUIRED_MATERIAL_FORMAL_CONTRACT = Object.freeze({
  'material-center-hole': Object.freeze({
    ...REQUIRED_MATERIAL_COMMON_FORMAL_CONTRACT,
    fireSize: 20,
    stopCondition: Object.freeze({
      mode: 'topology-classification',
      classification: 'deep-narrow',
      minimumDissolvedVolumeRatio: 0.12,
      maximumDissolvedVolumeRatio: 0.15,
      minimumRemainingRatio: 0.8,
    }),
    expectedTopology: Object.freeze({
      classification: 'deep-narrow',
      minimumDissolvedVolumeRatio: 0.12,
      maximumDissolvedVolumeRatio: 0.15,
      minimumRemainingRatio: 0.8,
      maximumCollectorCenterOffset: 1,
      minimumPenetrationRatio: 0.35,
      maximumPenetrationRatio: 1,
      minimumLateralCoverageRatio: 0,
      maximumLateralCoverageRatio: 0.45,
      throughConnected: false,
    }),
  }),
  'material-wide-strip': Object.freeze({
    ...REQUIRED_MATERIAL_COMMON_FORMAL_CONTRACT,
    fireSize: 100,
    stopCondition: Object.freeze({
      mode: 'topology-classification',
      classification: 'shallow-wide',
      minimumDissolvedVolumeRatio: 0.12,
      maximumDissolvedVolumeRatio: 0.15,
      minimumRemainingRatio: 0.8,
    }),
    expectedTopology: Object.freeze({
      classification: 'shallow-wide',
      minimumDissolvedVolumeRatio: 0.12,
      maximumDissolvedVolumeRatio: 0.15,
      minimumRemainingRatio: 0.8,
      maximumCollectorCenterOffset: 1,
      minimumPenetrationRatio: 0,
      maximumPenetrationRatio: 0.28,
      minimumLateralCoverageRatio: 0.45,
      maximumLateralCoverageRatio: 1,
      throughConnected: false,
    }),
  }),
  'material-burn-through': Object.freeze({
    ...REQUIRED_MATERIAL_COMMON_FORMAL_CONTRACT,
    fireSize: 20,
    stopCondition: Object.freeze({ mode: 'through-connected' }),
    expectedTopology: Object.freeze({
      classification: 'through-not-empty',
      minimumDissolvedVolumeRatio: 0,
      maximumDissolvedVolumeRatio: 0.95,
      minimumRemainingRatio: 0.05,
      maximumCollectorCenterOffset: 1,
      minimumPenetrationRatio: 1,
      maximumPenetrationRatio: 1,
      minimumLateralCoverageRatio: 0,
      maximumLateralCoverageRatio: 1,
      throughConnected: true,
    }),
  }),
} as const)
const REQUIRED_MATERIAL_PAIR_FORMAL_CONTRACT = Object.freeze({
  id: 'material-pair-non-overlap',
  automation: 'm2-material-pair-non-overlap',
  materialBatchIds: Object.freeze([
    'red_whisker_ginseng_fresh_wild_10',
    'azure_dew_leaf_fresh_cultivated_3',
  ]),
  materialDefinitionIds: Object.freeze([
    'red_whisker_ginseng',
    'azure_dew_leaf',
  ]),
  epsilon: 0.000001,
  settleMilliseconds: 100,
  requiredStates: Object.freeze(['material-pair-non-overlap']),
} as const)
const REQUIRED_MATERIAL_ALIGNMENT_FORMAL_CONTRACT = Object.freeze({
  leftKey: 'a',
  rightKey: 'd',
  maximumCenterOffset: 1,
  deadlineMilliseconds: 10_000,
  pollIntervalMilliseconds: 20,
  maximumCorrectionHoldMilliseconds: 500,
  settlePaddingMilliseconds: 100,
  feedbackActivationDirectionChanges: 2,
  feedbackPulseTicks: 1,
  feedbackVelocityTolerance: 0,
})
const REQUIRED_ACCESSIBILITY_STATES = Object.freeze([
  'fire',
  'medicinalLiquid',
  'slag',
  'impurity',
  'shield',
  'damage',
  'steam',
])
const REQUIRED_ACCESSIBILITY_CAPTURE_STATES = Object.freeze([
  'gallery',
  'warning-one',
  'warning-two',
])
const REQUIRED_ACCESSIBILITY_MATRICES = Object.freeze({
  grayscale: Object.freeze([
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0, 0, 0, 1, 0,
  ]),
  protanopia: Object.freeze([
    0.56667, 0.43333, 0, 0, 0,
    0.55833, 0.44167, 0, 0, 0,
    0, 0.24167, 0.75833, 0, 0,
    0, 0, 0, 1, 0,
  ]),
  deuteranopia: Object.freeze([
    0.625, 0.375, 0, 0, 0,
    0.7, 0.3, 0, 0, 0,
    0, 0.3, 0.7, 0, 0,
    0, 0, 0, 1, 0,
  ]),
  'reduced-motion': M5_VISUAL_IDENTITY_COLOR_MATRIX,
} as const)
const REQUIRED_ACCESSIBILITY_MODE_SETTINGS = Object.freeze({
  grayscale: Object.freeze({ visionMode: 'grayscale', reducedMotion: false }),
  protanopia: Object.freeze({ visionMode: 'protanopia', reducedMotion: false }),
  deuteranopia: Object.freeze({
    visionMode: 'deuteranopia',
    reducedMotion: false,
  }),
  'reduced-motion': Object.freeze({ visionMode: 'normal', reducedMotion: true }),
} as const)

function duplicates(values: readonly (string | number)[]): (string | number)[] {
  const seen = new Set<string | number>()
  const repeated = new Set<string | number>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated]
}

function sameMembers(
  actual: readonly (string | number)[],
  expected: readonly (string | number)[],
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  )
}

function appendFormalContractIssues(
  actual: unknown,
  expected: unknown,
  issuePrefix: string,
  issues: string[],
  path = '',
): void {
  if (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected)
  ) {
    const actualRecord =
      actual !== null && typeof actual === 'object'
        ? (actual as Readonly<Record<string, unknown>>)
        : undefined
    for (const [key, expectedValue] of Object.entries(expected)) {
      appendFormalContractIssues(
        actualRecord?.[key],
        expectedValue,
        issuePrefix,
        issues,
        path.length === 0 ? key : `${path}.${key}`,
      )
    }
    return
  }
  if (!Object.is(actual, expected)) {
    issues.push(`${issuePrefix}:${path}`)
  }
}

export function validateM5VisualEvidenceFixtureSemantics(
  fixture: M5VisualEvidenceFixture,
): readonly string[] {
  const issues: string[] = []
  const browsers = fixture.layout.browsers
  if (
    browsers.length !== 1 ||
    browsers[0]?.id !== 'stable-chrome' ||
    browsers[0]?.channel !== 'chrome'
  ) {
    issues.push('LAYOUT_BROWSER_MUST_BE_STABLE_CHROME')
  }
  if (duplicates(browsers.map(({ id }) => id)).length > 0) {
    issues.push('LAYOUT_BROWSER_ID_DUPLICATED')
  }
  const viewports = fixture.layout.viewports.map(({ width, height }) => `${width}x${height}`)
  if (!sameMembers(viewports, REQUIRED_LAYOUT_VIEWPORTS)) {
    issues.push('LAYOUT_VIEWPORT_MATRIX_INCOMPLETE')
  }
  if (duplicates(viewports).length > 0) issues.push('LAYOUT_VIEWPORT_DUPLICATED')
  if (
    fixture.layout.highDprViewport.width !== 1920 ||
    fixture.layout.highDprViewport.height !== 1080 ||
    fixture.layout.highDprViewport.deviceScaleFactor !== 2
  ) {
    issues.push('LAYOUT_HIGH_DPR_MUST_BE_1920X1080_DPR2')
  }
  if (!sameMembers(fixture.fire.sizes, REQUIRED_FIRE_SIZES)) {
    issues.push('FIRE_SIZE_MATRIX_INCOMPLETE')
  }
  if (duplicates(fixture.fire.sizes).length > 0) issues.push('FIRE_SIZE_DUPLICATED')
  const directionIds = fixture.fire.directions.map(({ id }) => id)
  if (!sameMembers(directionIds, REQUIRED_FIRE_DIRECTIONS)) {
    issues.push('FIRE_DIRECTION_MATRIX_INCOMPLETE')
  }
  if (duplicates(directionIds).length > 0) issues.push('FIRE_DIRECTION_DUPLICATED')
  if (
    fixture.fire.phaseTrace.size !== 60 ||
    fixture.fire.phaseTrace.directionId !== 'center'
  ) {
    issues.push('FIRE_PHASE_TRACE_MUST_BE_60_CENTER')
  }
  const phaseIds = fixture.fire.phases.map(({ id }) => id)
  if (!sameMembers(phaseIds, REQUIRED_FIRE_PHASES)) {
    issues.push('FIRE_PHASE_MATRIX_INCOMPLETE')
  }
  if (duplicates(phaseIds).length > 0) issues.push('FIRE_PHASE_DUPLICATED')
  for (const phase of fixture.fire.phases) {
    const expectedSampleCount = REQUIRED_FIRE_PHASE_SAMPLE_COUNTS[phase.id]
    if (phase.sampleOffsetsMilliseconds.length !== expectedSampleCount) {
      issues.push(
        `FIRE_PHASE_SAMPLE_COUNT_INVALID:${phase.id}:${phase.sampleOffsetsMilliseconds.length}:${expectedSampleCount}`,
      )
    }
    if (phase.sampleOffsetsMilliseconds.length === 0) {
      issues.push(`FIRE_PHASE_SAMPLES_EMPTY:${phase.id}`)
    }
    if (phase.sampleOffsetsMilliseconds[0] !== 0) {
      issues.push(`FIRE_PHASE_FIRST_SAMPLE_MUST_BE_ZERO:${phase.id}`)
    }
    if (duplicates(phase.sampleOffsetsMilliseconds).length > 0) {
      issues.push(`FIRE_PHASE_SAMPLE_DUPLICATED:${phase.id}`)
    }
    for (let index = 1; index < phase.sampleOffsetsMilliseconds.length; index += 1) {
      if (
        phase.sampleOffsetsMilliseconds[index]! <=
        phase.sampleOffsetsMilliseconds[index - 1]!
      ) {
        issues.push(`FIRE_PHASE_SAMPLES_NOT_ASCENDING:${phase.id}`)
        break
      }
    }
  }
  const coverageIds = fixture.coverage.cases.map(({ id }) => id)
  if (!sameMembers(coverageIds, REQUIRED_COVERAGE_CASES)) {
    issues.push('COVERAGE_CASE_MATRIX_INCOMPLETE')
  }
  if (duplicates(coverageIds).length > 0) issues.push('COVERAGE_CASE_DUPLICATED')
  for (const coverageCase of fixture.coverage.cases) {
    const caseId = coverageCase.id as keyof typeof REQUIRED_COVERAGE_AUTOMATION
    const requiredAutomation = REQUIRED_COVERAGE_AUTOMATION[caseId]
    const requiredStates = REQUIRED_COVERAGE_STATES[caseId]
    if (requiredAutomation !== undefined && coverageCase.automation !== requiredAutomation) {
      issues.push(`COVERAGE_AUTOMATION_INVALID:${coverageCase.id}`)
    }
    if (requiredStates !== undefined && !sameMembers(coverageCase.requiredStates, requiredStates)) {
      issues.push(`COVERAGE_REQUIRED_STATES_INVALID:${coverageCase.id}`)
    }
    if (coverageCase.automation === 'm2-material-topology') {
      const requiredMaterialFields = [
        coverageCase.fireSourceId,
        coverageCase.materialBatchId,
        coverageCase.materialDefinitionId,
        coverageCase.fireSize,
        coverageCase.logicalTarget,
        coverageCase.sourceEdge,
        coverageCase.epsilon,
        coverageCase.pollIntervalMilliseconds,
        coverageCase.maximumWaitMilliseconds,
        coverageCase.stopCondition,
        coverageCase.shapeThresholds,
        coverageCase.partialFront,
        coverageCase.expectedTopology,
      ]
      if (
        requiredMaterialFields.some((value) => value === undefined) ||
        coverageCase.flameThrust !== false
      ) {
        issues.push(`COVERAGE_MATERIAL_CONFIG_INCOMPLETE:${coverageCase.id}`)
      }
      const expected = coverageCase.expectedTopology
      if (
        expected !== undefined &&
        (expected.minimumDissolvedVolumeRatio > expected.maximumDissolvedVolumeRatio ||
          expected.minimumPenetrationRatio > expected.maximumPenetrationRatio ||
          expected.minimumLateralCoverageRatio > expected.maximumLateralCoverageRatio)
      ) {
        issues.push(`COVERAGE_MATERIAL_EXPECTATION_RANGE_INVALID:${coverageCase.id}`)
      }
      const stop = coverageCase.stopCondition
      if (stop?.mode === 'topology-classification') {
        if (
          stop.minimumDissolvedVolumeRatio >
            stop.maximumDissolvedVolumeRatio ||
          stop.classification !== expected?.classification ||
          stop.minimumDissolvedVolumeRatio !==
            expected?.minimumDissolvedVolumeRatio ||
          stop.maximumDissolvedVolumeRatio !==
            expected?.maximumDissolvedVolumeRatio ||
          stop.minimumRemainingRatio !== expected?.minimumRemainingRatio
        ) {
          issues.push(`COVERAGE_MATERIAL_STOP_RANGE_INVALID:${coverageCase.id}`)
        }
      }
      const formalContract =
        REQUIRED_MATERIAL_FORMAL_CONTRACT[
          coverageCase.id as keyof typeof REQUIRED_MATERIAL_FORMAL_CONTRACT
        ]
      if (formalContract !== undefined) {
        appendFormalContractIssues(
          coverageCase,
          formalContract,
          `COVERAGE_MATERIAL_FORMAL_CONTRACT_DRIFT:${coverageCase.id}`,
          issues,
        )
      }
    }
    if (coverageCase.automation === 'm2-material-pair-non-overlap') {
      const expected = REQUIRED_MATERIAL_PAIR_FORMAL_CONTRACT
      const batchIds = coverageCase.materialBatchIds
      const definitionIds = coverageCase.materialDefinitionIds
      if (
        batchIds === undefined ||
        definitionIds === undefined ||
        coverageCase.epsilon === undefined ||
        coverageCase.settleMilliseconds === undefined
      ) {
        issues.push(
          `COVERAGE_MATERIAL_PAIR_CONFIG_INCOMPLETE:${coverageCase.id}`,
        )
      }
      for (const [field, actual, required] of [
        ['id', coverageCase.id, expected.id],
        ['automation', coverageCase.automation, expected.automation],
        ['epsilon', coverageCase.epsilon, expected.epsilon],
        [
          'settleMilliseconds',
          coverageCase.settleMilliseconds,
          expected.settleMilliseconds,
        ],
      ] as const) {
        if (!Object.is(actual, required)) {
          issues.push(
            `COVERAGE_MATERIAL_PAIR_FORMAL_CONTRACT_DRIFT:${coverageCase.id}:${field}`,
          )
        }
      }
      for (const [field, actual, required] of [
        ['materialBatchIds', batchIds, expected.materialBatchIds],
        ['materialDefinitionIds', definitionIds, expected.materialDefinitionIds],
        ['requiredStates', coverageCase.requiredStates, expected.requiredStates],
      ] as const) {
        if (
          actual === undefined ||
          actual.length !== required.length ||
          actual.some((value, index) => value !== required[index])
        ) {
          issues.push(
            `COVERAGE_MATERIAL_PAIR_FORMAL_CONTRACT_DRIFT:${coverageCase.id}:${field}`,
          )
        }
      }
    }
    if (coverageCase.automation === 'm2-loss-warning') {
      const expectedLevel = coverageCase.id === 'loss-warning-one' ? 1 : 2
      const expectedEffect = expectedLevel === 1 ? 'warningOne' : 'warningTwo'
      if (
        coverageCase.warningLevel !== expectedLevel ||
        coverageCase.expectedEffect !== expectedEffect ||
        coverageCase.expectedMessageZh === undefined ||
        coverageCase.expectedMessageZh.trim().length === 0
      ) {
        issues.push(`COVERAGE_WARNING_CONFIG_INVALID:${coverageCase.id}`)
      }
      const formalContract =
        REQUIRED_WARNING_FORMAL_CONTRACT[
          coverageCase.id as keyof typeof REQUIRED_WARNING_FORMAL_CONTRACT
        ]
      if (formalContract !== undefined) {
        appendFormalContractIssues(
          coverageCase,
          formalContract,
          `COVERAGE_WARNING_FORMAL_CONTRACT_DRIFT:${coverageCase.id}`,
          issues,
        )
      }
    }
  }
  const materialCenter = fixture.coverage.cases.find(
    ({ id }) => id === 'material-center-hole',
  )
  const materialWide = fixture.coverage.cases.find(
    ({ id }) => id === 'material-wide-strip',
  )
  const materialThrough = fixture.coverage.cases.find(
    ({ id }) => id === 'material-burn-through',
  )
  if (
    materialCenter?.fireSize !== 20 ||
    materialWide?.fireSize !== 100 ||
    materialThrough?.fireSize !== 20 ||
    materialCenter.stopCondition?.mode !== 'topology-classification' ||
    materialCenter.stopCondition.classification !== 'deep-narrow' ||
    materialWide.stopCondition?.mode !== 'topology-classification' ||
    materialWide.stopCondition.classification !== 'shallow-wide' ||
    materialCenter.stopCondition.minimumDissolvedVolumeRatio !==
      materialWide.stopCondition.minimumDissolvedVolumeRatio ||
    materialCenter.stopCondition.maximumDissolvedVolumeRatio !==
      materialWide.stopCondition.maximumDissolvedVolumeRatio ||
    materialThrough.stopCondition?.mode !== 'through-connected' ||
    materialCenter.expectedTopology?.classification !== 'deep-narrow' ||
    materialWide.expectedTopology?.classification !== 'shallow-wide' ||
    materialThrough.expectedTopology?.classification !== 'through-not-empty'
  ) {
    issues.push('COVERAGE_MATERIAL_CASE_CONTRACT_INVALID')
  }
  appendFormalContractIssues(
    fixture.coverage.materialAlignment,
    REQUIRED_MATERIAL_ALIGNMENT_FORMAL_CONTRACT,
    'COVERAGE_MATERIAL_ALIGNMENT_FORMAL_CONTRACT_DRIFT',
    issues,
  )
  const warningFlow = fixture.coverage.warningFlow
  let warningTargetAuthoritative = false
  if (
    materialCenter?.logicalTarget !== undefined &&
    materialCenter.epsilon !== undefined
  ) {
    try {
      assertM5MaterialEvidenceTargetMatchesContentCenter({
        caseId: 'warningFlow',
        configuredTarget: warningFlow.logicalTarget,
        contentCenter: materialCenter.logicalTarget,
        epsilon: materialCenter.epsilon,
      })
      warningTargetAuthoritative = true
    } catch {
      warningTargetAuthoritative = false
    }
  }
  if (
    warningFlow.fireSize !== 100 ||
    materialCenter === undefined ||
    warningFlow.materialDefinitionId !== materialCenter.materialDefinitionId ||
    warningFlow.materialBatchId !== materialCenter.materialBatchId ||
    warningFlow.flameThrust !== false ||
    warningFlow.collectorMoveKey !== 'd' ||
    warningFlow.collectorMoveMilliseconds !== 2_500 ||
    warningFlow.collectorSettleMilliseconds !== 1_000 ||
    warningFlow.stopSprayingAtWarningLevel !== 2 ||
    warningFlow.maximumStoppedCaptureTickDrift !== 4 ||
    !warningTargetAuthoritative
  ) {
    issues.push('COVERAGE_WARNING_FLOW_NOT_AUTHORITATIVE')
  }
  const accessibilityIds = fixture.accessibility.modes.map(({ id }) => id)
  if (!sameMembers(accessibilityIds, REQUIRED_ACCESSIBILITY_MODES)) {
    issues.push('ACCESSIBILITY_MATRIX_INCOMPLETE')
  }
  if (duplicates(accessibilityIds).length > 0) {
    issues.push('ACCESSIBILITY_MODE_DUPLICATED')
  }
  if (!sameMembers(fixture.accessibility.galleryRequiredStates, REQUIRED_ACCESSIBILITY_STATES)) {
    issues.push('ACCESSIBILITY_REQUIRED_STATES_INVALID')
  }
  if (
    !sameMembers(
      fixture.accessibility.captureStates,
      REQUIRED_ACCESSIBILITY_CAPTURE_STATES,
    )
  ) {
    issues.push('ACCESSIBILITY_CAPTURE_STATES_INVALID')
  }
  for (const mode of fixture.accessibility.modes) {
    if (mode.colorMatrix.length !== 20) {
      issues.push(`ACCESSIBILITY_COLOR_MATRIX_INVALID:${mode.id}`)
    }
    if (mode.id === 'reduced-motion') {
      if (!mode.reducedMotion || mode.visionMode !== 'normal') {
        issues.push('ACCESSIBILITY_REDUCED_MODE_INVALID')
      }
      if (
        mode.colorMatrix.some(
          (value, index) => value !== M5_VISUAL_IDENTITY_COLOR_MATRIX[index],
        )
      ) {
        issues.push('ACCESSIBILITY_REDUCED_MATRIX_MUST_BE_IDENTITY')
      }
    } else if (mode.reducedMotion) {
      issues.push(`ACCESSIBILITY_VISION_MODE_CANNOT_REDUCE_MOTION:${mode.id}`)
    }
    const requiredMatrix = REQUIRED_ACCESSIBILITY_MATRICES[mode.id]
    const requiredSettings = REQUIRED_ACCESSIBILITY_MODE_SETTINGS[mode.id]
    if (
      mode.visionMode !== requiredSettings.visionMode ||
      mode.reducedMotion !== requiredSettings.reducedMotion
    ) {
      issues.push(`ACCESSIBILITY_MODE_SETTINGS_INVALID:${mode.id}`)
    }
    if (
      mode.colorMatrix.length !== requiredMatrix.length ||
      mode.colorMatrix.some((value, index) => value !== requiredMatrix[index])
    ) {
      issues.push(`ACCESSIBILITY_COLOR_MATRIX_NOT_AUTHORITATIVE:${mode.id}`)
    }
  }
  if (!sameMembers(fixture.failure.phases, REQUIRED_FAILURE_PHASES)) {
    issues.push('FAILURE_PHASE_MATRIX_INCOMPLETE')
  }
  if (duplicates(fixture.failure.phases).length > 0) {
    issues.push('FAILURE_PHASE_DUPLICATED')
  }
  const motionIds = fixture.failure.motionModes.map(({ id }) => id)
  if (!sameMembers(motionIds, ['normal', 'reduced'])) {
    issues.push('FAILURE_MOTION_MATRIX_INCOMPLETE')
  }
  if (
    fixture.failure.motionModes.some(
      ({ id, reducedMotion }) => reducedMotion !== (id === 'reduced'),
    )
  ) {
    issues.push('FAILURE_MOTION_MODE_INVALID')
  }
  if (
    fixture.protocol.clock.resumeReserveMilliseconds >=
    fixture.protocol.clock.maximumCaptureMilliseconds
  ) {
    issues.push('TRANSIENT_CLOCK_RESUME_RESERVE_INVALID')
  }
  return issues
}

export function parseAndValidateM5VisualEvidenceFixtureJson(
  fixtureText: string,
  schemaText: string,
): M5VisualEvidenceFixture {
  const fixtureResult = parseStrictJson(fixtureText)
  if (!fixtureResult.ok) {
    throw new Error('M5_VISUAL_EVIDENCE_FIXTURE_STRICT_JSON_INVALID')
  }
  const schemaResult = parseStrictJson(schemaText)
  if (!schemaResult.ok) {
    throw new Error('M5_VISUAL_EVIDENCE_SCHEMA_STRICT_JSON_INVALID')
  }
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    validateSchema: true,
  }).compile(schemaResult.value as object)
  if (!validate(fixtureResult.value)) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_FIXTURE_SCHEMA_INVALID:${JSON.stringify(validate.errors ?? [])}`,
    )
  }
  const fixture = fixtureResult.value as M5VisualEvidenceFixture
  const issues = validateM5VisualEvidenceFixtureSemantics(fixture)
  if (issues.length > 0) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID:${issues.join(',')}`,
    )
  }
  return fixture
}

function fireCaseStem(size: number, directionId: string): string {
  return `${size}/${directionId}`
}

export function expandM5VisualEvidenceMatrix(
  fixture: M5VisualEvidenceFixture,
): readonly M5VisualEvidenceExpectedCell[] {
  const semanticIssues = validateM5VisualEvidenceFixtureSemantics(fixture)
  if (semanticIssues.length > 0) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID:${semanticIssues.join(',')}`,
    )
  }
  const cells: M5VisualEvidenceExpectedCell[] = []
  for (const browser of fixture.layout.browsers) {
    for (const viewport of fixture.layout.viewports) {
      cells.push({
        id: `layout/${browser.id}/${viewport.width}x${viewport.height}@dpr1`,
        section: 'layout',
        kind: 'raw-frame',
        expectedStatus: 'capture',
      })
    }
    const highDpr = fixture.layout.highDprViewport
    cells.push({
      id: `layout/${browser.id}/${highDpr.width}x${highDpr.height}@dpr${highDpr.deviceScaleFactor}`,
      section: 'layout',
      kind: 'raw-frame',
      expectedStatus: 'capture',
    })
  }
  for (const size of fixture.fire.sizes) {
    for (const direction of fixture.fire.directions) {
      cells.push({
        id: `fire/matrix/${fireCaseStem(size, direction.id)}`,
        section: 'fire',
        kind: 'raw-frame',
        expectedStatus: 'capture',
      })
    }
  }
  const phaseStem = fireCaseStem(
    fixture.fire.phaseTrace.size,
    fixture.fire.phaseTrace.directionId,
  )
  for (const phase of fixture.fire.phases) {
    const sources: string[] = []
    for (let index = 0; index < phase.sampleOffsetsMilliseconds.length; index += 1) {
      const id = `fire/raw/${phaseStem}/${phase.id}/${String(index).padStart(2, '0')}`
      sources.push(id)
      cells.push({
        id,
        section: 'fire',
        kind: 'raw-frame',
        expectedStatus: 'capture',
      })
    }
    cells.push({
      id: `fire/contact/${phaseStem}/${phase.id}`,
      section: 'fire',
      kind: 'contact-sheet',
      expectedStatus: 'capture',
      sourceCaseIds: sources,
    })
  }
  for (const coverageCase of fixture.coverage.cases) {
    cells.push({
      id: `coverage/${coverageCase.id}`,
      section: 'coverage',
      kind: 'coverage-frame',
      expectedStatus: 'capture',
    })
  }
  for (const mode of fixture.accessibility.modes) {
    for (const state of fixture.accessibility.captureStates) {
      cells.push({
        id: `accessibility/${mode.id}/${state}`,
        section: 'accessibility',
        kind: 'coverage-frame',
        expectedStatus: 'capture',
      })
    }
  }
  for (const motion of fixture.failure.motionModes) {
    for (const phase of fixture.failure.phases) {
      cells.push({
        id: `failure/${motion.id}/${phase}`,
        section: 'failure',
        kind: 'raw-frame',
        expectedStatus: 'capture',
      })
    }
  }
  const capturedCount = cells.filter(
    ({ expectedStatus }) => expectedStatus === 'capture',
  ).length
  const manualBlockedCount = cells.filter(
    ({ expectedStatus }) => expectedStatus === 'manual-blocked',
  ).length
  const sectionCounts = {
    layout: cells.filter(({ section }) => section === 'layout').length,
    fire: cells.filter(({ section }) => section === 'fire').length,
    coverage: cells.filter(({ section }) => section === 'coverage').length,
    accessibility: cells.filter(({ section }) => section === 'accessibility').length,
    failure: cells.filter(({ section }) => section === 'failure').length,
  }
  if (
    cells.length !== 64 ||
    capturedCount !== 64 ||
    manualBlockedCount !== 0 ||
    sectionCounts.layout !== 7 ||
    sectionCounts.fire !== 24 ||
    sectionCounts.coverage !== 9 ||
    sectionCounts.accessibility !== 12 ||
    sectionCounts.failure !== 12
  ) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_MATRIX_COUNT_INVALID:${JSON.stringify({
        total: cells.length,
        captured: capturedCount,
        manualBlocked: manualBlockedCount,
        sections: sectionCounts,
      })}`,
    )
  }
  return Object.freeze(cells)
}

export function assertM5VisualEvidenceCellCoverage(
  expected: readonly Pick<M5VisualEvidenceExpectedCell, 'id'>[],
  actual: readonly Readonly<{ caseId: string }>[],
): void {
  const expectedIds = new Set(expected.map(({ id }) => id))
  const actualCounts = new Map<string, number>()
  for (const { caseId } of actual) {
    actualCounts.set(caseId, (actualCounts.get(caseId) ?? 0) + 1)
  }
  const duplicated = [...actualCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort()
  if (duplicated.length > 0) {
    throw new Error(`M5_VISUAL_EVIDENCE_CASE_DUPLICATED:${duplicated.join(',')}`)
  }
  const unexpected = [...actualCounts.keys()]
    .filter((id) => !expectedIds.has(id))
    .sort()
  if (unexpected.length > 0) {
    throw new Error(`M5_VISUAL_EVIDENCE_CASE_UNEXPECTED:${unexpected.join(',')}`)
  }
  const missing = [...expectedIds]
    .filter((id) => !actualCounts.has(id))
    .sort()
  if (missing.length > 0) {
    throw new Error(`M5_VISUAL_EVIDENCE_CASE_MISSING:${missing.join(',')}`)
  }
}

export type M5VisualFirePhaseBoundaryObservation = Readonly<{
  firePresentationState: string
  isSpraying: boolean
}>

export function createM5VisualFirePhaseChecks(input: Readonly<{
  phaseId: 'startup' | 'steady' | 'release'
  configuredOffsetMilliseconds: number
  screenshotStartedOffsetMilliseconds: number
  screenshotFinishedOffsetMilliseconds: number
  maximumSampleLatenessMilliseconds: number
  before: M5VisualFirePhaseBoundaryObservation
  after: M5VisualFirePhaseBoundaryObservation
}>): readonly M5VisualEvidenceCheck[] {
  const expectedState =
    input.phaseId === 'startup'
      ? 'emerging'
      : input.phaseId === 'steady'
        ? 'steady'
        : 'cooling'
  const expectedSpraying = input.phaseId !== 'release'
  const boundaryMatches = (
    observation: M5VisualFirePhaseBoundaryObservation,
  ): boolean =>
    observation.firePresentationState === expectedState &&
    observation.isSpraying === expectedSpraying
  const startedLateness =
    input.screenshotStartedOffsetMilliseconds -
    input.configuredOffsetMilliseconds
  const finishedLateness =
    input.screenshotFinishedOffsetMilliseconds -
    input.configuredOffsetMilliseconds
  return Object.freeze([
    {
      id: `fire-phase-${input.phaseId}-before`,
      passed: boundaryMatches(input.before),
      actual: `${input.before.firePresentationState}/${String(input.before.isSpraying)}`,
      expected: `${expectedState}/${String(expectedSpraying)}`,
    },
    {
      id: `fire-phase-${input.phaseId}-after`,
      passed: boundaryMatches(input.after),
      actual: `${input.after.firePresentationState}/${String(input.after.isSpraying)}`,
      expected: `${expectedState}/${String(expectedSpraying)}`,
    },
    {
      id: 'phase-screenshot-not-early',
      passed: startedLateness >= 0 && finishedLateness >= 0,
      actual: `${startedLateness}/${finishedLateness}`,
      expected: 'start/finish >= 0ms',
    },
    {
      id: 'phase-screenshot-lateness-bounded',
      passed:
        startedLateness <= input.maximumSampleLatenessMilliseconds &&
        finishedLateness <= input.maximumSampleLatenessMilliseconds,
      actual: `${startedLateness}/${finishedLateness}`,
      expected: `start/finish <= ${input.maximumSampleLatenessMilliseconds}ms`,
    },
    {
      id: 'phase-screenshot-offset-order',
      passed:
        input.screenshotFinishedOffsetMilliseconds >=
        input.screenshotStartedOffsetMilliseconds,
      actual: `${input.screenshotStartedOffsetMilliseconds}/${input.screenshotFinishedOffsetMilliseconds}`,
      expected: 'start <= finish',
    },
  ])
}

export type M5VisualFailurePhaseThresholds = Readonly<{
  shatteringStartRatio: number
  gatheringStartRatio: number
  flyingStartRatio: number
}>

export type M5VisualFailureBoundaryObservation = Readonly<{
  sessionId: string
  tick: number
  domainStatus: string
  failurePresentationState: string
  failurePresentationProgress: number
  failurePresentationComplete: boolean
}>

export type M5VisualClockPauseAudit = Readonly<{
  attemptCount: number
  retryCount: number
  targetMilliseconds: number
}>

export type M5VisualFailureClockPauseAudit = M5VisualClockPauseAudit

export type M5VisualClockCaptureAudit = Readonly<{
  paused: true
  resumed: true
  realDurationMilliseconds: number
  pauseAcquisition?: M5VisualClockPauseAudit
}>

export type M5VisualFailureClockCaptureAudit = M5VisualClockCaptureAudit

type M5VisualClockPauseInput = Readonly<{
  leadMilliseconds: number
  maximumAttempts: number
  nowMilliseconds: () => number | Promise<number>
  pauseAt: (targetMilliseconds: number) => Promise<void>
}>

type M5VisualClockErrorCodes = Readonly<{
  pauseConfigInvalid: string
  nowInvalid: string
  pauseAcquisitionFailed: string
  pauseUnreachable: string
  captureConfigInvalid: string
  quarantineFailed: string
  pauseTimeout: string
  pauseDrainTimeout: string
  criticalTimeout: string
  criticalDrainTimeout: string
  resumeTimeout: string
  captureAndResumeFailed: string
  resumeFailed: string
}>

const M5_VISUAL_TRANSIENT_CLOCK_ERROR_CODES: M5VisualClockErrorCodes =
  Object.freeze({
    pauseConfigInvalid:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_PAUSE_CONFIG_INVALID',
    nowInvalid: 'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_NOW_INVALID',
    pauseAcquisitionFailed:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_PAUSE_ACQUISITION_FAILED',
    pauseUnreachable:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_PAUSE_UNREACHABLE',
    captureConfigInvalid:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CONFIG_INVALID',
    quarantineFailed:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_QUARANTINE_FAILED',
    pauseTimeout: 'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_PAUSE_TIMEOUT',
    pauseDrainTimeout:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_PAUSE_DRAIN_TIMEOUT',
    criticalTimeout:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CRITICAL_TIMEOUT',
    criticalDrainTimeout:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CRITICAL_DRAIN_TIMEOUT',
    resumeTimeout: 'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_RESUME_TIMEOUT',
    captureAndResumeFailed:
      'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CAPTURE_AND_RESUME_FAILED',
    resumeFailed: 'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_RESUME_FAILED',
  })

const M5_VISUAL_FAILURE_CLOCK_ERROR_CODES: M5VisualClockErrorCodes =
  Object.freeze({
    pauseConfigInvalid:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_CONFIG_INVALID',
    nowInvalid: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_NOW_INVALID',
    pauseAcquisitionFailed:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_ACQUISITION_FAILED',
    pauseUnreachable: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_UNREACHABLE',
    captureConfigInvalid: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CONFIG_INVALID',
    quarantineFailed:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_QUARANTINE_FAILED',
    pauseTimeout: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_TIMEOUT',
    pauseDrainTimeout:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_DRAIN_TIMEOUT',
    criticalTimeout:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CRITICAL_TIMEOUT',
    criticalDrainTimeout:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CRITICAL_DRAIN_TIMEOUT',
    resumeTimeout: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_RESUME_TIMEOUT',
    captureAndResumeFailed:
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CAPTURE_AND_RESUME_FAILED',
    resumeFailed: 'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_RESUME_FAILED',
  })

async function acquireM5VisualClockPauseCore(
  input: M5VisualClockPauseInput,
  errorCodes: M5VisualClockErrorCodes,
): Promise<M5VisualClockPauseAudit> {
  if (
    !Number.isSafeInteger(input.leadMilliseconds) ||
    input.leadMilliseconds < 0 ||
    !Number.isSafeInteger(input.maximumAttempts) ||
    input.maximumAttempts <= 0
  ) {
    throw new Error(errorCodes.pauseConfigInvalid)
  }
  const errors: unknown[] = []
  for (let attemptCount = 1; attemptCount <= input.maximumAttempts; attemptCount += 1) {
    const now = await input.nowMilliseconds()
    if (!Number.isFinite(now)) {
      throw new Error(errorCodes.nowInvalid)
    }
    const targetMilliseconds = now + input.leadMilliseconds
    try {
      await input.pauseAt(targetMilliseconds)
      return {
        attemptCount,
        retryCount: attemptCount - 1,
        targetMilliseconds,
      }
    } catch (error) {
      errors.push(error)
      const retryablePastTarget =
        error instanceof Error &&
        error.message.includes('Cannot fast-forward to the past')
      if (retryablePastTarget && attemptCount < input.maximumAttempts) continue
      if (errors.length === 1) throw error
      throw new AggregateError(
        errors,
        errorCodes.pauseAcquisitionFailed,
        { cause: error },
      )
    }
  }
  throw new Error(errorCodes.pauseUnreachable)
}

export async function acquireM5VisualFailureClockPause(
  input: M5VisualClockPauseInput,
): Promise<M5VisualFailureClockPauseAudit> {
  return acquireM5VisualClockPauseCore(
    input,
    M5_VISUAL_FAILURE_CLOCK_ERROR_CODES,
  )
}

export async function acquireM5VisualClockPause(
  input: M5VisualClockPauseInput,
): Promise<M5VisualClockPauseAudit> {
  return acquireM5VisualClockPauseCore(
    input,
    M5_VISUAL_TRANSIENT_CLOCK_ERROR_CODES,
  )
}

const m5VisualClockQuarantineErrors = new WeakSet<Error>()

function markM5VisualClockContextQuarantine<T>(error: T): T {
  if (error instanceof Error) m5VisualClockQuarantineErrors.add(error)
  return error
}

export function requiresM5VisualContextQuarantine(
  error: unknown,
  ancestors: ReadonlySet<unknown> = new Set(),
): boolean {
  if (!(error instanceof Error) || ancestors.has(error)) return false
  if (m5VisualClockQuarantineErrors.has(error)) return true
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(error)
  if (
    error.cause !== undefined &&
    requiresM5VisualContextQuarantine(error.cause, nextAncestors)
  ) {
    return true
  }
  return (
    error instanceof AggregateError &&
    Array.from(error.errors).some((nested) =>
      requiresM5VisualContextQuarantine(nested, nextAncestors),
    )
  )
}

type M5VisualPromiseSettlement<T> =
  | Readonly<{ status: 'fulfilled'; value: T }>
  | Readonly<{ status: 'rejected'; reason: unknown }>

function observeM5VisualPromise<T>(
  operation: PromiseLike<T>,
): Promise<M5VisualPromiseSettlement<T>> {
  return Promise.resolve(operation).then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  )
}

type M5VisualClockCaptureInput<T> = Readonly<{
  maximumCaptureMilliseconds: number
  resumeReserveMilliseconds: number
  pause: () => Promise<void | M5VisualClockPauseAudit>
  critical: (timeoutMilliseconds: number) => Promise<T>
  resume: () => Promise<void>
  quarantine?: () => Promise<void>
}>

async function captureM5VisualClockCore<T>(
  input: M5VisualClockCaptureInput<T>,
  errorCodes: M5VisualClockErrorCodes,
): Promise<Readonly<{ value: T; audit: M5VisualClockCaptureAudit }>> {
  if (
    !Number.isFinite(input.maximumCaptureMilliseconds) ||
    input.maximumCaptureMilliseconds <= 0 ||
    !Number.isFinite(input.resumeReserveMilliseconds) ||
    input.resumeReserveMilliseconds <= 0 ||
    input.resumeReserveMilliseconds >= input.maximumCaptureMilliseconds
  ) {
    throw new Error(errorCodes.captureConfigInvalid)
  }
  const startedAt = Date.now()
  const criticalDeadline =
    startedAt +
    input.maximumCaptureMilliseconds -
    input.resumeReserveMilliseconds
  const overallDeadline = startedAt + input.maximumCaptureMilliseconds
  const remaining = (deadline: number): number =>
    Math.max(1, deadline - Date.now())
  let quarantinePromise: Promise<void> | undefined
  const quarantineOnce = (): Promise<void> => {
    if (quarantinePromise === undefined) {
      quarantinePromise =
        input.quarantine === undefined
          ? Promise.resolve()
          : Promise.resolve().then(input.quarantine)
    }
    return quarantinePromise
  }
  const quarantineFailure = async (error: unknown): Promise<unknown> => {
    markM5VisualClockContextQuarantine(error)
    try {
      await quarantineOnce()
      return error
    } catch (quarantineError) {
      return markM5VisualClockContextQuarantine(
        new AggregateError(
          [error, quarantineError],
          errorCodes.quarantineFailed,
          { cause: error },
        ),
      )
    }
  }

  const pauseOperation = observeM5VisualPromise(
    Promise.resolve().then(input.pause),
  )
  let pauseSettlement: M5VisualPromiseSettlement<
    void | M5VisualClockPauseAudit
  >
  let primaryError: unknown
  try {
    pauseSettlement = await runM5VisualEvidenceWithTimeout(
      pauseOperation,
      remaining(criticalDeadline),
      errorCodes.pauseTimeout,
    )
  } catch (error) {
    primaryError = markM5VisualClockContextQuarantine(error)
    try {
      pauseSettlement = await runM5VisualEvidenceWithTimeout(
        pauseOperation,
        remaining(overallDeadline),
        errorCodes.pauseDrainTimeout,
      )
    } catch {
      throw await quarantineFailure(primaryError)
    }
  }
  if (pauseSettlement.status === 'rejected') {
    if (primaryError !== undefined) {
      throw await quarantineFailure(primaryError)
    }
    throw pauseSettlement.reason
  }
  const pauseAcquisition = pauseSettlement.value

  let value: T | undefined
  if (primaryError === undefined) {
    const criticalTimeout = remaining(criticalDeadline)
    const criticalOperation = observeM5VisualPromise(
      Promise.resolve().then(() => input.critical(criticalTimeout)),
    )
    let criticalSettlement: M5VisualPromiseSettlement<T>
    try {
      criticalSettlement = await runM5VisualEvidenceWithTimeout(
        criticalOperation,
        criticalTimeout,
        errorCodes.criticalTimeout,
      )
    } catch (error) {
      primaryError = markM5VisualClockContextQuarantine(error)
      try {
        criticalSettlement = await runM5VisualEvidenceWithTimeout(
          criticalOperation,
          remaining(overallDeadline),
          errorCodes.criticalDrainTimeout,
        )
      } catch {
        throw await quarantineFailure(primaryError)
      }
    }
    if (criticalSettlement.status === 'rejected') {
      if (primaryError === undefined) primaryError = criticalSettlement.reason
    } else {
      value = criticalSettlement.value
    }
  }

  let resumeError: unknown
  const resumeOperation = observeM5VisualPromise(
    Promise.resolve().then(input.resume),
  )
  try {
    const resumeSettlement = await runM5VisualEvidenceWithTimeout(
      resumeOperation,
      remaining(overallDeadline),
      errorCodes.resumeTimeout,
    )
    if (resumeSettlement.status === 'rejected') {
      resumeError = resumeSettlement.reason
    }
  } catch (error) {
    resumeError = error
  }
  if (primaryError !== undefined && resumeError !== undefined) {
    throw await quarantineFailure(
      new AggregateError(
        [primaryError, resumeError],
        errorCodes.captureAndResumeFailed,
        { cause: primaryError },
      ),
    )
  }
  if (primaryError !== undefined) {
    if (requiresM5VisualContextQuarantine(primaryError)) {
      throw await quarantineFailure(primaryError)
    }
    throw primaryError
  }
  if (resumeError !== undefined) {
    throw await quarantineFailure(
      new Error(errorCodes.resumeFailed, {
        cause: resumeError,
      }),
    )
  }
  return {
    value: value!,
    audit: {
      paused: true,
      resumed: true,
      realDurationMilliseconds: Date.now() - startedAt,
      ...(pauseAcquisition === undefined ? {} : { pauseAcquisition }),
    },
  }
}

export async function captureM5VisualFailurePhaseWithClock<T>(
  input: M5VisualClockCaptureInput<T>,
): Promise<Readonly<{ value: T; audit: M5VisualFailureClockCaptureAudit }>> {
  return captureM5VisualClockCore(input, M5_VISUAL_FAILURE_CLOCK_ERROR_CODES)
}

export async function captureM5VisualTransientWithClock<T>(
  input: M5VisualClockCaptureInput<T>,
): Promise<Readonly<{ value: T; audit: M5VisualClockCaptureAudit }>> {
  return captureM5VisualClockCore(input, M5_VISUAL_TRANSIENT_CLOCK_ERROR_CODES)
}

export function requiresM5VisualFailureContextQuarantine(
  error: unknown,
): boolean {
  return requiresM5VisualContextQuarantine(error)
}

function validateFailureThresholds(
  thresholds: M5VisualFailurePhaseThresholds,
): void {
  if (
    !Number.isFinite(thresholds.shatteringStartRatio) ||
    !Number.isFinite(thresholds.gatheringStartRatio) ||
    !Number.isFinite(thresholds.flyingStartRatio) ||
    thresholds.shatteringStartRatio <= 0 ||
    thresholds.shatteringStartRatio >= thresholds.gatheringStartRatio ||
    thresholds.gatheringStartRatio >= thresholds.flyingStartRatio ||
    thresholds.flyingStartRatio >= 1
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_FAILURE_THRESHOLDS_INVALID')
  }
}

export function targetFailureProgress(
  phase: M5VisualEvidenceFixture['failure']['phases'][number],
  thresholds: M5VisualFailurePhaseThresholds,
): number {
  validateFailureThresholds(thresholds)
  switch (phase) {
    case 'trigger':
      return 0
    case 'charring':
      return thresholds.shatteringStartRatio / 2
    case 'shattering':
      return (
        (thresholds.shatteringStartRatio + thresholds.gatheringStartRatio) / 2
      )
    case 'gathering':
      return (
        (thresholds.gatheringStartRatio + thresholds.flyingStartRatio) / 2
      )
    case 'flying':
      return (thresholds.flyingStartRatio + 1) / 2
    case 'result':
      return 1
  }
}

export function expectedM5VisualFailurePresentationState(
  phase: M5VisualEvidenceFixture['failure']['phases'][number],
): string {
  return phase === 'trigger' ? 'charring' : phase
}

function failureProgressRange(
  phase: M5VisualEvidenceFixture['failure']['phases'][number],
  thresholds: M5VisualFailurePhaseThresholds,
): readonly [number, number] {
  switch (phase) {
    case 'trigger':
      return [0, thresholds.shatteringStartRatio / 3]
    case 'charring':
      return [thresholds.shatteringStartRatio / 3, thresholds.shatteringStartRatio]
    case 'shattering':
      return [thresholds.shatteringStartRatio, thresholds.gatheringStartRatio]
    case 'gathering':
      return [thresholds.gatheringStartRatio, thresholds.flyingStartRatio]
    case 'flying':
      return [thresholds.flyingStartRatio, 1]
    case 'result':
      return [1, 1]
  }
}

export function createM5VisualFailurePhaseChecks(input: Readonly<{
  phase: M5VisualEvidenceFixture['failure']['phases'][number]
  thresholds: M5VisualFailurePhaseThresholds
  before: M5VisualFailureBoundaryObservation
  after: M5VisualFailureBoundaryObservation
}>): readonly M5VisualEvidenceCheck[] {
  validateFailureThresholds(input.thresholds)
  const expectedState = expectedM5VisualFailurePresentationState(input.phase)
  const [minimumProgress, maximumProgress] = failureProgressRange(
    input.phase,
    input.thresholds,
  )
  const boundaryInPhase = (
    observation: M5VisualFailureBoundaryObservation,
    boundary: 'before' | 'after',
  ): boolean =>
    observation.domainStatus === 'failed' &&
    observation.failurePresentationState === expectedState &&
    observation.failurePresentationProgress >= minimumProgress &&
    observation.failurePresentationProgress <=
      (input.phase === 'trigger' && boundary === 'after'
        ? input.thresholds.shatteringStartRatio
        : maximumProgress) &&
    (input.phase !== 'result' || observation.failurePresentationComplete)
  return Object.freeze([
    {
      id: 'failure-authoritative-boundary-stable',
      passed:
        input.before.sessionId === input.after.sessionId &&
        input.before.tick === input.after.tick &&
        input.before.failurePresentationState ===
          input.after.failurePresentationState &&
        input.before.failurePresentationProgress ===
          input.after.failurePresentationProgress,
      actual: `${input.before.sessionId}/${input.after.sessionId}/${input.before.tick}/${input.after.tick}/${input.before.failurePresentationState}/${input.after.failurePresentationState}/${input.before.failurePresentationProgress}/${input.after.failurePresentationProgress}`,
      expected: 'same-session/tick/state/progress',
    },
    {
      id: `failure-phase-${input.phase}-before`,
      passed: boundaryInPhase(input.before, 'before'),
      actual: `${input.before.domainStatus}/${input.before.failurePresentationState}/${input.before.failurePresentationProgress.toFixed(4)}/${String(input.before.failurePresentationComplete)}`,
      expected: `failed/${expectedState}/${minimumProgress.toFixed(4)}..${maximumProgress.toFixed(4)}`,
    },
    {
      id: `failure-phase-${input.phase}-after`,
      passed: boundaryInPhase(input.after, 'after'),
      actual: `${input.after.domainStatus}/${input.after.failurePresentationState}/${input.after.failurePresentationProgress.toFixed(4)}/${String(input.after.failurePresentationComplete)}`,
      expected: `failed/${expectedState}/${minimumProgress.toFixed(4)}..${(input.phase === 'trigger' ? input.thresholds.shatteringStartRatio : maximumProgress).toFixed(4)}`,
    },
    {
      id: 'failure-progress-monotonic-across-screenshot',
      passed:
        input.after.failurePresentationProgress >=
        input.before.failurePresentationProgress,
      actual: `${input.before.failurePresentationProgress}/${input.after.failurePresentationProgress}`,
      expected: 'before <= after',
    },
    {
      id: 'failure-completion-stable',
      passed:
        input.phase !== 'result' ||
        (input.before.failurePresentationComplete &&
          input.after.failurePresentationComplete),
      actual: `${String(input.before.failurePresentationComplete)}/${String(input.after.failurePresentationComplete)}`,
      expected: input.phase === 'result' ? 'true/true' : 'not-required',
    },
  ])
}

export type M5VisualFailureCaptureSequenceEntry = Readonly<{
  phase: M5VisualEvidenceFixture['failure']['phases'][number]
  failurePresentationState: string
  failurePresentationProgress: number
  failurePresentationComplete: boolean
  sha256: string
}>

export function assertM5VisualFailureCaptureSequence(
  entries: readonly M5VisualFailureCaptureSequenceEntry[],
): void {
  if (
    entries.length !== REQUIRED_FAILURE_PHASES.length ||
    entries.some((entry, index) => entry.phase !== REQUIRED_FAILURE_PHASES[index])
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_PHASES_INVALID')
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    if (
      entry.failurePresentationState !==
      expectedM5VisualFailurePresentationState(entry.phase)
    ) {
      throw new Error(`M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_STATE_INVALID:${entry.phase}`)
    }
    if (
      index > 0 &&
      entry.failurePresentationProgress <=
        entries[index - 1]!.failurePresentationProgress
    ) {
      throw new Error(`M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_PROGRESS_INVALID:${entry.phase}`)
    }
  }
  if (!entries.at(-1)!.failurePresentationComplete) {
    throw new Error('M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_RESULT_INCOMPLETE')
  }
  if (new Set(entries.map(({ sha256 }) => sha256)).size !== entries.length) {
    throw new Error('M5_VISUAL_EVIDENCE_FAILURE_SEQUENCE_PNG_REUSED')
  }
}

function matricesEqual(
  actual: readonly number[],
  expected: readonly number[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (value, index) =>
        Number.isFinite(value) && Math.abs(value - expected[index]!) <= 1e-9,
    )
  )
}

function parseMatrixDataset(value: string): readonly number[] {
  if (value.trim().length === 0) return []
  return value.trim().split(/\s+/u).map(Number)
}

export function createM5VisualBrowserEnvironmentChecks(input: Readonly<{
  viewport: M5VisualEvidenceViewport
  reducedMotion: boolean
  visionMode: M5VisualEvidenceVisionMode
  colorMatrix: readonly number[]
  seed: number
  observedSeed: unknown
  environment: M5VisualEvidenceBrowserEnvironment
  screenshotMode: M5VisualEvidenceScreenshotMode
  artifact: Readonly<{ width: number; height: number }>
}>): readonly M5VisualEvidenceCheck[] {
  const screenshotCssWidth =
    input.screenshotMode === 'full-page'
      ? Math.max(
          input.environment.documentClientWidth,
          input.environment.documentScrollWidth,
        )
      : input.environment.innerWidth
  const screenshotCssHeight =
    input.screenshotMode === 'full-page'
      ? Math.max(
          input.environment.documentClientHeight,
          input.environment.documentScrollHeight,
        )
      : input.environment.innerHeight
  const expectedPngWidth = Math.round(
    screenshotCssWidth * input.environment.devicePixelRatio,
  )
  const expectedPngHeight = Math.round(
    screenshotCssHeight * input.environment.devicePixelRatio,
  )
  const transformedVision = input.visionMode !== 'normal'
  const observedMatrix = parseMatrixDataset(
    input.environment.colorMatrixDataset,
  )
  return Object.freeze([
    {
      id: 'measured-inner-viewport',
      passed:
        input.environment.innerWidth === input.viewport.width &&
        input.environment.innerHeight === input.viewport.height,
      actual: `${input.environment.innerWidth}x${input.environment.innerHeight}`,
      expected: `${input.viewport.width}x${input.viewport.height}`,
    },
    {
      id: 'measured-device-pixel-ratio',
      passed:
        Math.abs(
          input.environment.devicePixelRatio -
            input.viewport.deviceScaleFactor,
        ) <= 1e-9,
      actual: input.environment.devicePixelRatio,
      expected: input.viewport.deviceScaleFactor,
    },
    {
      id: 'measured-reduced-motion',
      passed:
        input.environment.prefersReducedMotion === input.reducedMotion,
      actual: input.environment.prefersReducedMotion,
      expected: input.reducedMotion,
    },
    {
      id: 'measured-vision-mode-dataset',
      passed: input.environment.visionModeDataset === input.visionMode,
      actual: input.environment.visionModeDataset,
      expected: input.visionMode,
    },
    {
      id: 'measured-color-matrix-dataset',
      passed: matricesEqual(observedMatrix, input.colorMatrix),
      actual: input.environment.colorMatrixDataset,
      expected: input.colorMatrix.join(' '),
    },
    {
      id: 'measured-computed-vision-filter',
      passed: transformedVision
        ? input.environment.computedFilter !== 'none' &&
          input.environment.computedFilter.includes('url(')
        : input.environment.computedFilter === 'none',
      actual: input.environment.computedFilter,
      expected: transformedVision ? 'url(...)' : 'none',
    },
    {
      id: 'measured-authoritative-seed',
      passed: input.observedSeed === input.seed,
      actual:
        typeof input.observedSeed === 'string' ||
        typeof input.observedSeed === 'number' ||
        typeof input.observedSeed === 'boolean'
          ? input.observedSeed
          : String(input.observedSeed),
      expected: input.seed,
    },
    {
      id: `measured-png-${input.screenshotMode}-pixel-size`,
      passed:
        input.artifact.width === expectedPngWidth &&
        input.artifact.height === expectedPngHeight,
      actual: `${input.artifact.width}x${input.artifact.height}`,
      expected: `${expectedPngWidth}x${expectedPngHeight}`,
    },
    {
      id: 'browser-audio-muted-by-launch-arg',
      passed: input.environment.audioMutedByBrowser,
      actual: input.environment.audioMutedByBrowser,
      expected: true,
    },
  ])
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

function requireNonEmpty(value: string, code: string): void {
  if (value.trim().length === 0) throw new Error(code)
}

function resolveArtifactPath(outputDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error('M5_VISUAL_EVIDENCE_PNG_PATH_INVALID')
  }
  const absoluteRoot = resolve(outputDirectory)
  const absolutePath = resolve(absoluteRoot, relativePath)
  const relativeToRoot = relative(absoluteRoot, absolutePath)
  if (
    relativeToRoot === '' ||
    relativeToRoot.startsWith('..') ||
    isAbsolute(relativeToRoot) ||
    !relativePath.toLowerCase().endsWith('.png')
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_PNG_PATH_INVALID')
  }
  return absolutePath
}

export function sha256M5VisualEvidence(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function inspectM5VisualEvidencePng(
  absolutePath: string,
): Readonly<{ width: number; height: number; sha256: string }> {
  const bytes = readFileSync(absolutePath)
  let png: PNG
  try {
    png = PNG.sync.read(bytes)
  } catch (error) {
    throw new Error('M5_VISUAL_EVIDENCE_PNG_INVALID', { cause: error })
  }
  return {
    width: png.width,
    height: png.height,
    sha256: sha256M5VisualEvidence(bytes),
  }
}

export function validateM5VisualEvidenceCaptureRecord(
  record: M5VisualEvidenceCaptureRecord,
  outputDirectory: string,
): void {
  requireNonEmpty(record.caseId, 'M5_VISUAL_EVIDENCE_METADATA_CASE_ID_MISSING')
  requireNonEmpty(record.capturedAt, 'M5_VISUAL_EVIDENCE_METADATA_CAPTURE_TIME_MISSING')
  if (record.context.domainEvents.length === 0) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_DOMAIN_EVENTS_MISSING')
  }
  requireNonEmpty(
    record.context.presentationState,
    'M5_VISUAL_EVIDENCE_METADATA_PRESENTATION_STATE_MISSING',
  )
  requireNonEmpty(record.context.build.runId, 'M5_VISUAL_EVIDENCE_METADATA_RUN_ID_MISSING')
  if (!isSha256(record.context.build.distSha256)) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_DIST_SHA256_INVALID')
  }
  if (!isSha256(record.context.fingerprints.simulation)) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_SIMULATION_FINGERPRINT_INVALID')
  }
  if (!isSha256(record.context.fingerprints.presentation)) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_PRESENTATION_FINGERPRINT_INVALID')
  }
  if (
    record.context.viewport.width < 1 ||
    record.context.viewport.height < 1 ||
    record.context.viewport.deviceScaleFactor <= 0
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_VIEWPORT_INVALID')
  }
  requireNonEmpty(record.context.browser.id, 'M5_VISUAL_EVIDENCE_METADATA_BROWSER_ID_MISSING')
  requireNonEmpty(record.context.browser.channel, 'M5_VISUAL_EVIDENCE_METADATA_BROWSER_CHANNEL_MISSING')
  requireNonEmpty(record.context.browser.version, 'M5_VISUAL_EVIDENCE_METADATA_BROWSER_VERSION_MISSING')
  requireNonEmpty(record.context.os.platform, 'M5_VISUAL_EVIDENCE_METADATA_OS_PLATFORM_MISSING')
  requireNonEmpty(record.context.os.release, 'M5_VISUAL_EVIDENCE_METADATA_OS_RELEASE_MISSING')
  requireNonEmpty(record.context.os.arch, 'M5_VISUAL_EVIDENCE_METADATA_OS_ARCH_MISSING')
  if (record.context.colorMatrix.length !== 20) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_COLOR_MATRIX_INVALID')
  }
  if (!Number.isSafeInteger(record.context.seed)) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_SEED_INVALID')
  }
  requireNonEmpty(record.context.sessionId, 'M5_VISUAL_EVIDENCE_METADATA_SESSION_MISSING')
  if (!Number.isSafeInteger(record.context.tick) || record.context.tick < 0) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_TICK_INVALID')
  }
  if (record.context.checks.length === 0) {
    throw new Error('M5_VISUAL_EVIDENCE_METADATA_CHECKS_MISSING')
  }
  if (!isSha256(record.artifact.sha256)) {
    throw new Error('M5_VISUAL_EVIDENCE_PNG_SHA256_INVALID')
  }
  const absolutePath = resolveArtifactPath(outputDirectory, record.artifact.relativePath)
  const inspected = inspectM5VisualEvidencePng(absolutePath)
  if (inspected.width !== record.artifact.width) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_PNG_WIDTH_MISMATCH:${record.artifact.width}:${inspected.width}`,
    )
  }
  if (inspected.height !== record.artifact.height) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_PNG_HEIGHT_MISMATCH:${record.artifact.height}:${inspected.height}`,
    )
  }
  if (inspected.sha256 !== record.artifact.sha256) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_PNG_SHA256_MISMATCH:${record.artifact.sha256}:${inspected.sha256}`,
    )
  }
  const environmentChecks = createM5VisualBrowserEnvironmentChecks({
    viewport: record.context.viewport,
    reducedMotion: record.context.reducedMotion,
    visionMode: record.context.visionMode,
    colorMatrix: record.context.colorMatrix,
    seed: record.context.seed,
    observedSeed: record.context.observableState?.seed,
    environment: record.context.environment,
    screenshotMode: record.context.screenshotMode,
    artifact: inspected,
  })
  const failedEnvironmentChecks = environmentChecks
    .filter(
      ({ id, passed }) =>
        !passed &&
        (record.kind !== 'contact-sheet' ||
          !id.startsWith('measured-png-')),
    )
    .map(({ id }) => id)
  if (failedEnvironmentChecks.length > 0) {
    throw new Error(
      `M5_VISUAL_EVIDENCE_ENVIRONMENT_MISMATCH:${failedEnvironmentChecks.join(',')}`,
    )
  }
}

export function createPendingM5VisualManualReview(): M5VisualManualReview {
  return Object.freeze({
    status: 'pending',
    independentReviewer: null,
    user: null,
    reviewedAt: null,
    notesZh: '',
  })
}

export function createM5VisualContactSheetContext(input: Readonly<{
  phaseId: 'startup' | 'steady' | 'release'
  sourceCaseIds: readonly string[]
  sources: readonly M5VisualEvidenceCaptureRecord[]
}>): M5VisualEvidenceCaptureContext {
  const lastSource = input.sources.at(-1)
  if (lastSource === undefined) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SOURCES_EMPTY')
  }
  return {
    ...lastSource.context,
    domainEvents: [
      ...new Set(
        input.sources.flatMap(({ context }) => context.domainEvents),
      ),
    ],
    presentationState: `contact-sheet/${input.phaseId}`,
    checks: [
      {
        id: 'all-configured-source-frames-present',
        passed: input.sources.length === input.sourceCaseIds.length,
        actual: input.sources.length,
        expected: input.sourceCaseIds.length,
      },
    ],
    observableState: {
      ...lastSource.context.observableState,
      phaseId: input.phaseId,
      sourceCaseIds: input.sourceCaseIds,
      configuredOffsetsMilliseconds: input.sources.map(
        ({ context }) => context.configuredSampleOffsetMilliseconds,
      ),
      actualOffsetsMilliseconds: input.sources.map(
        ({ context }) => context.actualSampleOffsetMilliseconds,
      ),
    },
  }
}

export function assertM5VisualManualReviewPending(review: unknown): void {
  const candidate = review as Partial<M5VisualManualReview> | null
  if (
    candidate === null ||
    candidate.status !== 'pending' ||
    candidate.independentReviewer !== null ||
    candidate.user !== null ||
    candidate.reviewedAt !== null ||
    candidate.notesZh !== ''
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_MANUAL_REVIEW_MUST_BE_PENDING')
  }
}

export function writeM5VisualEvidenceFileAtomically(
  targetPath: string,
  contents: string | Uint8Array,
): void {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, contents)
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function parseHexColor(color: string): readonly [number, number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SHEET_COLOR_INVALID')
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    255,
  ]
}

export function createM5VisualEvidenceContactSheet(
  sourcePaths: readonly string[],
  targetPath: string,
  options: Readonly<{ columns: number; gapPixels: number; backgroundColor: string }>,
): Readonly<{ width: number; height: number; sha256: string }> {
  if (sourcePaths.length === 0) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SHEET_SOURCE_EMPTY')
  }
  if (!Number.isSafeInteger(options.columns) || options.columns < 1) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SHEET_COLUMNS_INVALID')
  }
  if (!Number.isSafeInteger(options.gapPixels) || options.gapPixels < 0) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SHEET_GAP_INVALID')
  }
  const images = sourcePaths.map((path) => PNG.sync.read(readFileSync(path)))
  const tileWidth = images[0]!.width
  const tileHeight = images[0]!.height
  if (images.some(({ width, height }) => width !== tileWidth || height !== tileHeight)) {
    throw new Error('M5_VISUAL_EVIDENCE_CONTACT_SHEET_SOURCE_SIZE_MISMATCH')
  }
  const columns = Math.min(options.columns, images.length)
  const rows = Math.ceil(images.length / columns)
  const width = columns * tileWidth + (columns + 1) * options.gapPixels
  const height = rows * tileHeight + (rows + 1) * options.gapPixels
  const result = new PNG({ width, height })
  const background = parseHexColor(options.backgroundColor)
  for (let offset = 0; offset < result.data.length; offset += 4) {
    result.data[offset] = background[0]
    result.data[offset + 1] = background[1]
    result.data[offset + 2] = background[2]
    result.data[offset + 3] = background[3]
  }
  images.forEach((source, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    PNG.bitblt(
      source,
      result,
      0,
      0,
      source.width,
      source.height,
      options.gapPixels + column * (tileWidth + options.gapPixels),
      options.gapPixels + row * (tileHeight + options.gapPixels),
    )
  })
  writeM5VisualEvidenceFileAtomically(targetPath, PNG.sync.write(result))
  return inspectM5VisualEvidencePng(targetPath)
}

export async function runM5VisualEvidenceWithTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMilliseconds: number,
  errorCode: string,
  onLateResolve?: (value: T) => void | Promise<void>,
  lateCleanupRegistry?: M5VisualLateCleanupRegistry,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error('M5_VISUAL_EVIDENCE_TIMEOUT_INVALID')
  }
  if (onLateResolve !== undefined && lateCleanupRegistry === undefined) {
    throw new Error('M5_VISUAL_EVIDENCE_LATE_CLEANUP_REGISTRY_REQUIRED')
  }
  const operationPromise = Promise.resolve(operation)
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      if (onLateResolve !== undefined && lateCleanupRegistry !== undefined) {
        lateCleanupRegistry.register(
          errorCode,
          operationPromise.then(async (value) => onLateResolve(value)),
        )
      }
      rejectPromise(new Error(errorCode))
    }, timeoutMilliseconds)
    void operationPromise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectPromise(error)
      },
    )
  })
}

type M5VisualLateCleanupEntry = {
  readonly label: string
  settled: boolean
  error?: unknown
  readonly completion: Promise<void>
}

export type M5VisualLateCleanupRegistry = Readonly<{
  register: (label: string, cleanup: PromiseLike<void>) => void
  drain: (timeoutMilliseconds: number) => Promise<void>
}>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createM5VisualLateCleanupRegistry(): M5VisualLateCleanupRegistry {
  const entries: M5VisualLateCleanupEntry[] = []
  return {
    register(label, cleanup) {
      let entry: M5VisualLateCleanupEntry
      const completion = Promise.resolve(cleanup).then(
        () => {
          entry.settled = true
        },
        (error: unknown) => {
          entry.error = error
          entry.settled = true
        },
      )
      entry = { label, settled: false, completion }
      entries.push(entry)
    },
    async drain(timeoutMilliseconds) {
      if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
        throw new Error('M5_VISUAL_EVIDENCE_LATE_CLEANUP_TIMEOUT_INVALID')
      }
      const pending = entries.filter(({ settled }) => !settled)
      if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timedOut = await Promise.race([
          Promise.all(pending.map(({ completion }) => completion)).then(
            () => false,
          ),
          new Promise<true>((resolvePromise) => {
            timer = setTimeout(() => resolvePromise(true), timeoutMilliseconds)
          }),
        ])
        if (timer !== undefined) clearTimeout(timer)
        if (timedOut) {
          const labels = entries
            .filter(({ settled }) => !settled)
            .map(({ label }) => label)
          throw new Error(
            `M5_VISUAL_EVIDENCE_LATE_CLEANUP_DRAIN_TIMEOUT:${labels.join(',')}`,
          )
        }
      }
      const failures = entries
        .filter(({ error }) => error !== undefined)
        .map(
          ({ label, error }) =>
            new Error(
              `M5_VISUAL_EVIDENCE_LATE_CLEANUP_FAILED:${label}:${errorMessage(error)}`,
              { cause: error },
            ),
        )
      entries.splice(0, entries.length)
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          failures.map(({ message }) => message).join(';'),
        )
      }
    },
  }
}

export async function drainM5VisualLateCleanupRegistry(
  registry: M5VisualLateCleanupRegistry,
  timeoutMilliseconds: number,
): Promise<void> {
  await registry.drain(timeoutMilliseconds)
}
