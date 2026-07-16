import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  alignM5VisualCollector,
  classifyM5MaterialTopology,
  hasM5MaterialTopologyStopAuthority,
  parseAndValidateM5VisualEvidenceFixtureJson,
  type M5MaterialTopologyMetrics,
  type M5VisualEvidenceFixture,
} from '../scripts/m5-visual-evidence-support.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixture = parseAndValidateM5VisualEvidenceFixtureJson(
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
const collectorMotion = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'public', 'config', 'm2', 'collector.json'),
    'utf8',
  ),
) as Readonly<{
  acceleration: number
  deceleration: number
  maxSpeed: number
}>
const fireSources = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'public', 'config', 'm2', 'fire-sources.json'),
    'utf8',
  ),
) as Readonly<{
  fireSources: readonly Readonly<{
    id: string
    origin: Readonly<{ x: number; y: number }>
  }>[]
}>

type FixtureCoverageCase = M5VisualEvidenceFixture['coverage']['cases'][number]
type MaterialCase = FixtureCoverageCase & Readonly<{
  automation: 'm2-material-topology'
  fireSourceId: string
  materialBatchId: string
  materialDefinitionId: string
  fireSize: number
  flameThrust: false
  logicalTarget: Readonly<{ x: number; y: number }>
  sourceEdge: 'top' | 'right' | 'bottom' | 'left'
  epsilon: number
  pollIntervalMilliseconds: number
  maximumWaitMilliseconds: number
  stopCondition:
    | Readonly<{
        mode: 'topology-classification'
        classification: 'deep-narrow' | 'shallow-wide'
        minimumDissolvedVolumeRatio: number
        maximumDissolvedVolumeRatio: number
        minimumRemainingRatio: number
      }>
    | Readonly<{ mode: 'through-connected' }>
  shapeThresholds: NonNullable<FixtureCoverageCase['shapeThresholds']>
  partialFront: NonNullable<FixtureCoverageCase['partialFront']>
  expectedTopology: NonNullable<FixtureCoverageCase['expectedTopology']>
}>

type RawMaterial = Readonly<{
  materialInstanceId: string
  materialDefinitionId: string
  inventoryBatchId: string
  placement: Readonly<{
    center: Readonly<{ x: number; y: number }>
    width: number
    height: number
    rotationRadians: number
  }>
  gridWidth: number
  gridHeight: number
  initialCellVolumes: readonly number[]
  remainingCellVolumes: readonly number[]
}>

type Sample = Readonly<{
  caseId: string
  targetRatio: number | 'through'
  actualRatio: number
  metrics: M5MaterialTopologyMetrics
  stopAuthority: boolean
  collectorOffset: number
  samplingToleranceRatio: number
}>

const PARTIAL_FRONT_BOUNDARY_SAMPLE_COUNT = 4

function materialCase(id: string): MaterialCase {
  const candidate = fixture.coverage.cases.find((entry) => entry.id === id)
  if (
    candidate?.automation !== 'm2-material-topology' ||
    candidate.fireSourceId === undefined ||
    candidate.materialBatchId === undefined ||
    candidate.materialDefinitionId === undefined ||
    candidate.fireSize === undefined ||
    candidate.flameThrust === undefined ||
    candidate.logicalTarget === undefined ||
    candidate.sourceEdge === undefined ||
    candidate.epsilon === undefined ||
    candidate.pollIntervalMilliseconds === undefined ||
    candidate.maximumWaitMilliseconds === undefined ||
    candidate.stopCondition === undefined ||
    candidate.shapeThresholds === undefined ||
    candidate.partialFront === undefined ||
    candidate.expectedTopology === undefined
  ) {
    throw new Error(`M5_REAL_MATERIAL_CASE_INVALID:${id}`)
  }
  return candidate as MaterialCase
}

function fireOrigin(coverageCase: MaterialCase): Readonly<{ x: number; y: number }> {
  const source = fireSources.fireSources.find(
    ({ id }) => id === coverageCase.fireSourceId,
  )
  if (source === undefined) {
    throw new Error(`M5_REAL_FIRE_SOURCE_MISSING:${coverageCase.fireSourceId}`)
  }
  return source.origin
}

async function openConfiguredMaterial(
  page: Page,
  coverageCase: MaterialCase,
): Promise<void> {
  await page.clock.install({ time: Date.now() })
  await page.setViewportSize(fixture.coverage.viewport)
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  await page.evaluate(
    ({ fireSourceId, fireSize, flameThrust, materialBatchId }) => {
      const api = window.__LIANDAN_M2__
      if (api === undefined) throw new Error('M5_REAL_M2_API_MISSING')
      api.selectFireSource(fireSourceId)
      api.setFireSize(fireSize)
      api.setFlameThrust(flameThrust)
      api.preselectMaterial(materialBatchId)
      api.addSelectedMaterial()
    },
    coverageCase,
  )
  await page.clock.runFor(fixture.protocol.clock.sequenceStepMilliseconds * 4)
  await expect
    .poll(() =>
      page.evaluate(
        ({ materialDefinitionId, materialBatchId }) =>
          window.__LIANDAN_M2__?.getMaterialTopologyEvidence().some(
            (material) =>
              material.materialDefinitionId === materialDefinitionId &&
              material.inventoryBatchId === materialBatchId,
          ) === true,
        coverageCase,
      ),
    )
    .toBe(true)

  const alignment = await alignM5VisualCollector({
    config: fixture.coverage.materialAlignment,
    motion: collectorMotion,
    readPosition: () =>
      page.evaluate(
        ({ materialDefinitionId, materialBatchId }) => {
          const api = window.__LIANDAN_M2__
          const material = api?.getMaterialTopologyEvidence().find(
            (candidate) =>
              candidate.materialDefinitionId === materialDefinitionId &&
              candidate.inventoryBatchId === materialBatchId,
          )
          if (api === undefined || material === undefined) {
            throw new Error('M5_REAL_MATERIAL_MISSING_DURING_ALIGNMENT')
          }
          const presentation = api.getPresentationEvidence()
          return {
            collectorCenterX: presentation.collectorCenter.x,
            materialCenterX: material.placement.center.x,
            velocityX: presentation.collectorVelocityX,
            tick: presentation.simulationTick,
          }
        },
        coverageCase,
      ),
    focus: () => page.locator('[data-m2-stage]').focus(),
    keyDown: (key) => page.keyboard.down(key),
    keyUp: (key) => page.keyboard.up(key),
    waitForMilliseconds: (milliseconds) => page.clock.runFor(milliseconds),
    now: () => Date.now(),
  })
  expect(alignment.finalOffset).toBeLessThanOrEqual(
    fixture.coverage.materialAlignment.maximumCenterOffset,
  )

  const bounds = await page.locator('canvas[data-scene="m2-extraction"]').boundingBox()
  const logical = await page.evaluate(() => {
    const snapshot = window.__LIANDAN_M2__?.getSnapshot()
    if (snapshot === undefined) throw new Error('M5_REAL_SNAPSHOT_MISSING')
    return { width: snapshot.logicalWidth, height: snapshot.logicalHeight }
  })
  if (bounds === null) throw new Error('M5_REAL_CANVAS_MISSING')
  await page.mouse.move(
    bounds.x + bounds.width * (coverageCase.logicalTarget.x / logical.width),
    bounds.y + bounds.height * (coverageCase.logicalTarget.y / logical.height),
  )
}

async function rawMaterial(
  page: Page,
  coverageCase: MaterialCase,
): Promise<Readonly<{ material: RawMaterial; collectorCenterX: number }>> {
  return page.evaluate(
    ({ materialDefinitionId, materialBatchId }) => {
      const api = window.__LIANDAN_M2__
      const material = api?.getMaterialTopologyEvidence().find(
        (candidate) =>
          candidate.materialDefinitionId === materialDefinitionId &&
          candidate.inventoryBatchId === materialBatchId,
      )
      if (api === undefined || material === undefined) {
        throw new Error('M5_REAL_MATERIAL_MISSING')
      }
      return {
        material,
        collectorCenterX: api.getPresentationEvidence().collectorCenter.x,
      }
    },
    coverageCase,
  )
}

function classifyRaw(
  raw: Awaited<ReturnType<typeof rawMaterial>>,
  coverageCase: MaterialCase,
): Sample {
  const metrics = classifyM5MaterialTopology({
    gridWidth: raw.material.gridWidth,
    gridHeight: raw.material.gridHeight,
    initialCellVolumes: raw.material.initialCellVolumes,
    remainingCellVolumes: raw.material.remainingCellVolumes,
    sourceEdge: coverageCase.sourceEdge,
    epsilon: coverageCase.epsilon,
    shapeThresholds: coverageCase.shapeThresholds,
    partialFront: coverageCase.partialFront,
    placement: raw.material.placement,
    fireRay: {
      origin: fireOrigin(coverageCase),
      target: coverageCase.logicalTarget,
    },
  })
  return {
    caseId: coverageCase.id,
    targetRatio: metrics.throughConnected ? 'through' : 0,
    actualRatio: metrics.dissolvedVolumeRatio,
    metrics,
    stopAuthority: hasM5MaterialTopologyStopAuthority(
      metrics,
      coverageCase.stopCondition,
    ),
    collectorOffset: Math.abs(
      raw.collectorCenterX - raw.material.placement.center.x,
    ),
    samplingToleranceRatio: 0,
  }
}

async function samplePartialTargets(
  page: Page,
  coverageCase: MaterialCase,
): Promise<readonly Sample[]> {
  if (coverageCase.stopCondition.mode !== 'topology-classification') {
    throw new Error(`M5_REAL_PARTIAL_CASE_INVALID:${coverageCase.id}`)
  }
  const { minimumDissolvedVolumeRatio, maximumDissolvedVolumeRatio } =
    coverageCase.stopCondition
  const targets = Array.from(
    { length: PARTIAL_FRONT_BOUNDARY_SAMPLE_COUNT },
    (_, index) =>
      minimumDissolvedVolumeRatio +
      ((maximumDissolvedVolumeRatio - minimumDissolvedVolumeRatio) * index) /
        (PARTIAL_FRONT_BOUNDARY_SAMPLE_COUNT - 1),
  )
  const samples: Sample[] = []
  let targetIndex = 0
  let elapsed = 0
  let previousRaw: Awaited<ReturnType<typeof rawMaterial>> | undefined
  let previousRatio = 0
  while (
    targetIndex < targets.length &&
    elapsed <= coverageCase.maximumWaitMilliseconds
  ) {
    await page.clock.runFor(fixture.protocol.clock.sequenceStepMilliseconds)
    elapsed += fixture.protocol.clock.sequenceStepMilliseconds
    const raw = await rawMaterial(page, coverageCase)
    const initial = raw.material.initialCellVolumes.reduce(
      (sum, volume) => sum + volume,
      0,
    )
    const remaining = raw.material.remainingCellVolumes.reduce(
      (sum, volume) => sum + volume,
      0,
    )
    const ratio = (initial - remaining) / initial
    while (
      targetIndex < targets.length &&
      ratio + coverageCase.epsilon >= targets[targetIndex]!
    ) {
      const target = targets[targetIndex]!
      const crossedFormalMaximum =
        target === maximumDissolvedVolumeRatio &&
        ratio > maximumDissolvedVolumeRatio &&
        previousRaw !== undefined &&
        previousRatio <= maximumDissolvedVolumeRatio
      const selectedRaw =
        crossedFormalMaximum && previousRaw !== undefined ? previousRaw : raw
      const sample = classifyRaw(selectedRaw, coverageCase)
      samples.push({
        ...sample,
        targetRatio: target,
        samplingToleranceRatio: crossedFormalMaximum
          ? Math.max(0, ratio - previousRatio)
          : 0,
      })
      targetIndex += 1
    }
    previousRaw = raw
    previousRatio = ratio
  }
  expect(samples, `${coverageCase.id}:partial-target-timeout`).toHaveLength(
    targets.length,
  )
  return samples
}

async function continueToThrough(
  page: Page,
  coverageCase: MaterialCase,
): Promise<Sample> {
  let elapsed = 0
  let last: Sample | undefined
  while (elapsed <= coverageCase.maximumWaitMilliseconds) {
    await page.clock.runFor(coverageCase.pollIntervalMilliseconds)
    elapsed += coverageCase.pollIntervalMilliseconds
    const sample = classifyRaw(await rawMaterial(page, coverageCase), coverageCase)
    last = sample
    if (sample.metrics.throughConnected) {
      return { ...sample, targetRatio: 'through' }
    }
  }
  throw new Error(
    `M5_REAL_THROUGH_TIMEOUT:${coverageCase.id}:${JSON.stringify({
      elapsed,
      actualRatio: last?.actualRatio,
      metrics: last?.metrics,
    })}`,
  )
}

test.describe.configure({ mode: 'serial' })

test('M5 真实材料在配置比例首次越线时具有正式 partial 权威，中心火继续形成 binary 贯通', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const observations: Sample[] = []
  const center = materialCase('material-center-hole')
  const through = materialCase('material-burn-through')
  await openConfiguredMaterial(page, center)
  await page.mouse.down()
  try {
    observations.push(...(await samplePartialTargets(page, center)))
  } finally {
    await page.mouse.up()
  }

  const wide = materialCase('material-wide-strip')
  await page.goto('about:blank')
  await openConfiguredMaterial(page, wide)
  await page.mouse.down()
  try {
    observations.push(...(await samplePartialTargets(page, wide)))
  } finally {
    await page.mouse.up()
  }

  console.log(
    `M5_REAL_MATERIAL_PARTIAL_AUTHORITY:${testInfo.project.name}:${JSON.stringify(
      observations.map((sample) => ({
        caseId: sample.caseId,
        targetRatio: sample.targetRatio,
        actualRatio: sample.actualRatio,
        classification: sample.metrics.classification,
        metricSource: sample.metrics.topologyMetricSource,
        source: sample.metrics.sourceBoundaryReached,
        penetration: sample.metrics.penetrationRatio,
        coverage: sample.metrics.lateralCoverageRatio,
        centerOffset: sample.metrics.partialFrontCenterOffsetRatio,
        authority: sample.stopAuthority,
        collectorOffset: sample.collectorOffset,
        samplingToleranceRatio: sample.samplingToleranceRatio,
      })),
    )}`,
  )

  await page.goto('about:blank')
  await openConfiguredMaterial(page, through)
  await page.mouse.down()
  try {
    const throughSample = await continueToThrough(page, through)
    observations.push({
      ...throughSample,
      stopAuthority: hasM5MaterialTopologyStopAuthority(
        throughSample.metrics,
        through.stopCondition,
      ),
    })
  } finally {
    await page.mouse.up()
  }

  console.log(
    `M5_REAL_MATERIAL_AUTHORITY:${testInfo.project.name}:${JSON.stringify(
      observations.map((sample) => ({
        caseId: sample.caseId,
        targetRatio: sample.targetRatio,
        actualRatio: sample.actualRatio,
        classification: sample.metrics.classification,
        metricSource: sample.metrics.topologyMetricSource,
        source: sample.metrics.sourceBoundaryReached,
        penetration: sample.metrics.penetrationRatio,
        coverage: sample.metrics.lateralCoverageRatio,
        centerOffset: sample.metrics.partialFrontCenterOffsetRatio,
        authority: sample.stopAuthority,
        collectorOffset: sample.collectorOffset,
        samplingToleranceRatio: sample.samplingToleranceRatio,
      })),
    )}`,
  )

  for (const sample of observations) {
    expect.soft(sample.collectorOffset, `${sample.caseId}:collector`).toBeLessThanOrEqual(
      fixture.coverage.materialAlignment.maximumCenterOffset,
    )
    if (sample.targetRatio === 'through') {
      expect.soft(sample.metrics, `${sample.caseId}:through`).toMatchObject({
        classification: 'through-not-empty',
        topologyMetricSource: 'binary-through',
        sourceBoundaryReached: true,
        farBoundaryReached: true,
        throughConnected: true,
      })
      expect.soft(sample.stopAuthority, `${sample.caseId}:through-authority`).toBe(true)
      continue
    }
    const coverageCase =
      sample.caseId === center.id ? center : wide
    const expected = coverageCase.expectedTopology
    expect.soft(sample.actualRatio, `${sample.caseId}:${sample.targetRatio}:min`).toBeGreaterThanOrEqual(
      sample.targetRatio - sample.samplingToleranceRatio,
    )
    expect.soft(sample.actualRatio, `${sample.caseId}:${sample.targetRatio}:max`).toBeLessThanOrEqual(
      coverageCase.stopCondition.mode === 'topology-classification'
        ? coverageCase.stopCondition.maximumDissolvedVolumeRatio
        : 1,
    )
    expect.soft(sample.metrics.classification, `${sample.caseId}:${sample.targetRatio}:class`).toBe(
      expected.classification,
    )
    expect.soft(sample.metrics.topologyMetricSource, `${sample.caseId}:${sample.targetRatio}:source-kind`).toBe(
      'partial-front',
    )
    expect.soft(sample.metrics.sourceBoundaryReached, `${sample.caseId}:${sample.targetRatio}:source`).toBe(true)
    expect.soft(sample.metrics.penetrationRatio, `${sample.caseId}:${sample.targetRatio}:penetration-min`).toBeGreaterThanOrEqual(
      expected.minimumPenetrationRatio,
    )
    expect.soft(sample.metrics.penetrationRatio, `${sample.caseId}:${sample.targetRatio}:penetration-max`).toBeLessThanOrEqual(
      expected.maximumPenetrationRatio,
    )
    expect.soft(sample.metrics.lateralCoverageRatio, `${sample.caseId}:${sample.targetRatio}:coverage-min`).toBeGreaterThanOrEqual(
      expected.minimumLateralCoverageRatio,
    )
    expect.soft(sample.metrics.lateralCoverageRatio, `${sample.caseId}:${sample.targetRatio}:coverage-max`).toBeLessThanOrEqual(
      expected.maximumLateralCoverageRatio,
    )
    expect.soft(sample.metrics.partialFrontCenterOffsetRatio, `${sample.caseId}:${sample.targetRatio}:center`).toBeLessThanOrEqual(
      coverageCase.shapeThresholds.maximumCenterOffsetRatio,
    )
    expect.soft(sample.stopAuthority, `${sample.caseId}:${sample.targetRatio}:authority`).toBe(true)
  }
})
