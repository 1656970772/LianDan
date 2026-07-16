import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  classifyM5MaterialTopology,
  type M5MaterialTopologyMetrics,
} from '../../../scripts/m5-visual-evidence-support.ts'
import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader.ts'
import { createDomainState, type DomainState } from '../../domain/index.ts'
import { createM2RuntimeConfiguration } from '../../game/extraction/runtime-config.ts'
import {
  ExtractionSimulation,
  commitSimulationDeltaCandidate,
  type ExtractionMaterialReadView,
  type ExtractionSimulationConfig,
  type SimulationDelta,
} from '../../simulation/index.ts'

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const MATERIAL_DEFINITION_ID = 'red_whisker_ginseng'
const MATERIAL_INSTANCE_ID = 'm5-production-red-ginseng'
const MATERIAL_BATCH_ID = 'red_whisker_ginseng_fresh_wild_10'
const FIRE_SOURCE_ID = 'basic-fire'
const FIRE_TARGET = Object.freeze({ x: 711, y: 525 })
const SAMPLE_TARGETS = Object.freeze([0.12, 0.13, 0.14, 0.15])

type ProductionFixture = Readonly<{
  rules: Parameters<typeof createDomainState>[0]
  simulation: ExtractionSimulationConfig
  materialVolume: number
  topologyCase: Readonly<{
    sourceEdge: 'bottom'
    epsilon: number
    shapeThresholds: Parameters<typeof classifyM5MaterialTopology>[0]['shapeThresholds']
    partialFront: Parameters<typeof classifyM5MaterialTopology>[0]['partialFront']
  }>
}>

type TickResult = Readonly<{
  state: DomainState
  delta: SimulationDelta
}>

type TopologySample = Readonly<{
  target: number
  actualRatio: number
  metrics: M5MaterialTopologyMetrics
  zeroCellCount: number
  partialCellCount: number
}>

let production: ProductionFixture

beforeAll(async () => {
  const loaded = await loadAndValidatePublicM2GameplayConfig(PROJECT_ROOT)
  if (!loaded.ok) {
    throw new Error(`M5_PRODUCTION_CONFIG_LOAD_FAILED:${JSON.stringify(loaded.issues)}`)
  }
  const runtime = createM2RuntimeConfiguration(
    loaded.config,
    loaded.compositionMaps,
  )
  const material = runtime.simulation.materials.find(
    ({ id }) => id === MATERIAL_DEFINITION_ID,
  )
  if (material === undefined) {
    throw new Error(`M5_PRODUCTION_MATERIAL_MISSING:${MATERIAL_DEFINITION_ID}`)
  }
  const matrix = JSON.parse(
    readFileSync(
      resolve(
        PROJECT_ROOT,
        'public',
        'config',
        'evidence',
        'm5-visual-matrix.json',
      ),
      'utf8',
    ),
  ) as Readonly<{
    coverage: Readonly<{
      cases: readonly Readonly<{
        id: string
        sourceEdge?: string
        epsilon?: number
        shapeThresholds?: Parameters<
          typeof classifyM5MaterialTopology
        >[0]['shapeThresholds']
        partialFront?: Parameters<
          typeof classifyM5MaterialTopology
        >[0]['partialFront']
      }>[]
    }>
  }>
  const topologyCase = matrix.coverage.cases.find(
    ({ id }) => id === 'material-burn-through',
  )
  if (
    topologyCase?.sourceEdge !== 'bottom' ||
    topologyCase.epsilon === undefined ||
    topologyCase.shapeThresholds === undefined ||
    topologyCase.partialFront === undefined
  ) {
    throw new Error('M5_PRODUCTION_TOPOLOGY_FIXTURE_INVALID')
  }
  production = {
    rules: runtime.rules,
    simulation: runtime.simulation,
    materialVolume:
      material.targetPearlCount * runtime.simulation.standardPearlVolume,
    topologyCase: {
      sourceEdge: topologyCase.sourceEdge,
      epsilon: topologyCase.epsilon,
      shapeThresholds: topologyCase.shapeThresholds,
      partialFront: topologyCase.partialFront,
    },
  }
})

function runTick(
  simulation: ExtractionSimulation,
  state: DomainState,
  tick: number,
): TickResult {
  simulation.beginTick({ tick, domainState: state })
  for (let phase = 1; phase <= 7; phase += 1) {
    simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
  }
  const delta = simulation.buildCandidate()
  const committed = commitSimulationDeltaCandidate(state, delta)
  if (!committed.ok) throw new Error(committed.error)
  simulation.commitTick()
  return { state: committed.state, delta }
}

function productionState(
  fireSize: number,
  overrides: Partial<DomainState> = {},
): DomainState {
  return {
    ...createDomainState(production.rules),
    status: 'extracting',
    equippedFireSourceId: FIRE_SOURCE_ID,
    isSpraying: true,
    fireSize,
    fireDirection: {
      x: FIRE_TARGET.x - production.simulation.fireSource.origin.x,
      y: FIRE_TARGET.y - production.simulation.fireSource.origin.y,
    },
    materialInstances: [
      {
        materialInstanceId: MATERIAL_INSTANCE_ID,
        materialDefinitionId: MATERIAL_DEFINITION_ID,
        inventoryBatchId: MATERIAL_BATCH_ID,
        initialVolume: production.materialVolume,
        remainingVolume: production.materialVolume,
      },
    ],
    ...overrides,
  }
}

function classify(
  material: ExtractionMaterialReadView,
): M5MaterialTopologyMetrics {
  return classifyM5MaterialTopology({
    gridWidth: 64,
    gridHeight: 64,
    initialCellVolumes: material.initialCellVolumes,
    remainingCellVolumes: material.remainingCellVolumes,
    sourceEdge: production.topologyCase.sourceEdge,
    epsilon: production.topologyCase.epsilon,
    shapeThresholds: production.topologyCase.shapeThresholds,
    partialFront: production.topologyCase.partialFront,
    placement: material.placement,
    fireRay: {
      origin: production.simulation.fireSource.origin,
      target: FIRE_TARGET,
    },
  })
}

function cellCounts(
  material: ExtractionMaterialReadView,
): Readonly<{ zeroCellCount: number; partialCellCount: number }> {
  let zeroCellCount = 0
  let partialCellCount = 0
  for (let index = 0; index < material.initialCellVolumes.length; index += 1) {
    const initial = material.initialCellVolumes[index]!
    if (initial <= 0) continue
    const remaining = material.remainingCellVolumes[index]!
    if (remaining === 0) zeroCellCount += 1
    else if (remaining < initial - 1e-9) partialCellCount += 1
  }
  return { zeroCellCount, partialCellCount }
}

function partialCellIndexes(
  material: ExtractionMaterialReadView,
): readonly number[] {
  const result: number[] = []
  for (let index = 0; index < material.initialCellVolumes.length; index += 1) {
    const initial = material.initialCellVolumes[index]!
    const remaining = material.remainingCellVolumes[index]!
    if (initial > 0 && remaining > 0 && remaining < initial - 1e-9) {
      result.push(index)
    }
  }
  return result
}

function runToTopologyTargets(
  fireSize: number,
  configOverrides: Partial<ExtractionSimulationConfig> = {},
): Readonly<{
  samples: readonly TopologySample[]
  cumulativeDissolution: number
  cumulativeNaturalLoss: number
  finalRemainingVolume: number
}> {
  const simulation = new ExtractionSimulation({
    ...production.simulation,
    ...configOverrides,
  })
  let state = productionState(fireSize)
  let cumulativeDissolution = 0
  let cumulativeNaturalLoss = 0
  const samples: TopologySample[] = []
  let targetIndex = 0

  for (let tick = 0; tick < 2_000 && targetIndex < SAMPLE_TARGETS.length; tick += 1) {
    const result = runTick(simulation, state, tick)
    state = result.state
    cumulativeDissolution += result.delta.dissolutions.reduce(
      (total, dissolution) => total + dissolution.volume,
      0,
    )
    cumulativeNaturalLoss += result.delta.naturalLosses.reduce(
      (total, loss) =>
        total + (loss.sourceKind === 'materialCell' ? loss.volume : 0),
      0,
    )
    const material = simulation.read().materials[0]!
    const actualRatio =
      (material.initialVolume - material.remainingVolume) /
      material.initialVolume
    while (
      targetIndex < SAMPLE_TARGETS.length &&
      actualRatio + production.topologyCase.epsilon >= SAMPLE_TARGETS[targetIndex]!
    ) {
      samples.push({
        target: SAMPLE_TARGETS[targetIndex]!,
        actualRatio,
        metrics: classify(material),
        ...cellCounts(material),
      })
      targetIndex += 1
    }
  }

  const material = simulation.read().materials[0]!
  return {
    samples,
    cumulativeDissolution,
    cumulativeNaturalLoss,
    finalRemainingVolume: material.remainingVolume,
  }
}

describe('M5 生产材料 lane-aware 灼烧拓扑', () => {
  it('低预算 fire20 深窄、fire100 浅宽，四个正式比例点均守恒且可重放', () => {
    const narrow = runToTopologyTargets(20)
    const wide = runToTopologyTargets(100)
    const replay = runToTopologyTargets(100)

    expect(narrow.samples).toHaveLength(SAMPLE_TARGETS.length)
    expect(wide.samples).toHaveLength(SAMPLE_TARGETS.length)
    expect(replay).toEqual(wide)
    expect(
      production.materialVolume - narrow.finalRemainingVolume,
    ).toBeCloseTo(
      narrow.cumulativeDissolution + narrow.cumulativeNaturalLoss,
      8,
    )
    expect(
      production.materialVolume - wide.finalRemainingVolume,
    ).toBeCloseTo(
      wide.cumulativeDissolution + wide.cumulativeNaturalLoss,
      8,
    )

    for (const sample of narrow.samples) {
      expect(
        sample.metrics.classification,
        `fire20@${sample.target}:${JSON.stringify(sample)}`,
      ).toBe('deep-narrow')
      expect(sample.metrics.penetrationRatio).toBeGreaterThanOrEqual(0.35)
      expect(sample.metrics.lateralCoverageRatio).toBeLessThanOrEqual(0.45)
    }
    for (const sample of wide.samples) {
      expect(
        sample.metrics.classification,
        `fire100@${sample.target}:${JSON.stringify(sample)}`,
      ).toBe('shallow-wide')
      expect(sample.metrics.penetrationRatio).toBeLessThanOrEqual(0.28)
      expect(sample.metrics.lateralCoverageRatio).toBeGreaterThanOrEqual(0.45)
    }
  })

  it('fire100 在侵蚀深度超过 0.28 前已经铺到至少 0.45 横向覆盖', () => {
    const wide = runToTopologyTargets(100, { naturalLossRatePerMinute: 0 })

    for (const sample of wide.samples) {
      expect(
        sample.metrics.lateralCoverageRatio,
        `fire100-front@${sample.target}:${JSON.stringify(sample.metrics)}`,
      ).toBeGreaterThanOrEqual(0.45)
      expect(sample.metrics.penetrationRatio).toBeLessThanOrEqual(0.28)
    }
  })

  it('生产级首珠形成前已经逐格退让，且同一时刻最多一个火烧 partial', () => {
    const simulation = new ExtractionSimulation({
      ...production.simulation,
      naturalLossRatePerMinute: 0,
    })
    let state = productionState(100)
    let birthTick = -1

    for (let tick = 0; tick < 30; tick += 1) {
      const result = runTick(simulation, state, tick)
      state = result.state
      if (result.delta.births.length > 0) {
        birthTick = tick
        break
      }
    }

    const counts = cellCounts(simulation.read().materials[0]!)
    expect(birthTick).toBeGreaterThanOrEqual(0)
    expect(counts.zeroCellCount).toBeGreaterThan(0)
    expect(counts.partialCellCount).toBeLessThanOrEqual(1)
  })

  it('生产方向切换先收口旧 pending，并在 reset 重放中始终最多一个火烧 partial', () => {
    const simulation = new ExtractionSimulation({
      ...production.simulation,
      naturalLossRatePerMinute: 0,
      dissolutionVolumePerTick: 0.18,
    })
    const execute = () => {
      let state = productionState(0, {
        fireDirection: {
          x: 625 - production.simulation.fireSource.origin.x,
          y: 500 - production.simulation.fireSource.origin.y,
        },
      })
      const first = runTick(simulation, state, 0)
      state = {
        ...first.state,
        fireDirection: {
          x: 797 - production.simulation.fireSource.origin.x,
          y: 500 - production.simulation.fireSource.origin.y,
        },
      }
      const firstPartials = partialCellIndexes(
        simulation.read().materials[0]!,
      )
      const second = runTick(simulation, state, 1)
      const material = simulation.read().materials[0]!
      const cumulativeDissolution = [...first.delta.dissolutions, ...second.delta.dissolutions]
        .reduce((total, dissolution) => total + dissolution.volume, 0)
      return {
        deltas: [first.delta, second.delta],
        partialsByTick: [
          firstPartials,
          partialCellIndexes(material),
        ],
        remainingVolume: material.remainingVolume,
        cumulativeDissolution,
      }
    }

    const firstRun = execute()
    expect(firstRun.partialsByTick[0]).toEqual([3554])
    expect(firstRun.partialsByTick[1]).toHaveLength(1)
    expect(
      production.materialVolume - firstRun.remainingVolume,
    ).toBeCloseTo(firstRun.cumulativeDissolution, 8)

    simulation.reset()
    expect(execute()).toEqual(firstRun)
  })

  it('fire20 在材料仍有体积时持续有溶解进度，并在 60 秒内形成 binary through', () => {
    const simulation = new ExtractionSimulation({
      ...production.simulation,
      naturalLossRatePerMinute: 0,
    })
    let state = productionState(20)
    let maximumConsecutiveStallTicks = 0
    let consecutiveStallTicks = 0
    let lastDissolutionTick = -1
    let throughTick = -1
    let lastMetrics: M5MaterialTopologyMetrics | undefined

    for (let tick = 0; tick <= 1_800; tick += 1) {
      const result = runTick(simulation, state, tick)
      state = result.state
      const dissolved = result.delta.dissolutions.reduce(
        (total, dissolution) => total + dissolution.volume,
        0,
      )
      const material = simulation.read().materials[0]!
      lastMetrics = classify(material)
      if (dissolved > 0) {
        lastDissolutionTick = tick
        consecutiveStallTicks = 0
      } else if (material.remainingVolume > 0 && !lastMetrics.throughConnected) {
        consecutiveStallTicks += 1
        maximumConsecutiveStallTicks = Math.max(
          maximumConsecutiveStallTicks,
          consecutiveStallTicks,
        )
      }
      if (lastMetrics.throughConnected) {
        throughTick = tick
        break
      }
    }

    const diagnostic = JSON.stringify({
      throughTick,
      lastDissolutionTick,
      maximumConsecutiveStallTicks,
      remainingRatio:
        simulation.read().materials[0]!.remainingVolume /
        production.materialVolume,
      metrics: lastMetrics,
    })
    expect(maximumConsecutiveStallTicks, diagnostic).toBe(0)
    expect(throughTick, diagnostic).toBeGreaterThanOrEqual(0)
    expect(lastMetrics, diagnostic).toMatchObject({
      classification: 'through-not-empty',
      topologyMetricSource: 'binary-through',
      sourceBoundaryReached: true,
      farBoundaryReached: true,
      throughConnected: true,
    })
    expect(simulation.read().materials[0]!.remainingVolume).toBeGreaterThan(0)
  })

  it('自然损耗造成的全局 partial 不会破坏火烧 front 的 reset/replay', () => {
    const execute = () => {
      const simulation = new ExtractionSimulation({
        ...production.simulation,
        naturalLossRatePerMinute: 30,
      })
      let state = productionState(100, { isSpraying: false })
      ;({ state } = runTick(simulation, state, 0))
      state = { ...state, isSpraying: true }
      const deltas: SimulationDelta[] = []
      for (let tick = 1; tick <= 12; tick += 1) {
        const result = runTick(simulation, state, tick)
        state = result.state
        deltas.push(result.delta)
      }
      return {
        deltas,
        material: simulation.read().materials[0],
      }
    }

    expect(execute()).toEqual(execute())
  })
})
