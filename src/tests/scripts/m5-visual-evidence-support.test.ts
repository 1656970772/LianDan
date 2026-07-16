import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { PNG } from 'pngjs'
import { afterEach, describe, expect, test } from 'vitest'

import {
  assertM5VisualFailureCaptureSequence,
  assertM5VisualEvidenceCellCoverage,
  assertM5VisualManualReviewPending,
  assertM5MaterialEvidenceTargetMatchesContentCenter,
  acquireM5VisualClockPause,
  alignM5VisualCollector,
  captureM5VisualFailurePhaseWithClock,
  captureM5VisualTransientWithClock,
  createM5MaterialFireRayFrame,
  createM5VisualBrowserEnvironmentChecks,
  createM5VisualContactSheetContext,
  createM5VisualEvidenceContactSheet,
  createM5VisualFailurePhaseChecks,
  createM5VisualFirePhaseChecks,
  createM5VisualLayoutChecks,
  createM5VisualMaterialPairBoundaryChecks,
  createM5VisualMaterialTopologyBoundaryChecks,
  createM5VisualWarningBoundaryChecks,
  createM5VisualLateCleanupRegistry,
  classifyM5MaterialTopology,
  createPendingM5VisualManualReview,
  drainM5VisualLateCleanupRegistry,
  expandM5VisualEvidenceMatrix,
  hasM5MaterialTopologyStopAuthority,
  m5VisualMaterialPlacementsHaveInteriorIntersection,
  parseAndValidateM5VisualEvidenceFixtureJson,
  runM5VisualEvidenceWithTimeout,
  requiresM5VisualContextQuarantine,
  targetFailureProgress,
  validateM5VisualEvidenceCaptureRecord,
  validateM5VisualEvidenceFixtureSemantics,
  M5_VISUAL_LAYOUT_CORE_CONTROLS,
  type M5VisualEvidenceCaptureRecord,
  type M5VisualLayoutObservation,
} from '../../../scripts/m5-visual-evidence-support.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const temporaryDirectories: string[] = []
const topologyShapeThresholds = Object.freeze({
  deepPenetrationMinimum: 0.35,
  narrowLateralCoverageMaximum: 0.45,
  shallowPenetrationMaximum: 0.28,
  wideLateralCoverageMinimum: 0.45,
  targetLateralRatio: 0.5,
  targetCorridorHalfWidthRatio: 0.25,
  maximumCenterOffsetRatio: 0.2,
  minimumThroughDepthSpanRatio: 0.5,
})

const topologyPartialFront = Object.freeze({
  lateralBinCount: 9,
  minimumCellErosionRatio: 0.1,
  minimumActiveLaneErosionRatio: 0.1,
  lateralCoverageQuantile: 0.9,
  minimumMeaningfulComponentCellCount: 4,
})

function loadFixture() {
  return parseAndValidateM5VisualEvidenceFixtureJson(
    readFileSync(
      resolve(
        repositoryRoot,
        'public',
        'config',
        'evidence',
        'm5-visual-matrix.json',
      ),
      'utf8',
    ),
    readFileSync(
      resolve(
        repositoryRoot,
        'schemas',
        'config',
        'm5-visual-evidence.schema.json',
      ),
      'utf8',
    ),
  )
}

function loadMutableFixture(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        'public',
        'config',
        'evidence',
        'm5-visual-matrix.json',
      ),
      'utf8',
    ),
  ) as Record<string, any>
}

function schemaSource(): string {
  return readFileSync(
    resolve(
      repositoryRoot,
      'schemas',
      'config',
      'm5-visual-evidence.schema.json',
    ),
    'utf8',
  )
}

function runnerSource(): string {
  return readFileSync(
    resolve(repositoryRoot, 'scripts', 'run-m5-visual-evidence.ts'),
    'utf8',
  )
}

function supportSource(): string {
  return readFileSync(
    resolve(repositoryRoot, 'scripts', 'm5-visual-evidence-support.ts'),
    'utf8',
  )
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'liandan-m5-evidence-'))
  temporaryDirectories.push(directory)
  return directory
}

function createQuantizedCollectorDriver(
  collectorStart: number,
  materialCenterX: number,
  options: Readonly<{
    movementEnabled?: boolean
    oneFeedbackPollCrossesTwoTicks?: boolean
  }> = {},
) {
  const fixedDeltaSeconds = 1 / 30
  const fixedDeltaMilliseconds = 1_000 / 30
  let collectorCenterX = collectorStart
  let velocityX = 0
  let tick = 0
  let now = 0
  let activeKey: string | null = null
  let injectTwoTicks = options.oneFeedbackPollCrossesTwoTicks === true
  const trace: Array<Readonly<{ x: number; velocityX: number; tick: number }>> = []
  const advanceTick = (): void => {
    tick += 1
    const axis =
      options.movementEnabled === false || activeKey === null
        ? 0
        : activeKey === 'a'
          ? -1
          : activeKey === 'd'
            ? 1
            : 0
    if (axis !== 0) velocityX += axis * 1_200 * fixedDeltaSeconds
    else if (Math.abs(velocityX) <= 1_600 * fixedDeltaSeconds) velocityX = 0
    else velocityX -= Math.sign(velocityX) * 1_600 * fixedDeltaSeconds
    velocityX = Math.max(-500, Math.min(500, velocityX))
    collectorCenterX += velocityX * fixedDeltaSeconds
  }
  return {
    readPosition: async () => {
      trace.push({ x: collectorCenterX, velocityX, tick })
      return { collectorCenterX, materialCenterX, velocityX, tick }
    },
    focus: async () => undefined,
    keyDown: async (key: string) => {
      activeKey = key
    },
    keyUp: async () => {
      activeKey = null
    },
    waitForMilliseconds: async (milliseconds: number) => {
      let ticks = Math.ceil(milliseconds / fixedDeltaMilliseconds)
      if (
        injectTwoTicks &&
        activeKey !== null &&
        milliseconds <= 20 &&
        Math.abs(collectorCenterX - 603.3333333333) < 0.05
      ) {
        ticks = Math.max(2, ticks)
        injectTwoTicks = false
      }
      for (let index = 0; index < ticks; index += 1) advanceTick()
      now += ticks * fixedDeltaMilliseconds
    },
    now: () => now,
    trace,
    isReleased: () => activeKey === null,
  }
}

function createLayoutObservation(): M5VisualLayoutObservation {
  return {
    hasCore: true,
    stageContainsCanvas: true,
    horizontalOverflow: false,
    scrollHeight: 1_100,
    innerWidth: 900,
    innerHeight: 700,
    maximumScrollY: 400,
    observedMaximumScrollY: 400,
    controls: M5_VISUAL_LAYOUT_CORE_CONTROLS.map(({ id }) => ({
      id,
      matchCount: 1,
      visibleCount: 1,
      nonZeroRectCount: 1,
      reachableCount: 1,
      hitTestCount: 1,
      clippedByAncestorCount: 0,
      disabledCount: id === 'finish' ? 1 : 0,
    })),
  }
}

function coreLayoutCheck(measured: M5VisualLayoutObservation) {
  return createM5VisualLayoutChecks({
    viewport: { width: 900, height: 700, deviceScaleFactor: 1 },
    narrowMaximumWidth: 950,
    measured,
  }).find(
    ({ id }) => id === 'core-controls-visible-nonzero-scroll-reachable',
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('M5 正式视觉证据支撑层', () => {
  test('完整展开固定矩阵且每格 ID 唯一', () => {
    const cells = expandM5VisualEvidenceMatrix(loadFixture())

    expect(cells).toHaveLength(64)
    expect(new Set(cells.map(({ id }) => id)).size).toBe(cells.length)
    expect(cells.filter(({ section }) => section === 'layout')).toHaveLength(7)
    expect(cells.filter(({ section }) => section === 'fire')).toHaveLength(24)
    expect(cells.filter(({ section }) => section === 'coverage')).toHaveLength(9)
    expect(
      cells.filter(({ section }) => section === 'accessibility'),
    ).toHaveLength(12)
    expect(cells.filter(({ section }) => section === 'failure')).toHaveLength(12)
    expect(cells).toContainEqual({
      id: 'coverage/material-pair-non-overlap',
      section: 'coverage',
      kind: 'coverage-frame',
      expectedStatus: 'capture',
    })
  })

  test('证据层独立四轴 SAT 允许触边并拒绝 OBB 内部交集，且不修改 placement', () => {
    const left = {
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      rotationRadians: Math.PI / 8,
      layer: 0,
    }
    const touching = {
      center: {
        x: Math.cos(Math.PI / 8) * 2,
        y: Math.sin(Math.PI / 8) * 2,
      },
      width: 2,
      height: 2,
      rotationRadians: Math.PI / 8,
      layer: 1,
    }
    const overlapping = {
      ...touching,
      center: {
        x: Math.cos(Math.PI / 8) * 1.99,
        y: Math.sin(Math.PI / 8) * 1.99,
      },
    }
    const separated = {
      ...touching,
      center: {
        x: Math.cos(Math.PI / 8) * 2.01,
        y: Math.sin(Math.PI / 8) * 2.01,
      },
    }
    const before = JSON.stringify({ left, touching, overlapping, separated })

    expect(
      m5VisualMaterialPlacementsHaveInteriorIntersection(left, touching, 1e-9),
    ).toBe(false)
    expect(
      m5VisualMaterialPlacementsHaveInteriorIntersection(left, overlapping, 1e-9),
    ).toBe(true)
    expect(
      m5VisualMaterialPlacementsHaveInteriorIntersection(left, separated, 1e-9),
    ).toBe(false)
    expect(JSON.stringify({ left, touching, overlapping, separated })).toBe(
      before,
    )
  })

  test('双材料证据用真实内容 OBB，透明 full frame 相交不误报且向内 1e-6 会失败', () => {
    const materials = [
      {
        materialInstanceId: 'material-1',
        materialDefinitionId: 'red_whisker_ginseng',
        inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
        placement: {
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          rotationRadians: 0,
          layer: 0,
        },
        contentPlacement: {
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          rotationRadians: 0,
          layer: 0,
        },
        initialVolume: 10,
        remainingVolume: 10,
        initialGridSha256: 'a'.repeat(64),
        remainingGridSha256: 'a'.repeat(64),
        initialNonEmptyCellCount: 100,
        remainingNonEmptyCellCount: 100,
      },
      {
        materialInstanceId: 'material-2',
        materialDefinitionId: 'azure_dew_leaf',
        inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
        placement: {
          center: { x: 2, y: 0 },
          width: 4,
          height: 4,
          rotationRadians: 0,
          layer: 1,
        },
        contentPlacement: {
          center: { x: 1, y: 0 },
          width: 1,
          height: 1,
          rotationRadians: 0,
          layer: 1,
        },
        initialVolume: 3,
        remainingVolume: 3,
        initialGridSha256: 'b'.repeat(64),
        remainingGridSha256: 'b'.repeat(64),
        initialNonEmptyCellCount: 80,
        remainingNonEmptyCellCount: 80,
      },
    ]
    const before = {
      sessionId: 'session-content-obb',
      tick: 10,
      equippedFireSourceId: null,
      isSpraying: false,
      firePresentationState: 'off',
      fireVisualIntensity: 0,
      activePearlCount: 0,
      audioMuted: true,
      materials,
    }
    const expectedMaterials = materials.map(
      ({ materialDefinitionId, inventoryBatchId }) => ({
        materialDefinitionId,
        inventoryBatchId,
      }),
    )
    const noOverlap = createM5VisualMaterialPairBoundaryChecks({
      expectedMaterials,
      epsilon: 1e-9,
      before,
      after: structuredClone(before),
    }).find(({ id }) => id === 'material-pair-no-interior-overlap-before')
    expect(noOverlap).toMatchObject({ passed: true })

    const overlapping = structuredClone(before)
    overlapping.materials[1]!.contentPlacement.center.x -= 1e-6
    const realContentOverlap = createM5VisualMaterialPairBoundaryChecks({
      expectedMaterials,
      epsilon: 1e-9,
      before: overlapping,
      after: structuredClone(overlapping),
    }).find(({ id }) => id === 'material-pair-no-interior-overlap-before')
    expect(realContentOverlap).toMatchObject({ passed: false })
  })

  test('双材料截图边界要求恰两份、互异身份、未烧蚀、无内部交集且前后稳定', () => {
    const materials = [
      {
        materialInstanceId: 'material-1',
        materialDefinitionId: 'red_whisker_ginseng',
        inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
        placement: {
          center: { x: 500, y: 300 },
          width: 120,
          height: 80,
          rotationRadians: 0,
          layer: 0,
        },
        contentPlacement: {
          center: { x: 500, y: 300 },
          width: 120,
          height: 80,
          rotationRadians: 0,
          layer: 0,
        },
        initialVolume: 10,
        remainingVolume: 10,
        initialGridSha256: 'a'.repeat(64),
        remainingGridSha256: 'a'.repeat(64),
        initialNonEmptyCellCount: 100,
        remainingNonEmptyCellCount: 100,
      },
      {
        materialInstanceId: 'material-2',
        materialDefinitionId: 'azure_dew_leaf',
        inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
        placement: {
          center: { x: 620, y: 300 },
          width: 120,
          height: 80,
          rotationRadians: 0,
          layer: 1,
        },
        contentPlacement: {
          center: { x: 620, y: 300 },
          width: 120,
          height: 80,
          rotationRadians: 0,
          layer: 1,
        },
        initialVolume: 3,
        remainingVolume: 3,
        initialGridSha256: 'b'.repeat(64),
        remainingGridSha256: 'b'.repeat(64),
        initialNonEmptyCellCount: 80,
        remainingNonEmptyCellCount: 80,
      },
    ]
    const before = {
      sessionId: 'session-1',
      tick: 10,
      equippedFireSourceId: null,
      isSpraying: false,
      firePresentationState: 'off',
      fireVisualIntensity: 0,
      activePearlCount: 0,
      audioMuted: true,
      materials,
    }
    const checks = createM5VisualMaterialPairBoundaryChecks({
      expectedMaterials: [
        {
          materialDefinitionId: 'red_whisker_ginseng',
          inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
        },
        {
          materialDefinitionId: 'azure_dew_leaf',
          inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
        },
      ],
      epsilon: 1e-9,
      before,
      after: structuredClone(before),
    })
    expect(checks.every(({ passed }) => passed)).toBe(true)

    const overlapping = structuredClone(before)
    overlapping.materials[1]!.contentPlacement.center.x = 619
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            materialDefinitionId: 'red_whisker_ginseng',
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
          },
          {
            materialDefinitionId: 'azure_dew_leaf',
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
          },
        ],
        epsilon: 1e-9,
        before: overlapping,
        after: structuredClone(overlapping),
      }).find(({ id }) => id === 'material-pair-no-interior-overlap-before'),
    ).toMatchObject({ passed: false })
  })

  test('双材料正式记录允许规则内自然损耗且身份校验不依赖对象键序', () => {
    const formalObservation = {
      sessionId: 'session-000001',
      tick: 10,
      equippedFireSourceId: null,
      isSpraying: false,
      firePresentationState: 'off',
      fireVisualIntensity: 0,
      activePearlCount: 0,
      audioMuted: true,
      materials: [
        {
          materialInstanceId: 'material-instance-1',
          materialDefinitionId: 'red_whisker_ginseng',
          inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
          placement: {
            center: { x: 600, y: 285 },
            width: 160,
            height: 160,
            rotationRadians: 0,
            layer: 0,
          },
          contentPlacement: {
            center: { x: 600, y: 285 },
            width: 115,
            height: 127.5,
            rotationRadians: 0,
            layer: 0,
          },
          initialVolume: 300,
          remainingVolume: 299.9958334374978,
          initialGridSha256:
            '071db7a57a693cc807c392c507ff51cdebda676193939387c999998ab8b3e9a7',
          remainingGridSha256:
            '48e815f00dc2a310484069067bcd6cbc3e9abe606c2c4cbde16d2b921bcfbc54',
          initialNonEmptyCellCount: 948,
          remainingNonEmptyCellCount: 948,
        },
        {
          materialInstanceId: 'material-instance-2',
          materialDefinitionId: 'azure_dew_leaf',
          inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
          placement: {
            center: { x: 760, y: 285 },
            width: 160,
            height: 160,
            rotationRadians: 0,
            layer: 1,
          },
          contentPlacement: {
            center: { x: 760, y: 285 },
            width: 95,
            height: 150,
            rotationRadians: 0,
            layer: 1,
          },
          initialVolume: 300,
          remainingVolume: 299.9958302786233,
          initialGridSha256:
            '2251e27e83f02c406e2373f8e98b3357bf6e11a4ce7f0a5af87cfc09bf32f095',
          remainingGridSha256:
            '18462c18f5383d171ac680aac04771000c98f109a117e20839c984dc57aeaa5d',
          initialNonEmptyCellCount: 1319,
          remainingNonEmptyCellCount: 1319,
        },
      ],
    }

    const checks = createM5VisualMaterialPairBoundaryChecks({
      expectedMaterials: [
        {
          inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
          materialDefinitionId: 'red_whisker_ginseng',
        },
        {
          inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
          materialDefinitionId: 'azure_dew_leaf',
        },
      ],
      epsilon: 1e-6,
      before: formalObservation,
      after: structuredClone(formalObservation),
    })

    expect(
      checks
        .filter(({ passed }) => !passed)
        .map(({ id }) => id),
    ).toEqual([])

    const withActiveFire = structuredClone(formalObservation)
    withActiveFire.fireVisualIntensity = 0.01
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
            materialDefinitionId: 'red_whisker_ginseng',
          },
          {
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
            materialDefinitionId: 'azure_dew_leaf',
          },
        ],
        epsilon: 1e-6,
        before: withActiveFire,
        after: structuredClone(withActiveFire),
      }).find(({ id }) => id === 'material-pair-fire-inactive-before'),
    ).toMatchObject({ passed: false })

    const withInvalidVolume = structuredClone(formalObservation)
    withInvalidVolume.materials[0]!.remainingVolume = 301
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
            materialDefinitionId: 'red_whisker_ginseng',
          },
          {
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
            materialDefinitionId: 'azure_dew_leaf',
          },
        ],
        epsilon: 1e-6,
        before: withInvalidVolume,
        after: structuredClone(withInvalidVolume),
      }).find(({ id }) => id === 'material-pair-volume-uneroded-before'),
    ).toMatchObject({ passed: false })

    const withEmptyVolume = structuredClone(formalObservation)
    withEmptyVolume.materials[0]!.remainingVolume = 0
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
            materialDefinitionId: 'red_whisker_ginseng',
          },
          {
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
            materialDefinitionId: 'azure_dew_leaf',
          },
        ],
        epsilon: 1e-6,
        before: withEmptyVolume,
        after: structuredClone(withEmptyVolume),
      }).find(({ id }) => id === 'material-pair-volume-uneroded-before'),
    ).toMatchObject({ passed: false })

    const withMissingCell = structuredClone(formalObservation)
    withMissingCell.materials[0]!.remainingNonEmptyCellCount -= 1
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
            materialDefinitionId: 'red_whisker_ginseng',
          },
          {
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
            materialDefinitionId: 'azure_dew_leaf',
          },
        ],
        epsilon: 1e-6,
        before: withMissingCell,
        after: structuredClone(withMissingCell),
      }).find(({ id }) => id === 'material-pair-grid-uneroded-before'),
    ).toMatchObject({ passed: false })

    const afterWithTopologyDrift = structuredClone(formalObservation)
    afterWithTopologyDrift.materials[0]!.remainingVolume -= 0.001
    afterWithTopologyDrift.materials[0]!.remainingGridSha256 = 'f'.repeat(64)
    expect(
      createM5VisualMaterialPairBoundaryChecks({
        expectedMaterials: [
          {
            inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
            materialDefinitionId: 'red_whisker_ginseng',
          },
          {
            inventoryBatchId: 'azure_dew_leaf_fresh_cultivated_3',
            materialDefinitionId: 'azure_dew_leaf',
          },
        ],
        epsilon: 1e-6,
        before: formalObservation,
        after: afterWithTopologyDrift,
      }).find(
        ({ id }) =>
          id === 'material-pair-topology-stable-across-screenshot',
      ),
    ).toMatchObject({ passed: false })
  })

  test('材料拓扑 classifier 区分深窄、浅宽与未烧空的贯通侵蚀，且不修改输入', () => {
    const width = 7
    const height = 7
    const initial = Array.from({ length: width * height }, () => 1)
    const classify = (emptyCells: readonly [number, number][]) => {
      const remaining = [...initial]
      for (const [x, y] of emptyCells) remaining[y * width + x] = 0
      const before = JSON.stringify({ initial, remaining })
      const result = classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: {
          ...topologyShapeThresholds,
          deepPenetrationMinimum: 5 / 7,
          narrowLateralCoverageMaximum: 2 / 7,
          shallowPenetrationMaximum: 2 / 7,
          wideLateralCoverageMinimum: 5 / 7,
        },
      })
      expect(JSON.stringify({ initial, remaining })).toBe(before)
      return result
    }

    const deepNarrow = classify([
      [3, 6],
      [3, 5],
      [3, 4],
      [3, 3],
      [3, 2],
    ])
    expect(deepNarrow.classification).toBe('deep-narrow')
    expect(deepNarrow.sourceErosionComponentCount).toBe(1)
    expect(deepNarrow.throughConnected).toBe(false)

    const shallowWide = classify([
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
    ])
    expect(shallowWide.classification).toBe('shallow-wide')
    expect(shallowWide.lateralCoverageRatio).toBeCloseTo(6 / 7)

    const through = classify([
      [3, 6],
      [3, 5],
      [3, 4],
      [3, 3],
      [3, 2],
      [3, 1],
      [3, 0],
    ])
    expect(through.classification).toBe('through-not-empty')
    expect(through.sourceBoundaryReached).toBe(true)
    expect(through.farBoundaryReached).toBe(true)
    expect(through.throughConnected).toBe(true)
    expect(through.remainingRatio).toBeGreaterThan(0)
  })

  test('材料拓扑 classifier 以初始 occupied silhouette 为边界而非矩形外框', () => {
    const initial = [
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 1, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
    ]
    const remaining = [...initial]
    remaining[2] = 0
    remaining[7] = 0
    remaining[12] = 0
    remaining[17] = 0
    const result = classifyM5MaterialTopology({
      gridWidth: 5,
      gridHeight: 5,
      initialCellVolumes: initial,
      remainingCellVolumes: remaining,
      sourceEdge: 'top',
      epsilon: 1e-9,
      shapeThresholds: {
        ...topologyShapeThresholds,
        deepPenetrationMinimum: 0.7,
        narrowLateralCoverageMaximum: 0.5,
        shallowPenetrationMaximum: 0.3,
        wideLateralCoverageMinimum: 0.7,
      },
    })
    expect(result.throughConnected).toBe(true)
    expect(result.penetrationRatio).toBe(1)
    expect(result.occupiedCellCount).toBe(8)
  })

  test('材料拓扑按有效 lane 深度归一贯通主组件，且不放过近源、偏心、薄 lane 与断连边界', () => {
    const width = 7
    const height = 7
    const initial = Array.from({ length: width * height }, () => 0)
    for (let y = 0; y < height; y += 1) initial[y * width] = 1
    for (let y = 1; y < height; y += 1) initial[y * width + 3] = 1
    const classify = (emptyCells: readonly [number, number][]) => {
      const remaining = [...initial]
      for (const [x, y] of emptyCells) remaining[y * width + x] = 0
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      })
    }

    const centeredThrough = classify(
      Array.from({ length: 6 }, (_, index) => [3, index + 1] as const),
    )
    expect(centeredThrough).toMatchObject({
      classification: 'through-not-empty',
      farBoundaryReached: true,
      throughConnected: true,
      penetrationRatio: 1,
      primaryComponentDepthSpanRatio: 1,
    })

    const nearSource = classify([[3, 6], [3, 5]])
    expect(nearSource.throughConnected).toBe(false)
    expect(nearSource.penetrationRatio).toBeCloseTo(2 / 6)

    const offCenterThrough = classify(
      Array.from({ length: 7 }, (_, y) => [0, y] as const),
    )
    expect(offCenterThrough.throughConnected).toBe(false)
    expect(offCenterThrough.classification).toBe('intermediate')

    const disconnected = classify([[3, 6], [3, 5], [3, 2], [3, 1]])
    expect(disconnected.throughConnected).toBe(false)

    const thinInitial = Array.from({ length: width * height }, () => 0)
    for (let y = 0; y < height; y += 1) thinInitial[y * width] = 1
    for (let x = 0; x < width; x += 1) {
      thinInitial[(height - 1) * width + x] = 1
    }
    const thinRemaining = [...thinInitial]
    thinRemaining[(height - 1) * width + 3] = 0
    const thinLane = classifyM5MaterialTopology({
      gridWidth: width,
      gridHeight: height,
      initialCellVolumes: thinInitial,
      remainingCellVolumes: thinRemaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
    })
    expect(thinLane.throughConnected).toBe(false)
    expect(thinLane.classification).toBe('intermediate')
    expect(thinLane.penetrationRatio).toBeCloseTo(1 / 7)
  })

  test('材料拓扑优先选择满足中心偏移上限的真实贯通组件，而非更居中的 tiny source 组件', () => {
    const width = 11
    const height = 7
    const initial = Array.from({ length: width * height }, () => 1)
    const remaining = [...initial]
    remaining[6 * width + 5] = 0
    for (let y = 0; y < height; y += 1) remaining[y * width + 3] = 0

    const result = classifyM5MaterialTopology({
      gridWidth: width,
      gridHeight: height,
      initialCellVolumes: initial,
      remainingCellVolumes: remaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
    })

    expect(result).toMatchObject({
      classification: 'through-not-empty',
      throughConnected: true,
      farBoundaryReached: true,
      penetrationRatio: 1,
      primaryComponentCellCount: 7,
    })
    expect(result.primaryComponentCenterOffsetRatio).toBeLessThanOrEqual(
      topologyShapeThresholds.maximumCenterOffsetRatio,
    )
  })

  test('材料拓扑 classifier 按单一主组件拒绝薄须、偏心深槽和离散浅坑', () => {
    const thinInitial = Array.from({ length: 25 }, () => 0)
    for (let y = 1; y < 5; y += 1) {
      for (let x = 1; x < 4; x += 1) thinInitial[y * 5 + x] = 1
    }
    thinInitial[20] = 1
    const thinRemaining = [...thinInitial]
    thinRemaining[20] = 0
    const thinSpur = classifyM5MaterialTopology({
      gridWidth: 5,
      gridHeight: 5,
      initialCellVolumes: thinInitial,
      remainingCellVolumes: thinRemaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
    })
    expect(thinSpur.classification).toBe('intermediate')
    expect(thinSpur.throughConnected).toBe(false)

    const rectangle = Array.from({ length: 49 }, () => 1)
    const offCenterRemaining = [...rectangle]
    for (let y = 3; y < 7; y += 1) offCenterRemaining[y * 7] = 0
    const offCenter = classifyM5MaterialTopology({
      gridWidth: 7,
      gridHeight: 7,
      initialCellVolumes: rectangle,
      remainingCellVolumes: offCenterRemaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
    })
    expect(offCenter.classification).toBe('intermediate')

    const scatteredRemaining = [...rectangle]
    for (const x of [0, 2, 4, 6]) scatteredRemaining[42 + x] = 0
    const scattered = classifyM5MaterialTopology({
      gridWidth: 7,
      gridHeight: 7,
      initialCellVolumes: rectangle,
      remainingCellVolumes: scatteredRemaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
    })
    expect(scattered.sourceErosionComponentCount).toBe(4)
    expect(scattered.classification).toBe('intermediate')
  })

  test('材料拓扑 classifier 四向浅宽分类同样要求主组件中心偏移合格', () => {
    const width = 7
    const height = 7
    const initial = Array.from({ length: width * height }, () => 1)
    const sourceCells = (
      sourceEdge: 'top' | 'right' | 'bottom' | 'left',
      lanes: readonly number[],
    ): readonly number[] =>
      lanes.map((lane) => {
        if (sourceEdge === 'top') return lane
        if (sourceEdge === 'bottom') return (height - 1) * width + lane
        if (sourceEdge === 'left') return lane * width
        return lane * width + width - 1
      })
    const classify = (
      sourceEdge: 'top' | 'right' | 'bottom' | 'left',
      lanes: readonly number[],
    ) => {
      const remaining = [...initial]
      for (const index of sourceCells(sourceEdge, lanes)) remaining[index] = 0
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge,
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      })
    }

    for (const sourceEdge of ['top', 'right', 'bottom', 'left'] as const) {
      const offCenter = classify(sourceEdge, [0, 1, 2, 3])
      expect(offCenter.primaryComponentWithinTargetCorridor).toBe(true)
      expect(offCenter.primaryComponentCenterOffsetRatio).toBeGreaterThan(
        topologyShapeThresholds.maximumCenterOffsetRatio,
      )
      expect(offCenter.classification).toBe('intermediate')

      expect(classify(sourceEdge, [1, 2, 3, 4]).classification).toBe(
        'shallow-wide',
      )
    }
  })

  test('材料拓扑 classifier 显式拒绝缺阈值、NaN、非法关系与非法 source edge', () => {
    const base = {
      gridWidth: 7,
      gridHeight: 7,
      initialCellVolumes: Array.from({ length: 49 }, () => 1),
      remainingCellVolumes: Array.from({ length: 49 }, () => 1),
      sourceEdge: 'bottom' as const,
      epsilon: 1e-9,
    }
    for (const key of Object.keys(topologyShapeThresholds)) {
      const thresholds = { ...topologyShapeThresholds } as Record<string, number>
      delete thresholds[key]
      expect(() =>
        classifyM5MaterialTopology({
          ...base,
          shapeThresholds: thresholds as typeof topologyShapeThresholds,
        }),
      ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_THRESHOLDS_INVALID')
    }
    for (const shapeThresholds of [
      { ...topologyShapeThresholds, deepPenetrationMinimum: Number.NaN },
      {
        ...topologyShapeThresholds,
        deepPenetrationMinimum: 0.2,
        shallowPenetrationMaximum: 0.4,
      },
      {
        ...topologyShapeThresholds,
        narrowLateralCoverageMaximum: 0.6,
        wideLateralCoverageMinimum: 0.5,
      },
      {
        ...topologyShapeThresholds,
        maximumCenterOffsetRatio: 0.4,
        targetCorridorHalfWidthRatio: 0.25,
      },
    ]) {
      expect(() =>
        classifyM5MaterialTopology({ ...base, shapeThresholds }),
      ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_THRESHOLDS_INVALID')
    }
    expect(() =>
      classifyM5MaterialTopology({
        ...base,
        sourceEdge: 'diagonal' as typeof base.sourceEdge,
        shapeThresholds: topologyShapeThresholds,
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_INPUT_INVALID')
  })

  test('材料拓扑 classifier 保留四向真实贯通、全空与 partial 边界', () => {
    for (const sourceEdge of ['top', 'right', 'bottom', 'left'] as const) {
      const initial = Array.from({ length: 25 }, () => 1)
      const remaining = [...initial]
      for (let index = 0; index < 5; index += 1) {
        const cell =
          sourceEdge === 'top' || sourceEdge === 'bottom'
            ? index * 5 + 2
            : 2 * 5 + index
        remaining[cell] = 0
      }
      expect(
        classifyM5MaterialTopology({
          gridWidth: 5,
          gridHeight: 5,
          initialCellVolumes: initial,
          remainingCellVolumes: remaining,
          sourceEdge,
          epsilon: 1e-9,
          shapeThresholds: topologyShapeThresholds,
        }),
      ).toMatchObject({
        classification: 'through-not-empty',
        throughConnected: true,
        penetrationRatio: 1,
      })
    }

    expect(() =>
      classifyM5MaterialTopology({
        gridWidth: 2,
        gridHeight: 2,
        initialCellVolumes: [0, 0, 0, 0],
        remainingCellVolumes: [0, 0, 0, 0],
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      }),
    ).toThrow(/M5_VISUAL_EVIDENCE_MATERIAL_TOPOLOGY_EMPTY_INITIAL/)
    expect(
      classifyM5MaterialTopology({
        gridWidth: 2,
        gridHeight: 2,
        initialCellVolumes: [1, 1, 1, 1],
        remainingCellVolumes: [0, 0, 0, 0],
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      }).classification,
    ).toBe('through-empty')
    expect(
      classifyM5MaterialTopology({
        gridWidth: 2,
        gridHeight: 2,
        initialCellVolumes: [1, 1, 1, 1],
        remainingCellVolumes: [0.5, 0.5, 0.5, 0.5],
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      }).classification,
    ).toBe('intermediate')
  })

  test('binary through 只接受四邻接，对角溶解链不冒充贯通', () => {
    const width = 5
    const height = 5
    const initial = Array.from({ length: width * height }, () => 1)
    const remaining = [...initial]
    for (const [x, y] of [
      [4, 4], [3, 3], [2, 2], [1, 1], [0, 0],
    ] as const) {
      remaining[y * width + x] = 0
    }
    expect(
      classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      }),
    ).toMatchObject({
      classification: 'intermediate',
      throughConnected: false,
    })
  })

  test('真实赤须参 mask 的一格和三格薄 lane 不冒充贯通', () => {
    const png = PNG.sync.read(
      readFileSync(
        resolve(
          repositoryRoot,
          'public',
          'assets',
          'masks',
          'red_whisker_ginseng-components.png',
        ),
      ),
    )
    const initial = Array.from({ length: png.width * png.height }, (_, index) =>
      png.data[index * 4 + 3]! > 0 ? 1 : 0,
    )
    for (const cells of [
      [[52, 31]],
      [[9, 34], [9, 35], [9, 36]],
    ] as const) {
      const remaining = [...initial]
      for (const [x, y] of cells) remaining[y * png.width + x] = 0
      const result = classifyM5MaterialTopology({
        gridWidth: png.width,
        gridHeight: png.height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
      })
      expect(result.classification).toBe('intermediate')
      expect(result.throughConnected).toBe(false)
    }
  })

  test('真实火焰射线按材料旋转推导四向入射边，并拒绝配置 sourceEdge 与射线不一致', () => {
    const placement = {
      center: { x: 600, y: 285 },
      width: 160,
      height: 160,
      rotationRadians: 0,
    }
    const ray = {
      origin: { x: 800, y: 700 },
      target: { x: 600, y: 285 },
    }
    expect(createM5MaterialFireRayFrame({ placement, ray }).sourceEdge).toBe(
      'bottom',
    )
    expect(
      createM5MaterialFireRayFrame({
        placement: { ...placement, rotationRadians: Math.PI / 2 },
        ray,
      }).sourceEdge,
    ).toBe('right')

    const cardinal = [
      [{ x: 600, y: 500 }, 'bottom'],
      [{ x: 800, y: 285 }, 'right'],
      [{ x: 600, y: 50 }, 'top'],
      [{ x: 400, y: 285 }, 'left'],
    ] as const
    for (const [origin, expectedSourceEdge] of cardinal) {
      expect(
        createM5MaterialFireRayFrame({
          placement,
          ray: { origin, target: placement.center },
        }).sourceEdge,
      ).toBe(expectedSourceEdge)

      const initial = Array.from({ length: 25 }, () => 1)
      expect(() =>
        classifyM5MaterialTopology({
          gridWidth: 5,
          gridHeight: 5,
          initialCellVolumes: initial,
          remainingCellVolumes: initial,
          sourceEdge: expectedSourceEdge,
          epsilon: 1e-9,
          shapeThresholds: topologyShapeThresholds,
          partialFront: topologyPartialFront,
          placement,
          fireRay: { origin, target: placement.center },
        }),
      ).not.toThrow()
    }

    expect(() =>
      classifyM5MaterialTopology({
        gridWidth: 5,
        gridHeight: 5,
        initialCellVolumes: Array.from({ length: 25 }, () => 1),
        remainingCellVolumes: Array.from({ length: 25 }, () => 1),
        sourceEdge: 'top',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement,
        fireRay: {
          origin: { x: 600, y: 500 },
          target: placement.center,
        },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_SOURCE_EDGE_MISMATCH')
  })

  test('火源 origin 可以位于材料外部或边界，但严格内部必须 fail closed', () => {
    const rotationRadians = (37 * Math.PI) / 180
    const placement = {
      center: { x: 10, y: -20 },
      width: 70,
      height: 50,
      rotationRadians,
    }
    const cosine = Math.cos(rotationRadians)
    const sine = Math.sin(rotationRadians)
    const toWorld = ({ x, y }: Readonly<{ x: number; y: number }>) => ({
      x: placement.center.x + x * cosine - y * sine,
      y: placement.center.y + x * sine + y * cosine,
    })

    for (const localOrigin of [
      { x: 0, y: 100 },
      { x: 0, y: 25 },
    ]) {
      expect(
        createM5MaterialFireRayFrame({
          placement,
          ray: {
            origin: toWorld(localOrigin),
            target: placement.center,
          },
        }).sourceEdge,
      ).toBe('bottom')
    }

    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: {
          origin: toWorld({ x: 0, y: 20 }),
          target: placement.center,
        },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ORIGIN_INSIDE')

    const unrotatedPlacement = {
      center: { x: 0, y: 0 },
      width: 70,
      height: 70,
      rotationRadians: 0,
    }
    expect(() =>
      createM5MaterialFireRayFrame({
        placement: unrotatedPlacement,
        ray: { origin: { x: 0, y: 20 }, target: { x: 0, y: 0 } },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ORIGIN_INSIDE')
    expect(
      createM5MaterialFireRayFrame({
        placement: unrotatedPlacement,
        ray: { origin: { x: 0, y: 35 }, target: { x: 0, y: 0 } },
      }).sourceEdge,
    ).toBe('bottom')

    const outside = toWorld({ x: 0, y: 100 })
    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: { origin: outside, target: outside },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ZERO_LENGTH')
    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: { origin: { x: Number.NaN, y: 0 }, target: placement.center },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: {
          origin: toWorld({ x: 0, y: 100 }),
          target: toWorld({ x: 0, y: 80 }),
        },
      }),
    ).not.toThrow()
  })

  test('火源射线的边界与非零方向判定在极端材料尺度下保持无量纲一致', () => {
    const rotations = [0, (37 * Math.PI) / 180] as const
    const toWorld = (
      local: Readonly<{ x: number; y: number }>,
      rotationRadians: number,
    ) => ({
      x:
        local.x * Math.cos(rotationRadians) -
        local.y * Math.sin(rotationRadians),
      y:
        local.x * Math.sin(rotationRadians) +
        local.y * Math.cos(rotationRadians),
    })

    for (const size of [70, 1e-14, 1e300]) {
      for (const rotationRadians of rotations) {
        const placement = {
          center: { x: 0, y: 0 },
          width: size,
          height: size,
          rotationRadians,
        }
        const frameFor = (
          localOrigin: Readonly<{ x: number; y: number }>,
          localTarget: Readonly<{ x: number; y: number }>,
        ) =>
          createM5MaterialFireRayFrame({
            placement,
            ray: {
              origin: toWorld(localOrigin, rotationRadians),
              target: toWorld(localTarget, rotationRadians),
            },
          })

        expect(() =>
          frameFor({ x: 0, y: 0 }, { x: 0, y: 2 * size }),
        ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ORIGIN_INSIDE')
        expect(() =>
          frameFor({ x: 0, y: 0.5 * size * (1 - 1e-8) }, { x: 0, y: 0 }),
        ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ORIGIN_INSIDE')

        for (const localOrigin of [
          { x: 0, y: 0.5 * size },
          { x: 0, y: 0.5 * size * (1 - 1e-15) },
          { x: 0, y: 0.5 * size * (1 + 1e-8) },
          { x: 0.5 * size, y: 0.5 * size },
        ]) {
          expect(() => frameFor(localOrigin, { x: 0, y: 0 })).not.toThrow()
        }
      }
    }
  })

  test('极小但非零的火源射线不被绝对 epsilon 误杀', () => {
    for (const rotationRadians of [0, (37 * Math.PI) / 180]) {
      const size = 1e-18
      const placement = {
        center: { x: 0, y: 0 },
        width: size,
        height: size,
        rotationRadians,
      }
      expect(() =>
        createM5MaterialFireRayFrame({
          placement,
          ray: {
            origin: {
              x: -5e-19 * Math.sin(rotationRadians),
              y: 5e-19 * Math.cos(rotationRadians),
            },
            target: { x: 0, y: 0 },
          },
        }),
      ).not.toThrow()
    }
  })

  test('世界坐标不同但局部方向坍缩时以 input invalid fail closed', () => {
    const placement = {
      center: { x: -3e307, y: 0 },
      width: 1e308,
      height: 70,
      rotationRadians: 0,
    }
    const origin = { x: 6e307, y: 100 }
    const collapsedTarget = { x: 5.999999999999999e307, y: 100 }

    expect(origin.x).not.toBe(collapsedTarget.x)
    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: { origin, target: collapsedTarget },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID')
    expect(() =>
      createM5MaterialFireRayFrame({
        placement,
        ray: { origin, target: origin },
      }),
    ).toThrow('M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_ZERO_LENGTH')
  })

  test('局部坐标变换或方向差溢出时以 input invalid fail closed', () => {
    const cases = [
      {
        placement: {
          center: { x: -1e308, y: 0 },
          width: 70,
          height: 70,
          rotationRadians: (37 * Math.PI) / 180,
        },
        ray: { origin: { x: 1e308, y: 0 }, target: { x: 0, y: 0 } },
      },
      {
        placement: {
          center: { x: 1e308, y: 0 },
          width: 70,
          height: 70,
          rotationRadians: (37 * Math.PI) / 180,
        },
        ray: { origin: { x: 0, y: 0 }, target: { x: -1e308, y: 0 } },
      },
      {
        placement: {
          center: { x: 0, y: 0 },
          width: 70,
          height: 70,
          rotationRadians: 0,
        },
        ray: {
          origin: { x: 1e308, y: 0 },
          target: { x: -1e308, y: 0 },
        },
      },
    ] as const
    const messages = cases.map(({ placement, ray }) => {
      try {
        createM5MaterialFireRayFrame({ placement, ray })
        return 'ACCEPT'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })
    expect(messages).toEqual(
      Array.from(
        { length: cases.length },
        () => 'M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_INPUT_INVALID',
      ),
    )
  })

  test('partial DDA 明确拒绝溢出的网格归一化火源坐标', () => {
    const placement = {
      center: { x: 0, y: 0 },
      width: 1e-320,
      height: 1,
      rotationRadians: 0,
    }
    expect(() =>
      classifyM5MaterialTopology({
        gridWidth: 3,
        gridHeight: 3,
        initialCellVolumes: Array.from({ length: 9 }, () => 1),
        remainingCellVolumes: Array.from({ length: 9 }, () => 0.8),
        sourceEdge: 'right',
        epsilon: 0,
        shapeThresholds: topologyShapeThresholds,
        partialFront: {
          ...topologyPartialFront,
          lateralBinCount: 3,
          minimumMeaningfulComponentCellCount: 1,
        },
        placement,
        fireRay: {
          origin: { x: 1e308, y: 0 },
          target: { x: 0, y: 0 },
        },
      }),
    ).toThrow(
      'M5_VISUAL_EVIDENCE_MATERIAL_FIRE_RAY_NORMALIZED_ORIGIN_INVALID',
    )
  })

  test('ray-aligned partial source surface 在 cardinal 四向都保留居中浅宽权威', () => {
    const width = 7
    const height = 7
    const initial = Array.from({ length: width * height }, () => 1)
    const placement = {
      center: { x: 0, y: 0 },
      width: 70,
      height: 70,
      rotationRadians: 0,
    }
    const origins = {
      top: { x: 0, y: -100 },
      right: { x: 100, y: 0 },
      bottom: { x: 0, y: 100 },
      left: { x: -100, y: 0 },
    } as const
    for (const sourceEdge of ['top', 'right', 'bottom', 'left'] as const) {
      const remaining = [...initial]
      for (const lane of [1, 2, 3, 4, 5]) {
        const index =
          sourceEdge === 'top'
            ? lane
            : sourceEdge === 'bottom'
              ? (height - 1) * width + lane
              : sourceEdge === 'left'
                ? lane * width
                : lane * width + width - 1
        remaining[index] = 0.2
      }
      const result = classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge,
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement,
        fireRay: {
          origin: origins[sourceEdge],
          target: placement.center,
        },
      })
      expect(result, sourceEdge).toMatchObject({
        classification: 'shallow-wide',
        sourceBoundaryReached: true,
        topologyMetricSource: 'partial-front',
      })
      expect(result.partialFrontCenterOffsetRatio, sourceEdge).toBeLessThanOrEqual(
        topologyShapeThresholds.maximumCenterOffsetRatio,
      )
    }
  })

  test('部分体积前沿在相同火焰射线上互斥区分深窄与浅宽，binary 贯通仍保持严格连通', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    const classify = (
      erodedCells: readonly Readonly<{
        x: number
        y: number
        remaining: number
      }>[],
    ) => {
      const remaining = [...initial]
      for (const cell of erodedCells) {
        remaining[cell.y * width + cell.x] = cell.remaining
      }
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: {
          ...topologyShapeThresholds,
          deepPenetrationMinimum: 0.55,
          shallowPenetrationMaximum: 0.3,
          narrowLateralCoverageMaximum: 0.45,
          wideLateralCoverageMinimum: 0.55,
        },
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 0, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    const deepNarrow = classify(
      [3, 4, 5].flatMap((x) =>
        [8, 7, 6, 5, 4, 3, 2].map((y) => ({ x, y, remaining: 0.2 })),
      ),
    )
    const shallowWide = classify(
      [1, 2, 3, 4, 5, 6, 7].flatMap((x) =>
        [8, 7].map((y) => ({ x, y, remaining: 0.2 })),
      ),
    )
    const through = classify(
      Array.from({ length: height }, (_, y) => ({ x: 4, y, remaining: 0 })),
    )

    expect(deepNarrow).toMatchObject({
      classification: 'deep-narrow',
      throughConnected: false,
      topologyMetricSource: 'partial-front',
    })
    expect(deepNarrow.penetrationRatio).toBeGreaterThanOrEqual(0.55)
    expect(deepNarrow.lateralCoverageRatio).toBeLessThanOrEqual(0.45)
    expect(shallowWide).toMatchObject({
      classification: 'shallow-wide',
      throughConnected: false,
      topologyMetricSource: 'partial-front',
    })
    expect(shallowWide.penetrationRatio).toBeLessThanOrEqual(0.3)
    expect(shallowWide.lateralCoverageRatio).toBeGreaterThanOrEqual(0.55)
    expect(through).toMatchObject({
      classification: 'through-not-empty',
      throughConnected: true,
      topologyMetricSource: 'binary-through',
    })
  })

  test('exact-axis partial 拒绝仅角接触的 zigzag 伪 source authority', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    const remaining = [...initial]
    for (const [x, y] of [
      [4, 8], [3, 7], [4, 6], [3, 5], [4, 4], [3, 3], [4, 2],
    ] as const) {
      remaining[y * width + x] = 0.1
    }

    expect(
      classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 0, y: 100 },
          target: { x: 0, y: 0 },
        },
      }),
    ).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      topologyMetricSource: 'partial-front',
      sourceErosionComponentCount: 0,
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
    })
  })

  test('partial 邻接边界在四向与 near-axis 射线下不把 45° 角接链当成连通', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    const cases = [
      {
        sourceEdge: 'top' as const,
        origin: { x: 0, y: -100 },
        cells: [[4, 0], [3, 1], [4, 2], [3, 3], [4, 4], [3, 5], [4, 6]],
      },
      {
        sourceEdge: 'right' as const,
        origin: { x: 100, y: 0 },
        cells: [[8, 4], [7, 3], [6, 4], [5, 3], [4, 4], [3, 3], [2, 4]],
      },
      {
        sourceEdge: 'bottom' as const,
        origin: { x: 0, y: 100 },
        cells: [[4, 8], [3, 7], [4, 6], [3, 5], [4, 4], [3, 3], [4, 2]],
      },
      {
        sourceEdge: 'left' as const,
        origin: { x: -100, y: 0 },
        cells: [[0, 4], [1, 3], [2, 4], [3, 3], [4, 4], [5, 3], [6, 4]],
      },
      {
        sourceEdge: 'bottom' as const,
        origin: { x: 0.001, y: 100 },
        cells: [[4, 8], [3, 7], [4, 6], [3, 5], [4, 4], [3, 3], [4, 2]],
      },
    ]

    for (const { sourceEdge, origin, cells } of cases) {
      const remaining = [...initial]
      for (const [x, y] of cells) remaining[y * width + x] = 0.1
      const result = classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge,
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: { origin, target: { x: 0, y: 0 } },
      })
      expect(result, `${sourceEdge}:${origin.x}:${origin.y}`).toMatchObject({
        classification: 'intermediate',
        sourceBoundaryReached: false,
        sourceErosionComponentCount: 0,
        penetrationRatio: 0,
        lateralCoverageRatio: 0,
      })
    }
  })

  test('oblique partial 只允许与真实射线几何一致的对角步进', () => {
    const width = 9
    const height = 9
    const baseInitial = Array.from({ length: width * height }, () => 1)
    const classify = (
      cells: readonly (readonly [number, number])[],
      carve: readonly (readonly [number, number])[] = [],
    ) => {
      const initial = [...baseInitial]
      for (const [x, y] of carve) initial[y * width + x] = 0
      const remaining = [...initial]
      for (const [x, y] of cells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 100, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    const rayAligned = classify(
      [[8, 8], [7, 7], [6, 6], [5, 5], [4, 4], [3, 3], [2, 2]],
      [
        [7, 8], [8, 7], [6, 7], [7, 6], [5, 6], [6, 5],
        [4, 5], [5, 4], [3, 4], [4, 3], [2, 3], [3, 2],
      ],
    )
    expect(rayAligned).toMatchObject({
      classification: 'deep-narrow',
      sourceBoundaryReached: true,
      sourceErosionComponentCount: 1,
      topologyMetricSource: 'partial-front',
    })

    // [8,5] 的凹口让 [8,4] 成为 DDA-visible 真实迎火面；
    // 后续对角步进却与射线方向相反，不应继承该 source authority。
    const reverseDiagonal = classify(
      [[8, 4], [7, 5], [6, 6], [5, 7], [4, 8]],
      [[8, 5]],
    )
    const alternatingZigzag = classify(
      [[8, 4], [7, 5], [6, 4], [5, 5], [4, 4], [3, 5], [2, 4]],
      [[8, 5]],
    )
    for (const [id, result] of [
      ['reverse', reverseDiagonal],
      ['alternating', alternatingZigzag],
    ] as const) {
      expect(result, id).toMatchObject({
        classification: 'intermediate',
        sourceBoundaryReached: false,
        sourceErosionComponentCount: 0,
        penetrationRatio: 0,
        lateralCoverageRatio: 0,
      })
    }
  })

  test('partial supercover 角点两侧只允许 empty 或 qualifying，任一 unqualified occupied 都阻断 authority', () => {
    const width = 7
    const height = 7
    const placement = {
      center: { x: 0, y: 0 },
      width: 70,
      height: 70,
      rotationRadians: 0,
    }
    const shapeThresholds = {
      deepPenetrationMinimum: 0.2,
      narrowLateralCoverageMaximum: 0.65,
      shallowPenetrationMaximum: 0.15,
      wideLateralCoverageMinimum: 0.7,
      targetLateralRatio: 0.5,
      targetCorridorHalfWidthRatio: 0.5,
      maximumCenterOffsetRatio: 0.5,
      minimumThroughDepthSpanRatio: 0.5,
    }
    const partialFront = {
      lateralBinCount: 7,
      minimumCellErosionRatio: 0.1,
      minimumActiveLaneErosionRatio: 0.1,
      lateralCoverageQuantile: 0.9,
      minimumMeaningfulComponentCellCount: 4,
    }
    const diagonal = [[6, 6], [5, 5], [4, 4], [3, 3]] as const
    const firstSide = [5, 6] as const
    const secondSide = [6, 5] as const
    const classify = (
      initialCells: readonly (readonly [number, number])[],
      qualifyingCells: readonly (readonly [number, number])[],
    ) => {
      const initial = Array.from({ length: width * height }, () => 0)
      for (const [x, y] of [...initialCells, [0, 0], [6, 0]] as const) {
        initial[y * width + x] = 1
      }
      const remaining = [...initial]
      for (const [x, y] of qualifyingCells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds,
        partialFront,
        placement,
        fireRay: {
          origin: { x: 100, y: 100 },
          target: placement.center,
        },
      })
    }

    for (const [id, initialCells, qualifyingCells] of [
      ['both-empty', diagonal, diagonal],
      ['one-qualifying', [...diagonal, firstSide], [...diagonal, firstSide]],
      [
        'two-qualifying',
        [...diagonal, firstSide, secondSide],
        [...diagonal, firstSide, secondSide],
      ],
    ] as const) {
      expect(classify(initialCells, qualifyingCells), id).toMatchObject({
        sourceBoundaryReached: true,
        sourceErosionComponentCount: 1,
        topologyMetricSource: 'partial-front',
      })
    }

    for (const [id, initialCells] of [
      ['one-unqualified', [...diagonal, firstSide]],
      ['two-unqualified', [...diagonal, firstSide, secondSide]],
    ] as const) {
      expect(classify(initialCells, diagonal), id).toMatchObject({
        classification: 'intermediate',
        sourceBoundaryReached: false,
        sourceErosionComponentCount: 0,
        penetrationRatio: 0,
        lateralCoverageRatio: 0,
      })
    }
  })

  test('partial authority 只来自每 target supercover DDA，不由 cell-center 对角链回退授权', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    const cells = [
      [8, 8], [7, 7], [6, 6], [5, 5], [4, 4], [3, 3], [2, 2],
    ] as const
    const classify = (originX: number) => {
      const remaining = [...initial]
      for (const [x, y] of cells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: originX, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    for (const originX of [33.2, 100 / 3, 33.45, 50]) {
      expect(classify(originX), String(originX)).toMatchObject({
        classification: 'intermediate',
        sourceBoundaryReached: false,
        sourceErosionComponentCount: 0,
        penetrationRatio: 0,
        lateralCoverageRatio: 0,
      })
    }
    expect(classify(100)).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      sourceErosionComponentCount: 0,
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
    })
  })

  test('non-square cell 与材料世界旋转不改变 partial supercover 授权', () => {
    const width = 12
    const height = 6
    const placement = {
      center: { x: 0, y: 0 },
      width: 120,
      height: 120,
      rotationRadians: (37 * Math.PI) / 180,
    }
    const cosine = Math.cos(placement.rotationRadians)
    const sine = Math.sin(placement.rotationRadians)
    const toWorld = ({ x, y }: Readonly<{ x: number; y: number }>) => ({
      x: x * cosine - y * sine,
      y: x * sine + y * cosine,
    })
    const classify = (
      cells: readonly (readonly [number, number])[],
      sparseCorridor = false,
    ) => {
      const initial: number[] = Array.from(
        { length: width * height },
        () => sparseCorridor ? 0 : 1,
      )
      if (sparseCorridor) {
        for (const [x, y] of [...cells, [0, 5], [11, 0]] as const) {
          initial[y * width + x] = 1
        }
      }
      const remaining = [...initial]
      for (const [x, y] of cells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement,
        fireRay: {
          origin: toWorld({ x: 50, y: 100 }),
          target: placement.center,
        },
      })
    }

    expect(
      classify([[8, 5], [7, 4], [6, 3], [5, 2], [4, 1]], true),
    ).toMatchObject({
      classification: 'deep-narrow',
      sourceBoundaryReached: true,
      sourceErosionComponentCount: 1,
    })
    expect(classify([[8, 1], [7, 2], [6, 3], [5, 4], [4, 5]])).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      sourceErosionComponentCount: 0,
    })
  })

  test('DDA-visible 迎火表面对角轮廓可聚合，但同形内部角接链不继承 authority', () => {
    const width = 5
    const height = 5
    const classify = (
      initialCells: readonly (readonly [number, number])[],
      erodedCells: readonly (readonly [number, number])[],
    ) => {
      const initial = Array.from({ length: width * height }, () => 0)
      for (const [x, y] of initialCells) initial[y * width + x] = 1
      const remaining = [...initial]
      for (const [x, y] of erodedCells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: {
          ...topologyPartialFront,
          lateralBinCount: 5,
          minimumActiveLaneErosionRatio: 0.1,
          minimumMeaningfulComponentCellCount: 2,
        },
        placement: {
          center: { x: 0, y: 0 },
          width: 50,
          height: 50,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 0, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    const sourceSurface = classify(
      [[2, 4], [3, 3]],
      [[2, 4], [3, 3]],
    )
    expect(sourceSurface).toMatchObject({
      sourceBoundaryReached: true,
      sourceErosionComponentCount: 1,
      topologyMetricSource: 'partial-front',
      partialFrontErodedCellCount: 2,
    })

    const internal = classify(
      Array.from({ length: width * height }, (_, index) => [
        index % width,
        Math.floor(index / width),
      ] as const),
      [[2, 3], [3, 2]],
    )
    expect(internal).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      sourceErosionComponentCount: 0,
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
    })
  })

  test('每个 qualifying cell 以独立 DDA 射线穿过初始空洞，并由同一迎火面组累计最小规模', () => {
    const width = 5
    const height = 5
    const classify = (blockGap: boolean) => {
      const initial = Array.from({ length: width * height }, () => 0)
      for (const [x, y] of [
        [2, 4], [3, 4], [2, 2], [3, 2],
      ] as const) {
        initial[y * width + x] = 1
      }
      if (blockGap) {
        initial[3 * width + 2] = 1
        initial[3 * width + 3] = 1
      }
      const remaining = [...initial]
      for (const [x, y] of [
        [2, 4], [3, 4], [2, 2], [3, 2],
      ] as const) {
        remaining[y * width + x] = 0.1
      }
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: {
          ...topologyPartialFront,
          lateralBinCount: 5,
          minimumActiveLaneErosionRatio: 0.1,
          minimumMeaningfulComponentCellCount: 4,
        },
        placement: {
          center: { x: 0, y: 0 },
          width: 50,
          height: 50,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 0, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    expect(classify(false)).toMatchObject({
      sourceBoundaryReached: true,
      sourceErosionComponentCount: 1,
      topologyMetricSource: 'partial-front',
      partialFrontErodedCellCount: 4,
    })
    expect(classify(true)).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      sourceErosionComponentCount: 0,
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
    })
  })

  test('独立 DDA 射线不会把多个未达最小规模的离散 source seed 组相加自证', () => {
    const width = 7
    const height = 7
    const initial = Array.from({ length: width * height }, () => 1)
    const remaining = [...initial]
    for (const x of [0, 2, 4, 6]) remaining[6 * width + x] = 0.1
    const result = classifyM5MaterialTopology({
      gridWidth: width,
      gridHeight: height,
      initialCellVolumes: initial,
      remainingCellVolumes: remaining,
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: topologyShapeThresholds,
      partialFront: topologyPartialFront,
      placement: {
        center: { x: 0, y: 0 },
        width: 70,
        height: 70,
        rotationRadians: 0,
      },
      fireRay: {
        origin: { x: 0, y: 100 },
        target: { x: 0, y: 0 },
      },
    })

    expect(result).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      sourceErosionComponentCount: 0,
      penetrationRatio: 0,
      lateralCoverageRatio: 0,
    })
  })

  test('部分体积前沿只聚合触达真实入射边且达到最小规模的连通组件，并以加权中心拒绝偏心前沿', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    const classify = (
      mutate: (remaining: number[]) => void,
    ) => {
      const remaining = [...initial]
      mutate(remaining)
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: initial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement: {
          center: { x: 0, y: 0 },
          width: 90,
          height: 90,
          rotationRadians: 0,
        },
        fireRay: {
          origin: { x: 0, y: 100 },
          target: { x: 0, y: 0 },
        },
      })
    }

    const internal = classify((remaining) => {
      for (const x of [3, 4, 5]) {
        for (const y of [2, 3, 4, 5, 6]) remaining[y * width + x] = 0.2
      }
    })
    expect(internal).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      partialFrontActiveLaneCount: 0,
    })

    const tiny = classify((remaining) => {
      for (const y of [8, 7, 6]) remaining[y * width + 4] = 0.1
    })
    expect(tiny).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
      partialFrontActiveLaneCount: 0,
    })

    const offCenter = classify((remaining) => {
      for (const x of [0, 1, 2, 3, 4]) {
        for (const y of [8, 7]) remaining[y * width + x] = 0.1
      }
    })
    expect(offCenter.classification).toBe('intermediate')
    expect(offCenter.sourceBoundaryReached).toBe(true)
    expect(offCenter.partialFrontCenterOffsetRatio).toBeGreaterThan(
      topologyShapeThresholds.maximumCenterOffsetRatio,
    )

    const disconnectedWide = classify((remaining) => {
      for (const x of [1, 2, 4, 5, 6]) {
        for (const y of [8, 7]) remaining[y * width + x] = 0.1
      }
    })
    expect(disconnectedWide).toMatchObject({
      classification: 'shallow-wide',
      sourceBoundaryReached: true,
      topologyMetricSource: 'partial-front',
    })
  })

  test('斜射线与材料旋转按迎火轮廓授权 partial，而非配置 cardinal 行列自证', () => {
    const width = 9
    const height = 9
    const initial = Array.from({ length: width * height }, () => 1)
    // 凹口使右侧迎火面可见，同时保留同 lane 更低的 occupied cell；
    // cardinal bottom 行列算法会误把这条合法入口判成内部侵蚀。
    initial[7 * width + 8] = 0
    const rotationRadians = Math.PI / 12
    const cosine = Math.cos(rotationRadians)
    const sine = Math.sin(rotationRadians)
    const placement = {
      center: { x: 0, y: 0 },
      width: 90,
      height: 90,
      rotationRadians,
    }
    const localOrigin = { x: 100, y: 150 }
    const fireRay = {
      origin: {
        x: localOrigin.x * cosine - localOrigin.y * sine,
        y: localOrigin.x * sine + localOrigin.y * cosine,
      },
      target: placement.center,
    }
    const classify = (
      cells: readonly (readonly [number, number])[],
      carve: readonly (readonly [number, number])[] = [],
    ) => {
      const scenarioInitial = [...initial]
      for (const [x, y] of carve) scenarioInitial[y * width + x] = 0
      const remaining = [...scenarioInitial]
      for (const [x, y] of cells) remaining[y * width + x] = 0.1
      return classifyM5MaterialTopology({
        gridWidth: width,
        gridHeight: height,
        initialCellVolumes: scenarioInitial,
        remainingCellVolumes: remaining,
        sourceEdge: 'bottom',
        epsilon: 1e-9,
        shapeThresholds: topologyShapeThresholds,
        partialFront: topologyPartialFront,
        placement,
        fireRay,
      })
    }

    const diagonalCenter = classify(
      [
        [8, 6], [7, 6], [7, 5], [6, 5],
        [6, 4], [5, 4], [5, 3], [4, 3], [4, 2],
      ],
      [
        [8, 8], [7, 8], [7, 7], [6, 7],
        [6, 6], [5, 5], [4, 4],
      ],
    )
    const diagonalWide = classify([
      [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8],
      [8, 6], [8, 5], [8, 4], [8, 3],
    ])
    const internal = classify([
      [3, 2], [4, 2], [5, 2], [3, 3], [4, 3], [5, 3],
    ])
    const offCenter = classify([
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8],
    ])
    const tiny = classify([[8, 6], [7, 6], [7, 5]])

    expect(diagonalCenter).toMatchObject({
      classification: 'deep-narrow',
      sourceBoundaryReached: true,
      topologyMetricSource: 'partial-front',
    })
    expect(diagonalCenter.penetrationRatio).toBeGreaterThanOrEqual(
      topologyShapeThresholds.deepPenetrationMinimum,
    )
    expect(diagonalCenter.lateralCoverageRatio).toBeLessThanOrEqual(
      topologyShapeThresholds.narrowLateralCoverageMaximum,
    )
    expect(diagonalCenter.partialFrontCenterOffsetRatio).toBeLessThanOrEqual(
      topologyShapeThresholds.maximumCenterOffsetRatio,
    )
    expect(diagonalWide).toMatchObject({
      classification: 'shallow-wide',
      sourceBoundaryReached: true,
      topologyMetricSource: 'partial-front',
      sourceErosionComponentCount: 2,
    })
    expect(diagonalWide.penetrationRatio).toBeLessThanOrEqual(
      topologyShapeThresholds.shallowPenetrationMaximum,
    )
    expect(diagonalWide.lateralCoverageRatio).toBeGreaterThanOrEqual(
      topologyShapeThresholds.wideLateralCoverageMinimum,
    )
    expect(diagonalWide.partialFrontCenterOffsetRatio).toBeLessThanOrEqual(
      topologyShapeThresholds.maximumCenterOffsetRatio,
    )
    expect(internal).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
    })
    expect(tiny).toMatchObject({
      classification: 'intermediate',
      sourceBoundaryReached: false,
    })
    expect(offCenter.classification).toBe('intermediate')
    expect(offCenter.sourceBoundaryReached).toBe(true)
    expect(offCenter.partialFrontCenterOffsetRatio).toBeGreaterThan(
      topologyShapeThresholds.maximumCenterOffsetRatio,
    )
  })

  test('材料停机权威 helper 对 class/source/metric/ratio/remaining 任一漂移均返回 false', () => {
    const metrics = classifyM5MaterialTopology({
      gridWidth: 9,
      gridHeight: 9,
      initialCellVolumes: Array.from({ length: 81 }, () => 1),
      remainingCellVolumes: Array.from({ length: 81 }, (_, index) =>
        index % 9 >= 3 && index % 9 <= 5 && Math.floor(index / 9) >= 2
          ? 0.2
          : 1,
      ),
      sourceEdge: 'bottom',
      epsilon: 1e-9,
      shapeThresholds: {
        ...topologyShapeThresholds,
        deepPenetrationMinimum: 0.55,
      },
      partialFront: topologyPartialFront,
      placement: {
        center: { x: 0, y: 0 },
        width: 90,
        height: 90,
        rotationRadians: 0,
      },
      fireRay: {
        origin: { x: 0, y: 100 },
        target: { x: 0, y: 0 },
      },
    })
    const stop = {
      mode: 'topology-classification' as const,
      classification: 'deep-narrow' as const,
      minimumDissolvedVolumeRatio: metrics.dissolvedVolumeRatio,
      maximumDissolvedVolumeRatio: metrics.dissolvedVolumeRatio,
      minimumRemainingRatio: metrics.remainingRatio,
    }
    expect(hasM5MaterialTopologyStopAuthority(metrics, stop)).toBe(true)
    for (const mutation of [
      { ...metrics, classification: 'shallow-wide' as const },
      { ...metrics, sourceBoundaryReached: false },
      { ...metrics, topologyMetricSource: 'binary-component' as const },
      { ...metrics, dissolvedVolumeRatio: metrics.dissolvedVolumeRatio - 0.01 },
      { ...metrics, dissolvedVolumeRatio: metrics.dissolvedVolumeRatio + 0.01 },
      { ...metrics, remainingRatio: metrics.remainingRatio - 0.01 },
    ]) {
      expect(hasM5MaterialTopologyStopAuthority(mutation, stop)).toBe(false)
    }
    expect(
      hasM5MaterialTopologyStopAuthority(
        { ...metrics, throughConnected: true, remainingRatio: 0.5 },
        { mode: 'through-connected' },
      ),
    ).toBe(true)
    expect(
      hasM5MaterialTopologyStopAuthority(
        { ...metrics, throughConnected: true, remainingRatio: 0 },
        { mode: 'through-connected' },
      ),
    ).toBe(false)
  })

  test('材料正式瞄准只接受 fixture target 与公开 contentPlacement.center 一致', () => {
    expect(
      assertM5MaterialEvidenceTargetMatchesContentCenter({
        caseId: 'material-center-hole',
        configuredTarget: { x: 711, y: 525 },
        contentCenter: { x: 711, y: 525 },
        epsilon: 0.000001,
      }),
    ).toEqual({ x: 711, y: 525 })
    expect(() =>
      assertM5MaterialEvidenceTargetMatchesContentCenter({
        caseId: 'material-center-hole',
        configuredTarget: { x: 600, y: 285 },
        contentCenter: { x: 711, y: 525 },
        epsilon: 0.000001,
      }),
    ).toThrow(
      'M5_VISUAL_EVIDENCE_MATERIAL_TARGET_CONTENT_CENTER_MISMATCH:material-center-hole:600,285:711,525',
    )
  })

  test('warningFlow 瞄准与同批正式首材料共用权威目标', () => {
    const fixture = loadFixture()
    const warningFlow = fixture.coverage.warningFlow
    const formalMaterial = fixture.coverage.cases.find(
      (coverageCase) =>
        coverageCase.automation === 'm2-material-topology' &&
        coverageCase.materialDefinitionId === warningFlow.materialDefinitionId &&
        coverageCase.materialBatchId === warningFlow.materialBatchId,
    )
    if (
      formalMaterial?.logicalTarget === undefined ||
      formalMaterial.epsilon === undefined
    ) {
      throw new Error('M5_VISUAL_EVIDENCE_WARNING_FORMAL_MATERIAL_MISSING')
    }

    expect(
      assertM5MaterialEvidenceTargetMatchesContentCenter({
        caseId: 'warningFlow',
        configuredTarget: warningFlow.logicalTarget,
        contentCenter: formalMaterial.logicalTarget,
        epsilon: formalMaterial.epsilon,
      }),
    ).toEqual(formalMaterial.logicalTarget)
  })

  test('冻结截图视觉准备契约拒绝 caller boolean 与四路径人工标签循环', () => {
    const runner = runnerSource()
    const e2e = readFileSync(
      resolve(repositoryRoot, 'e2e', 'm2-extraction.spec.ts'),
      'utf8',
    )
    const captureType = runner.slice(
      runner.indexOf('type CaptureClockInput'),
      runner.indexOf('type CaptureStateInput'),
    )
    const transform = runner.slice(
      runner.indexOf('async function applyVisionTransform'),
      runner.indexOf('async function readBrowserEnvironment'),
    )
    const capture = runner.slice(
      runner.indexOf('async function capturePage'),
      runner.indexOf('function checksPassed'),
    )

    expect(transform).toMatch(
      /Promise<[^>]*(?:Vision|Transform)[^>]*Prepared[^>]*>/,
    )
    expect(captureType).toMatch(
      /(?:preparedToken|visionTransformToken|VisionTransformPrepared)/,
    )
    expect(captureType).not.toMatch(/visionTransformPrepared:\s*true/)
    expect(capture).not.toMatch(
      /clockCapture\.visionTransformPrepared\s*!==\s*true/,
    )
    expect(runner.match(/visionTransformPrepared:\s*true/g) ?? []).toHaveLength(0)
    expect(e2e).not.toContain("'fire-sequence',\n+    'material-transient',")
  })

  test('配置拒绝会产生重复格的火力值', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          repositoryRoot,
          'public',
          'config',
          'evidence',
          'm5-visual-matrix.json',
        ),
        'utf8',
      ),
    ) as { fire: { sizes: number[] } }
    fixture.fire.sizes = [20, 20, 100]

    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(fixture),
        readFileSync(
          resolve(
            repositoryRoot,
            'schemas',
            'config',
            'm5-visual-evidence.schema.json',
          ),
          'utf8',
        ),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_(?:SCHEMA|SEMANTICS)_INVALID/)
  })

  test('配置拒绝静默缩减 4/3/5 火焰相位帧或把材料证据退回非真实自动化', () => {
    const shortened = loadMutableFixture()
    shortened.fire.phases[0].sampleOffsetsMilliseconds = [0]
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(shortened),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_(?:SCHEMA|SEMANTICS)_INVALID/)

    const automatedMaterial = loadMutableFixture()
    automatedMaterial.coverage.cases[0].automation = 'manual-blocked'
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(automatedMaterial),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_(?:SCHEMA|SEMANTICS)_INVALID/)
  })

  test('配置拒绝改变 coverage/accessibility 的权威状态集合与视觉矩阵', () => {
    const missingCoverageState = loadMutableFixture()
    missingCoverageState.coverage.cases[3].requiredStates.pop()
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(missingCoverageState),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID/)

    const missingCaptureState = loadMutableFixture()
    missingCaptureState.accessibility.captureStates.pop()
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(missingCaptureState),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_(?:SCHEMA|SEMANTICS)_INVALID/)

    const incompleteMaterial = loadMutableFixture()
    delete incompleteMaterial.coverage.cases[0].epsilon
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(incompleteMaterial),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID/)

    const fakeWarning = loadMutableFixture()
    fakeWarning.coverage.cases[6].expectedEffect = 'warningTwo'
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(fakeWarning),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID/)

    const changedAccessibilityStates = loadMutableFixture()
    changedAccessibilityStates.accessibility.galleryRequiredStates.pop()
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(changedAccessibilityStates),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_(?:SCHEMA|SEMANTICS)_INVALID/)

    const identityGrayscale = loadMutableFixture()
    identityGrayscale.accessibility.modes[0].colorMatrix = [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0,
    ]
    expect(() =>
      parseAndValidateM5VisualEvidenceFixtureJson(
        JSON.stringify(identityGrayscale),
        schemaSource(),
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_FIXTURE_SEMANTICS_INVALID/)
  })

  test('双材料不重叠正式用例固定生产批次、定义、独立 SAT epsilon 与稳定等待时间', () => {
    const fixture = loadMutableFixture()
    const pairCase = fixture.coverage.cases.find(
      (candidate: any) => candidate.id === 'material-pair-non-overlap',
    )
    expect(pairCase).toMatchObject({
      automation: 'm2-material-pair-non-overlap',
      materialBatchIds: [
        'red_whisker_ginseng_fresh_wild_10',
        'azure_dew_leaf_fresh_cultivated_3',
      ],
      materialDefinitionIds: [
        'red_whisker_ginseng',
        'azure_dew_leaf',
      ],
      epsilon: 0.000001,
      settleMilliseconds: expect.any(Number),
      requiredStates: ['material-pair-non-overlap'],
    })

    pairCase.materialBatchIds[1] = 'other_batch'
    expect(
      validateM5VisualEvidenceFixtureSemantics(fixture as never),
    ).toContain(
      'COVERAGE_MATERIAL_PAIR_FORMAL_CONTRACT_DRIFT:material-pair-non-overlap:materialBatchIds',
    )
  })

  test('正式 warning 文案与材料协议逐字段 mutation 都返回稳定语义错误', () => {
    const baseline = loadMutableFixture()
    expect(
      validateM5VisualEvidenceFixtureSemantics(baseline as never),
    ).toEqual([])
    for (const id of [
      'material-center-hole',
      'material-wide-strip',
      'material-burn-through',
    ]) {
      expect(
        baseline.coverage.cases.find((candidate: any) => candidate.id === id)
          .logicalTarget,
        `${id}:logicalTarget 必须跟随首个材料公开 contentPlacement.center`,
      ).toEqual({ x: 711, y: 525 })
    }
    const mutations: Array<Readonly<{
      name: string
      expectedIssue: string
      mutate: (fixture: Record<string, any>) => void
    }>> = []
    for (const id of ['loss-warning-one', 'loss-warning-two']) {
      mutations.push({
        name: `${id}.expectedMessageZh`,
        expectedIssue: `COVERAGE_WARNING_FORMAL_CONTRACT_DRIFT:${id}:expectedMessageZh`,
        mutate: (fixture) => {
          fixture.coverage.cases.find((candidate: any) => candidate.id === id)
            .expectedMessageZh = '错误文案'
        },
      })
    }
    mutations.push({
      name: 'warningFlow.logicalTarget',
      expectedIssue: 'COVERAGE_WARNING_FLOW_NOT_AUTHORITATIVE',
      mutate: (fixture) => {
        fixture.coverage.warningFlow.logicalTarget.x += 1
      },
    })

    const scalarMutations = [
      ['materialBatchId', 'other_batch'],
      ['materialDefinitionId', 'other_material'],
      ['fireSize', 21],
      ['sourceEdge', 'left'],
      ['logicalTarget.x', 601],
      ['logicalTarget.y', 286],
      ['shapeThresholds.deepPenetrationMinimum', 0.36],
      ['shapeThresholds.narrowLateralCoverageMaximum', 0.46],
      ['shapeThresholds.shallowPenetrationMaximum', 0.29],
      ['shapeThresholds.wideLateralCoverageMinimum', 0.46],
      ['shapeThresholds.targetLateralRatio', 0.51],
      ['shapeThresholds.targetCorridorHalfWidthRatio', 0.26],
      ['shapeThresholds.maximumCenterOffsetRatio', 0.21],
      ['shapeThresholds.minimumThroughDepthSpanRatio', 0.51],
    ] as const
    const expectedTopologyMutations = [
      ['classification', 'intermediate'],
      ['minimumDissolvedVolumeRatio', 0.01],
      ['maximumDissolvedVolumeRatio', 0.96],
      ['minimumRemainingRatio', 0.04],
      ['maximumCollectorCenterOffset', 2],
      ['minimumPenetrationRatio', 0.01],
      ['maximumPenetrationRatio', 0.99],
      ['minimumLateralCoverageRatio', 0.01],
      ['maximumLateralCoverageRatio', 0.99],
      ['throughConnected', true],
    ] as const
    for (const id of [
      'material-center-hole',
      'material-wide-strip',
      'material-burn-through',
    ]) {
      for (const [path, value] of scalarMutations) {
        mutations.push({
          name: `${id}.${path}`,
          expectedIssue: `COVERAGE_MATERIAL_FORMAL_CONTRACT_DRIFT:${id}:${path}`,
          mutate: (fixture) => {
            const coverageCase = fixture.coverage.cases.find(
              (candidate: any) => candidate.id === id,
            )
            const segments = path.split('.')
            let target = coverageCase
            for (const segment of segments.slice(0, -1)) target = target[segment]
            target[segments.at(-1)!] = value
          },
        })
      }
      for (const [field, fallback] of expectedTopologyMutations) {
        mutations.push({
          name: `${id}.expectedTopology.${field}`,
          expectedIssue: `COVERAGE_MATERIAL_FORMAL_CONTRACT_DRIFT:${id}:expectedTopology.${field}`,
          mutate: (fixture) => {
            const expected = fixture.coverage.cases.find(
              (candidate: any) => candidate.id === id,
            ).expectedTopology
            const current = expected[field]
            expected[field] =
              field === 'classification'
                ? current === 'deep-narrow'
                  ? 'shallow-wide'
                  : 'deep-narrow'
                : field === 'throughConnected'
                  ? !current
                  : current === fallback
                    ? Number(fallback) + 0.01
                    : fallback
          },
        })
      }
      if (id !== 'material-burn-through') {
        for (const [field, value] of [
          [
            'classification',
            id === 'material-center-hole' ? 'shallow-wide' : 'deep-narrow',
          ],
          ['minimumDissolvedVolumeRatio', 0.11],
          ['maximumDissolvedVolumeRatio', 0.16],
          ['minimumRemainingRatio', 0.79],
        ] as const) {
          mutations.push({
            name: `${id}.stopCondition.${field}`,
            expectedIssue: `COVERAGE_MATERIAL_FORMAL_CONTRACT_DRIFT:${id}:stopCondition.${field}`,
            mutate: (fixture) => {
              fixture.coverage.cases.find(
                (candidate: any) => candidate.id === id,
              ).stopCondition[field] = value
            },
          })
        }
      }
      for (const [field, value] of [
        ['lateralBinCount', 29],
        ['minimumCellErosionRatio', 0.11],
        ['minimumActiveLaneErosionRatio', 0.19],
        ['lateralCoverageQuantile', 0.81],
        ['minimumMeaningfulComponentCellCount', 5],
      ] as const) {
        mutations.push({
          name: `${id}.partialFront.${field}`,
          expectedIssue: `COVERAGE_MATERIAL_FORMAL_CONTRACT_DRIFT:${id}:partialFront.${field}`,
          mutate: (fixture) => {
            fixture.coverage.cases.find(
              (candidate: any) => candidate.id === id,
            ).partialFront[field] = value
          },
        })
      }
    }

    for (const [field, value] of [
      ['leftKey', 'q'],
      ['rightKey', 'e'],
      ['maximumCenterOffset', 2],
      ['deadlineMilliseconds', 10_001],
      ['pollIntervalMilliseconds', 21],
      ['maximumCorrectionHoldMilliseconds', 501],
      ['settlePaddingMilliseconds', 101],
      ['feedbackActivationDirectionChanges', 3],
      ['feedbackPulseTicks', 2],
      ['feedbackVelocityTolerance', 1],
    ] as const) {
      mutations.push({
        name: `materialAlignment.${field}`,
        expectedIssue: `COVERAGE_MATERIAL_ALIGNMENT_FORMAL_CONTRACT_DRIFT:${field}`,
        mutate: (fixture) => {
          fixture.coverage.materialAlignment[field] = value
        },
      })
    }

    for (const mutation of mutations) {
      const fixture = structuredClone(baseline)
      mutation.mutate(fixture)
      expect.soft(
        validateM5VisualEvidenceFixtureSemantics(fixture as never),
        mutation.name,
      ).toContain(mutation.expectedIssue)
    }
  })

  test('runner 以权威帧锚定火焰相位，并记录有上限的截图起止迟到', () => {
    const source = runnerSource()
    expect(source).toContain('maximumSampleLatenessMilliseconds')
    expect(source).toContain('createM5VisualFirePhaseChecks')
    expect(source).not.toMatch(/mouse\.down\(\)\s*\r?\n\s*const startupStart/)
    expect(source).not.toMatch(
      /mouse\.up\(\)\s*\r?\n\s*}[\s\S]{0,200}phaseId: 'release'/,
    )
    expect(source).toContain('screenshotStartedOffsetMilliseconds')
    expect(source).toContain('screenshotFinishedOffsetMilliseconds')
    expect(source).not.toContain(
      'actualSampleOffsetMilliseconds: configuredOffset',
    )
    expect(source).toContain('phaseStartedAtMilliseconds')
    expect(source).toContain('readBrowserClockMilliseconds')
  })

  test('runner 独立捕获 failure 六相并复核完成、进度与 PNG 去重', () => {
    const source = runnerSource()
    expect(source).not.toContain("phase === 'trigger' ? 'charring'")
    expect(source).not.toContain("if (phase !== 'trigger')")
    expect(source).toContain('failurePresentationComplete')
    expect(source).toContain('assertM5VisualFailureCaptureSequence')
    expect(source).toContain('targetFailureProgress')
    const failureRunner = source.slice(
      source.indexOf('async function runFailureCases'),
      source.indexOf('function automatedGate'),
    )
    expect(failureRunner).not.toContain('screenshotTimingAnchorMilliseconds')
    expect(failureRunner).toContain("mode: 'sequence-held'")
    expect(failureRunner).toContain('advanceToFailurePhaseTarget(')
    expect(failureRunner).toContain('failurePhaseTargetCheck(')
    expect(source).toContain("id: 'sequence-phase-target-audited'")
  })

  test('runner 记录浏览器实测 viewport/DPR/reduced/filter/seed 与 PNG 像素尺寸', () => {
    const source = runnerSource()
    expect(source).toContain('window.devicePixelRatio')
    expect(source).toContain('matchMedia(')
    expect(source).toMatch(/getComputedStyle\(app\)\.filter/)
    expect(source).toContain('snapshot.seed')
    expect(source).toContain('deviceScaleFactor')
    expect(source).toContain('artifact.width')
  })

  test('gallery 检查只接受截图边界当前帧数值，不冒充 loss warning', () => {
    const source = runnerSource()
    const gallery = source.slice(
      source.indexOf('function galleryChecks'),
      source.indexOf('async function waitForGalleryEffects'),
    )
    expect(gallery).not.toContain("actual === 'm5-heat-field'")
    expect(gallery).not.toContain("actual === 'm5-local-light'")
    expect(gallery).not.toContain('pearlTypeWeights')
    expect(gallery).not.toContain('observedEffects.has')
    expect(gallery).not.toContain("required === 'warningOne'")
    expect(gallery).not.toContain("required === 'warningTwo'")
  })

  test('材料三拓扑只走生产 M2 权威网格、配置停机与截图前后分类，禁止规则路由覆盖', () => {
    const source = runnerSource()
    const materialRunner = source.slice(
      source.indexOf('async function readMaterialTopologyState'),
      source.indexOf('async function runWarningCases'),
    )
    expect(materialRunner).toContain('getMaterialTopologyEvidence')
    expect(materialRunner).toContain('classifyM5MaterialTopology')
    expect(materialRunner).toContain('stopCondition')
    expect(materialRunner).toContain('expectedTopology')
    expect(materialRunner).toContain('prepareBefore')
    expect(materialRunner).toContain('readAfter')
    expect(materialRunner).toContain('initialGridSha256')
    expect(materialRunner).toContain('remainingGridSha256')
    expect(materialRunner).toContain(
      'assertM5MaterialEvidenceTargetMatchesContentCenter',
    )
    expect(materialRunner).toContain('authoritativeTarget')
    expect(materialRunner).toContain('raw.material.contentPlacement.center')
    expect(materialRunner).not.toContain('.route(')
    expect(materialRunner).not.toContain('route.fulfill')
  })

  test('双材料正式 runner 依次走生产 API、不装备不开火，并用证据层独立 SAT 锁定截图边界', () => {
    const source = runnerSource()
    const pairRunner = source.slice(
      source.indexOf('async function runMaterialPairNonOverlapCase'),
      source.indexOf('async function readWarningState'),
    )
    expect(pairRunner).toContain('preselectMaterial')
    expect(pairRunner).toContain('addSelectedMaterial')
    expect(pairRunner).toContain('getMaterialTopologyEvidence')
    expect(pairRunner).toContain('createM5VisualMaterialPairBoundaryChecks')
    expect(pairRunner).toContain('prepareBefore')
    expect(pairRunner).toContain('readAfter')
    expect(pairRunner).toContain('equippedFireSourceId')
    expect(pairRunner).toContain('audioMuted')
    expect(pairRunner).not.toContain('configureM2Fire')
    expect(pairRunner).not.toContain('selectFireSource')
    expect(pairRunner).not.toContain('page.mouse.down')
    expect(supportSource()).not.toContain(
      "from '../src/shared/material-placement-geometry.ts'",
    )
  })

  test('材料 runner 在开火前用实时 collector/material 反馈对齐且策略全部来自配置', () => {
    const source = runnerSource()
    const materialRunner = source.slice(
      source.indexOf('async function runMaterialTopologyCases'),
      source.indexOf('async function readWarningState'),
    )
    const alignmentIndex = materialRunner.indexOf(
      'alignCollectorWithMaterialEvidence',
    )
    expect(alignmentIndex).toBeGreaterThanOrEqual(0)
    expect(alignmentIndex).toBeLessThan(materialRunner.indexOf('page.mouse.down()'))
    expect(materialRunner).toContain('getPresentationEvidence')
    expect(materialRunner).toContain('placement.center')
    expect(source).toContain('/config/m2/collector.json')
    const alignment = (loadMutableFixture().coverage as Record<string, any>)
      .materialAlignment
    expect(alignment).toMatchObject({
      leftKey: expect.any(String),
      rightKey: expect.any(String),
      maximumCenterOffset: 1,
      deadlineMilliseconds: expect.any(Number),
      pollIntervalMilliseconds: expect.any(Number),
      maximumCorrectionHoldMilliseconds: expect.any(Number),
      settlePaddingMilliseconds: expect.any(Number),
      feedbackActivationDirectionChanges: expect.any(Number),
      feedbackPulseTicks: expect.any(Number),
      feedbackVelocityTolerance: expect.any(Number),
    })
  })

  test('collector 反馈对齐覆盖左右、已对齐、错误方向与有界超时', async () => {
    const config = loadFixture().coverage.materialAlignment
    const motion = { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 }
    const run = async (
      collectorStart: number,
      materialCenterX: number,
      overrides: Partial<typeof config> = {},
      movementEnabled = true,
    ) => {
      let collectorCenterX = collectorStart
      let now = 0
      let activeKey: string | null = null
      const pressed: string[] = []
      const effectiveConfig = { ...config, ...overrides }
      const result = await alignM5VisualCollector({
        config: effectiveConfig,
        motion,
        readPosition: async () => ({ collectorCenterX, materialCenterX }),
        focus: async () => undefined,
        keyDown: async (key) => {
          activeKey = key
          pressed.push(key)
        },
        keyUp: async () => {
          activeKey = null
        },
        waitForMilliseconds: async (milliseconds) => {
          now += milliseconds
          if (!movementEnabled || activeKey === null) return
          const expectedKey = materialCenterX < collectorCenterX ? 'a' : 'd'
          if (activeKey === expectedKey) collectorCenterX = materialCenterX
          else collectorCenterX += activeKey === 'a' ? -50 : 50
        },
        now: () => now,
      })
      return { result, pressed }
    }

    await expect(run(800, 600)).resolves.toMatchObject({
      result: { initialOffset: 200, finalOffset: 0, correctionCount: 1 },
      pressed: ['a'],
    })
    await expect(run(400, 600)).resolves.toMatchObject({
      result: { initialOffset: 200, finalOffset: 0, correctionCount: 1 },
      pressed: ['d'],
    })
    await expect(run(600.5, 600)).resolves.toMatchObject({
      result: { initialOffset: 0.5, finalOffset: 0.5, correctionCount: 0 },
      pressed: [],
    })
    await expect(
      run(800, 600, { leftKey: 'd', rightKey: 'a' }),
    ).rejects.toThrow(/M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT/)
    await expect(run(800, 600, {}, false)).rejects.toThrow(
      /M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT/,
    )
  })

  test('collector 在 30Hz 量化粗校正振荡后切换配置化微脉冲并收敛到 1px', async () => {
    const config = loadFixture().coverage.materialAlignment
    const blindDriver = createQuantizedCollectorDriver(800, 600)
    await expect(
      alignM5VisualCollector({
        config: { ...config, feedbackActivationDirectionChanges: 999 },
        motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
        ...blindDriver,
      }),
    ).rejects.toThrow(/M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT/)
    for (const expectedX of [592.6666666667, 603.3333333333, 598.4444444444]) {
      expect(
        blindDriver.trace.some(({ x }) => Math.abs(x - expectedX) < 1e-6),
      ).toBe(true)
    }

    const driver = createQuantizedCollectorDriver(800, 600)

    const result = await alignM5VisualCollector({
      config,
      motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
      ...driver,
    })

    expect(driver.trace[0]!.x).toBeCloseTo(800)
    expect(driver.trace.some(({ x }) => Math.abs(x - 592.6666666667) < 1e-6)).toBe(true)
    expect(driver.trace.some(({ x }) => Math.abs(x - 603.3333333333) < 1e-6)).toBe(true)
    expect(result.finalOffset).toBeLessThanOrEqual(1)
    expect(result.correctionCount).toBeGreaterThan(2)
    expect(driver.isReleased()).toBe(true)

    const mirrored = createQuantizedCollectorDriver(400, 600)
    await expect(
      alignM5VisualCollector({
        config,
        motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
        ...mirrored,
      }),
    ).resolves.toMatchObject({ finalOffset: expect.any(Number) })
    expect(Math.abs(mirrored.trace.at(-1)!.x - 600)).toBeLessThanOrEqual(1)
    expect(mirrored.isReleased()).toBe(true)
  })

  test('collector 微脉冲按权威 tick 首次位移释放，并从一次跨两 tick 调度继续纠偏', async () => {
    const config = loadFixture().coverage.materialAlignment
    const driver = createQuantizedCollectorDriver(800, 600, {
      oneFeedbackPollCrossesTwoTicks: true,
    })

    const result = await alignM5VisualCollector({
      config,
      motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
      ...driver,
    })

    expect(driver.trace.some(({ x }) => Math.abs(x - 603.3333333333) < 1e-6)).toBe(true)
    expect(driver.trace.some(({ x }) => Math.abs(x - 598.4444444444) < 1e-6)).toBe(true)
    expect(result.finalOffset).toBeLessThanOrEqual(1)
    expect(driver.isReleased()).toBe(true)
  })

  test.each(['no-motion', 'tick-stalled', 'velocity-stuck'] as const)(
    'collector feedback 边界 %s 由总 deadline 收口且不遗留按键',
    async (mode) => {
      const base = createQuantizedCollectorDriver(800, 600, {
        movementEnabled: mode !== 'no-motion',
      })
      let frozenTick: number | undefined
      const readPosition = async () => {
        const observed = await base.readPosition()
        if (
          mode !== 'no-motion' &&
          Math.abs(observed.collectorCenterX - 603.3333333333) < 0.05
        ) {
          frozenTick ??= observed.tick
        }
        return {
          ...observed,
          ...(mode === 'tick-stalled' && frozenTick !== undefined
            ? { tick: frozenTick }
            : {}),
          ...(mode === 'velocity-stuck' && frozenTick !== undefined
            ? { velocityX: 1 }
            : {}),
        }
      }
      await expect(
        alignM5VisualCollector({
          config: {
            ...loadFixture().coverage.materialAlignment,
            deadlineMilliseconds: 3_000,
          },
          motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
          ...base,
          readPosition,
        }),
      ).rejects.toThrow(/M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT/)
      expect(base.isReleased()).toBe(true)
    },
  )

  test('collector 总 deadline 覆盖所有异步边界且按键超时仍尝试释放', async () => {
    const never = <T>(): Promise<T> => new Promise<T>(() => undefined)
    const stages = ['readPosition', 'focus', 'keyDown', 'wait', 'keyUp'] as const
    for (const stage of stages) {
      let now = 0
      let down = 0
      let up = 0
      let reads = 0
      const startedAt = Date.now()
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        alignM5VisualCollector({
          config: {
            leftKey: 'a',
            rightKey: 'd',
            maximumCenterOffset: 1,
            deadlineMilliseconds: 10,
            pollIntervalMilliseconds: 1,
            maximumCorrectionHoldMilliseconds: 2,
            settlePaddingMilliseconds: 0,
            feedbackActivationDirectionChanges: 2,
            feedbackPulseTicks: 1,
            feedbackVelocityTolerance: 0,
          },
          motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
          readPosition: async () => {
            reads += 1
            if (stage === 'readPosition') return never()
            return { collectorCenterX: 800, materialCenterX: 600 }
          },
          focus: async () => (stage === 'focus' ? never() : undefined),
          keyDown: async () => {
            down += 1
            if (stage === 'keyDown') return never()
          },
          keyUp: async () => {
            up += 1
            if (stage === 'keyUp') return never()
          },
          waitForMilliseconds: async (milliseconds) => {
            if (stage === 'wait') return never()
            now += milliseconds
          },
          now: () => now,
        }).then(
          () => 'RESOLVED',
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        ),
        new Promise<string>((resolvePromise) =>
          (watchdog = setTimeout(() => resolvePromise('PROBE_TIMEOUT'), 100)),
        ),
      ])
      clearTimeout(watchdog)
      const elapsedMilliseconds = Date.now() - startedAt

      expect(outcome).toBe('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT')
      expect(elapsedMilliseconds).toBeLessThan(100)
      expect(reads).toBe(1)
      if (stage === 'keyDown' || stage === 'wait' || stage === 'keyUp') {
        expect(down).toBe(1)
        expect(up).toBe(1)
      }
    }
  })

  test('collector keyDown 超时后若按键副作用迟到生效，会异步补偿释放且不延迟主超时', async () => {
    let pressed = false
    let downCalls = 0
    let upCalls = 0
    const order: string[] = []
    const startedAt = Date.now()

    const outcome = await alignM5VisualCollector({
      config: {
        leftKey: 'a',
        rightKey: 'd',
        maximumCenterOffset: 1,
        deadlineMilliseconds: 10,
        pollIntervalMilliseconds: 1,
        maximumCorrectionHoldMilliseconds: 2,
        settlePaddingMilliseconds: 0,
        feedbackActivationDirectionChanges: 2,
        feedbackPulseTicks: 1,
        feedbackVelocityTolerance: 0,
      },
      motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
      readPosition: async () => ({ collectorCenterX: 800, materialCenterX: 600 }),
      focus: async () => undefined,
      keyDown: async () => {
        downCalls += 1
        order.push('keyDown-start')
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, 30),
        )
        pressed = true
        order.push('keyDown-effect')
      },
      keyUp: async () => {
        upCalls += 1
        pressed = false
        order.push('keyUp')
      },
      waitForMilliseconds: async () => undefined,
    }).then(
      () => 'RESOLVED',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    const returnedAfterMilliseconds = Date.now() - startedAt

    expect(outcome).toBe('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT')
    expect(returnedAfterMilliseconds).toBeLessThan(100)
    expect(pressed).toBe(false)
    expect(upCalls).toBe(1)

    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50))

    expect(downCalls).toBe(1)
    expect(pressed).toBe(false)
    expect(upCalls).toBeGreaterThanOrEqual(2)
    expect(order).toEqual([
      'keyDown-start',
      'keyUp',
      'keyDown-effect',
      'keyUp',
    ])
  })

  test.each(['reject', 'never'] as const)(
    'collector 迟到补偿 keyUp=%s 时会消费其 Promise 且不会复活或拖延已返回的主超时',
    async (compensationOutcome) => {
      let upCalls = 0
      let unhandledRejection: unknown
      const onUnhandledRejection = (error: unknown) => {
        unhandledRejection = error
      }
      process.on('unhandledRejection', onUnhandledRejection)
      try {
        const startedAt = Date.now()
        const outcome = await alignM5VisualCollector({
          config: {
            leftKey: 'a',
            rightKey: 'd',
            maximumCenterOffset: 1,
            deadlineMilliseconds: 10,
            pollIntervalMilliseconds: 1,
            maximumCorrectionHoldMilliseconds: 2,
            settlePaddingMilliseconds: 0,
            feedbackActivationDirectionChanges: 2,
            feedbackPulseTicks: 1,
            feedbackVelocityTolerance: 0,
          },
          motion: { acceleration: 1_200, deceleration: 1_600, maxSpeed: 500 },
          readPosition: async () => ({
            collectorCenterX: 800,
            materialCenterX: 600,
          }),
          focus: async () => undefined,
          keyDown: async () => {
            await new Promise<void>((resolvePromise) =>
              setTimeout(resolvePromise, 30),
            )
          },
          keyUp: async () => {
            upCalls += 1
            if (upCalls === 1) return
            if (compensationOutcome === 'never') {
              return new Promise<void>(() => undefined)
            }
            await new Promise<void>((resolvePromise) =>
              setTimeout(resolvePromise, 5),
            )
            throw new Error('EXPECTED_LATE_COMPENSATION_REJECTION')
          },
          waitForMilliseconds: async () => undefined,
        }).then(
          () => 'RESOLVED',
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        )
        const returnedAfterMilliseconds = Date.now() - startedAt

        expect(outcome).toBe('M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_TIMEOUT')
        expect(returnedAfterMilliseconds).toBeLessThan(100)
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50))
        expect(upCalls).toBeGreaterThanOrEqual(2)
        expect(unhandledRejection).toBeUndefined()
      } finally {
        process.off('unhandledRejection', onUnhandledRejection)
      }
    },
  )

  test('collector runner 的配置 fetch 与实时位置 evaluate 都使用既有有界控制', () => {
    const source = runnerSource()
    const configReader = source.slice(
      source.indexOf('async function readCollectorMotionConfig'),
      source.indexOf('async function readMaterialTopologyState'),
    )
    const materialRunner = source.slice(
      source.indexOf('async function runMaterialTopologyCases'),
      source.indexOf('async function runWarningCases'),
    )

    expect(configReader).toContain('AbortController')
    expect(configReader).toContain('runM5VisualEvidenceWithTimeout')
    expect(materialRunner).toContain('readCollectorMotionConfig(')
    expect(materialRunner).toContain('coverageCase.fireSourceId,')
    expect(materialRunner).toContain('readPosition: async ()')
    expect(materialRunner).toContain('runM5VisualEvidenceWithTimeout')
    expect(materialRunner).toContain(
      'M5_VISUAL_EVIDENCE_COLLECTOR_ALIGNMENT_POSITION_TIMEOUT',
    )
  })

  test('材料截图边界锁定同 session/实例/identity/placement/尺寸与双网格 hash', () => {
    const source = runnerSource()
    const observation = source.slice(
      source.indexOf('function topologyObservation'),
      source.indexOf('function materialTopologyChecks'),
    )
    const checks = source.slice(
      source.indexOf('function materialTopologyChecks'),
      source.indexOf('function materialStopReached'),
    )
    for (const field of [
      'sessionId',
      'materialInstanceId',
      'materialDefinitionId',
      'inventoryBatchId',
      'placement',
      'gridWidth',
      'gridHeight',
      'initialGridSha256',
      'remainingGridSha256',
    ]) {
      expect(observation).toContain(field)
    }
    expect(checks).toContain('createM5VisualMaterialTopologyBoundaryChecks')
  })

  test('材料截图纯边界检查逐项拒绝实例、session、identity、placement、尺寸与 hash 漂移', () => {
    const baseline = {
      sessionId: 'session-1',
      materialInstanceId: 'material-1',
      materialDefinitionId: 'red_whisker_ginseng',
      inventoryBatchId: 'red_whisker_ginseng_fresh_wild_10',
      placement: {
        center: { x: 600, y: 285 },
        width: 160,
        height: 160,
        rotationRadians: 0,
        layer: 0,
      },
      gridWidth: 64,
      gridHeight: 64,
      initialGridSha256: 'a'.repeat(64),
      remainingGridSha256: 'b'.repeat(64),
    }
    expect(
      createM5VisualMaterialTopologyBoundaryChecks({
        before: baseline,
        after: structuredClone(baseline),
      }).every(({ passed }) => passed),
    ).toBe(true)
    const mutations = [
      [
        'material-session-stable-across-screenshot',
        (after: any) => { after.sessionId = 'session-2' },
      ],
      [
        'material-instance-stable-across-screenshot',
        (after: any) => { after.materialInstanceId = 'material-2' },
      ],
      [
        'material-identity-stable-across-screenshot',
        (after: any) => { after.materialDefinitionId = 'other' },
      ],
      [
        'material-identity-stable-across-screenshot',
        (after: any) => { after.inventoryBatchId = 'other-batch' },
      ],
      [
        'material-placement-stable-across-screenshot',
        (after: any) => { after.placement.center.x += 1 },
      ],
      [
        'material-grid-dimensions-stable-across-screenshot',
        (after: any) => { after.gridWidth = 63 },
      ],
      [
        'material-grid-dimensions-stable-across-screenshot',
        (after: any) => { after.gridHeight = 63 },
      ],
      [
        'material-initial-grid-stable-across-screenshot',
        (after: any) => { after.initialGridSha256 = 'c'.repeat(64) },
      ],
      [
        'material-remaining-grid-stable-across-screenshot',
        (after: any) => { after.remainingGridSha256 = 'd'.repeat(64) },
      ],
    ] as const
    for (const [checkId, mutate] of mutations) {
      const after = structuredClone(baseline)
      mutate(after)
      expect(
        createM5VisualMaterialTopologyBoundaryChecks({
          before: baseline,
          after,
        }).find(({ id }) => id === checkId),
      ).toMatchObject({ passed: false })
    }
  })

  test('warning1/2 必须来自真实 level、DOM中文、LossWarningChanged 与当前 presentation effect', () => {
    const source = runnerSource()
    const warningTransition = source.slice(
      source.indexOf('function warningTransitionExpression'),
      source.indexOf('function warningChecks'),
    )
    const warningRunner = source.slice(
      source.indexOf('async function runWarningCases'),
      source.indexOf('async function runCoverageCases'),
    )
    expect(warningTransition).toContain('getPresentationEvidence')
    expect(warningTransition).toContain('[data-loss-warning][data-level]')
    expect(warningTransition).toContain('LossWarningChanged')
    expect(warningTransition).toContain('activeEffectKinds')
    expect(warningTransition).toContain('expectedMessageZh')
    expect(warningTransition).toContain('expectedEffect')
    expect(warningTransition).toContain('warningLevel')
    expect(warningRunner).toContain('warningTransitionExpression')
    expect(warningRunner).toContain('stopSprayingAtWarningLevel')
    expect(warningRunner).toContain('getMaterialTopologyEvidence')
    expect(warningRunner).toContain('inventoryBatchId')
    expect(warningRunner).toContain('contentPlacement.center')
    expect(warningRunner).toContain(
      'assertM5MaterialEvidenceTargetMatchesContentCenter',
    )
    expect(warningRunner).toContain(
      'await aimAtLogicalPoint(page, authoritativeTarget)',
    )
    expect(warningRunner).not.toContain(
      'await aimAtLogicalPoint(page, flow.logicalTarget)',
    )
    expect(warningRunner.indexOf('page.mouse.up()')).toBeLessThan(
      warningRunner.indexOf('const record = await capturePage'),
    )
    expect(warningRunner).not.toContain('openGallery')
    expect(warningRunner).not.toContain('__LIANDAN_M5_PERFORMANCE__')
  })

  test('warning transition 首次命中即锁存，截图边界不再读取 volatile 旧事件', () => {
    const source = runnerSource()
    const support = supportSource()
    const warningTransition = source.slice(
      source.indexOf('function warningTransitionExpression'),
      source.indexOf('function warningChecks'),
    )
    const warningChecksSource = source.slice(
      source.indexOf('function warningChecks'),
      source.indexOf('async function runWarningCases'),
    )
    const warningRunner = source.slice(
      source.indexOf('async function runWarningCases'),
      source.indexOf('async function runCoverageCases'),
    )
    expect(warningRunner).toContain('latchedWarning')
    expect(warningTransition).toContain("eventType: 'LossWarningChanged'")
    expect(warningTransition).toContain('eventObserved: true')
    expect(warningTransition).toContain('sessionId')
    expect(warningTransition).toContain('tick')
    expect(warningChecksSource).not.toContain(
      'passed: evidence.lossWarningChangedObserved',
    )
    expect(warningChecksSource).toContain('createM5VisualWarningBoundaryChecks')
    expect(support).toContain('latchedWarning.tick <= current.tick')
    expect(support).toContain(
      'latchedWarning.sessionId === current.sessionId',
    )
  })

  test('warning 锁存不受后续 PearlDamaged 覆盖，错误 session/tick/effect 必败', () => {
    const latchedWarning = {
      sessionId: 'session-1',
      tick: 100,
      eventObserved: true,
      eventType: 'LossWarningChanged',
      level: 2,
      effectKind: 'warningTwo',
    } as const
    const current = {
      sessionId: 'session-1',
      tick: 102,
      domainStatus: 'extracting',
      failurePresentationState: 'idle',
      actualLevel: 2,
      domLevel: '2',
      domText: '药性濒临溃散，尽快收束火势。',
      domVisible: true,
      activeEffectKinds: ['warningTwo'],
    }
    const laterVolatileDomainEvents = ['PearlDamaged']
    expect(laterVolatileDomainEvents).not.toContain('LossWarningChanged')
    expect(
      createM5VisualWarningBoundaryChecks({
        boundary: 'after',
        expectedLevel: 2,
        expectedMessageZh: '药性濒临溃散，尽快收束火势。',
        expectedEffect: 'warningTwo',
        latchedWarning,
        current,
      }).every(({ passed }) => passed),
    ).toBe(true)

    for (const [checkId, changedLatch, changedCurrent] of [
      [
        'warning-session-stable-after',
        latchedWarning,
        { ...current, sessionId: 'session-2' },
      ],
      [
        'warning-latched-tick-not-after-boundary-after',
        latchedWarning,
        { ...current, tick: 99 },
      ],
      [
        'warning-presentation-effect-after',
        latchedWarning,
        { ...current, activeEffectKinds: ['damage'] },
      ],
      [
        'warning-transition-latched-after',
        { ...latchedWarning, effectKind: 'warningOne' as const },
        current,
      ],
      [
        'warning-domain-extracting-after',
        latchedWarning,
        { ...current, domainStatus: 'failed' },
      ],
      [
        'warning-failure-presentation-idle-after',
        latchedWarning,
        { ...current, failurePresentationState: 'charring' },
      ],
    ] as const) {
      expect(
        createM5VisualWarningBoundaryChecks({
          boundary: 'after',
          expectedLevel: 2,
          expectedMessageZh: '药性濒临溃散，尽快收束火势。',
          expectedEffect: 'warningTwo',
          latchedWarning: changedLatch,
          current: changedCurrent,
        }).find(({ id }) => id === checkId),
      ).toMatchObject({ passed: false })
    }
  })

  test('warning2 在命中轮次立即请求停火，截图前必须稳定在 extracting/idle', () => {
    const source = runnerSource()
    const warningTransition = source.slice(
      source.indexOf('function warningTransitionExpression'),
      source.indexOf('function warningChecks'),
    )
    const warningRunner = source.slice(
      source.indexOf('async function runWarningCases'),
      source.indexOf('async function runCoverageCases'),
    )
    const transitionIndex = warningTransition.indexOf(
      'const transitionMatches =',
    )
    const immediateStopIndex = warningTransition.indexOf(
      "new PointerEvent('pointerup'",
    )
    const latchReturnIndex = warningTransition.indexOf(
      'return Object.freeze({',
      transitionIndex,
    )
    const terminalWaitIndex = warningRunner.indexOf(
      "stoppedState.status === 'extracting'",
    )
    const controlledLatchIndex = warningRunner.indexOf(
      'latchedWarning = Object.freeze(transition)',
    )
    const captureIndex = warningRunner.indexOf(
      'const record = await capturePage',
    )

    expect(transitionIndex).toBeGreaterThanOrEqual(0)
    expect(immediateStopIndex).toBeGreaterThan(transitionIndex)
    expect(immediateStopIndex).toBeLessThan(latchReturnIndex)
    expect(warningRunner).toContain(
      "stoppedState.failurePresentationState === 'idle'",
    )
    expect(terminalWaitIndex).toBeGreaterThan(controlledLatchIndex)
    expect(terminalWaitIndex).toBeLessThan(captureIndex)
    expect(warningRunner).toContain('acquireWarningPageClockPause(')
    expect(
      warningRunner.indexOf('await acquireWarningPageClockPause('),
    ).toBeLessThan(warningRunner.indexOf('const transitionHandle'))
    expect(warningRunner).toContain('page.clock.runFor(')
    expect(warningRunner).toContain("mode: 'sequence-held'")
    expect(warningRunner).toContain("resumeOwner: 'sequence-finally'")
    expect(warningRunner).toContain(
      'maximumStoppedCaptureTickDrift',
    )
    expect(
      warningRunner.match(
        /if \(warningClockPaused\) await page\.clock\.resume\(\)/g,
      ),
    ).toHaveLength(1)
  })

  test('warning2 截图边界允许4 tick，拒绝5 tick与 reviewer 的10 tick漂移', () => {
    const latchedWarning = {
      sessionId: 'session-1',
      tick: 1609,
      eventObserved: true,
      eventType: 'LossWarningChanged',
      level: 2,
      effectKind: 'warningTwo',
    } as const
    const driftCheck = (
      tick: number,
      domainStatus = 'extracting',
      failurePresentationState = 'idle',
    ) =>
      createM5VisualWarningBoundaryChecks({
        boundary: 'before',
        expectedLevel: 2,
        expectedMessageZh: '药性濒临溃散，尽快收束火势。',
        expectedEffect: 'warningTwo',
        latchedWarning,
        maximumCaptureTickDrift: 4,
        current: {
          sessionId: 'session-1',
          tick,
          domainStatus,
          failurePresentationState,
          actualLevel: 2,
          domLevel: '2',
          domText: '药性濒临溃散，尽快收束火势。',
          domVisible: true,
          activeEffectKinds: ['warningTwo'],
        },
      }).find(
        ({ id }) => id === 'warning-latched-tick-drift-bounded-before',
      )

    expect(driftCheck(1613)).toMatchObject({
      passed: true,
      actual: 4,
      expected: '<=4',
    })
    expect(driftCheck(1614)).toMatchObject({
      passed: false,
      actual: 5,
      expected: '<=4',
    })
    expect(driftCheck(1619, 'failed', 'charring')).toMatchObject({
      passed: false,
      actual: 10,
      expected: '<=4',
    })
  })

  test('M2 最大火力 coverage 读取当前 canvas 局部光强，不固定写成人工失败', () => {
    const source = runnerSource()
    expect(source).not.toContain("id: 'local-light-visible-needs-human-confirmation'")
    expect(source).toContain('localLightIntensity')
    expect(source).toContain('local-light-current-frame-visible')
  })

  test('runner 从早期 fatal 开始审计，所有外部操作有界且写报告不阻断清理', () => {
    const source = runnerSource()
    const main = source.slice(source.indexOf('async function main'))
    const firstTry = main.indexOf('  try {')
    expect(main.indexOf('const fixtureSource')).toBeGreaterThan(firstTry)
    expect(main.indexOf('gitMetadata()')).toBeGreaterThan(firstTry)
    expect(source).toMatch(
      /runM5VisualEvidenceWithTimeout\(\s*runtime\.browser\.newContext/,
    )
    expect(source).toMatch(/execFileSync\([\s\S]*timeout:/)
    expect(source).toMatch(/void main\([^)]*\)\.catch/)
    expect(source).toContain('M5_VISUAL_EVIDENCE_PREVIEW_LOG_WRITE_FAILED')
    const drainIndex = source.indexOf('await drainM5VisualLateCleanupRegistry(')
    expect(drainIndex).toBeGreaterThan(source.indexOf('await closeBrowsers('))
    expect(drainIndex).toBeLessThan(
      source.indexOf('manifest.finishedAt = new Date().toISOString()'),
    )
    expect(source).toContain(
      'fixture.protocol.timeouts.lateCleanupDrainMilliseconds',
    )
  })

  test('布局契约拒绝所有固定核心控件隐藏形成的 0/0 假通过', () => {
    const baseline = createLayoutObservation()
    const hidden: M5VisualLayoutObservation = {
      ...baseline,
      controls: baseline.controls.map((control) => ({
        ...control,
        visibleCount: 0,
        nonZeroRectCount: 0,
        reachableCount: 0,
      })),
    }
    expect(coreLayoutCheck(hidden)).toMatchObject({ passed: false })
  })

  test('布局契约拒绝 finish 存在但零尺寸，即使它处于正常 disabled 状态', () => {
    const baseline = createLayoutObservation()
    const finishZeroRect: M5VisualLayoutObservation = {
      ...baseline,
      controls: baseline.controls.map((control) =>
        control.id === 'finish'
          ? { ...control, nonZeroRectCount: 0, reachableCount: 0 }
          : control,
      ),
    }
    expect(coreLayoutCheck(finishZeroRect)).toMatchObject({ passed: false })
  })

  test('布局契约要求 900/950 窄屏存在真实纵向滚动', () => {
    const baseline = createLayoutObservation()
    expect(
      coreLayoutCheck({
        ...baseline,
        scrollHeight: baseline.innerHeight,
        maximumScrollY: 0,
        observedMaximumScrollY: 0,
      }),
    ).toMatchObject({ passed: false })
  })

  test('布局契约拒绝控件被 overflow hidden 祖先裁切', () => {
    const baseline = createLayoutObservation()
    const clipped: M5VisualLayoutObservation = {
      ...baseline,
      controls: baseline.controls.map((control) =>
        control.id === 'finish'
          ? { ...control, clippedByAncestorCount: 1 }
          : control,
      ),
    }
    expect(coreLayoutCheck(clipped)).toMatchObject({ passed: false })
  })

  test('布局契约拒绝几何可达但中心命中被其他面板覆盖的控件', () => {
    const baseline = createLayoutObservation()
    const intercepted: M5VisualLayoutObservation = {
      ...baseline,
      controls: baseline.controls.map((control) =>
        control.id === 'inventory-materials'
          ? { ...control, hitTestCount: control.matchCount - 1 }
          : control,
      ),
    }
    expect(coreLayoutCheck(intercepted)).toMatchObject({ passed: false })
  })

  test('headed 证据浏览器以单一 launch args 事实源派生静音 provenance 并纳入门禁', () => {
    const source = runnerSource()
    expect(loadFixture().protocol.browserLaunchArgs).toEqual(
      expect.arrayContaining(['--force-device-scale-factor=1', '--mute-audio']),
    )
    expect(source).not.toContain('audioMutedByBrowser: true')
    const gate = source.slice(
      source.indexOf('function automatedGate('),
      source.indexOf('function buildReportMarkdown'),
    )
    expect(gate).toContain('browsers')
    expect(gate).toContain('launchArgs')
    expect(gate).toContain('audioMutedByBrowser')
    expect(source).not.toContain('全部由 --mute-audio 实测约束')
    expect(source).toContain('启动参数审计')
  })

  test('PNG 尺寸按显式截图模式和 document client/scroll 尺寸计算，不能由 artifact 反推', () => {
    const base = {
      viewport: { width: 900, height: 700, deviceScaleFactor: 2 },
      reducedMotion: false,
      visionMode: 'normal' as const,
      colorMatrix: [
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        0, 0, 0, 1, 0,
      ],
      seed: 20260715,
      observedSeed: 20260715,
      environment: {
        innerWidth: 900,
        innerHeight: 700,
        documentClientWidth: 885,
        documentClientHeight: 700,
        documentScrollWidth: 885,
        documentScrollHeight: 1_100,
        devicePixelRatio: 2,
        prefersReducedMotion: false,
        computedFilter: 'none',
        visionModeDataset: 'normal',
        colorMatrixDataset: '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0',
        audioMutedByBrowser: true,
      },
    }
    const fullPage = createM5VisualBrowserEnvironmentChecks({
      ...base,
      screenshotMode: 'full-page',
      artifact: { width: 1_770, height: 2_200 },
    } as any)
    const viewport = createM5VisualBrowserEnvironmentChecks({
      ...base,
      screenshotMode: 'viewport',
      artifact: { width: 1_800, height: 1_400 },
    } as any)

    expect(
      fullPage.find(({ id }) => id === 'measured-png-full-page-pixel-size'),
    ).toMatchObject({ passed: true, expected: '1770x2200' })
    expect(
      viewport.find(({ id }) => id === 'measured-png-viewport-pixel-size'),
    ).toMatchObject({ passed: true, expected: '1800x1400' })
  })

  test('缺格、重复格和意外格均拒绝，不允许挑图', () => {
    const expected = expandM5VisualEvidenceMatrix(loadFixture())
    const complete = expected.map(({ id }) => ({ caseId: id }))

    expect(() =>
      assertM5VisualEvidenceCellCoverage(expected, complete.slice(1)),
    ).toThrow(/M5_VISUAL_EVIDENCE_CASE_MISSING/)
    expect(() =>
      assertM5VisualEvidenceCellCoverage(expected, [
        ...complete,
        complete[0]!,
      ]),
    ).toThrow(/M5_VISUAL_EVIDENCE_CASE_DUPLICATED/)
    expect(() =>
      assertM5VisualEvidenceCellCoverage(expected, [
        ...complete,
        { caseId: 'unexpected/candidate' },
      ]),
    ).toThrow(/M5_VISUAL_EVIDENCE_CASE_UNEXPECTED/)
  })

  test('捕获记录逐项复核 PNG 哈希、尺寸与强制元数据', () => {
    const outputDirectory = createTemporaryDirectory()
    const png = new PNG({ width: 2, height: 3 })
    png.data.fill(0x7f)
    const bytes = PNG.sync.write(png)
    const relativePath = 'raw/evidence.png'
    const absolutePath = resolve(outputDirectory, relativePath)
    const rawDirectory = resolve(outputDirectory, 'raw')
    // 测试运行时的临时目录不属于仓库产物，允许直接创建。
    mkdirSync(rawDirectory, { recursive: true })
    writeFileSync(absolutePath, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const record: M5VisualEvidenceCaptureRecord = {
      caseId: 'layout/stable-chrome/1920x1080@dpr1',
      section: 'layout',
      kind: 'raw-frame',
      status: 'captured',
      capturedAt: '2026-07-15T00:00:00.000Z',
      artifact: { relativePath, width: 2, height: 3, sha256 },
      context: {
        domainEvents: ['SessionReady'],
        presentationState: 'ready',
        build: {
          runId: 'evidence-run',
          distSha256: 'a'.repeat(64),
        },
        fingerprints: {
          simulation: 'b'.repeat(64),
          presentation: 'c'.repeat(64),
        },
        viewport: { width: 2, height: 3, deviceScaleFactor: 1 },
        browser: {
          id: 'stable-chrome',
          engine: 'chromium',
          channel: 'chrome',
          version: '126.0.0.0',
        },
        environment: {
          innerWidth: 2,
          innerHeight: 3,
          documentClientWidth: 2,
          documentClientHeight: 3,
          documentScrollWidth: 2,
          documentScrollHeight: 3,
          devicePixelRatio: 1,
          prefersReducedMotion: false,
          computedFilter: 'none',
          visionModeDataset: 'normal',
          colorMatrixDataset:
            '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0',
          audioMutedByBrowser: true,
        },
        screenshotMode: 'full-page',
        os: { platform: 'win32', release: '10.0', arch: 'x64' },
        reducedMotion: false,
        visionMode: 'normal',
        colorMatrix: [
          1, 0, 0, 0, 0,
          0, 1, 0, 0, 0,
          0, 0, 1, 0, 0,
          0, 0, 0, 1, 0,
        ],
        seed: 20260715,
        sessionId: 'session-000001',
        tick: 42,
        consoleErrors: [],
        pageErrors: [],
        requestErrors: [],
        checks: [{ id: 'app-ready', passed: true, actual: 'ready' }],
        observableState: { seed: 20260715 },
      },
    }

    expect(() =>
      validateM5VisualEvidenceCaptureRecord(record, outputDirectory),
    ).not.toThrow()
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          artifact: { ...record.artifact, width: 4 },
        },
        outputDirectory,
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_PNG_WIDTH_MISMATCH/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          artifact: { ...record.artifact, sha256: 'd'.repeat(64) },
        },
        outputDirectory,
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_PNG_SHA256_MISMATCH/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: { ...record.context, domainEvents: [] },
        },
        outputDirectory,
      ),
    ).toThrow(/M5_VISUAL_EVIDENCE_METADATA_DOMAIN_EVENTS_MISSING/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: {
            ...record.context,
            viewport: { ...record.context.viewport, deviceScaleFactor: 2 },
          },
        },
        outputDirectory,
      ),
    ).toThrow(/measured-device-pixel-ratio/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: { ...record.context, reducedMotion: true },
        },
        outputDirectory,
      ),
    ).toThrow(/measured-reduced-motion/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: {
            ...record.context,
            visionMode: 'grayscale',
            colorMatrix: [
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0, 0, 0, 1, 0,
            ],
            environment: {
              ...record.context.environment,
              visionModeDataset: 'grayscale',
              colorMatrixDataset:
                '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0',
              computedFilter: 'none',
            },
          },
        },
        outputDirectory,
      ),
    ).toThrow(/measured-computed-vision-filter/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: {
            ...record.context,
            observableState: { seed: 7 },
          },
        },
        outputDirectory,
      ),
    ).toThrow(/measured-authoritative-seed/)
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(
        {
          ...record,
          context: {
            ...record.context,
            environment: {
              ...record.context.environment,
              audioMutedByBrowser: false,
            },
          },
        },
        outputDirectory,
      ),
    ).toThrow(/browser-audio-muted-by-launch-arg/)

    const contactRelativePath = 'contact-sheets/fire/startup.png'
    const contactAbsolutePath = resolve(outputDirectory, contactRelativePath)
    mkdirSync(resolve(outputDirectory, 'contact-sheets', 'fire'), {
      recursive: true,
    })
    const contactArtifact = createM5VisualEvidenceContactSheet(
      [absolutePath],
      contactAbsolutePath,
      { columns: 1, gapPixels: 1, backgroundColor: '#12100E' },
    )
    const contactRecord: M5VisualEvidenceCaptureRecord = {
      ...record,
      caseId: 'fire/contact/60/center/startup',
      section: 'fire',
      kind: 'contact-sheet',
      artifact: { relativePath: contactRelativePath, ...contactArtifact },
      sourceCaseIds: [record.caseId],
      context: createM5VisualContactSheetContext({
        phaseId: 'startup',
        sourceCaseIds: [record.caseId],
        sources: [record],
      }),
    }
    expect(() =>
      validateM5VisualEvidenceCaptureRecord(contactRecord, outputDirectory),
    ).not.toThrow()
  })

  test('火焰相位拒绝错误 release 状态与超出配置上限的迟到截图', () => {
    const wrongRelease = createM5VisualFirePhaseChecks({
      phaseId: 'release',
      configuredOffsetMilliseconds: 80,
      screenshotStartedOffsetMilliseconds: 90,
      screenshotFinishedOffsetMilliseconds: 100,
      maximumSampleLatenessMilliseconds: 40,
      before: { firePresentationState: 'steady', isSpraying: true },
      after: { firePresentationState: 'steady', isSpraying: true },
    })
    expect(wrongRelease.some(({ passed }) => !passed)).toBe(true)

    const lateStartup = createM5VisualFirePhaseChecks({
      phaseId: 'startup',
      configuredOffsetMilliseconds: 0,
      screenshotStartedOffsetMilliseconds: 81,
      screenshotFinishedOffsetMilliseconds: 90,
      maximumSampleLatenessMilliseconds: 80,
      before: { firePresentationState: 'emerging', isSpraying: true },
      after: { firePresentationState: 'emerging', isSpraying: true },
    })
    expect(
      lateStartup.find(({ id }) => id === 'phase-screenshot-lateness-bounded'),
    ).toMatchObject({ passed: false })

    const earlyStartup = createM5VisualFirePhaseChecks({
      phaseId: 'startup',
      configuredOffsetMilliseconds: 80,
      screenshotStartedOffsetMilliseconds: 79,
      screenshotFinishedOffsetMilliseconds: 79,
      maximumSampleLatenessMilliseconds: 80,
      before: { firePresentationState: 'emerging', isSpraying: true },
      after: { firePresentationState: 'emerging', isSpraying: true },
    })
    expect(
      earlyStartup.find(({ id }) => id === 'phase-screenshot-not-early'),
    ).toMatchObject({ passed: false })
  })

  test('四条冻结截图路径显式在 pause 前取得 opaque token，capture critical 只验证 token', () => {
    const source = runnerSource()
    const capture = source.slice(
      source.indexOf('async function capturePage'),
      source.indexOf('function checksPassed'),
    )
    const critical = capture.slice(
      capture.indexOf('const performCapture'),
      capture.indexOf('const clockAudit'),
    )
    expect(critical).not.toContain('await applyVisionTransform(')
    expect(critical).not.toContain('requestAnimationFrame')
    expect(capture).toContain('assertM5VisualVisionTransformPrepared')
    expect(capture).toContain('visionTransformToken')

    const clockPaths = [
      source.slice(
        source.indexOf('async function captureTimedFirePhase'),
        source.indexOf('type GalleryFixtureEvidence'),
      ),
      source.slice(
        source.indexOf('async function runMaterialTopologyCases'),
        source.indexOf('async function readWarningState'),
      ),
      source.slice(
        source.indexOf('async function runWarningCases'),
        source.indexOf('async function runCoverageCases'),
      ),
      source.slice(
        source.indexOf('async function runFailureCases'),
        source.indexOf('function automatedGate'),
      ),
    ]
    for (const path of clockPaths) {
      expect(path).toContain('await applyVisionTransform(')
      expect(path).toContain('visionTransformToken')
      expect(path).not.toContain('visionTransformPrepared: true')
    }
  })

  test('短命状态与时序截图都由通用 clock 抽象冻结，序列只在 finally 恢复一次', () => {
    const runner = runnerSource()
    const fireRunner = runner.slice(
      runner.indexOf('async function runFirePhaseTrace'),
      runner.indexOf('type GalleryFixtureEvidence'),
    )
    const materialRunner = runner.slice(
      runner.indexOf('async function runMaterialTopologyCases'),
      runner.indexOf('async function runWarningCases'),
    )
    const warningRunner = runner.slice(
      runner.indexOf('async function runWarningCases'),
      runner.indexOf('async function runCoverageCases'),
    )
    const failureRunner = runner.slice(
      runner.indexOf('async function runFailureCases'),
      runner.indexOf('function automatedGate'),
    )

    for (const source of [fireRunner, materialRunner, warningRunner, failureRunner]) {
      expect(source.indexOf('page.clock.install')).toBeGreaterThanOrEqual(0)
      expect(source.indexOf('page.clock.install')).toBeLessThan(
        source.indexOf('openM2('),
      )
    }
    expect(fireRunner).toContain('advanceToFirePhase(')
    expect(runner).toContain('page.clock.runFor')
    expect(fireRunner).not.toContain('page.waitForTimeout(remaining)')
    expect(materialRunner).toContain("mode: 'transient'")
    expect(warningRunner).toContain("mode: 'transient'")
    expect(failureRunner).toContain('advanceToFailurePhaseTarget(')
    expect(failureRunner.match(/page\.clock\.resume\(\)/g)).toHaveLength(1)
    expect(runner).toContain("mode: 'sequence-held'")
    expect(runner).toContain('transient-clock-installed-paused')
    expect(runner).not.toContain('failure-clock-installed-paused-resumed')
  })

  test('failure 六相使用独立目标进度，拒绝复用 PNG 与未完成 result', () => {
    const thresholds = {
      shatteringStartRatio: 0.24,
      gatheringStartRatio: 0.5,
      flyingStartRatio: 0.8,
    }
    expect(targetFailureProgress('charring', thresholds)).toBe(0.12)
    expect(targetFailureProgress('shattering', thresholds)).toBe(0.37)
    const phases = [
      'trigger',
      'charring',
      'shattering',
      'gathering',
      'flying',
      'result',
    ] as const
    const states = [
      'charring',
      'charring',
      'shattering',
      'gathering',
      'flying',
      'result',
    ] as const
    const progress = [0.01, 0.12, 0.37, 0.65, 0.9, 1]
    const entries = phases.map((phase, index) => ({
      phase,
      failurePresentationState: states[index]!,
      failurePresentationProgress: progress[index]!,
      failurePresentationComplete: phase === 'result',
      sha256: String(index).padStart(64, '0'),
    }))
    expect(() => assertM5VisualFailureCaptureSequence(entries)).not.toThrow()
    expect(() =>
      assertM5VisualFailureCaptureSequence([
        { ...entries[0]!, sha256: entries[1]!.sha256 },
        ...entries.slice(1),
      ]),
    ).toThrow(/FAILURE_SEQUENCE_PNG_REUSED/)
    expect(() =>
      assertM5VisualFailureCaptureSequence([
        ...entries.slice(0, -1),
        { ...entries.at(-1)!, failurePresentationComplete: false },
      ]),
    ).toThrow(/FAILURE_SEQUENCE_RESULT_INCOMPLETE/)

    const incompleteResult = createM5VisualFailurePhaseChecks({
      phase: 'result',
      thresholds,
      before: {
        sessionId: 'session-1',
        tick: 1,
        domainStatus: 'failed',
        failurePresentationState: 'result',
        failurePresentationProgress: 1,
        failurePresentationComplete: false,
      },
      after: {
        sessionId: 'session-1',
        tick: 1,
        domainStatus: 'failed',
        failurePresentationState: 'result',
        failurePresentationProgress: 1,
        failurePresentationComplete: false,
      },
    })
    expect(incompleteResult.some(({ passed }) => !passed)).toBe(true)
  })

  test('通用 transient clock helper 严格 pause/before/screenshot/after/resume，且如实审计一次恢复', async () => {
    const order: string[] = []
    const capture = await captureM5VisualTransientWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 10,
      pause: async () => {
        order.push('pause')
        return {
          attemptCount: 1,
          retryCount: 0,
          targetMilliseconds: 116,
        }
      },
      critical: async () => {
        order.push('before', 'screenshot', 'after')
        return 'captured'
      },
      resume: async () => { order.push('resume') },
    })
    expect(capture.value).toBe('captured')
    expect(capture.audit).toMatchObject({
      paused: true,
      resumed: true,
      pauseAcquisition: { attemptCount: 1, retryCount: 0 },
    })
    expect(order).toEqual([
      'pause',
      'before',
      'screenshot',
      'after',
      'resume',
    ])
  })

  test('failure clock helper 保留兼容语义：target 后 pause/before/screenshot/after/resume，错误与 never 均只恢复一次', async () => {
    const successOrder: string[] = ['target']
    const success = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 10,
      pause: async () => { successOrder.push('pause') },
      critical: async () => {
        successOrder.push('before', 'screenshot', 'after')
        return 'captured'
      },
      resume: async () => { successOrder.push('resume') },
    })
    expect(success.value).toBe('captured')
    expect(successOrder).toEqual([
      'target',
      'pause',
      'before',
      'screenshot',
      'after',
      'resume',
    ])

    const auditedPause = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 10,
      pause: async () => ({
        attemptCount: 2,
        retryCount: 1,
        targetMilliseconds: 216,
      }) as never,
      critical: async () => 'captured',
      resume: async () => undefined,
    })
    expect((auditedPause.audit as Record<string, unknown>)[
      'pauseAcquisition'
    ]).toEqual({
      attemptCount: 2,
      retryCount: 1,
      targetMilliseconds: 216,
    })

    for (const failingStage of ['pause', 'before', 'screenshot', 'after'] as const) {
      const primary = new Error(`PRIMARY_${failingStage}`)
      let resumeCalls = 0
      const outcome = await captureM5VisualFailurePhaseWithClock({
        maximumCaptureMilliseconds: 50,
        resumeReserveMilliseconds: 10,
        pause: async () => {
          if (failingStage === 'pause') throw primary
        },
        critical: async () => {
          if (failingStage !== 'pause') throw primary
          return 'unused'
        },
        resume: async () => { resumeCalls += 1 },
      }).catch((error: unknown) => error)
      expect(outcome).toBe(primary)
      expect(resumeCalls).toBe(failingStage === 'pause' ? 0 : 1)
    }

    const primary = new Error('PRIMARY_CAPTURE')
    const resumeFailure = new Error('RESUME_FAILURE')
    let resumeCalls = 0
    const combined = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 10,
      pause: async () => undefined,
      critical: async () => { throw primary },
      resume: async () => {
        resumeCalls += 1
        throw resumeFailure
      },
    }).catch((error: unknown) => error)
    expect(combined).toBeInstanceOf(AggregateError)
    expect((combined as AggregateError).cause).toBe(primary)
    expect((combined as AggregateError).errors).toEqual([primary, resumeFailure])
    expect(resumeCalls).toBe(1)

    for (const neverStage of ['critical', 'resume'] as const) {
      let neverResumeCalls = 0
      const startedAt = Date.now()
      const outcome = await Promise.race([
        captureM5VisualFailurePhaseWithClock({
          maximumCaptureMilliseconds: 30,
          resumeReserveMilliseconds: 10,
          pause: async () => undefined,
          critical: async () =>
            neverStage === 'critical'
              ? new Promise<string>(() => undefined)
              : 'captured',
          resume: async () => {
            neverResumeCalls += 1
            if (neverStage === 'resume') {
              await new Promise<void>(() => undefined)
            }
          },
        }).then(
          () => 'RESOLVED',
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        ),
        new Promise<string>((resolvePromise) =>
          setTimeout(() => resolvePromise('WATCHDOG_TIMEOUT'), 100),
        ),
      ])
      expect(outcome).not.toBe('WATCHDOG_TIMEOUT')
      expect(Date.now() - startedAt).toBeLessThan(100)
      expect(neverResumeCalls).toBe(neverStage === 'critical' ? 0 : 1)
    }

    const latePauseEvents: string[] = []
    let latePauseResumeCalls = 0
    const latePauseOutcome = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 40,
      resumeReserveMilliseconds: 20,
      pause: async () => {
        latePauseEvents.push('pause-start')
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, 30),
        )
        latePauseEvents.push('pause-late-success')
      },
      critical: async () => {
        latePauseEvents.push('critical')
        return 'unused'
      },
      resume: async () => {
        latePauseResumeCalls += 1
        latePauseEvents.push('resume')
      },
      quarantine: async () => { latePauseEvents.push('quarantine') },
    }).catch((error: unknown) => error)
    expect(latePauseOutcome).toBeInstanceOf(Error)
    expect((latePauseOutcome as Error).message).toContain(
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_PAUSE_TIMEOUT',
    )
    expect(latePauseResumeCalls).toBe(1)
    expect(latePauseEvents).toEqual([
      'pause-start',
      'pause-late-success',
      'resume',
      'quarantine',
    ])

    const lateCriticalEvents: string[] = []
    const lateCriticalOutcome = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 20,
      pause: async () => { lateCriticalEvents.push('pause') },
      critical: async () => {
        lateCriticalEvents.push('critical-start')
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, 40),
        )
        lateCriticalEvents.push('critical-late-finish')
      },
      resume: async () => { lateCriticalEvents.push('resume') },
      quarantine: async () => { lateCriticalEvents.push('quarantine') },
    }).catch((error: unknown) => error)
    expect(lateCriticalOutcome).toBeInstanceOf(Error)
    expect((lateCriticalOutcome as Error).message).toContain(
      'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CRITICAL_TIMEOUT',
    )
    expect(lateCriticalEvents).toEqual([
      'pause',
      'critical-start',
      'critical-late-finish',
      'resume',
      'quarantine',
    ])
  })

  test('通用 transient clock 使用通用错误码，legacy failure API 保留兼容错误码', async () => {
    await expect(
      captureM5VisualTransientWithClock({
        maximumCaptureMilliseconds: 20,
        resumeReserveMilliseconds: 20,
        pause: async () => undefined,
        critical: async () => 'unused',
        resume: async () => undefined,
      }),
    ).rejects.toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CONFIG_INVALID')
    await expect(
      captureM5VisualFailurePhaseWithClock({
        maximumCaptureMilliseconds: 20,
        resumeReserveMilliseconds: 20,
        pause: async () => undefined,
        critical: async () => 'unused',
        resume: async () => undefined,
      }),
    ).rejects.toThrow('M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CONFIG_INVALID')

    const genericSource = supportSource().slice(
      supportSource().indexOf('async function captureM5VisualClockCore'),
      supportSource().indexOf('export async function captureM5VisualFailurePhaseWithClock'),
    )
    expect(genericSource).toContain('M5VisualClockErrorCodes')
    expect(genericSource).not.toContain('FAILURE_CLOCK')
  })

  test('failure clock ownership timeout 会隔离当前 context，不启动下一 phase', async () => {
    const events: string[] = []
    let contextCloseCalls = 0
    let contextClosePromise: Promise<void> | undefined
    let abortCritical: (() => void) | undefined
    const closeContextOnce = (): Promise<void> => {
      contextClosePromise ??= Promise.resolve().then(() => {
        contextCloseCalls += 1
        events.push('context-close')
        abortCritical?.()
      })
      return contextClosePromise
    }
    try {
      for (const phase of ['current', 'next']) {
        events.push(`target:${phase}`)
        try {
          if (phase === 'current') {
            await captureM5VisualTransientWithClock({
              maximumCaptureMilliseconds: 30,
              resumeReserveMilliseconds: 10,
              pause: async () => { events.push('pause') },
              critical: async () => new Promise<void>((_resolve, reject) => {
                abortCritical = () => reject(new Error('CONTEXT_CLOSED'))
              }),
              resume: async () => { events.push('resume') },
              quarantine: closeContextOnce,
            })
          }
        } catch (error) {
          events.push('mark-failed')
          if (requiresM5VisualContextQuarantine(error)) throw error
        }
      }
    } catch {
      events.push('motion-failed')
    } finally {
      await closeContextOnce()
    }
    expect(events).toEqual([
      'target:current',
      'pause',
      'context-close',
      'mark-failed',
      'motion-failed',
    ])
    expect(contextCloseCalls).toBe(1)

    let resumeQuarantineCalls = 0
    let abortResume: (() => void) | undefined
    const resumeTimeout = await captureM5VisualTransientWithClock({
      maximumCaptureMilliseconds: 30,
      resumeReserveMilliseconds: 10,
      pause: async () => undefined,
      critical: async () => 'captured',
      resume: async () => new Promise<void>((_resolve, reject) => {
        abortResume = () => reject(new Error('CONTEXT_CLOSED'))
      }),
      quarantine: async () => {
        resumeQuarantineCalls += 1
        abortResume?.()
      },
    }).catch((error: unknown) => error)
    expect(requiresM5VisualContextQuarantine(resumeTimeout)).toBe(true)
    expect(resumeQuarantineCalls).toBe(1)

    const immediateCritical = new Error('IMMEDIATE_CRITICAL_FAILURE')
    let safeQuarantineCalls = 0
    const safeFailure = await captureM5VisualTransientWithClock({
      maximumCaptureMilliseconds: 30,
      resumeReserveMilliseconds: 10,
      pause: async () => undefined,
      critical: async () => { throw immediateCritical },
      resume: async () => undefined,
      quarantine: async () => { safeQuarantineCalls += 1 },
    }).catch((error: unknown) => error)
    expect(safeFailure).toBe(immediateCritical)
    expect(requiresM5VisualContextQuarantine(safeFailure)).toBe(false)
    expect(safeQuarantineCalls).toBe(0)

    const runner = runnerSource()
    expect(runner).toContain(
      'requiresM5VisualContextQuarantine(error)',
    )
  })

  test('failure clock quarantine 会消费被 context close 驳回的迟到 Promise', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      let abortCritical: (() => void) | undefined
      const outcome = await captureM5VisualTransientWithClock({
        maximumCaptureMilliseconds: 30,
        resumeReserveMilliseconds: 10,
        pause: async () => undefined,
        critical: async () => new Promise<void>((_resolve, reject) => {
          abortCritical = () => reject(new Error('PAGE_CLOSED'))
        }),
        resume: async () => undefined,
        quarantine: async () => { abortCritical?.() },
      }).catch((error: unknown) => error)
      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toContain(
        'M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CRITICAL_TIMEOUT',
      )
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('failure phase failed record 递归保留 capture 与 resume 双错', async () => {
    const support = await import('../../../scripts/m5-visual-evidence-support.ts')
    const createFailedRecord = (support as Record<string, unknown>)[
      'createM5VisualEvidenceFailedRecord'
    ] as undefined | ((input: Readonly<{
      caseId: string
      section: string
      kind: string
      error: unknown
    }>) => Record<string, unknown>)
    expect(createFailedRecord).toBeTypeOf('function')
    if (createFailedRecord === undefined) return
    const isInitialPlaceholder = (support as Record<string, unknown>)[
      'isM5VisualEvidenceInitialFailurePlaceholder'
    ] as undefined | ((record: unknown) => boolean)
    expect(isInitialPlaceholder).toBeTypeOf('function')
    if (isInitialPlaceholder === undefined) return

    const primary = new Error('BEFORE_OR_SCREENSHOT_ROOT')
    const resumeFailure = new Error('CLOCK_RESUME_ROOT')
    const combined = await captureM5VisualFailurePhaseWithClock({
      maximumCaptureMilliseconds: 50,
      resumeReserveMilliseconds: 10,
      pause: async () => undefined,
      critical: async () => { throw primary },
      resume: async () => { throw resumeFailure },
    }).catch((error: unknown) => error)
    const record = createFailedRecord({
      caseId: 'failure/normal/shattering',
      section: 'failure',
      kind: 'raw-frame',
      error: combined,
    })
    expect(record).toMatchObject({
      caseId: 'failure/normal/shattering',
      section: 'failure',
      kind: 'raw-frame',
      status: 'failed',
      reasonZh:
        'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CAPTURE_AND_RESUME_FAILED',
      error: {
        name: 'AggregateError',
        message:
          'M5_VISUAL_EVIDENCE_FAILURE_CLOCK_CAPTURE_AND_RESUME_FAILED',
        cause: { message: 'BEFORE_OR_SCREENSHOT_ROOT' },
        errors: [
          { message: 'BEFORE_OR_SCREENSHOT_ROOT' },
          { message: 'CLOCK_RESUME_ROOT' },
        ],
      },
    })
    const serialized = JSON.stringify(record)
    expect(serialized).toContain('BEFORE_OR_SCREENSHOT_ROOT')
    expect(serialized).toContain('CLOCK_RESUME_ROOT')
    expect(isInitialPlaceholder({
      caseId: 'failure/normal/gathering',
      section: 'failure',
      kind: 'raw-frame',
      status: 'failed',
      reasonZh: '采集尚未执行。',
    })).toBe(true)
    expect(isInitialPlaceholder(record)).toBe(false)
    expect(isInitialPlaceholder({ status: 'captured' })).toBe(false)
    expect(isInitialPlaceholder(undefined)).toBe(false)

    const circular = new Error('CIRCULAR_ROOT')
    ;(circular as Error & { cause: unknown }).cause = circular
    expect(() =>
      createFailedRecord({
        caseId: 'failure/normal/charring',
        section: 'failure',
        kind: 'raw-frame',
        error: circular,
      }),
    ).not.toThrow()

    const runner = runnerSource()
    expect(runner).toContain('createM5VisualEvidenceFailedRecord({')
  })

  test('failure clock 配置必须为恢复保留严格小于总预算的时间', async () => {
    const fixture = loadMutableFixture()
    fixture.protocol.clock.resumeReserveMilliseconds =
      fixture.protocol.clock.maximumCaptureMilliseconds
    expect(
      validateM5VisualEvidenceFixtureSemantics(fixture as never),
    ).toContain('TRANSIENT_CLOCK_RESUME_RESERVE_INVALID')
    await expect(
      captureM5VisualTransientWithClock({
        maximumCaptureMilliseconds: 20,
        resumeReserveMilliseconds: 20,
        pause: async () => undefined,
        critical: async () => 'unused',
        resume: async () => undefined,
      }),
    ).rejects.toThrow(/M5_VISUAL_EVIDENCE_TRANSIENT_CLOCK_CONFIG_INVALID/)
  })

  test('failure clock pause acquisition 只重试 past，重算 future target 并保留穷尽错误因果', async () => {
    const acquire = acquireM5VisualClockPause
    expect(loadFixture().protocol.clock.pauseMaximumAttempts).toBe(3)

    const asynchronousTargets: number[] = []
    await expect(
      acquire({
        leadMilliseconds: 16,
        maximumAttempts: 3,
        nowMilliseconds: async () => 1_000,
        pauseAt: async (target: number) => {
          asynchronousTargets.push(target)
        },
      } as never),
    ).resolves.toMatchObject({
      attemptCount: 1,
      retryCount: 0,
      targetMilliseconds: 1_016,
    })
    expect(asynchronousTargets).toEqual([1_016])

    const retryable = new Error('Cannot fast-forward to the past')
    const targets: number[] = []
    const success = await acquire({
      leadMilliseconds: 16,
      maximumAttempts: 3,
      nowMilliseconds: () => 100 + targets.length * 100,
      pauseAt: async (target: number) => {
        targets.push(target)
        if (targets.length === 1) throw retryable
      },
    })
    expect(success).toEqual({
      attemptCount: 2,
      retryCount: 1,
      targetMilliseconds: 216,
    })
    expect(targets).toEqual([116, 216])

    const nonRetryable = new Error('CLOCK_TRANSPORT_FAILED')
    await expect(
      acquire({
        leadMilliseconds: 16,
        maximumAttempts: 3,
        nowMilliseconds: () => 100,
        pauseAt: async () => { throw nonRetryable },
      }),
    ).rejects.toBe(nonRetryable)

    const exhaustedErrors = Array.from(
      { length: 3 },
      (_, index) => new Error(`Cannot fast-forward to the past:${index + 1}`),
    )
    let exhaustedAttempt = 0
    const exhausted = await acquire({
      leadMilliseconds: 16,
      maximumAttempts: 3,
      nowMilliseconds: () => 100 + exhaustedAttempt * 100,
      pauseAt: async () => {
        const error = exhaustedErrors[exhaustedAttempt]!
        exhaustedAttempt += 1
        throw error
      },
    }).catch((error: unknown) => error)
    expect(exhausted).toBeInstanceOf(AggregateError)
    expect((exhausted as AggregateError).errors).toEqual(exhaustedErrors)
    expect((exhausted as AggregateError).cause).toBe(exhaustedErrors.at(-1))
  })

  test('failure 截图边界要求同 session/tick/state/progress，且 runner 导航前装时钟并始终恢复', () => {
    const fixture = loadFixture()
    expect(fixture.failure).toMatchObject({
      screenshotMode: 'viewport',
    })
    expect(fixture.protocol.clock).toMatchObject({
      pauseLeadMilliseconds: 16,
      pauseMaximumAttempts: 3,
      maximumCaptureMilliseconds: expect.any(Number),
      resumeReserveMilliseconds: expect.any(Number),
      sequenceStepMilliseconds: expect.any(Number),
    })
    const runner = runnerSource()
    const failureRunner = runner.slice(
      runner.indexOf('async function runFailureCases'),
      runner.indexOf('function automatedGate'),
    )
    expect(failureRunner.indexOf('page.clock.install')).toBeGreaterThanOrEqual(0)
    expect(failureRunner.indexOf('page.clock.install')).toBeLessThan(
      failureRunner.indexOf('openM2('),
    )
    expect(runner).toContain('page.clock.pauseAt')
    expect(failureRunner).toContain('acquirePageClockPause')
    expect(failureRunner).toContain(
      'advanceToFailurePhaseTarget(',
    )
    expect(runner).toContain('nowMilliseconds: Date.now')
    expect(failureRunner).toContain('failurePhaseTargetCheck(')
    expect(runner).toContain('pauseAcquisition: clockAudit?.pauseAcquisition')
    expect(failureRunner).not.toContain("page.evaluate('Date.now()')")
    expect(failureRunner.match(/page\.clock\.resume\(\)/g)).toHaveLength(1)
    expect(failureRunner).toContain("resumeOwner: 'sequence-finally'")
    expect(failureRunner).toContain('failure.screenshotMode')
    expect(failureRunner).toContain('context.close()')
    expect(failureRunner).toContain('markPlaceholderFailed')
    expect(runner).toContain(
      'isM5VisualEvidenceInitialFailurePlaceholder(current)',
    )
    expect(supportSource()).toContain('serializeM5VisualEvidenceErrorRecursive(')
    expect(supportSource()).toContain('errors: aggregateErrors.map')
    expect(failureRunner).not.toMatch(
      /for \(const caseId of motionCaseIds\) \{\s*markFailed\(/,
    )

    const baseline = {
      sessionId: 'session-1',
      tick: 120,
      domainStatus: 'failed',
      failurePresentationState: 'shattering',
      failurePresentationProgress: 0.37,
      failurePresentationComplete: false,
    }
    const checks = createM5VisualFailurePhaseChecks({
      phase: 'shattering',
      thresholds: {
        shatteringStartRatio: 0.24,
        gatheringStartRatio: 0.5,
        flyingStartRatio: 0.8,
      },
      before: baseline,
      after: { ...baseline, tick: 121 },
    } as any)
    expect(
      checks.find(({ id }) => id === 'failure-authoritative-boundary-stable'),
    ).toMatchObject({ passed: false })
  })

  test('failure trigger 在暂停时钟的截图前后保持同一权威进度', () => {
    const thresholds = {
      shatteringStartRatio: 0.24,
      gatheringStartRatio: 0.5,
      flyingStartRatio: 0.8,
    }
    const checks = createM5VisualFailurePhaseChecks({
      phase: 'trigger',
      thresholds,
      before: {
        sessionId: 'session-1',
        tick: 1,
        domainStatus: 'failed',
        failurePresentationState: 'charring',
        failurePresentationProgress: 0.05,
        failurePresentationComplete: false,
      },
      after: {
        sessionId: 'session-1',
        tick: 1,
        domainStatus: 'failed',
        failurePresentationState: 'charring',
        failurePresentationProgress: 0.05,
        failurePresentationComplete: false,
      },
    })
    expect(checks.every(({ passed }) => passed)).toBe(true)
  })

  test('有界 Promise 超时后若资源迟到创建，仍执行 late cleanup', async () => {
    let resolveOperation!: (value: { close: () => void }) => void
    let closed = false
    const operation = new Promise<{ close: () => void }>((resolvePromise) => {
      resolveOperation = resolvePromise
    })
    const registry = createM5VisualLateCleanupRegistry()
    await expect(
      runM5VisualEvidenceWithTimeout(
        operation,
        5,
        'EXPECTED_TIMEOUT',
        (resource) => resource.close(),
        registry,
      ),
    ).rejects.toThrow(/EXPECTED_TIMEOUT/)
    resolveOperation({ close: () => { closed = true } })
    await drainM5VisualLateCleanupRegistry(registry, 100)
    expect(closed).toBe(true)
  })

  test('late cleanup registry 在最终报告前暴露迟到 close 拒绝', async () => {
    let resolveOperation!: (value: { close: () => Promise<void> }) => void
    const operation = new Promise<{ close: () => Promise<void> }>(
      (resolvePromise) => {
        resolveOperation = resolvePromise
      },
    )
    const registry = createM5VisualLateCleanupRegistry()
    await expect(
      runM5VisualEvidenceWithTimeout(
        operation,
        5,
        'EXPECTED_TIMEOUT',
        (resource) => resource.close(),
        registry,
      ),
    ).rejects.toThrow(/EXPECTED_TIMEOUT/)
    resolveOperation({
      close: async () => {
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, 5),
        )
        throw new Error('LATE_CLOSE_FAILED')
      },
    })
    await expect(
      drainM5VisualLateCleanupRegistry(registry, 100),
    ).rejects.toThrow(/M5_VISUAL_EVIDENCE_LATE_CLEANUP_FAILED.*LATE_CLOSE_FAILED/)
  })

  test('late cleanup registry 对未完成的迟到 close 使用有界 deadline', async () => {
    let resolveOperation!: (value: { close: () => Promise<void> }) => void
    const operation = new Promise<{ close: () => Promise<void> }>(
      (resolvePromise) => {
        resolveOperation = resolvePromise
      },
    )
    const registry = createM5VisualLateCleanupRegistry()
    await expect(
      runM5VisualEvidenceWithTimeout(
        operation,
        5,
        'EXPECTED_TIMEOUT',
        (resource) => resource.close(),
        registry,
      ),
    ).rejects.toThrow(/EXPECTED_TIMEOUT/)
    resolveOperation({ close: () => new Promise<void>(() => undefined) })
    await expect(
      drainM5VisualLateCleanupRegistry(registry, 10),
    ).rejects.toThrow(/M5_VISUAL_EVIDENCE_LATE_CLEANUP_DRAIN_TIMEOUT/)
  })

  test('脚本只能创建 pending 人工结论，不能自标通过', () => {
    expect(createPendingM5VisualManualReview()).toEqual({
      status: 'pending',
      independentReviewer: null,
      user: null,
      reviewedAt: null,
      notesZh: '',
    })
    expect(() =>
      assertM5VisualManualReviewPending({
        status: 'pass',
        independentReviewer: 'automation',
        user: 'automation',
        reviewedAt: '2026-07-15T00:00:00.000Z',
        notesZh: '脚本自标通过',
      }),
    ).toThrow(/M5_VISUAL_EVIDENCE_MANUAL_REVIEW_MUST_BE_PENDING/)
  })

  test('浏览器执行脚本保持字符串自包含，禁止 tsx 注入 __name helper', () => {
    const source = readFileSync(
      resolve(repositoryRoot, 'scripts', 'run-m5-visual-evidence.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/\.evaluate\(\s*(?:async\s*)?\(/)
    expect(source).not.toMatch(/\.waitForFunction\(\s*(?:async\s*)?\(/)
    expect(source).not.toMatch(/\.addInitScript\(\s*(?:async\s*)?\(/)
    expect(source).not.toContain('__name')
  })
})
