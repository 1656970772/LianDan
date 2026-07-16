import { describe, expect, it } from 'vitest'

import {
  ExtractionSimulation,
  commitSimulationDeltaCandidate,
  type ExtractionSimulationConfig,
  type SimulationDelta,
} from '../../simulation/index.ts'
import { circleIntersectsRemainingMaterial } from '../../simulation/extraction/material-geometry.ts'
import {
  createDomainState,
  type DomainState,
  type MaterialInstance,
  type PearlType,
  type PrototypeRules,
} from '../../domain/index.ts'
import { orientedMaterialRectanglesHaveInteriorIntersection } from '../../shared/material-placement-geometry.ts'
import { deriveMaterialContentBounds } from '../../shared/material-content-geometry.ts'

const GRID_SIZE = 64
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const MATERIAL_ID = 'material.generic'
const MATERIAL_INSTANCE_ID = 'material-instance-1'
const M3_PEARL_RULES = {
  spawnClearance: 0,
  wallRestitution: 0.2,
  fireProtectionSeconds: 10,
  resetProtectionOnExit: true,
  burnDurationSeconds: 60,
  thrustAcceleration: 0,
} as const

const RULES: PrototypeRules = {
  fixedDeltaSeconds: 1 / 30,
  availableFireSourceIds: ['fire.basic'],
  fireSources: [
    {
      id: 'fire.basic',
      baseTemperature: 8,
      maximumTemperature: 100,
      heatingRatePerSecond: 24,
      coolingRatePerSecond: 10,
      temperatureCurve: 'linear',
    },
  ],
  initialFireSize: 100,
  initialFireDirection: { x: 0, y: -1 },
  inventoryBatches: [],
  settlement: {
    warningThresholds: [0.5, 0.65],
    failureThreshold: 0.7,
    slagUnitVolume: 100,
  },
}

function composition(
  cells: readonly Readonly<{ column: number; row: number; type: 1 | 2 | 3 }>[],
): Uint8Array {
  const result = new Uint8Array(CELL_COUNT)
  for (const cell of cells) result[cell.row * GRID_SIZE + cell.column] = cell.type
  return result
}

function rectangleComposition(
  firstColumn: number,
  lastColumn: number,
  firstRow: number,
  lastRow: number,
  type: 1 | 2 | 3 = 1,
): Uint8Array {
  const result = new Uint8Array(CELL_COUNT)
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      result[row * GRID_SIZE + column] = type
    }
  }
  return result
}

function config(
  materialComposition: Uint8Array,
  targetPearlCount: number,
  overrides: Partial<ExtractionSimulationConfig> = {},
): ExtractionSimulationConfig {
  const contentBounds = deriveMaterialContentBounds(materialComposition)
  return {
    seed: 123,
    standardPearlVolume: 1,
    fixedDeltaSeconds: 1,
    dissolutionVolumePerTick: 1,
    exposureProbeDistance: 2,
    frontLaneWidthCells: 1,
    naturalLossRatePerMinute: 0,
    safeZoneY: 112,
    fireFlow: {
      geometry: {
        columns: 32,
        rows: 32,
        cellSize: 4,
        originX: 0,
        originY: 0,
      },
      solver: {
        circleCoverageSamplesPerAxis: 2,
        lateralSpread: 0.35,
        obstacleDeflection: 0.75,
        partialObstaclePenalty: 0.5,
        mergeRate: 0.15,
        fullObstacleThreshold: 0.95,
      },
    },
    materials: [
      {
        id: MATERIAL_ID,
        targetPearlCount,
        composition: materialComposition,
      },
    ],
    materialPlacement: {
      visibleLongEdge: Math.max(
        contentBounds.widthCells,
        contentBounds.heightCells,
      ),
      minimumGap: 0,
      usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
      slots: [{ center: { x: 64, y: 50 }, rotationRadians: 0 }],
    },
    fireSource: {
      origin: { x: 64, y: 112 },
      halfAngleRadians: Math.PI / 3,
      minWidth: 4,
      maxWidth: 80,
    },
    pearlPhysics: {
      medicinalLiquid: {
        radiusAtStandardVolume: 2,
        spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        gravity: 8,
        driftX: 0,
        maxSpeed: 40,
        materialRestitution: 0.2,
        ...M3_PEARL_RULES,
      },
      slag: {
        radiusAtStandardVolume: 2,
        spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        gravity: 8,
        driftX: 0,
        maxSpeed: 40,
        materialRestitution: 0.2,
        ...M3_PEARL_RULES,
      },
      impurity: {
        radiusAtStandardVolume: 2,
        spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        gravity: 8,
        driftX: 0,
        maxSpeed: 40,
        materialRestitution: 0.2,
        ...M3_PEARL_RULES,
      },
    },
    collector: {
      initialCenter: { x: 64, y: 104 },
      width: 24,
      height: 8,
      trackMinX: 16,
      trackMaxX: 112,
      acceleration: 80,
      deceleration: 100,
      maxSpeed: 32,
    },
    worldBounds: { left: 0, top: 0, right: 128, bottom: 128 },
    ...overrides,
  }
}

function materialInstance(totalVolume: number): MaterialInstance {
  return {
    materialInstanceId: MATERIAL_INSTANCE_ID,
    materialDefinitionId: MATERIAL_ID,
    inventoryBatchId: 'batch.generic',
    initialVolume: totalVolume,
    remainingVolume: totalVolume,
  }
}

function materialInstances(count: number, totalVolume = 1): MaterialInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    ...materialInstance(totalVolume),
    materialInstanceId: `material-instance-${String(index + 1).padStart(2, '0')}`,
  }))
}

function domainState(
  totalVolume: number,
  overrides: Partial<DomainState> = {},
): DomainState {
  const initial = createDomainState(RULES)
  return {
    ...initial,
    status: 'extracting',
    materialInstances: [materialInstance(totalVolume)],
    equippedFireSourceId: 'fire.basic',
    isSpraying: true,
    fireSize: 100,
    ...overrides,
  }
}

function runTick(
  simulation: ExtractionSimulation,
  state: DomainState,
  tick: number,
): Readonly<{ state: DomainState; delta: SimulationDelta }> {
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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function volumeByType(
  delta: SimulationDelta,
): Readonly<Record<PearlType, number>> {
  const result: Record<PearlType, number> = {
    medicinalLiquid: 0,
    slag: 0,
    impurity: 0,
  }
  for (const birth of delta.births) result[birth.pearlType] += birth.volume
  return result
}

function affectedRows(
  before: readonly number[],
  after: readonly number[],
): ReadonlySet<number> {
  const rows = new Set<number>()
  for (let index = 0; index < after.length; index += 1) {
    if (after[index]! < before[index]! - 1e-9) rows.add(Math.floor(index / GRID_SIZE))
  }
  return rows
}

function affectedColumns(
  before: readonly number[],
  after: readonly number[],
): ReadonlySet<number> {
  const columns = new Set<number>()
  for (let index = 0; index < after.length; index += 1) {
    if (after[index]! < before[index]! - 1e-9) columns.add(index % GRID_SIZE)
  }
  return columns
}

describe('M2 纯萃取模拟事务', () => {
  it('两份材料的权威摆放内部不相交', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        materialPlacement: {
          visibleLongEdge: 1,
          minimumGap: 0,
          usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
          slots: [
            { center: { x: 32, y: 50 }, rotationRadians: 0 },
            { center: { x: 96, y: 50 }, rotationRadians: 0 },
          ],
        },
      }),
    )
    const state = domainState(1, {
      isSpraying: false,
      materialInstances: [
        materialInstance(1),
        {
          ...materialInstance(1),
          materialInstanceId: 'material-instance-2',
        },
      ],
    })

    runTick(simulation, state, 0)

    const [first, second] = simulation.read().materials
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(Math.abs(first!.placement.center.x - second!.placement.center.x)).toBeGreaterThanOrEqual(
      first!.placement.width,
    )
  })

  it('三份同材依序使用唯一槽位且 OBB 两两不相交', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        materialPlacement: {
          visibleLongEdge: 0.5,
          minimumGap: 0,
          usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
          slots: [16, 48, 80].map((x) => ({
            center: { x, y: 50 },
            rotationRadians: 0,
          })),
        },
      }),
    )

    let state = domainState(1, {
      isSpraying: false,
      materialInstances: materialInstances(1),
    })
    ;({ state } = runTick(simulation, state, 0))
    ;({ state } = runTick(
      simulation,
      { ...state, materialInstances: materialInstances(2).reverse() },
      1,
    ))
    const threeInstances = materialInstances(3)
    runTick(
      simulation,
      {
        ...state,
        materialInstances: [
          threeInstances[2]!,
          threeInstances[0]!,
          threeInstances[1]!,
        ],
      },
      2,
    )

    const placements = simulation.read().materials.map(({ placement }) => placement)
    expect(placements.map(({ layer }) => layer)).toEqual([0, 1, 2])
    expect(new Set(placements.map(({ center }) => `${center.x},${center.y}`)).size).toBe(3)
    for (let left = 0; left < placements.length; left += 1) {
      for (let right = left + 1; right < placements.length; right += 1) {
        expect(
          orientedMaterialRectanglesHaveInteriorIntersection(
            placements[left]!,
            placements[right]!,
          ),
        ).toBe(false)
      }
    }
  })

  it('24 份材料全部使用唯一槽位且 OBB 两两不相交', () => {
    const slots = [16, 48, 80].flatMap((y) =>
      Array.from({ length: 8 }, (_, column) => ({
        center: { x: 8 + column * 16, y },
        rotationRadians: 0,
      })),
    )
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        materialPlacement: {
          visibleLongEdge: 0.25,
          minimumGap: 0,
          usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
          slots,
        },
      }),
    )

    runTick(
      simulation,
      domainState(1, {
        isSpraying: false,
        materialInstances: materialInstances(24),
      }),
      0,
    )

    const placements = simulation.read().materials.map(({ placement }) => placement)
    expect(placements).toHaveLength(24)
    expect(new Set(placements.map(({ center }) => `${center.x},${center.y}`)).size).toBe(24)
    for (let left = 0; left < placements.length; left += 1) {
      for (let right = left + 1; right < placements.length; right += 1) {
        expect(
          orientedMaterialRectanglesHaveInteriorIntersection(
            placements[left]!,
            placements[right]!,
          ),
        ).toBe(false)
      }
    }
  })

  it('材料份数超过槽位时 fail-closed 且 rollback 不发布半写', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1),
    )
    const state = domainState(1, {
      isSpraying: false,
      materialInstances: materialInstances(2),
    })

    simulation.beginTick({ tick: 0, domainState: state })
    expect(() => simulation.runPhase(1, state)).toThrow(
      'SIM_EXTRACTION_MATERIAL_PLACEMENT_FULL',
    )
    simulation.rollbackTick()

    expect(simulation.read()).toMatchObject({
      tick: -1,
      materials: [],
      pearls: [],
    })
  })

  it.each([
    [
      '内部相交',
      {
        visibleLongEdge: 64,
        minimumGap: 0,
        usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
        slots: [
          { center: { x: 32, y: 50 }, rotationRadians: 0 },
          { center: { x: 80, y: 50 }, rotationRadians: 0 },
        ],
      },
      'SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.slots.1.overlap',
    ],
    [
      '旋转越界',
      {
        visibleLongEdge: 64,
        minimumGap: 0,
        usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
        slots: [
          { center: { x: 32, y: 50 }, rotationRadians: Math.PI / 4 },
        ],
      },
      'SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.slots.0.bounds',
    ],
  ] as const)('模拟构造防御性拒绝槽位%s', (_name, materialPlacement, error) => {
    expect(
      () =>
        new ExtractionSimulation(
          config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
            materialPlacement,
          }),
        ),
    ).toThrow(error)
  })

  it('reset 后以相同投药顺序重放得到相同槽位映射', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        materialPlacement: {
          visibleLongEdge: 1,
          minimumGap: 0,
          usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
          slots: [
            { center: { x: 32, y: 50 }, rotationRadians: 0 },
            { center: { x: 96, y: 50 }, rotationRadians: 0 },
          ],
        },
      }),
    )
    const state = domainState(1, {
      isSpraying: false,
      materialInstances: materialInstances(2),
    })
    const execute = () => {
      runTick(simulation, state, 0)
      return simulation.read().materials.map(({ materialInstanceId, placement }) => ({
        materialInstanceId,
        placement,
      }))
    }

    const first = execute()
    simulation.reset()

    expect(execute()).toEqual(first)
  })

  it('M4 丹珠继承批次标签，并在安全区内按配置触发赤寒相争', () => {
    const medicinalCell = composition([{ column: 32, row: 63, type: 1 }])
    const interactionConfig = config(medicinalCell, 1, {
      safeZoneY: 40,
      materials: [
        { id: 'red_whisker_ginseng', targetPearlCount: 1, composition: medicinalCell },
        { id: 'frost_marrow_crystal', targetPearlCount: 1, composition: medicinalCell },
      ],
      materialPlacement: {
        visibleLongEdge: 0.25,
        minimumGap: 0,
        usableRegion: { left: 0, top: 0, right: 128, bottom: 128 },
        slots: [
          { center: { x: 56, y: 50 }, rotationRadians: 0 },
          { center: { x: 72, y: 50 }, rotationRadians: 0 },
        ],
      },
      pearlPhysics: {
        medicinalLiquid: {
          ...config(medicinalCell, 1).pearlPhysics.medicinalLiquid,
          gravity: 0,
        },
        slag: config(medicinalCell, 1).pearlPhysics.slag,
        impurity: config(medicinalCell, 1).pearlPhysics.impurity,
      },
      interactions: [
        {
          id: 'red_frost_medicinal_fight',
          behavior: 'fight',
          participantA: {
            materialDefinitionIds: ['red_whisker_ginseng'],
            requiredTagIds: ['warm_fierce'],
            pearlTypes: ['medicinalLiquid'],
          },
          participantB: {
            materialDefinitionIds: ['frost_marrow_crystal'],
            requiredTagIds: ['extreme_cold'],
            pearlTypes: ['medicinalLiquid'],
          },
          distance: 32,
          durationSeconds: 2,
          impulse: 10,
          cooldownSeconds: 2,
        },
      ],
    })
    const simulation = new ExtractionSimulation(interactionConfig)
    let state = domainState(1, {
      materialInstances: [
        {
          materialInstanceId: 'material-instance-red',
          materialDefinitionId: 'red_whisker_ginseng',
          inventoryBatchId: 'batch-red',
          initialVolume: 1,
          remainingVolume: 1,
          tagIds: ['warm_fierce', 'fresh'],
        },
        {
          materialInstanceId: 'material-instance-frost',
          materialDefinitionId: 'frost_marrow_crystal',
          inventoryBatchId: 'batch-frost',
          initialVolume: 1,
          remainingVolume: 1,
          tagIds: ['extreme_cold', 'frozen'],
        },
      ],
    })

    ;({ state } = runTick(simulation, state, 0))
    expect(simulation.read().pearls).toHaveLength(2)
    expect(simulation.read().pearls.map((pearl) => pearl.tags)).toEqual([
      ['extreme_cold', 'frozen'],
      ['fresh', 'warm_fierce'],
    ])
    expect(simulation.read().pearls.every(
      (pearl) => pearl.interactionProfileIds.includes('red_frost_medicinal_fight'),
    )).toBe(true)

    const interacted = runTick(simulation, state, 1)
    expect(interacted.delta.interactions).toEqual([
      {
        interactionId: 'red_frost_medicinal_fight',
        pearlAId: 'pearl:material-instance-frost:medicinalLiquid:000001',
        pearlBId: 'pearl:material-instance-red:medicinalLiquid:000001',
      },
    ])
    expect(simulation.read().pearls.every((pearl) => pearl.safeZone.entered)).toBe(true)
    expect(simulation.read()).toMatchObject({
      interactionCount: 1,
      activeInteractions: [
        {
          interactionId: 'red_frost_medicinal_fight',
          remainingTicks: 2,
        },
      ],
    })
    const [first, second] = simulation.read().pearls
    expect(first!.velocity.x * second!.velocity.x).toBeLessThan(0)
  })

  it('M4 互动配置拒绝不存在的材料引用', () => {
    const map = composition([{ column: 32, row: 63, type: 1 }])
    expect(
      () => new ExtractionSimulation(config(map, 1, {
        interactions: [
          {
            id: 'invalid-fight',
            behavior: 'fight',
            participantA: {
              materialDefinitionIds: ['missing-material'],
              requiredTagIds: [],
              pearlTypes: ['medicinalLiquid'],
            },
            participantB: {
              materialDefinitionIds: [MATERIAL_ID],
              requiredTagIds: [],
              pearlTypes: ['medicinalLiquid'],
            },
            distance: 10,
            durationSeconds: 1,
            impulse: 1,
            cooldownSeconds: 1,
          },
        ],
      })),
    ).toThrow('SIM_EXTRACTION_CONFIG_INVALID:interactions.invalid-fight.participantA.materialDefinitionIds')
  })

  it('ReadView 发布当前求解使用的有效火源，停火时恢复为空', () => {
    const map = composition([{ column: 32, row: 63, type: 1 }])
    const simulation = new ExtractionSimulation(config(map, 1))
    let state = domainState(1, { isSpraying: false })

    ;({ state } = runTick(simulation, state, 0))
    expect(simulation.read()).toMatchObject({ effectiveFireSource: null })

    ;({ state } = runTick(simulation, { ...state, isSpraying: true }, 1))
    expect(simulation.read()).toMatchObject({
      effectiveFireSource: {
        position: { x: 64, y: 112 },
        direction: { x: 0, y: -1 },
        width: 80,
      },
    })

    runTick(simulation, { ...state, isSpraying: false }, 2)
    expect(simulation.read()).toMatchObject({ effectiveFireSource: null })
  })

  it('大于材料格尺寸的暴露探测距离不会跳过下层遮挡', () => {
    const map = rectangleComposition(32, 32, 58, 63)
    const simulation = new ExtractionSimulation(
      config(map, 6, {
        exposureProbeDistance: 18,
        dissolutionVolumePerTick: 1,
      }),
    )
    let state = domainState(6, { isSpraying: false })
    ;({ state } = runTick(simulation, state, 0))
    const before = simulation.read().materials[0]!.remainingCellVolumes

    ;({ state } = runTick(simulation, { ...state, isSpraying: true }, 1))

    expect([...affectedRows(before, simulation.read().materials[0]!.remainingCellVolumes)])
      .toEqual([63])
  })

  it('解析圆-格碰撞能检出整格落在圆内但 16 个圆周采样点都落在格外的情形', () => {
    const remainingCellVolumes = new Float64Array(CELL_COUNT)
    remainingCellVolumes[32 * GRID_SIZE + 32] = 1

    expect(
      circleIntersectsRemainingMaterial(
        [{
          placement: {
            center: { x: 32, y: 32 },
            width: 64,
            height: 64,
            rotationRadians: 0,
            layer: 0,
          },
          remainingCellVolumes,
        }],
        { x: 31, y: 32.5 },
        2,
      ),
    ).toBe(true)
  })

  it('30Hz 下 500px/s 的珠子不会穿过单个剩余材料格', () => {
    const map = composition([
      { column: 31, row: 63, type: 1 },
      { column: 42, row: 63, type: 1 },
    ])
    const fastPhysics = {
      radiusAtStandardVolume: 0.2,
      spawnVelocity: { minX: 500, maxX: 500, minY: 0, maxY: 0 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 500,
      materialRestitution: 0.25,
      ...M3_PEARL_RULES,
    }
    const simulation = new ExtractionSimulation(
      config(map, 2, {
        fixedDeltaSeconds: 1 / 30,
        dissolutionVolumePerTick: 1,
        fireSource: {
          origin: { x: 58.5, y: 112 },
          halfAngleRadians: Math.PI / 3,
          minWidth: 4,
          maxWidth: 4,
        },
        pearlPhysics: {
          medicinalLiquid: fastPhysics,
          slag: fastPhysics,
          impurity: fastPhysics,
        },
      }),
    )
    let state = domainState(2)
    const born = runTick(simulation, state, 0)
    state = { ...born.state, isSpraying: false }
    expect(born.delta.births).toHaveLength(1)
    const before = simulation.read().pearls[0]!.position

    runTick(simulation, state, 1)

    expect(simulation.read().pearls[0]!.position).toEqual(before)
    expect(simulation.read().pearls[0]!.velocity.x).toBe(-125)
  })

  it('单份材料总体积唯一等于 targetPearlCount × standardPearlVolume', () => {
    const map = composition([
      { column: 31, row: 32, type: 1 },
      { column: 32, row: 32, type: 2 },
      { column: 33, row: 32, type: 3 },
    ])
    const simulation = new ExtractionSimulation(
      config(map, 7, { dissolutionVolumePerTick: 0.25 }),
    )
    const state = domainState(7, { isSpraying: false })

    runTick(simulation, state, 0)

    const material = simulation.read().materials[0]!
    expect(material.initialVolume).toBe(7)
    expect(material.remainingVolume).toBe(7)
    expect(sum(material.initialCellVolumes)).toBeCloseTo(7, 12)
    expect(material.initialVolumeByType).toEqual({
      medicinalLiquid: 7 / 3,
      slag: 7 / 3,
      impurity: 7 / 3,
    })
  })

  it('标准珠体积小于旧绝对 epsilon 时，4096 个正体积格仍能推进', () => {
    const map = rectangleComposition(0, 63, 0, 63)
    const standardPearlVolume = 1e-10
    const scenarioConfig = config(map, 1, {
      standardPearlVolume,
      dissolutionVolumePerTick: standardPearlVolume,
    })
    const runScenario = () => {
      const simulation = new ExtractionSimulation(scenarioConfig)
      const startedAt = performance.now()
      const result = runTick(
        simulation,
        domainState(standardPearlVolume),
        0,
      )
      return {
        elapsedMilliseconds: performance.now() - startedAt,
        result,
        material: simulation.read().materials[0]!,
      }
    }

    const first = runScenario()
    const replay = runScenario()
    const dissolvedVolume = sum(
      first.result.delta.dissolutions.map(({ volume }) => volume),
    )

    expect(first.elapsedMilliseconds).toBeLessThan(2_000)
    expect(dissolvedVolume).toBeGreaterThan(0)
    expect(first.material.remainingVolume)
      .toBeLessThan(standardPearlVolume)
    expect(
      standardPearlVolume - first.material.remainingVolume,
    ).toBeCloseTo(dissolvedVolume, 20)
    expect(replay.result.delta).toEqual(first.result.delta)
    expect(replay.material.remainingCellVolumes).toEqual(
      first.material.remainingCellVolumes,
    )
  })

  it('每 tick 溶解量小于旧绝对 epsilon 时仍按配置产生正进度', () => {
    const map = composition([{ column: 32, row: 63, type: 1 }])
    const dissolutionVolumePerTick = 1e-10
    const simulation = new ExtractionSimulation(
      config(map, 1, { dissolutionVolumePerTick }),
    )

    const result = runTick(simulation, domainState(1), 0)

    expect(sum(result.delta.dissolutions.map(({ volume }) => volume)))
      .toBeCloseTo(dissolutionVolumePerTick, 20)
    expect(simulation.read().materials[0]!.remainingVolume).toBeLessThan(1)
  })

  it('按成分权重生成各类型完整珠和尾量珠，出生总体积严格守恒', () => {
    const map = composition([
      { column: 29, row: 32, type: 1 },
      { column: 30, row: 32, type: 1 },
      { column: 31, row: 32, type: 1 },
      { column: 32, row: 32, type: 2 },
      { column: 33, row: 32, type: 3 },
      { column: 34, row: 32, type: 3 },
    ])
    const simulation = new ExtractionSimulation(
      config(map, 5, { dissolutionVolumePerTick: 100 }),
    )

    const result = runTick(simulation, domainState(5), 0)

    expect(sum(result.delta.dissolutions.map(({ volume }) => volume))).toBeCloseTo(5, 12)
    expect(sum(result.delta.births.map(({ volume }) => volume))).toBeCloseTo(5, 12)
    const bornVolumeByType = volumeByType(result.delta)
    expect(bornVolumeByType.medicinalLiquid).toBeCloseTo(2.5, 12)
    expect(bornVolumeByType.slag).toBeCloseTo(5 / 6, 12)
    expect(bornVolumeByType.impurity).toBeCloseTo(5 / 3, 12)
    expect(
      result.delta.births.filter(({ pearlType }) => pearlType === 'medicinalLiquid')
        .map(({ volume }) => volume),
    ).toEqual([1, 1, 0.5])
    expect(result.delta.births.map(({ pearlId }) => ({ pearlId }))).toEqual(
      [...result.delta.births]
        .sort((left, right) => left.pearlId.localeCompare(right.pearlId))
        .map(({ pearlId }) => ({ pearlId })),
    )
  })

  it('seed 与 spawnVelocity 范围决定可重放且不被静默丢弃的出生速度', () => {
    const map = composition([{ column: 32, row: 32, type: 1 }])
    const run = (seed: number) => {
      const base = config(map, 4, { dissolutionVolumePerTick: 4 })
      const rangedPhysics = Object.fromEntries(
        (['medicinalLiquid', 'slag', 'impurity'] as const).map((pearlType) => [
          pearlType,
          {
            ...base.pearlPhysics[pearlType],
            spawnVelocity: { minX: -10, maxX: 10, minY: 20, maxY: 30 },
          },
        ]),
      ) as typeof base.pearlPhysics
      const simulation = new ExtractionSimulation({
        ...base,
        seed,
        pearlPhysics: rangedPhysics,
      })

      runTick(simulation, domainState(4), 0)
      return simulation.read().pearls.map(({ velocity }) => velocity)
    }

    const first = run(123)
    const replay = run(123)
    const anotherSeed = run(456)

    expect(first).toEqual(replay)
    expect(first).not.toEqual(anotherSeed)
    expect(new Set(first.map(({ x }) => x)).size).toBeGreaterThan(1)
    for (const velocity of first) {
      expect(velocity.x).toBeGreaterThanOrEqual(-10)
      expect(velocity.x).toBeLessThanOrEqual(10)
      expect(velocity.y).toBeGreaterThanOrEqual(20)
      expect(velocity.y).toBeLessThanOrEqual(30)
    }
  })

  it('窄火形成更深缺口、宽火形成更宽剥离，但每 tick 总溶解速率相同', () => {
    const map = rectangleComposition(20, 43, 20, 43)
    const baseConfig = config(map, 576, { dissolutionVolumePerTick: 24 })
    const narrow = new ExtractionSimulation(baseConfig)
    const wide = new ExtractionSimulation(baseConfig)
    const narrowState = domainState(576, { fireSize: 0 })
    const wideState = domainState(576, { fireSize: 100 })

    const initial = new ExtractionSimulation(baseConfig)
    runTick(initial, domainState(576, { isSpraying: false }), 0)
    const before = initial.read().materials[0]!.remainingCellVolumes
    const narrowResult = runTick(narrow, narrowState, 0)
    const wideResult = runTick(wide, wideState, 0)
    const narrowAfter = narrow.read().materials[0]!.remainingCellVolumes
    const wideAfter = wide.read().materials[0]!.remainingCellVolumes

    expect(sum(narrowResult.delta.dissolutions.map(({ volume }) => volume))).toBeCloseTo(24, 12)
    expect(sum(wideResult.delta.dissolutions.map(({ volume }) => volume))).toBeCloseTo(24, 12)
    expect(affectedRows(before, narrowAfter).size).toBeGreaterThan(
      affectedRows(before, wideAfter).size,
    )
    expect(affectedColumns(before, narrowAfter).size).toBeLessThan(
      affectedColumns(before, wideAfter).size,
    )
  })

  it('生产级小步溶解在首珠出生时已经形成局部面积缺口，不把整排 exposed 格均摊成淡影', () => {
    const map = rectangleComposition(18, 46, 16, 48)
    const simulation = new ExtractionSimulation(
      config(map, 300, {
        fixedDeltaSeconds: 1 / 30,
        dissolutionVolumePerTick: 0.18,
        fireSource: {
          origin: { x: 64, y: 112 },
          halfAngleRadians: Math.PI / 3,
          minWidth: 4,
          maxWidth: 80,
        },
      }),
    )
    let state = domainState(300)
    let firstBirthTick = -1
    for (let tick = 0; tick < 20; tick += 1) {
      const result = runTick(simulation, state, tick)
      state = result.state
      if (result.delta.births.length > 0) {
        firstBirthTick = tick
        break
      }
    }

    const material = simulation.read().materials[0]!
    const zeroCells = material.initialCellVolumes.filter(
      (initial, index) =>
        initial > 0 && material.remainingCellVolumes[index] === 0,
    ).length
    const partialCells = material.initialCellVolumes.filter(
      (initial, index) =>
        initial > 0 &&
        material.remainingCellVolumes[index]! > 0 &&
        material.remainingCellVolumes[index]! < initial,
    ).length

    expect(firstBirthTick).toBeGreaterThanOrEqual(0)
    expect(zeroCells).toBeGreaterThan(0)
    expect(partialCells).toBeLessThanOrEqual(1)
  })

  it('自然损耗形成的 partial 不会冒充 active fire front', () => {
    const map = composition([
      { column: 20, row: 63, type: 1 },
      { column: 26, row: 63, type: 2 },
      { column: 32, row: 63, type: 2 },
    ])
    const simulation = new ExtractionSimulation(
      config(map, 3, {
        fixedDeltaSeconds: 1,
        dissolutionVolumePerTick: 0.18,
        naturalLossRatePerMinute: 30,
      }),
    )
    let state = domainState(3, { isSpraying: false })
    ;({ state } = runTick(simulation, state, 0))

    const naturallyPartial = simulation.read().materials[0]!
    expect(naturallyPartial.remainingCellVolumes[63 * GRID_SIZE + 20])
      .toBeLessThan(naturallyPartial.initialCellVolumes[63 * GRID_SIZE + 20]!)

    const fired = runTick(
      simulation,
      { ...state, isSpraying: true },
      1,
    )

    expect(fired.delta.dissolutions).toMatchObject([
      { pearlType: 'slag', volume: 0.18 },
    ])
  })

  it('只有火蚀本身清零的格才建立通道，自然损耗收尾不会暴露相邻炉渣', () => {
    const map = composition([
      { column: 32, row: 63, type: 1 },
      { column: 33, row: 63, type: 2 },
    ])
    const base = config(map, 2)
    const channelConfig: ExtractionSimulationConfig = {
      ...base,
      fixedDeltaSeconds: 1,
      dissolutionVolumePerTick: 0.5,
      naturalLossRatePerMinute: 60,
      safeZoneY: 780,
      fireFlow: {
        ...base.fireFlow,
        geometry: {
          columns: 100,
          rows: 125,
          cellSize: 4,
          originX: 600,
          originY: 300,
        },
      },
      materialPlacement: {
        visibleLongEdge: 64,
        minimumGap: 0,
        usableRegion: { left: 700, top: 400, right: 900, bottom: 600 },
        slots: [{ center: { x: 800, y: 500 }, rotationRadians: 0 }],
      },
      fireSource: {
        origin: { x: 784, y: 700 },
        halfAngleRadians: Math.PI / 3,
        minWidth: 16,
        maxWidth: 16,
      },
      collector: {
        ...base.collector,
        initialCenter: { x: 800, y: 760 },
        trackMinX: 700,
        trackMaxX: 900,
      },
      worldBounds: { left: 600, top: 300, right: 1000, bottom: 800 },
    }
    const runBranch = (sprayOnFirstTick: boolean) => {
      const simulation = new ExtractionSimulation(channelConfig)
      const execute = () => {
        const first = runTick(
          simulation,
          domainState(2, {
            isSpraying: sprayOnFirstTick,
            fireDirection: { x: 0, y: -1 },
          }),
          0,
        )
        const second = runTick(
          simulation,
          { ...first.state, isSpraying: true },
          1,
        )
        return {
          firstDissolutions: first.delta.dissolutions,
          firstNaturalLosses: first.delta.naturalLosses,
          secondDissolutions: second.delta.dissolutions,
          remainingCellVolumes: Array.from(
            simulation.read().materials[0]!.remainingCellVolumes,
          ),
        }
      }
      const firstRun = execute()
      simulation.reset()
      expect(execute()).toEqual(firstRun)
      return firstRun
    }

    const control = runBranch(false)
    const experiment = runBranch(true)

    expect(control.firstDissolutions).toEqual([])
    expect(experiment.firstDissolutions).toMatchObject([
      { pearlType: 'medicinalLiquid', volume: 0.5 },
    ])
    expect(control.secondDissolutions).toEqual([])
    expect(experiment.secondDissolutions).toEqual([])
    expect(experiment.remainingCellVolumes).toEqual(
      control.remainingCellVolumes,
    )
  })

  it.each([0, 1.5, 65] as const)(
    'frontLaneWidthCells=%s 在 simulation 边界 fail-closed',
    (frontLaneWidthCells) => {
      const map = composition([{ column: 32, row: 63, type: 1 }])
      expect(
        () =>
          new ExtractionSimulation(
            config(map, 1, { frontLaneWidthCells }),
          ),
      ).toThrow('SIM_EXTRACTION_CONFIG_INVALID:frontLaneWidthCells')
    },
  )

  it('标准珠出生即与所有剩余材料分离，commit 后下一 tick 真实移动', () => {
    const map = rectangleComposition(18, 46, 16, 48)
    const simulation = new ExtractionSimulation(
      config(map, 300, {
        fixedDeltaSeconds: 1 / 30,
        dissolutionVolumePerTick: 1,
        pearlPhysics: {
          medicinalLiquid: {
            ...config(map, 300).pearlPhysics.medicinalLiquid,
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 20, maxX: 20, minY: 30, maxY: 30 },
            gravity: 0,
          },
          slag: {
            ...config(map, 300).pearlPhysics.slag,
            radiusAtStandardVolume: 2,
          },
          impurity: {
            ...config(map, 300).pearlPhysics.impurity,
            radiusAtStandardVolume: 2,
          },
        },
      }),
    )
    const first = runTick(simulation, domainState(300), 0)
    expect(first.delta.births).toHaveLength(1)
    const firstPearlAtBirth = simulation.read().pearls[0]!
    expect(
      circleIntersectsRemainingMaterial(
        simulation.read().materials,
        firstPearlAtBirth.position,
        firstPearlAtBirth.radius,
      ),
    ).toBe(false)

    const second = runTick(simulation, first.state, 1)
    expect(second.delta.births).toHaveLength(1)
    for (const pearl of simulation.read().pearls) {
      expect(
        circleIntersectsRemainingMaterial(
          simulation.read().materials,
          pearl.position,
          pearl.radius,
        ),
      ).toBe(false)
    }
    expect(simulation.read().pearls[0]!.position).not.toEqual(
      firstPearlAtBirth.position,
    )
    expect(
      sum(
        [...first.delta.births, ...second.delta.births].map(
          ({ volume }) => volume,
        ),
      ),
    ).toBeCloseTo(
      sum(
        [...first.delta.dissolutions, ...second.delta.dissolutions].map(
          ({ volume }) => volume,
        ),
      ),
      12,
    )
  })

  it('材料剩余格构成完全障碍，烧出的缺口在下一 tick 进入同一火流视图', () => {
    const map = rectangleComposition(20, 43, 20, 43)
    const simulation = new ExtractionSimulation(
      config(map, 1, {
        standardPearlVolume: 1000,
        dissolutionVolumePerTick: 12,
        fireSource: {
          origin: { x: 64, y: 112 },
          halfAngleRadians: Math.PI / 3,
          minWidth: 8,
          maxWidth: 80,
        },
      }),
    )
    let state = domainState(1000, { fireSize: 0, isSpraying: false })
    ;({ state } = runTick(simulation, state, 0))

    const centerFlowIndex = 12 * 32 + 16
    expect(simulation.read().fireFlow.obstacle[centerFlowIndex]).toBe(1)

    state = { ...state, isSpraying: true }
    let tick = 1
    while (
      simulation.read().fireFlow.obstacle[centerFlowIndex] === 1 &&
      tick < 60
    ) {
      ;({ state } = runTick(simulation, state, tick))
      tick += 1
    }
    expect(simulation.read().fireFlow.obstacle[centerFlowIndex]).toBe(0)
    expect(simulation.read().materials[0]!.remainingVolume).toBeGreaterThan(0)
  })

  it('newborn 在出生 tick 不运动也不接取，commit 后才成为下一 tick active', () => {
    const map = composition([{ column: 32, row: 32, type: 1 }])
    const simulation = new ExtractionSimulation(
      config(map, 1, {
        dissolutionVolumePerTick: 1,
        collector: {
          initialCenter: { x: 64.5, y: 50.5 },
          width: 12,
          height: 12,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
        pearlPhysics: {
          medicinalLiquid: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
          slag: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
          impurity: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
        },
      }),
    )
    let state = domainState(1)

    const born = runTick(simulation, state, 0)
    state = born.state
    expect(born.delta.births).toHaveLength(1)
    expect(born.delta.terminalOutcomes).toEqual([])
    expect(simulation.read().pearls).toMatchObject([{ state: 'active' }])

    const caught = runTick(simulation, state, 1)
    expect(caught.delta.terminalOutcomes).toEqual([
      { pearlId: born.delta.births[0]!.pearlId, outcome: 'caught' },
    ])
    expect(simulation.read().pearls).toMatchObject([{ state: 'caught' }])
  })

  it('collector 按输入轴移动并接取既有 active 珠', () => {
    const map = composition([{ column: 32, row: 32, type: 1 }])
    const simulation = new ExtractionSimulation(
      config(map, 1, {
        dissolutionVolumePerTick: 1,
        collector: {
          initialCenter: { x: 52, y: 50.5 },
          width: 8,
          height: 10,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 16,
          deceleration: 16,
          maxSpeed: 16,
        },
        pearlPhysics: {
          medicinalLiquid: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
          slag: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
          impurity: {
            radiusAtStandardVolume: 2,
            spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            gravity: 0,
            driftX: 0,
            maxSpeed: 40,
            materialRestitution: 0.2,
            ...M3_PEARL_RULES,
          },
        },
      }),
    )
    let state = domainState(1)
    const born = runTick(simulation, state, 0)
    state = { ...born.state, containerAxis: 1 }

    const caught = runTick(simulation, state, 1)

    expect(simulation.read().collector.center.x).toBe(68)
    expect(caught.delta.terminalOutcomes).toEqual([
      { pearlId: born.delta.births[0]!.pearlId, outcome: 'caught' },
    ])
  })

  it('collector 在轨道边界被夹紧时清零速度，不借用体积容差', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        fixedDeltaSeconds: 1,
        collector: {
          initialCenter: { x: 112, y: 0 },
          width: 1,
          height: 1,
          trackMinX: 0,
          trackMaxX: 112,
          acceleration: 1e-8,
          deceleration: 1,
          maxSpeed: 1,
        },
      }),
    )

    runTick(simulation, domainState(1, { containerAxis: 1, isSpraying: false }), 0)

    expect(simulation.read().collector.center.x).toBe(112)
    expect(simulation.read().collector.velocityX).toBe(0)
  })

  it.each([
    ['left', { x: 68, y: 50 }, { x: 68.01, y: 50 }],
    ['right', { x: 60, y: 50 }, { x: 59.99, y: 50 }],
    ['top', { x: 64, y: 54 }, { x: 64, y: 54.01 }],
    ['bottom', { x: 64, y: 46 }, { x: 64, y: 45.99 }],
  ] as const)('collector 仅在珠中心进入 AABB 时接取：%s 边界', (_edge, boundary, outside) => {
    const run = (collectorCenter: Readonly<{ x: number; y: number }>) => {
      const zeroPhysics = {
        radiusAtStandardVolume: 2,
        spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        gravity: 0,
        driftX: 0,
        maxSpeed: 40,
        materialRestitution: 0.2,
        ...M3_PEARL_RULES,
      }
      const simulation = new ExtractionSimulation(
        config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
          collector: {
            initialCenter: collectorCenter,
            width: 8,
            height: 8,
            trackMinX: 0,
            trackMaxX: 128,
            acceleration: 80,
            deceleration: 100,
            maxSpeed: 32,
          },
          pearlPhysics: {
            medicinalLiquid: zeroPhysics,
            slag: zeroPhysics,
            impurity: zeroPhysics,
          },
        }),
      )
      const born = runTick(simulation, domainState(1), 0)
      return runTick(simulation, { ...born.state, isSpraying: false }, 1)
        .delta.terminalOutcomes
    }

    expect(run(boundary)).toMatchObject([{ outcome: 'caught' }])
    expect(run(outside)).toEqual([])
  })

  it('phase 5 只让既有 active 珠运动，并与仍有体积的材料格碰撞', () => {
    const map = composition([
      { column: 32, row: 32, type: 1 },
      { column: 32, row: 33, type: 1 },
    ])
    const physics = {
      radiusAtStandardVolume: 0.3,
      spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      gravity: -1,
      driftX: 0,
      maxSpeed: 10,
      materialRestitution: 0.2,
      ...M3_PEARL_RULES,
    }
    const simulation = new ExtractionSimulation(
      config(map, 2, {
        dissolutionVolumePerTick: 1,
        pearlPhysics: {
          medicinalLiquid: physics,
          slag: physics,
          impurity: physics,
        },
        collector: {
          initialCenter: { x: 16, y: 112 },
          width: 4,
          height: 4,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
      }),
    )
    let state = domainState(2)
    const born = runTick(simulation, state, 0)
    state = { ...born.state, isSpraying: false }
    const before = simulation.read().pearls[0]!.position

    runTick(simulation, state, 1)

    expect(simulation.read().pearls[0]!.position).toEqual(before)
    expect(simulation.read().pearls[0]!.velocity.y).toBeCloseTo(0.2, 12)
  })

  it('密集材料表面的药渣停火后不会因全量反速收敛为永久静止 active 珠', () => {
    const map = rectangleComposition(20, 43, 20, 43, 2)
    const physics = {
      radiusAtStandardVolume: 0.3,
      spawnVelocity: { minX: 1, maxX: 1, minY: 0, maxY: 0 },
      gravity: -1,
      driftX: 0,
      maxSpeed: 10,
      materialRestitution: 0.2,
      ...M3_PEARL_RULES,
    }
    const scenarioConfig = config(map, 300, {
      dissolutionVolumePerTick: 1,
      pearlPhysics: {
        medicinalLiquid: physics,
        slag: physics,
        impurity: physics,
      },
      collector: {
        initialCenter: { x: 16, y: 112 },
        width: 4,
        height: 4,
        trackMinX: 16,
        trackMaxX: 112,
        acceleration: 80,
        deceleration: 100,
        maxSpeed: 32,
      },
    })
    const runScenario = () => {
      const simulation = new ExtractionSimulation(scenarioConfig)
      let state = domainState(300)
      const born = runTick(simulation, state, 0)
      state = { ...born.state, isSpraying: false }
      expect(born.delta.births).toMatchObject([{ pearlType: 'slag' }])
      const pearlId = born.delta.births[0]!.pearlId
      const positions: string[] = []

      for (let tick = 1; tick <= 60; tick += 1) {
        const result = runTick(simulation, state, tick)
        state = { ...result.state, isSpraying: false }
        const pearl = simulation.read().pearls.find(
          (candidate) => candidate.pearlId === pearlId,
        )!
        positions.push(`${pearl.position.x},${pearl.position.y}`)
      }

      const pearl = simulation.read().pearls.find(
        (candidate) => candidate.pearlId === pearlId,
      )!
      return {
        positions,
        pearl,
        nearSurface: circleIntersectsRemainingMaterial(
          simulation.read().materials,
          pearl.position,
          pearl.radius + 1,
        ),
      }
    }
    const first = runScenario()
    const replay = runScenario()
    const lowSpeed =
      Math.hypot(first.pearl.velocity.x, first.pearl.velocity.y) < 10
    const positionUnchanged = new Set(first.positions).size === 1

    expect(new Set(first.positions).size).toBeGreaterThan(1)
    expect(replay).toEqual(first)
    expect(
      first.pearl.state === 'active' &&
        first.nearSurface &&
        lowSpeed &&
        positionUnchanged,
    ).toBe(false)
  })

  it('phase 6 将完全越出 worldBounds 的既有 active 珠稳定结算为 missed', () => {
    const map = composition([{ column: 32, row: 32, type: 1 }])
    const physics = {
      radiusAtStandardVolume: 1,
      spawnVelocity: { minX: 0, maxX: 0, minY: 100, maxY: 100 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 100,
      materialRestitution: 0.2,
      ...M3_PEARL_RULES,
    }
    const simulation = new ExtractionSimulation(
      config(map, 1, {
        dissolutionVolumePerTick: 1,
        pearlPhysics: {
          medicinalLiquid: physics,
          slag: physics,
          impurity: physics,
        },
        collector: {
          initialCenter: { x: 16, y: 16 },
          width: 4,
          height: 4,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
      }),
    )
    let state = domainState(1)
    const born = runTick(simulation, state, 0)
    state = born.state

    const missed = runTick(simulation, state, 1)

    expect(missed.delta.terminalOutcomes).toEqual([
      { pearlId: born.delta.births[0]!.pearlId, outcome: 'missed' },
    ])
    expect(simulation.read().pearls).toMatchObject([{ state: 'missed' }])
  })

  it('rollback 不发布材料、珠子、流场或 ID 半写，同 tick 重放得到相同 delta', () => {
    const map = composition([{ column: 32, row: 32, type: 1 }])
    const simulation = new ExtractionSimulation(
      config(map, 1, { dissolutionVolumePerTick: 1 }),
    )
    const state = domainState(1)
    const before = simulation.read()

    simulation.beginTick({ tick: 0, domainState: state })
    for (let phase = 1; phase <= 7; phase += 1) {
      simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
    }
    const first = simulation.buildCandidate()
    simulation.rollbackTick()

    expect(simulation.read()).toBe(before)
    expect(simulation.read()).toMatchObject({ tick: -1, materials: [], pearls: [] })

    simulation.beginTick({ tick: 0, domainState: state })
    for (let phase = 1; phase <= 7; phase += 1) {
      simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
    }
    const replay = simulation.buildCandidate()
    expect(replay).toEqual(first)
  })

  it('完整标准珠无法找到安全出生点时首个形成 tick 立即 fail-closed 并可同 tick 重放', () => {
    const map = rectangleComposition(31, 32, 31, 32)
    const base = config(map, 4, { dissolutionVolumePerTick: 1 })
    const blockedPhysics = Object.fromEntries(
      Object.entries(base.pearlPhysics).map(([pearlType, physics]) => [
        pearlType,
        { ...physics, spawnClearance: 100 },
      ]),
    ) as ExtractionSimulationConfig['pearlPhysics']
    const simulation = new ExtractionSimulation({
      ...base,
      pearlPhysics: blockedPhysics,
    })
    const initialized = runTick(
      simulation,
      domainState(4, { isSpraying: false }),
      0,
    )
    const spraying = { ...initialized.state, isSpraying: true }

    const runBlockedBirthTick = () => {
      simulation.beginTick({ tick: 1, domainState: spraying })
      for (let phase = 1; phase <= 3; phase += 1) {
        simulation.runPhase(phase as 1 | 2 | 3, spraying)
      }
      expect(() => simulation.runPhase(4, spraying)).toThrow(
        'SIM_EXTRACTION_PEARL_SPAWN_BLOCKED',
      )
      simulation.rollbackTick()
    }

    runBlockedBirthTick()
    expect(simulation.read().materials[0]!.remainingVolume).toBe(4)
    expect(simulation.read().pearls).toEqual([])

    runBlockedBirthTick()
    expect(simulation.read().materials[0]!.remainingVolume).toBe(4)
    expect(simulation.read().pearls).toEqual([])
  })

  it('构造后的外部配置变更不会改写模拟权威配置', () => {
    const mutableConfig = config(
      composition([{ column: 32, row: 32, type: 1 }]),
      1,
    )
    const simulation = new ExtractionSimulation(mutableConfig)
    ;(mutableConfig.materialPlacement.slots[0]!.center as { x: number }).x = 12
    ;(mutableConfig.fireSource.origin as { x: number }).x = 12

    runTick(simulation, domainState(1, { isSpraying: false }), 0)

    const material = simulation.read().materials[0]!
    const bounds = deriveMaterialContentBounds(material.composition)
    expect({
      x:
        material.placement.center.x +
        ((bounds.leftColumn + bounds.rightColumn) * 0.5 - GRID_SIZE * 0.5) *
          (material.placement.width / GRID_SIZE),
      y:
        material.placement.center.y +
        ((bounds.topRow + bounds.bottomRow) * 0.5 - GRID_SIZE * 0.5) *
          (material.placement.height / GRID_SIZE),
    }).toEqual({ x: 64, y: 50 })
  })

  it('公开 read 视图不能改写已发布流场或下一 tick 的 generation', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1),
    )
    let state = domainState(1, { isSpraying: false })
    ;({ state } = runTick(simulation, state, 0))
    const published = simulation.read()
    const originalIntensity = published.fireFlow.intensity[0]!
    try {
      ;(published.fireFlow as { generation: number }).generation = 999
    } catch {
      // 冻结视图在 strict mode 下拒绝写入也符合合约。
    }
    published.fireFlow.intensity[0] = originalIntensity ^ 1

    expect(simulation.read().fireFlow.intensity[0]).toBe(originalIntensity)
    ;({ state } = runTick(simulation, state, 1))
    expect(simulation.read().fireFlow.generation).toBe(2)
  })

  it('按成分码稳定生成药液、药渣与杂质三类丹珠', () => {
    const simulation = new ExtractionSimulation(
      config(
        composition([
          { column: 31, row: 32, type: 1 },
          { column: 32, row: 32, type: 2 },
          { column: 33, row: 32, type: 3 },
        ]),
        3,
        { dissolutionVolumePerTick: 3 },
      ),
    )

    const result = runTick(simulation, domainState(3), 0)

    expect(result.delta.births.map(({ pearlType }) => pearlType)).toEqual([
      'impurity',
      'medicinalLiquid',
      'slag',
    ])
    expect(volumeByType(result.delta)).toEqual({
      medicinalLiquid: 1,
      slag: 1,
      impurity: 1,
    })
  })

  it('丹珠首触火焰先激活护盾，保护耗尽后才按体积持续灼烧', () => {
    const physics = {
      radiusAtStandardVolume: 2,
      spawnClearance: 0,
      spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 40,
      materialRestitution: 0.2,
      wallRestitution: 0.2,
      fireProtectionSeconds: 1,
      resetProtectionOnExit: true,
      burnDurationSeconds: 2,
      thrustAcceleration: 0,
    }
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        pearlPhysics: {
          medicinalLiquid: physics,
          slag: physics,
          impurity: physics,
        },
        collector: {
          initialCenter: { x: 16, y: 112 },
          width: 4,
          height: 4,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
      }),
    )
    const born = runTick(simulation, domainState(1), 0)
    const pearlId = born.delta.births[0]!.pearlId

    const shielded = runTick(simulation, born.state, 1)
    expect(shielded.delta.shieldActivations).toEqual([{ pearlId }])
    expect(shielded.delta.pearlVolumeChanges).toEqual([])
    expect(simulation.read().pearls[0]).toMatchObject({
      currentVolume: 1,
      shield: { active: true, exposureTicks: 1 },
    })

    const damaged = runTick(simulation, shielded.state, 2)
    expect(damaged.delta.pearlVolumeChanges).toHaveLength(1)
    expect(damaged.delta.pearlVolumeChanges[0]).toMatchObject({
      pearlId,
      previousVolume: 1,
    })
    expect(damaged.delta.pearlVolumeChanges[0]!.currentVolume).toBeLessThan(1)
    expect(damaged.state.ledger.burnedMedicinalVolume).toBeGreaterThan(0)
  })

  it('火焰推力开关只在开启时沿权威流场改变丹珠速度', () => {
    const physics = {
      radiusAtStandardVolume: 2,
      spawnClearance: 0,
      spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 100,
      materialRestitution: 0.2,
      wallRestitution: 0.2,
      fireProtectionSeconds: 10,
      resetProtectionOnExit: true,
      burnDurationSeconds: 60,
      thrustAcceleration: 20,
    }
    const create = () =>
      new ExtractionSimulation(
        config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
          pearlPhysics: {
            medicinalLiquid: physics,
            slag: physics,
            impurity: physics,
          },
          collector: {
            initialCenter: { x: 16, y: 112 },
            width: 4,
            height: 4,
            trackMinX: 16,
            trackMaxX: 112,
            acceleration: 80,
            deceleration: 100,
            maxSpeed: 32,
          },
        }),
      )
    const offSimulation = create()
    const onSimulation = create()
    const offBorn = runTick(offSimulation, domainState(1), 0)
    const onBorn = runTick(onSimulation, domainState(1), 0)

    runTick(offSimulation, offBorn.state, 1)
    const thrustOn = runTick(
      onSimulation,
      { ...onBorn.state, flameThrustEnabled: true },
      1,
    )

    expect(offSimulation.read().pearls[0]!.velocity).toEqual({ x: 0, y: 0 })
    const velocityAfterThrust = onSimulation.read().pearls[0]!.velocity
    expect(velocityAfterThrust.y).toBeLessThan(0)

    runTick(
      onSimulation,
      {
        ...thrustOn.state,
        flameThrustEnabled: false,
        isSpraying: true,
      },
      2,
    )

    expect(onSimulation.read().pearls[0]!.velocity).toEqual(
      velocityAfterThrust,
    )
  })

  it('离开火流后重置保护计时，再次触火会重新激活护盾', () => {
    const physics = {
      radiusAtStandardVolume: 2,
      spawnClearance: 0,
      spawnVelocity: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 40,
      materialRestitution: 0.2,
      wallRestitution: 0.2,
      fireProtectionSeconds: 1,
      resetProtectionOnExit: true,
      burnDurationSeconds: 2,
      thrustAcceleration: 0,
    }
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        pearlPhysics: {
          medicinalLiquid: physics,
          slag: physics,
          impurity: physics,
        },
        collector: {
          initialCenter: { x: 16, y: 112 },
          width: 4,
          height: 4,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
      }),
    )
    const born = runTick(simulation, domainState(1), 0)
    const firstContact = runTick(simulation, born.state, 1)
    const leftFire = runTick(
      simulation,
      { ...firstContact.state, isSpraying: false },
      2,
    )
    expect(simulation.read().pearls[0]!.shield).toEqual({
      active: false,
      exposureTicks: 0,
    })

    const secondContact = runTick(
      simulation,
      { ...leftFire.state, isSpraying: true },
      3,
    )
    expect(secondContact.delta.shieldActivations).toHaveLength(1)
    expect(secondContact.delta.pearlVolumeChanges).toEqual([])
  })

  it('丹珠越过安全区边界后永久退出挡火、伤害与推力资格', () => {
    const physics = {
      radiusAtStandardVolume: 2,
      spawnClearance: 0,
      spawnVelocity: { minX: 0, maxX: 0, minY: 20, maxY: 20 },
      gravity: 0,
      driftX: 0,
      maxSpeed: 40,
      materialRestitution: 0.2,
      wallRestitution: 0.2,
      fireProtectionSeconds: 0,
      resetProtectionOnExit: true,
      burnDurationSeconds: 1,
      thrustAcceleration: 20,
    }
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1, {
        safeZoneY: 70,
        pearlPhysics: {
          medicinalLiquid: physics,
          slag: physics,
          impurity: physics,
        },
        collector: {
          initialCenter: { x: 16, y: 112 },
          width: 4,
          height: 4,
          trackMinX: 16,
          trackMaxX: 112,
          acceleration: 80,
          deceleration: 100,
          maxSpeed: 32,
        },
      }),
    )
    const born = runTick(simulation, domainState(1), 0)
    const entered = runTick(
      simulation,
      { ...born.state, flameThrustEnabled: true },
      1,
    )

    expect(entered.delta.shieldActivations).toEqual([])
    expect(entered.delta.pearlVolumeChanges).toEqual([])
    expect(simulation.read().pearls[0]).toMatchObject({
      currentVolume: 1,
      velocity: { x: 0, y: 20 },
      safeZone: { entered: true, enteredTick: 1 },
    })
  })

  it('自然损耗按稳定实体顺序对合格药液体积分摊并守恒', () => {
    const simulation = new ExtractionSimulation(
      config(
        composition([
          { column: 31, row: 32, type: 1 },
          { column: 32, row: 32, type: 1 },
        ]),
        2,
        {
          naturalLossRatePerMinute: 30,
          dissolutionVolumePerTick: 1,
        },
      ),
    )

    const result = runTick(
      simulation,
      domainState(2, { isSpraying: false }),
      0,
    )

    expect(result.delta.naturalLosses.map(({ stableEntityId }) => stableEntityId)).toEqual([
      'cell:material-instance-1:2079',
      'cell:material-instance-1:2080',
    ])
    expect(sum(result.delta.naturalLosses.map(({ volume }) => volume))).toBe(1)
    expect(result.delta.naturalLosses.map(({ volume }) => volume)).toEqual([0.5, 0.5])
    expect(result.state.materialInstances[0]!.remainingVolume).toBe(1)
    expect(result.state.ledger.naturalLossVolume).toBe(1)
  })

  it('后加材料只对药液成分应用已记录继承损耗', () => {
    const simulation = new ExtractionSimulation(
      config(
        composition([
          { column: 31, row: 32, type: 1 },
          { column: 32, row: 32, type: 1 },
          { column: 33, row: 32, type: 2 },
        ]),
        3,
        { dissolutionVolumePerTick: 1 },
      ),
    )
    const state = domainState(3, {
      isSpraying: false,
      materialInstances: [
        {
          ...materialInstance(3),
          theoreticalMedicinalVolume: 2,
          inheritedLossAtAddition: 1,
        },
      ],
    })

    const result = runTick(simulation, state, 0)

    expect(result.delta.inheritedLosses).toEqual([
      {
        materialInstanceId: MATERIAL_INSTANCE_ID,
        theoreticalMedicinalVolume: 2,
        volume: 1,
      },
    ])
    expect(result.state.materialInstances[0]!.remainingVolume).toBe(2)
    expect(result.state.ledger.theoreticalMedicinalVolumes).toEqual({
      [MATERIAL_INSTANCE_ID]: 2,
    })
    expect(result.state.ledger.inheritedLossVolume).toBe(1)
    expect(simulation.read().materials[0]!.remainingVolume).toBe(2)
    expect(sum(simulation.read().materials[0]!.remainingCellVolumes)).toBe(2)
  })

  it('reset 清空所有运行态并从同一 seed 真实重放出相同 delta 与视图', () => {
    const simulation = new ExtractionSimulation(
      config(composition([{ column: 32, row: 32, type: 1 }]), 1),
    )
    const execute = () => {
      const initial = domainState(1)
      const first = runTick(simulation, initial, 0)
      const second = runTick(
        simulation,
        { ...first.state, isSpraying: false },
        1,
      )
      return {
        deltas: [first.delta, second.delta],
        view: {
          tick: simulation.read().tick,
          materials: simulation.read().materials,
          pearls: simulation.read().pearls,
          collector: simulation.read().collector,
          fireFlow: {
            generation: simulation.read().fireFlow.generation,
            tick: simulation.read().fireFlow.tick,
            intensity: Array.from(simulation.read().fireFlow.intensity),
          },
        },
      }
    }
    const firstRun = execute()

    expect(simulation.reset()).toMatchObject({
      tick: -1,
      materials: [],
      pearls: [],
      fireFlow: { generation: 0, tick: -1 },
    })

    expect(execute()).toEqual(firstRun)
  })
})
