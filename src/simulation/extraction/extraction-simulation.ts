import type {
  DomainState,
  MaterialInstance,
  PearlTerminalOutcome,
  PearlType,
} from '../../domain/index.ts'
import type {
  PearlBirthDelta,
  PearlTerminalDelta,
  SimulationDelta,
} from '../contracts.ts'
import {
  FireFlowField,
  type FireFlowCircleObstacles,
  type FireFlowReadView,
  type FireFlowSource,
} from '../fire-flow/index.ts'
import {
  EXTRACTION_COMPOSITION_CELL_COUNT,
  EXTRACTION_COMPOSITION_GRID_SIZE,
  type ExtractionCollectorReadView,
  type ExtractionEffectiveFireSource,
  type ExtractionFireFlowReadView,
  type ExtractionMaterialDefinition,
  type ExtractionMaterialPlacement,
  type ExtractionMaterialReadView,
  type ExtractionPearlReadView,
  type ExtractionSimulationConfig,
  type ExtractionSimulationPhase,
  type ExtractionSimulationReadView,
  type ExtractionSimulationTickInput,
  type ExtractionVector,
} from './contracts.ts'
import {
  circleIntersectsRemainingMaterial,
  materialCellWorldPosition,
  rasterizeRemainingMaterials,
  normalizeAndClampFireDirection,
  sampleFireFlowIntensity,
  segmentIntersectsRemainingMaterial,
  type MaterialGeometryState,
} from './material-geometry.ts'
import {
  clampVolumeToZero,
  volumesApproximatelyEqual,
} from '../volume-tolerance.ts'

const GEOMETRY_EPSILON = 1e-9
const PEARL_TYPES = ['medicinalLiquid', 'slag', 'impurity'] as const
const PEARL_TYPE_ORDER: Readonly<Record<PearlType, number>> = {
  medicinalLiquid: 0,
  slag: 1,
  impurity: 2,
}

type MutableTypeVolumes = Record<PearlType, number>
type MutableTypePositions = Record<PearlType, ExtractionVector>

interface MutableMaterial extends MaterialGeometryState {
  readonly materialInstanceId: string
  readonly materialDefinitionId: string
  readonly inventoryBatchId: string
  readonly definition: ExtractionMaterialDefinition
  readonly placement: ExtractionMaterialPlacement
  readonly initialVolume: number
  remainingVolume: number
  readonly initialVolumeByType: MutableTypeVolumes
  readonly initialCellVolumes: Float64Array
  readonly remainingCellVolumes: Float64Array
  readonly spawnAccumulators: MutableTypeVolumes
  readonly lastDissolvedPositions: MutableTypePositions
  readonly nextPearlOrdinals: MutableTypeVolumes
}

interface MutablePearl {
  readonly pearlId: string
  readonly sourceMaterialDefinitionId: string
  readonly sourceMaterialInstanceId: string
  readonly pearlType: PearlType
  readonly currentVolume: number
  readonly radius: number
  position: ExtractionVector
  velocity: ExtractionVector
  state: 'newborn' | 'active' | 'caught' | 'missed'
}

interface MutableCollector {
  center: ExtractionVector
  velocityX: number
}

interface MutableSimulationState {
  tick: number
  materials: MutableMaterial[]
  pearls: MutablePearl[]
  collector: MutableCollector
}

interface MutableDissolutionEntry {
  readonly materialDefinitionId: string
  readonly materialInstanceId: string
  readonly pearlType: PearlType
  volume: number
}

interface TickTransaction {
  readonly tick: number
  readonly state: MutableSimulationState
  readonly tickStartActivePearlIds: readonly string[]
  nextPhase: number
  domainState: DomainState
  fullObstacles: Uint8Array | null
  circles: FireFlowCircleObstacles | null
  flowView: FireFlowReadView | null
  flowSnapshot: ExtractionFireFlowReadView | null
  effectiveFireSource: ExtractionEffectiveFireSource | null
  fireDirection: ExtractionVector
  fireWidth: number
  dissolutionByKey: Map<string, MutableDissolutionEntry>
  births: PearlBirthDelta[]
  terminals: PearlTerminalDelta[]
  builtDelta: SimulationDelta | null
}

function compareStableId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyTypeVolumes(): MutableTypeVolumes {
  return { medicinalLiquid: 0, slag: 0, impurity: 0 }
}

function centeredTypePositions(center: ExtractionVector): MutableTypePositions {
  return {
    medicinalLiquid: { ...center },
    slag: { ...center },
    impurity: { ...center },
  }
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function requireFinite(name: string, value: number): void {
  if (!finite(value)) throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${name}`)
}

function requirePositive(name: string, value: number): void {
  requireFinite(name, value)
  if (value <= 0) throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${name}`)
}

function validateVector(name: string, value: ExtractionVector): void {
  requireFinite(`${name}.x`, value.x)
  requireFinite(`${name}.y`, value.y)
}

function cloneAndValidateConfig(config: ExtractionSimulationConfig): ExtractionSimulationConfig {
  if (
    !Number.isSafeInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > 0xffff_ffff
  ) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:seed')
  }
  requirePositive('standardPearlVolume', config.standardPearlVolume)
  requirePositive('fixedDeltaSeconds', config.fixedDeltaSeconds)
  requirePositive('dissolutionVolumePerTick', config.dissolutionVolumePerTick)
  requireFinite('exposureProbeDistance', config.exposureProbeDistance)
  if (config.exposureProbeDistance < 0) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:exposureProbeDistance')
  }

  requirePositive('materialPlacement.width', config.materialPlacement.width)
  requirePositive('materialPlacement.height', config.materialPlacement.height)
  validateVector('materialPlacement.center', config.materialPlacement.center)
  validateVector('materialPlacement.offsetPerInstance', config.materialPlacement.offsetPerInstance)
  requireFinite(
    'materialPlacement.rotationRadiansPerInstance',
    config.materialPlacement.rotationRadiansPerInstance,
  )

  validateVector('fireSource.origin', config.fireSource.origin)
  requireFinite('fireSource.halfAngleRadians', config.fireSource.halfAngleRadians)
  if (config.fireSource.halfAngleRadians < 0 || config.fireSource.halfAngleRadians > Math.PI) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:fireSource.halfAngleRadians')
  }
  requirePositive('fireSource.minWidth', config.fireSource.minWidth)
  requirePositive('fireSource.maxWidth', config.fireSource.maxWidth)
  if (config.fireSource.maxWidth < config.fireSource.minWidth) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:fireSource.widthRange')
  }

  const materialIds = new Set<string>()
  const materials = config.materials.map((material) => {
    if (material.id.length === 0 || materialIds.has(material.id)) {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materials.id')
    }
    materialIds.add(material.id)
    if (!Number.isSafeInteger(material.targetPearlCount) || material.targetPearlCount <= 0) {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materials.targetPearlCount')
    }
    if (material.composition.length !== EXTRACTION_COMPOSITION_CELL_COUNT) {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materials.composition.length')
    }
    const composition = new Uint8Array(material.composition)
    let nonEmptyCount = 0
    for (const code of composition) {
      if (!Number.isInteger(code) || code < 0 || code > 3) {
        throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materials.composition.code')
      }
      if (code !== 0) nonEmptyCount += 1
    }
    if (nonEmptyCount === 0) {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materials.composition.empty')
    }
    return { ...material, composition }
  })

  for (const pearlType of PEARL_TYPES) {
    const physics = config.pearlPhysics[pearlType]
    requirePositive(`${pearlType}.radiusAtStandardVolume`, physics.radiusAtStandardVolume)
    const velocity = physics.spawnVelocity
    requireFinite(`${pearlType}.spawnVelocity.minX`, velocity.minX)
    requireFinite(`${pearlType}.spawnVelocity.maxX`, velocity.maxX)
    requireFinite(`${pearlType}.spawnVelocity.minY`, velocity.minY)
    requireFinite(`${pearlType}.spawnVelocity.maxY`, velocity.maxY)
    if (velocity.minX > velocity.maxX || velocity.minY > velocity.maxY) {
      throw new RangeError(
        `SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.spawnVelocity.range`,
      )
    }
    requireFinite(`${pearlType}.gravity`, physics.gravity)
    requireFinite(`${pearlType}.driftX`, physics.driftX)
    requirePositive(`${pearlType}.maxSpeed`, physics.maxSpeed)
    requireFinite(`${pearlType}.materialRestitution`, physics.materialRestitution)
    if (physics.materialRestitution < 0 || physics.materialRestitution > 1) {
      throw new RangeError(
        `SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.materialRestitution`,
      )
    }
  }

  validateVector('collector.initialCenter', config.collector.initialCenter)
  requirePositive('collector.width', config.collector.width)
  requirePositive('collector.height', config.collector.height)
  requireFinite('collector.trackMinX', config.collector.trackMinX)
  requireFinite('collector.trackMaxX', config.collector.trackMaxX)
  requirePositive('collector.acceleration', config.collector.acceleration)
  requirePositive('collector.deceleration', config.collector.deceleration)
  requirePositive('collector.maxSpeed', config.collector.maxSpeed)
  if (config.collector.trackMaxX < config.collector.trackMinX) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:collector.trackRange')
  }

  for (const [name, value] of Object.entries(config.worldBounds)) {
    requireFinite(`worldBounds.${name}`, value)
  }
  if (
    config.worldBounds.right <= config.worldBounds.left ||
    config.worldBounds.bottom <= config.worldBounds.top
  ) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:worldBounds')
  }

  const cloned: ExtractionSimulationConfig = {
    ...config,
    materials,
    fireFlow: {
      geometry: { ...config.fireFlow.geometry },
      solver: { ...config.fireFlow.solver },
    },
    materialPlacement: {
      ...config.materialPlacement,
      center: { ...config.materialPlacement.center },
      offsetPerInstance: { ...config.materialPlacement.offsetPerInstance },
    },
    fireSource: {
      ...config.fireSource,
      origin: { ...config.fireSource.origin },
    },
    pearlPhysics: {
      medicinalLiquid: {
        ...config.pearlPhysics.medicinalLiquid,
        spawnVelocity: { ...config.pearlPhysics.medicinalLiquid.spawnVelocity },
      },
      slag: {
        ...config.pearlPhysics.slag,
        spawnVelocity: { ...config.pearlPhysics.slag.spawnVelocity },
      },
      impurity: {
        ...config.pearlPhysics.impurity,
        spawnVelocity: { ...config.pearlPhysics.impurity.spawnVelocity },
      },
    },
    collector: {
      ...config.collector,
      initialCenter: { ...config.collector.initialCenter },
    },
    worldBounds: { ...config.worldBounds },
  }
  // FireFlowField owns the detailed solver/geometry validation.
  new FireFlowField(cloned.fireFlow)
  return cloned
}

function seededUnitInterval(seed: number, stableKey: string): number {
  let hash = (seed ^ 0x811c_9dc5) >>> 0
  for (let index = 0; index < stableKey.length; index += 1) {
    hash = Math.imul(hash ^ stableKey.charCodeAt(index), 0x0100_0193) >>> 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb_352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846c_a68b) >>> 0
  hash ^= hash >>> 16
  return (hash >>> 0) / 0x1_0000_0000
}

function spawnVelocity(
  seed: number,
  pearlId: string,
  physics: ExtractionSimulationConfig['pearlPhysics'][PearlType],
): ExtractionVector {
  const range = physics.spawnVelocity
  const xUnit = seededUnitInterval(seed, `${pearlId}:spawn-velocity:x`)
  const yUnit = seededUnitInterval(seed, `${pearlId}:spawn-velocity:y`)
  return {
    x: range.minX + (range.maxX - range.minX) * xUnit,
    y: range.minY + (range.maxY - range.minY) * yUnit,
  }
}

function pearlTypeFromCode(code: number): PearlType | null {
  switch (code) {
    case 1:
      return 'medicinalLiquid'
    case 2:
      return 'slag'
    case 3:
      return 'impurity'
    default:
      return null
  }
}

function cloneMaterial(material: MutableMaterial): MutableMaterial {
  return {
    ...material,
    placement: {
      ...material.placement,
      center: { ...material.placement.center },
    },
    initialVolumeByType: { ...material.initialVolumeByType },
    initialCellVolumes: new Float64Array(material.initialCellVolumes),
    remainingCellVolumes: new Float64Array(material.remainingCellVolumes),
    spawnAccumulators: { ...material.spawnAccumulators },
    lastDissolvedPositions: {
      medicinalLiquid: { ...material.lastDissolvedPositions.medicinalLiquid },
      slag: { ...material.lastDissolvedPositions.slag },
      impurity: { ...material.lastDissolvedPositions.impurity },
    },
    nextPearlOrdinals: { ...material.nextPearlOrdinals },
  }
}

function cloneState(state: MutableSimulationState): MutableSimulationState {
  return {
    tick: state.tick,
    materials: state.materials.map(cloneMaterial),
    pearls: state.pearls.map((pearl) => ({
      ...pearl,
      position: { ...pearl.position },
      velocity: { ...pearl.velocity },
    })),
    collector: {
      center: { ...state.collector.center },
      velocityX: state.collector.velocityX,
    },
  }
}

function emptyFlowView(config: ExtractionSimulationConfig): ExtractionFireFlowReadView {
  const cellCount = config.fireFlow.geometry.columns * config.fireFlow.geometry.rows
  return {
    generation: 0,
    tick: -1,
    columns: config.fireFlow.geometry.columns,
    rows: config.fireFlow.geometry.rows,
    cellSize: config.fireFlow.geometry.cellSize,
    originX: config.fireFlow.geometry.originX,
    originY: config.fireFlow.geometry.originY,
    obstacle: new Float32Array(cellCount),
    flowX: new Float32Array(cellCount),
    flowY: new Float32Array(cellCount),
    intensity: new Uint8Array(cellCount),
  }
}

function snapshotFlow(
  view: FireFlowReadView,
  generation: number,
): ExtractionFireFlowReadView {
  return {
    generation,
    tick: view.tick,
    columns: view.columns,
    rows: view.rows,
    cellSize: view.cellSize,
    originX: view.originX,
    originY: view.originY,
    obstacle: new Float32Array(view.obstacle),
    flowX: new Float32Array(view.flowX),
    flowY: new Float32Array(view.flowY),
    intensity: new Uint8Array(view.intensity),
  }
}

function readonlyFlowView(
  source: ExtractionFireFlowReadView,
): ExtractionFireFlowReadView {
  const obstacle = new Float32Array(source.obstacle)
  const flowX = new Float32Array(source.flowX)
  const flowY = new Float32Array(source.flowY)
  const intensity = new Uint8Array(source.intensity)
  return Object.freeze({
    generation: source.generation,
    tick: source.tick,
    columns: source.columns,
    rows: source.rows,
    cellSize: source.cellSize,
    originX: source.originX,
    originY: source.originY,
    get obstacle() {
      return new Float32Array(obstacle)
    },
    get flowX() {
      return new Float32Array(flowX)
    },
    get flowY() {
      return new Float32Array(flowY)
    },
    get intensity() {
      return new Uint8Array(intensity)
    },
  })
}

function materialReadView(material: MutableMaterial): ExtractionMaterialReadView {
  return Object.freeze({
    materialInstanceId: material.materialInstanceId,
    materialDefinitionId: material.materialDefinitionId,
    inventoryBatchId: material.inventoryBatchId,
    placement: Object.freeze({
      ...material.placement,
      center: Object.freeze({ ...material.placement.center }),
    }),
    initialVolume: material.initialVolume,
    remainingVolume: material.remainingVolume,
    initialVolumeByType: Object.freeze({ ...material.initialVolumeByType }),
    composition: Object.freeze(Array.from(material.definition.composition)),
    initialCellVolumes: Object.freeze(Array.from(material.initialCellVolumes)),
    remainingCellVolumes: Object.freeze(Array.from(material.remainingCellVolumes)),
  })
}

function pearlReadView(pearl: MutablePearl): ExtractionPearlReadView {
  if (pearl.state === 'newborn') {
    throw new Error('SIM_EXTRACTION_NEWBORN_NOT_COMMITTED')
  }
  return Object.freeze({
    pearlId: pearl.pearlId,
    sourceMaterialDefinitionId: pearl.sourceMaterialDefinitionId,
    sourceMaterialInstanceId: pearl.sourceMaterialInstanceId,
    pearlType: pearl.pearlType,
    currentVolume: pearl.currentVolume,
    radius: pearl.radius,
    position: Object.freeze({ ...pearl.position }),
    velocity: Object.freeze({ ...pearl.velocity }),
    state: pearl.state,
  })
}

function collectorReadView(
  state: MutableSimulationState,
  config: ExtractionSimulationConfig,
): ExtractionCollectorReadView {
  return Object.freeze({
    center: Object.freeze({ ...state.collector.center }),
    width: config.collector.width,
    height: config.collector.height,
    velocityX: state.collector.velocityX,
  })
}

function createReadView(
  state: MutableSimulationState,
  config: ExtractionSimulationConfig,
  flow: ExtractionFireFlowReadView,
  effectiveFireSource: ExtractionEffectiveFireSource | null,
): ExtractionSimulationReadView {
  return Object.freeze({
    tick: state.tick,
    materials: Object.freeze(state.materials
      .slice()
      .sort((left, right) => compareStableId(left.materialInstanceId, right.materialInstanceId))
      .map(materialReadView)),
    pearls: Object.freeze(state.pearls
      .slice()
      .sort((left, right) => compareStableId(left.pearlId, right.pearlId))
      .map(pearlReadView)),
    collector: collectorReadView(state, config),
    fireFlow: readonlyFlowView(flow),
    effectiveFireSource:
      effectiveFireSource === null
        ? null
        : Object.freeze({
            position: Object.freeze({ ...effectiveFireSource.position }),
            direction: Object.freeze({ ...effectiveFireSource.direction }),
            width: effectiveFireSource.width,
          }),
  })
}

function createEmptyState(config: ExtractionSimulationConfig): MutableSimulationState {
  return {
    tick: -1,
    materials: [],
    pearls: [],
    collector: {
      center: { ...config.collector.initialCenter },
      velocityX: 0,
    },
  }
}

function sumCellVolumes(values: ArrayLike<number>): number {
  let total = 0
  for (let index = 0; index < values.length; index += 1) total += values[index] ?? 0
  return total
}

function approximatelyEqual(left: number, right: number): boolean {
  return volumesApproximatelyEqual(left, right)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export class ExtractionSimulation {
  readonly #config: ExtractionSimulationConfig
  readonly #definitions: ReadonlyMap<string, ExtractionMaterialDefinition>
  #field: FireFlowField
  #committedState: MutableSimulationState
  #view: ExtractionSimulationReadView
  #flowGeneration = 0
  #transaction: TickTransaction | null = null

  constructor(config: ExtractionSimulationConfig) {
    this.#config = cloneAndValidateConfig(config)
    this.#definitions = new Map(
      this.#config.materials.map((definition) => [definition.id, definition]),
    )
    this.#field = new FireFlowField(this.#config.fireFlow)
    this.#committedState = createEmptyState(this.#config)
    this.#view = createReadView(
      this.#committedState,
      this.#config,
      emptyFlowView(this.#config),
      null,
    )
  }

  beginTick(input: ExtractionSimulationTickInput): void {
    if (this.#transaction !== null) throw new Error('SIM_EXTRACTION_TRANSACTION_ACTIVE')
    if (
      !Number.isSafeInteger(input.tick) ||
      input.tick < 0 ||
      input.tick !== this.#committedState.tick + 1
    ) {
      throw new Error('SIM_EXTRACTION_TICK_INVALID')
    }
    const state = cloneState(this.#committedState)
    state.tick = input.tick
    this.#transaction = {
      tick: input.tick,
      state,
      tickStartActivePearlIds: this.#committedState.pearls
        .filter((pearl) => pearl.state === 'active')
        .map((pearl) => pearl.pearlId)
        .sort(compareStableId),
      nextPhase: 1,
      domainState: input.domainState,
      fullObstacles: null,
      circles: null,
      flowView: null,
      flowSnapshot: null,
      effectiveFireSource: null,
      fireDirection: { x: 0, y: -1 },
      fireWidth: 0,
      dissolutionByKey: new Map(),
      births: [],
      terminals: [],
      builtDelta: null,
    }
  }

  runPhase(phase: ExtractionSimulationPhase, domainState: DomainState): void {
    const transaction = this.#requireTransaction()
    if (phase !== transaction.nextPhase) throw new Error('SIM_EXTRACTION_PHASE_INVALID')
    transaction.domainState = domainState
    switch (phase) {
      case 1:
        this.#synchronizeMaterials(transaction, domainState)
        break
      case 2:
        this.#buildObstacles(transaction)
        break
      case 3:
        this.#solveFireFlow(transaction, domainState)
        break
      case 4:
        this.#dissolveAndSpawn(transaction)
        break
      case 5:
        this.#moveCollectorAndPearls(transaction, domainState)
        break
      case 6:
        this.#settlePearls(transaction)
        break
      case 7:
        break
    }
    transaction.nextPhase += 1
  }

  buildCandidate(): SimulationDelta {
    const transaction = this.#requireTransaction()
    if (transaction.nextPhase !== 8) throw new Error('SIM_EXTRACTION_PHASE_INVALID')
    if (transaction.builtDelta !== null) return transaction.builtDelta

    const dissolutions = [...transaction.dissolutionByKey.values()].sort(
      (left, right) =>
        compareStableId(left.materialInstanceId, right.materialInstanceId) ||
        PEARL_TYPE_ORDER[left.pearlType] - PEARL_TYPE_ORDER[right.pearlType],
    )
    const births = transaction.births
      .slice()
      .sort((left, right) => compareStableId(left.pearlId, right.pearlId))
    const terminalOutcomes = transaction.terminals
      .slice()
      .sort((left, right) => compareStableId(left.pearlId, right.pearlId))
    transaction.builtDelta = {
      tick: transaction.tick,
      dissolutions,
      births,
      pearlVolumeChanges: [],
      terminalOutcomes,
      naturalLosses: [],
      inheritedLosses: [],
    }
    return transaction.builtDelta
  }

  commitTick(): ExtractionSimulationReadView {
    const transaction = this.#requireTransaction()
    if (transaction.builtDelta === null || transaction.flowSnapshot === null) {
      throw new Error('SIM_EXTRACTION_CANDIDATE_NOT_BUILT')
    }
    for (const pearl of transaction.state.pearls) {
      if (pearl.state === 'newborn') pearl.state = 'active'
    }
    this.#committedState = transaction.state
    this.#view = createReadView(
      this.#committedState,
      this.#config,
      transaction.flowSnapshot,
      transaction.effectiveFireSource,
    )
    this.#flowGeneration = transaction.flowSnapshot.generation
    this.#transaction = null
    return this.#view
  }

  rollbackTick(): void {
    this.#transaction = null
  }

  reset(): ExtractionSimulationReadView {
    this.#transaction = null
    this.#field = new FireFlowField(this.#config.fireFlow)
    this.#committedState = createEmptyState(this.#config)
    this.#flowGeneration = 0
    this.#view = createReadView(
      this.#committedState,
      this.#config,
      emptyFlowView(this.#config),
      null,
    )
    return this.#view
  }

  read(): ExtractionSimulationReadView {
    return this.#view
  }

  #requireTransaction(): TickTransaction {
    if (this.#transaction === null) throw new Error('SIM_EXTRACTION_TRANSACTION_MISSING')
    return this.#transaction
  }

  #synchronizeMaterials(transaction: TickTransaction, domainState: DomainState): void {
    const stateById = new Map(
      transaction.state.materials.map((material) => [material.materialInstanceId, material]),
    )
    const domainIds = new Set(domainState.materialInstances.map(({ materialInstanceId }) => materialInstanceId))
    for (const existing of transaction.state.materials) {
      if (!domainIds.has(existing.materialInstanceId)) {
        throw new Error('SIM_EXTRACTION_DOMAIN_MATERIAL_REMOVED')
      }
    }

    for (let index = 0; index < domainState.materialInstances.length; index += 1) {
      const instance = domainState.materialInstances[index]!
      const existing = stateById.get(instance.materialInstanceId)
      if (existing !== undefined) {
        if (
          existing.materialDefinitionId !== instance.materialDefinitionId ||
          !approximatelyEqual(existing.remainingVolume, instance.remainingVolume)
        ) {
          throw new Error('SIM_EXTRACTION_DOMAIN_MATERIAL_MISMATCH')
        }
        continue
      }
      const material = this.#createMaterial(instance, index)
      transaction.state.materials.push(material)
      stateById.set(material.materialInstanceId, material)
    }
    transaction.state.materials.sort((left, right) =>
      compareStableId(left.materialInstanceId, right.materialInstanceId),
    )
  }

  #createMaterial(instance: MaterialInstance, layer: number): MutableMaterial {
    const definition = this.#definitions.get(instance.materialDefinitionId)
    if (definition === undefined) throw new Error('SIM_EXTRACTION_MATERIAL_DEFINITION_NOT_FOUND')
    const totalVolume = definition.targetPearlCount * this.#config.standardPearlVolume
    if (
      !approximatelyEqual(instance.initialVolume, totalVolume) ||
      !approximatelyEqual(instance.remainingVolume, totalVolume)
    ) {
      throw new Error('SIM_EXTRACTION_DOMAIN_VOLUME_MISMATCH')
    }

    let nonEmptyCount = 0
    for (const code of definition.composition) if (code !== 0) nonEmptyCount += 1
    const volumePerCell = totalVolume / nonEmptyCount
    const initialCellVolumes = new Float64Array(EXTRACTION_COMPOSITION_CELL_COUNT)
    const initialVolumeByType = emptyTypeVolumes()
    for (let cellIndex = 0; cellIndex < definition.composition.length; cellIndex += 1) {
      const pearlType = pearlTypeFromCode(definition.composition[cellIndex]!)
      if (pearlType === null) continue
      initialCellVolumes[cellIndex] = volumePerCell
      initialVolumeByType[pearlType] += volumePerCell
    }
    const placement: ExtractionMaterialPlacement = {
      center: {
        x:
          this.#config.materialPlacement.center.x +
          this.#config.materialPlacement.offsetPerInstance.x * layer,
        y:
          this.#config.materialPlacement.center.y +
          this.#config.materialPlacement.offsetPerInstance.y * layer,
      },
      width: this.#config.materialPlacement.width,
      height: this.#config.materialPlacement.height,
      rotationRadians:
        this.#config.materialPlacement.rotationRadiansPerInstance * layer,
      layer,
    }
    return {
      materialInstanceId: instance.materialInstanceId,
      materialDefinitionId: instance.materialDefinitionId,
      inventoryBatchId: instance.inventoryBatchId,
      definition,
      placement,
      initialVolume: totalVolume,
      remainingVolume: totalVolume,
      initialVolumeByType,
      initialCellVolumes,
      remainingCellVolumes: new Float64Array(initialCellVolumes),
      spawnAccumulators: emptyTypeVolumes(),
      lastDissolvedPositions: centeredTypePositions(placement.center),
      nextPearlOrdinals: emptyTypeVolumes(),
    }
  }

  #buildObstacles(transaction: TickTransaction): void {
    transaction.fullObstacles = rasterizeRemainingMaterials(
      transaction.state.materials,
      this.#config.fireFlow.geometry,
    )
    const pearlsById = new Map(transaction.state.pearls.map((pearl) => [pearl.pearlId, pearl]))
    const count = transaction.tickStartActivePearlIds.length
    const x = new Float32Array(count)
    const y = new Float32Array(count)
    const radius = new Float32Array(count)
    const eligible = new Uint8Array(count)
    for (let index = 0; index < count; index += 1) {
      const pearl = pearlsById.get(transaction.tickStartActivePearlIds[index]!)
      if (pearl === undefined || pearl.state !== 'active') continue
      x[index] = pearl.position.x
      y[index] = pearl.position.y
      radius[index] = pearl.radius
      eligible[index] = 1
    }
    transaction.circles = { x, y, radius, eligible, count }
  }

  #solveFireFlow(transaction: TickTransaction, domainState: DomainState): void {
    if (transaction.fullObstacles === null || transaction.circles === null) {
      throw new Error('SIM_EXTRACTION_OBSTACLES_NOT_BUILT')
    }
    transaction.fireDirection = normalizeAndClampFireDirection(
      domainState.fireDirection,
      this.#config.fireSource.halfAngleRadians,
    )
    let source: FireFlowSource | null = null
    transaction.effectiveFireSource = null
    if (domainState.equippedFireSourceId !== null && domainState.isSpraying) {
      const ratio = clamp(domainState.fireSize / 100, 0, 1)
      transaction.fireWidth =
        this.#config.fireSource.minWidth +
        (this.#config.fireSource.maxWidth - this.#config.fireSource.minWidth) * ratio
      source = {
        x: this.#config.fireSource.origin.x,
        y: this.#config.fireSource.origin.y,
        directionX: transaction.fireDirection.x,
        directionY: transaction.fireDirection.y,
        width: transaction.fireWidth,
      }
      transaction.effectiveFireSource = {
        position: { ...this.#config.fireSource.origin },
        direction: { ...transaction.fireDirection },
        width: transaction.fireWidth,
      }
    }
    transaction.flowView = this.#field.update({
      tick: transaction.tick,
      source,
      fullObstacles: transaction.fullObstacles,
      circles: transaction.circles,
    })
    transaction.flowSnapshot = snapshotFlow(
      transaction.flowView,
      this.#flowGeneration + 1,
    )
  }

  #dissolveAndSpawn(transaction: TickTransaction): void {
    if (transaction.flowView === null) throw new Error('SIM_EXTRACTION_FLOW_NOT_SOLVED')
    if (
      transaction.domainState.equippedFireSourceId === null ||
      !transaction.domainState.isSpraying
    ) {
      return
    }
    for (const material of transaction.state.materials) {
      this.#dissolveMaterial(transaction, material)
    }
  }

  #dissolveMaterial(transaction: TickTransaction, material: MutableMaterial): void {
    let budget = Math.min(
      this.#config.dissolutionVolumePerTick,
      material.remainingVolume,
    )
    let iteration = 0
    while (budget > 0 && iteration <= EXTRACTION_COMPOSITION_CELL_COUNT) {
      iteration += 1
      const exposed = this.#findExposedCells(transaction, material)
      if (exposed.length === 0) break
      const capacity = exposed.reduce(
        (total, cellIndex) => total + material.remainingCellVolumes[cellIndex]!,
        0,
      )
      const requested = Math.min(budget, capacity)
      const allocations = this.#allocateEqually(
        exposed,
        material.remainingCellVolumes,
        requested,
      )
      let applied = 0
      for (const [cellIndex, volume] of allocations) {
        if (volume <= 0) continue
        this.#applyDissolution(transaction, material, cellIndex, volume)
        applied += volume
      }
      budget -= applied
      if (applied <= 0) break
    }
    material.remainingVolume = clampVolumeToZero(
      sumCellVolumes(material.remainingCellVolumes),
      material.initialVolume,
    )
    if (material.remainingVolume === 0) {
      material.remainingCellVolumes.fill(0)
      for (const pearlType of PEARL_TYPES) {
        const tailVolume = material.spawnAccumulators[pearlType]
        if (tailVolume <= 0) continue
        this.#spawnPearl(
          transaction,
          material,
          pearlType,
          tailVolume,
          material.lastDissolvedPositions[pearlType],
        )
        material.spawnAccumulators[pearlType] = 0
      }
    }
  }

  #findExposedCells(
    transaction: TickTransaction,
    material: MutableMaterial,
  ): number[] {
    const result: number[] = []
    for (let cellIndex = 0; cellIndex < material.remainingCellVolumes.length; cellIndex += 1) {
      if (material.remainingCellVolumes[cellIndex]! <= 0) continue
      if (this.#hasReachableFirePath(transaction, material, cellIndex)) {
        result.push(cellIndex)
      }
    }
    return result
  }

  #hasReachableFirePath(
    transaction: TickTransaction,
    material: MutableMaterial,
    cellIndex: number,
  ): boolean {
    const flowView = transaction.flowView
    if (flowView === null) return false
    const center = materialCellWorldPosition(material, cellIndex)
    const relativeX = center.x - this.#config.fireSource.origin.x
    const relativeY = center.y - this.#config.fireSource.origin.y
    const projection =
      relativeX * transaction.fireDirection.x +
      relativeY * transaction.fireDirection.y
    const lateralDistance = Math.abs(
      relativeX * -transaction.fireDirection.y +
        relativeY * transaction.fireDirection.x,
    )
    if (
      projection < 0 ||
      lateralDistance > transaction.fireWidth * 0.5 + GEOMETRY_EPSILON
    ) {
      return false
    }
    const towardSource = {
      x: -transaction.fireDirection.x,
      y: -transaction.fireDirection.y,
    }
    if (
      segmentIntersectsRemainingMaterial(
        transaction.state.materials,
        center,
        this.#config.fireSource.origin,
        { material, cellIndex },
      )
    ) {
      return false
    }
    const maximumProbeStep = this.#config.fireFlow.geometry.cellSize * 0.5
    const stepDistance =
      this.#config.exposureProbeDistance > 0
        ? Math.min(this.#config.exposureProbeDistance, maximumProbeStep)
        : maximumProbeStep
    const stepCount = Math.ceil(projection / stepDistance) + 1
    for (let step = 1; step <= stepCount; step += 1) {
      const point = {
        x: center.x + towardSource.x * stepDistance * step,
        y: center.y + towardSource.y * stepDistance * step,
      }
      if (
        point.x < this.#config.worldBounds.left ||
        point.x > this.#config.worldBounds.right ||
        point.y < this.#config.worldBounds.top ||
        point.y > this.#config.worldBounds.bottom
      ) {
        return false
      }
      if (sampleFireFlowIntensity(flowView, point) > 0) return true
    }
    return false
  }

  #allocateEqually(
    cellIndexes: readonly number[],
    volumes: Float64Array,
    requested: number,
  ): ReadonlyMap<number, number> {
    const allocations = new Map<number, number>()
    let active = [...cellIndexes]
    let remaining = requested
    while (remaining > 0 && active.length > 0) {
      const share = remaining / active.length
      const constrained = active.filter(
        (cellIndex) => volumes[cellIndex]! <= share,
      )
      if (constrained.length === 0) {
        for (const cellIndex of active) allocations.set(cellIndex, share)
        remaining = 0
        break
      }
      const constrainedSet = new Set(constrained)
      for (const cellIndex of constrained) {
        const volume = volumes[cellIndex]!
        allocations.set(cellIndex, volume)
        remaining -= volume
      }
      active = active.filter((cellIndex) => !constrainedSet.has(cellIndex))
    }
    return allocations
  }

  #applyDissolution(
    transaction: TickTransaction,
    material: MutableMaterial,
    cellIndex: number,
    volume: number,
  ): void {
    const pearlType = pearlTypeFromCode(material.definition.composition[cellIndex]!)
    if (pearlType === null) throw new Error('SIM_EXTRACTION_COMPONENT_TYPE_INVALID')
    const available = material.remainingCellVolumes[cellIndex]!
    const applied = Math.min(available, volume)
    material.remainingCellVolumes[cellIndex] = Math.max(0, available - applied)
    material.remainingVolume = Math.max(0, material.remainingVolume - applied)
    const position = materialCellWorldPosition(material, cellIndex)
    material.lastDissolvedPositions[pearlType] = position
    material.spawnAccumulators[pearlType] += applied

    const key = `${material.materialInstanceId}\u0000${pearlType}`
    const existing = transaction.dissolutionByKey.get(key)
    if (existing === undefined) {
      transaction.dissolutionByKey.set(key, {
        materialDefinitionId: material.materialDefinitionId,
        materialInstanceId: material.materialInstanceId,
        pearlType,
        volume: applied,
      })
    } else {
      existing.volume += applied
    }

    while (
      material.spawnAccumulators[pearlType] >= this.#config.standardPearlVolume
    ) {
      this.#spawnPearl(
        transaction,
        material,
        pearlType,
        this.#config.standardPearlVolume,
        position,
      )
      material.spawnAccumulators[pearlType] = Math.max(
        0,
        material.spawnAccumulators[pearlType] - this.#config.standardPearlVolume,
      )
    }
  }

  #spawnPearl(
    transaction: TickTransaction,
    material: MutableMaterial,
    pearlType: PearlType,
    volume: number,
    position: ExtractionVector,
  ): void {
    material.nextPearlOrdinals[pearlType] += 1
    const ordinal = material.nextPearlOrdinals[pearlType]
    const pearlId = `pearl:${material.materialInstanceId}:${pearlType}:${ordinal
      .toString()
      .padStart(6, '0')}`
    const physics = this.#config.pearlPhysics[pearlType]
    const radius =
      physics.radiusAtStandardVolume *
      Math.sqrt(volume / this.#config.standardPearlVolume)
    transaction.state.pearls.push({
      pearlId,
      sourceMaterialDefinitionId: material.materialDefinitionId,
      sourceMaterialInstanceId: material.materialInstanceId,
      pearlType,
      currentVolume: volume,
      radius,
      position: { ...position },
      velocity: spawnVelocity(this.#config.seed, pearlId, physics),
      state: 'newborn',
    })
    transaction.births.push({
      pearlId,
      sourceMaterialDefinitionId: material.materialDefinitionId,
      sourceMaterialInstanceId: material.materialInstanceId,
      pearlType,
      volume,
    })
  }

  #moveCollectorAndPearls(
    transaction: TickTransaction,
    domainState: DomainState,
  ): void {
    const axis = clamp(domainState.containerAxis, -1, 1)
    const collector = transaction.state.collector
    if (Math.abs(axis) > GEOMETRY_EPSILON) {
      collector.velocityX +=
        axis * this.#config.collector.acceleration * this.#config.fixedDeltaSeconds
    } else {
      const reduction =
        this.#config.collector.deceleration * this.#config.fixedDeltaSeconds
      if (Math.abs(collector.velocityX) <= reduction) collector.velocityX = 0
      else collector.velocityX -= Math.sign(collector.velocityX) * reduction
    }
    collector.velocityX = clamp(
      collector.velocityX,
      -this.#config.collector.maxSpeed,
      this.#config.collector.maxSpeed,
    )
    const nextCollectorX =
      collector.center.x + collector.velocityX * this.#config.fixedDeltaSeconds
    const clampedCollectorX = clamp(
      nextCollectorX,
      this.#config.collector.trackMinX,
      this.#config.collector.trackMaxX,
    )
    if (nextCollectorX !== clampedCollectorX) collector.velocityX = 0
    collector.center = { x: clampedCollectorX, y: collector.center.y }

    const pearlsById = new Map(transaction.state.pearls.map((pearl) => [pearl.pearlId, pearl]))
    for (const pearlId of transaction.tickStartActivePearlIds) {
      const pearl = pearlsById.get(pearlId)
      if (pearl === undefined || pearl.state !== 'active') continue
      const physics = this.#config.pearlPhysics[pearl.pearlType]
      let velocityX =
        pearl.velocity.x + physics.driftX * this.#config.fixedDeltaSeconds
      let velocityY =
        pearl.velocity.y + physics.gravity * this.#config.fixedDeltaSeconds
      const speed = Math.hypot(velocityX, velocityY)
      if (speed > physics.maxSpeed) {
        const ratio = physics.maxSpeed / speed
        velocityX *= ratio
        velocityY *= ratio
      }
      const nextPosition = {
        x: pearl.position.x + velocityX * this.#config.fixedDeltaSeconds,
        y: pearl.position.y + velocityY * this.#config.fixedDeltaSeconds,
      }
      const displacement = Math.hypot(
        nextPosition.x - pearl.position.x,
        nextPosition.y - pearl.position.y,
      )
      const collisionStep =
        Math.min(
          this.#config.materialPlacement.width,
          this.#config.materialPlacement.height,
        ) /
        EXTRACTION_COMPOSITION_GRID_SIZE /
        2
      const substeps = Math.max(1, Math.ceil(displacement / collisionStep))
      let collided = false
      for (let substep = 1; substep <= substeps; substep += 1) {
        const ratio = substep / substeps
        const probePosition = {
          x: pearl.position.x + (nextPosition.x - pearl.position.x) * ratio,
          y: pearl.position.y + (nextPosition.y - pearl.position.y) * ratio,
        }
        if (
          circleIntersectsRemainingMaterial(
            transaction.state.materials,
            probePosition,
            pearl.radius,
          )
        ) {
          collided = true
          break
        }
      }
      if (collided) {
        pearl.velocity = {
          x: -velocityX * physics.materialRestitution,
          y: -velocityY * physics.materialRestitution,
        }
      } else {
        pearl.position = nextPosition
        pearl.velocity = { x: velocityX, y: velocityY }
      }
    }
  }

  #settlePearls(transaction: TickTransaction): void {
    const pearlsById = new Map(transaction.state.pearls.map((pearl) => [pearl.pearlId, pearl]))
    for (const pearlId of transaction.tickStartActivePearlIds) {
      const pearl = pearlsById.get(pearlId)
      if (pearl === undefined || pearl.state !== 'active') continue
      let outcome: Extract<PearlTerminalOutcome, 'caught' | 'missed'> | null = null
      if (this.#collectorIntersectsPearl(transaction.state.collector, pearl)) {
        outcome = 'caught'
      } else if (this.#pearlOutsideWorld(pearl)) {
        outcome = 'missed'
      }
      if (outcome === null) continue
      pearl.state = outcome
      transaction.terminals.push({ pearlId: pearl.pearlId, outcome })
    }
  }

  #collectorIntersectsPearl(
    collector: MutableCollector,
    pearl: MutablePearl,
  ): boolean {
    const halfWidth = this.#config.collector.width * 0.5
    const halfHeight = this.#config.collector.height * 0.5
    return (
      pearl.position.x >= collector.center.x - halfWidth &&
      pearl.position.x <= collector.center.x + halfWidth &&
      pearl.position.y >= collector.center.y - halfHeight &&
      pearl.position.y <= collector.center.y + halfHeight
    )
  }

  #pearlOutsideWorld(pearl: MutablePearl): boolean {
    return (
      pearl.position.x + pearl.radius < this.#config.worldBounds.left ||
      pearl.position.x - pearl.radius > this.#config.worldBounds.right ||
      pearl.position.y + pearl.radius < this.#config.worldBounds.top ||
      pearl.position.y - pearl.radius > this.#config.worldBounds.bottom
    )
  }
}
