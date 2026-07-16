import type {
  DomainState,
  MaterialInstance,
  PearlTerminalOutcome,
  PearlType,
} from '../../domain/index.ts'
import type {
  InheritedLossDelta,
  NaturalLossDelta,
  PearlBirthDelta,
  PearlInteractionDelta,
  PearlShieldActivationDelta,
  PearlTerminalDelta,
  PearlVolumeChangeDelta,
  SimulationDelta,
} from '../contracts.ts'
import { SpatialHashGrid } from '../spatial-hash-grid.ts'
import {
  FireFlowField,
  type FireFlowCircleObstacles,
  type FireFlowReadView,
  type FireFlowSource,
} from '../fire-flow/index.ts'
import {
  orientedMaterialRectangleIsWithinBounds,
  orientedMaterialRectanglesHaveInteriorIntersection,
  type OrientedMaterialRectangle,
} from '../../shared/material-placement-geometry.ts'
import {
  alignMaterialFrameToContentCenter,
  deriveMaterialFrameLayout,
} from '../../shared/material-content-geometry.ts'
import {
  EXTRACTION_COMPOSITION_CELL_COUNT,
  EXTRACTION_COMPOSITION_GRID_SIZE,
  type ExtractionCollectorReadView,
  type ExtractionEffectiveFireSource,
  type ExtractionFireFlowReadView,
  type ExtractionInteractionConfig,
  type ExtractionInteractionSelector,
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
  circleRemainingMaterialCollisionNormal,
  materialCellWorldPosition,
  rasterizeRemainingMaterials,
  normalizeAndClampFireDirection,
  sampleFireFlowIntensity,
  type MaterialGeometryState,
} from './material-geometry.ts'
import {
  clampVolumeToZero,
  volumeTolerance,
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
  readonly tagIds: readonly string[]
  readonly definition: ExtractionMaterialDefinition
  readonly placement: ExtractionMaterialPlacement
  readonly initialVolume: number
  remainingVolume: number
  readonly initialVolumeByType: MutableTypeVolumes
  readonly initialCellVolumes: Float64Array
  readonly remainingCellVolumes: Float64Array
  readonly fireErodedCells: Uint8Array
  readonly spawnAccumulators: MutableTypeVolumes
  readonly lastDissolvedPositions: MutableTypePositions
  readonly nextPearlOrdinals: MutableTypeVolumes
  pendingFireCellIndex: number | null
}

interface MutablePearl {
  readonly pearlId: string
  readonly sourceMaterialDefinitionId: string
  readonly sourceMaterialInstanceId: string
  readonly pearlType: PearlType
  readonly tagIds: readonly string[]
  readonly interactionProfileIds: readonly string[]
  readonly initialVolume: number
  currentVolume: number
  radius: number
  position: ExtractionVector
  velocity: ExtractionVector
  state: 'newborn' | 'active' | 'caught' | 'missed' | 'burned'
  exposureTicks: number
  shieldActive: boolean
  safeZoneEnteredTick: number | null
  activeInteractionId: string | null
  interactionPartnerId: string | null
  interactionStartedTick: number | null
  interactionRemainingTicks: number
  interactionCooldownUntilTicks: Record<string, number>
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
  interactionCount: number
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
  volumeChanges: PearlVolumeChangeDelta[]
  terminals: PearlTerminalDelta[]
  naturalLosses: NaturalLossDelta[]
  inheritedLosses: InheritedLossDelta[]
  shieldActivations: PearlShieldActivationDelta[]
  interactions: PearlInteractionDelta[]
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

function requireNonNegative(name: string, value: number): void {
  requireFinite(name, value)
  if (value < 0) throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${name}`)
}

function selectorMatchesPearl(
  selector: ExtractionInteractionSelector,
  pearl: Pick<MutablePearl, 'sourceMaterialDefinitionId' | 'pearlType' | 'tagIds'>,
): boolean {
  return (
    (selector.materialDefinitionIds.length === 0 ||
      selector.materialDefinitionIds.includes(pearl.sourceMaterialDefinitionId)) &&
    (selector.pearlTypes.length === 0 || selector.pearlTypes.includes(pearl.pearlType)) &&
    selector.requiredTagIds.every((tagId) => pearl.tagIds.includes(tagId))
  )
}

function selectorHasCondition(selector: ExtractionInteractionSelector): boolean {
  return (
    selector.materialDefinitionIds.length > 0 ||
    selector.requiredTagIds.length > 0 ||
    selector.pearlTypes.length > 0
  )
}

function requireUniqueValues(name: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${name}`)
  }
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
  if (
    !Number.isSafeInteger(config.frontLaneWidthCells) ||
    config.frontLaneWidthCells < 1 ||
    config.frontLaneWidthCells > EXTRACTION_COMPOSITION_GRID_SIZE
  ) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:frontLaneWidthCells')
  }
  requireFinite('naturalLossRatePerMinute', config.naturalLossRatePerMinute)
  if (config.naturalLossRatePerMinute < 0 || config.naturalLossRatePerMinute > 60) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:naturalLossRatePerMinute')
  }
  requireFinite('safeZoneY', config.safeZoneY)

  requirePositive(
    'materialPlacement.visibleLongEdge',
    config.materialPlacement.visibleLongEdge,
  )
  requireNonNegative(
    'materialPlacement.minimumGap',
    config.materialPlacement.minimumGap,
  )
  for (const [name, value] of Object.entries(config.materialPlacement.usableRegion)) {
    requireFinite(`materialPlacement.usableRegion.${name}`, value)
  }
  if (
    config.materialPlacement.usableRegion.right <=
      config.materialPlacement.usableRegion.left ||
    config.materialPlacement.usableRegion.bottom <=
      config.materialPlacement.usableRegion.top
  ) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.usableRegion')
  }
  if (config.materialPlacement.slots.length === 0) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.slots')
  }
  const placementRectangles: OrientedMaterialRectangle[] = []
  config.materialPlacement.slots.forEach((slot, index) => {
    validateVector(`materialPlacement.slots.${index}.center`, slot.center)
    requireFinite(
      `materialPlacement.slots.${index}.rotationRadians`,
      slot.rotationRadians,
    )
    const rectangle: OrientedMaterialRectangle = {
      center: slot.center,
      width: config.materialPlacement.visibleLongEdge,
      height: config.materialPlacement.visibleLongEdge,
      rotationRadians: slot.rotationRadians,
    }
    if (
      !orientedMaterialRectangleIsWithinBounds(
        rectangle,
        config.materialPlacement.usableRegion,
      )
    ) {
      throw new RangeError(
        `SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.slots.${index}.bounds`,
      )
    }
    const gapRectangle: OrientedMaterialRectangle = {
      ...rectangle,
      width: rectangle.width + config.materialPlacement.minimumGap,
      height: rectangle.height + config.materialPlacement.minimumGap,
    }
    if (
      placementRectangles.some((previous) =>
        orientedMaterialRectanglesHaveInteriorIntersection(previous, gapRectangle),
      )
    ) {
      throw new RangeError(
        `SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.slots.${index}.overlap`,
      )
    }
    placementRectangles.push(gapRectangle)
  })

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
    requireNonNegative(`${pearlType}.spawnClearance`, physics.spawnClearance)
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
    requireFinite(`${pearlType}.wallRestitution`, physics.wallRestitution)
    if (physics.wallRestitution < 0 || physics.wallRestitution > 1) {
      throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.wallRestitution`)
    }
    requireFinite(`${pearlType}.fireProtectionSeconds`, physics.fireProtectionSeconds)
    if (physics.fireProtectionSeconds < 0) {
      throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.fireProtectionSeconds`)
    }
    if (typeof physics.resetProtectionOnExit !== 'boolean') {
      throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.resetProtectionOnExit`)
    }
    requirePositive(`${pearlType}.burnDurationSeconds`, physics.burnDurationSeconds)
    requireFinite(`${pearlType}.thrustAcceleration`, physics.thrustAcceleration)
    if (physics.thrustAcceleration < 0) {
      throw new RangeError(`SIM_EXTRACTION_CONFIG_INVALID:${pearlType}.thrustAcceleration`)
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
  const placementRegion = config.materialPlacement.usableRegion
  if (
    !orientedMaterialRectangleIsWithinBounds(
      {
        center: {
          x: (placementRegion.left + placementRegion.right) * 0.5,
          y: (placementRegion.top + placementRegion.bottom) * 0.5,
        },
        width: placementRegion.right - placementRegion.left,
        height: placementRegion.bottom - placementRegion.top,
        rotationRadians: 0,
      },
      config.worldBounds,
    )
  ) {
    throw new RangeError(
      'SIM_EXTRACTION_CONFIG_INVALID:materialPlacement.usableRegion.bounds',
    )
  }
  if (config.safeZoneY < config.worldBounds.top || config.safeZoneY > config.worldBounds.bottom) {
    throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:safeZoneY')
  }

  const interactionIds = new Set<string>()
  for (const interaction of config.interactions ?? []) {
    if (interaction.id.length === 0 || interactionIds.has(interaction.id)) {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:interactions.id')
    }
    interactionIds.add(interaction.id)
    if (interaction.behavior !== 'fight') {
      throw new RangeError('SIM_EXTRACTION_CONFIG_INVALID:interactions.behavior')
    }
    requirePositive(`interactions.${interaction.id}.distance`, interaction.distance)
    requirePositive(
      `interactions.${interaction.id}.durationSeconds`,
      interaction.durationSeconds,
    )
    requireNonNegative(`interactions.${interaction.id}.impulse`, interaction.impulse)
    requireNonNegative(
      `interactions.${interaction.id}.cooldownSeconds`,
      interaction.cooldownSeconds,
    )
    for (const [participantName, selector] of [
      ['participantA', interaction.participantA],
      ['participantB', interaction.participantB],
    ] as const) {
      if (!selectorHasCondition(selector)) {
        throw new RangeError(
          `SIM_EXTRACTION_CONFIG_INVALID:interactions.${interaction.id}.${participantName}`,
        )
      }
      requireUniqueValues(
        `interactions.${interaction.id}.${participantName}.materialDefinitionIds`,
        selector.materialDefinitionIds,
      )
      requireUniqueValues(
        `interactions.${interaction.id}.${participantName}.requiredTagIds`,
        selector.requiredTagIds,
      )
      requireUniqueValues(
        `interactions.${interaction.id}.${participantName}.pearlTypes`,
        selector.pearlTypes,
      )
      if (selector.materialDefinitionIds.some((id) => !materialIds.has(id))) {
        throw new RangeError(
          `SIM_EXTRACTION_CONFIG_INVALID:interactions.${interaction.id}.${participantName}.materialDefinitionIds`,
        )
      }
    }
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
      usableRegion: { ...config.materialPlacement.usableRegion },
      slots: config.materialPlacement.slots.map((slot) => ({
        center: { ...slot.center },
        rotationRadians: slot.rotationRadians,
      })),
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
    interactions: [...(config.interactions ?? [])]
      .sort((left, right) => compareStableId(left.id, right.id))
      .map((interaction) => ({
        ...interaction,
        participantA: {
          materialDefinitionIds: [...interaction.participantA.materialDefinitionIds],
          requiredTagIds: [...interaction.participantA.requiredTagIds],
          pearlTypes: [...interaction.participantA.pearlTypes],
        },
        participantB: {
          materialDefinitionIds: [...interaction.participantB.materialDefinitionIds],
          requiredTagIds: [...interaction.participantB.requiredTagIds],
          pearlTypes: [...interaction.participantB.pearlTypes],
        },
      })),
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
    tagIds: [...material.tagIds],
    placement: {
      ...material.placement,
      center: { ...material.placement.center },
    },
    initialVolumeByType: { ...material.initialVolumeByType },
    initialCellVolumes: new Float64Array(material.initialCellVolumes),
    remainingCellVolumes: new Float64Array(material.remainingCellVolumes),
    fireErodedCells: new Uint8Array(material.fireErodedCells),
    spawnAccumulators: { ...material.spawnAccumulators },
    lastDissolvedPositions: {
      medicinalLiquid: { ...material.lastDissolvedPositions.medicinalLiquid },
      slag: { ...material.lastDissolvedPositions.slag },
      impurity: { ...material.lastDissolvedPositions.impurity },
    },
    nextPearlOrdinals: { ...material.nextPearlOrdinals },
    pendingFireCellIndex: material.pendingFireCellIndex,
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
      interactionCooldownUntilTicks: { ...pearl.interactionCooldownUntilTicks },
    })),
    collector: {
      center: { ...state.collector.center },
      velocityX: state.collector.velocityX,
    },
    interactionCount: state.interactionCount,
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
    initialVolume: pearl.initialVolume,
    currentVolume: pearl.currentVolume,
    radius: pearl.radius,
    position: Object.freeze({ ...pearl.position }),
    velocity: Object.freeze({ ...pearl.velocity }),
    state: pearl.state,
    shield: Object.freeze({
      active: pearl.shieldActive,
      exposureTicks: pearl.exposureTicks,
    }),
    safeZone: Object.freeze({
      entered: pearl.safeZoneEnteredTick !== null,
      enteredTick: pearl.safeZoneEnteredTick,
    }),
    tags: Object.freeze([...pearl.tagIds]),
    interactionProfileIds: Object.freeze([...pearl.interactionProfileIds]),
    interaction: Object.freeze({
      activeId: pearl.activeInteractionId,
      remainingTicks: pearl.interactionRemainingTicks,
    }),
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
    activeInteractions: Object.freeze(
      state.pearls
        .filter(
          (pearl) =>
            pearl.state === 'active' &&
            pearl.activeInteractionId !== null &&
            pearl.interactionPartnerId !== null &&
            pearl.interactionStartedTick !== null &&
            compareStableId(pearl.pearlId, pearl.interactionPartnerId) < 0,
        )
        .sort((left, right) => compareStableId(left.pearlId, right.pearlId))
        .map((pearl) =>
          Object.freeze({
            interactionId: pearl.activeInteractionId!,
            pearlAId: pearl.pearlId,
            pearlBId: pearl.interactionPartnerId!,
            startedTick: pearl.interactionStartedTick!,
            remainingTicks: pearl.interactionRemainingTicks,
          }),
        ),
    ),
    interactionCount: state.interactionCount,
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
    interactionCount: 0,
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
      volumeChanges: [],
      terminals: [],
      naturalLosses: [],
      inheritedLosses: [],
      shieldActivations: [],
      interactions: [],
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
        this.#applyNaturalLoss(transaction)
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
    const domainMaterials = new Map(
      transaction.domainState.materialInstances.map((material) => [
        material.materialInstanceId,
        material,
      ]),
    )
    const materialVolumeChanges = transaction.state.materials.map((material) => {
      const domainMaterial = domainMaterials.get(material.materialInstanceId)
      if (domainMaterial === undefined) {
        throw new Error('SIM_EXTRACTION_DOMAIN_MATERIAL_MISMATCH')
      }
      return {
        materialInstanceId: material.materialInstanceId,
        previousVolume: domainMaterial.remainingVolume,
        currentVolume: material.remainingVolume,
      }
    })
    transaction.builtDelta = {
      tick: transaction.tick,
      dissolutions,
      births,
      pearlVolumeChanges: transaction.volumeChanges
        .slice()
        .sort((left, right) => compareStableId(left.pearlId, right.pearlId)),
      terminalOutcomes,
      naturalLosses: transaction.naturalLosses
        .slice()
        .sort((left, right) => compareStableId(left.stableEntityId, right.stableEntityId)),
      inheritedLosses: transaction.inheritedLosses
        .slice()
        .sort((left, right) => compareStableId(left.materialInstanceId, right.materialInstanceId)),
      materialVolumeChanges,
      shieldActivations: transaction.shieldActivations
        .slice()
        .sort((left, right) => compareStableId(left.pearlId, right.pearlId)),
      interactions: transaction.interactions
        .slice()
        .sort(
          (left, right) =>
            compareStableId(left.interactionId, right.interactionId) ||
            compareStableId(left.pearlAId, right.pearlAId) ||
            compareStableId(left.pearlBId, right.pearlBId),
        ),
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
    if (
      domainState.materialInstances.length >
      this.#config.materialPlacement.slots.length
    ) {
      throw new Error('SIM_EXTRACTION_MATERIAL_PLACEMENT_FULL')
    }
    const stateById = new Map(
      transaction.state.materials.map((material) => [material.materialInstanceId, material]),
    )
    const domainIds = new Set(domainState.materialInstances.map(({ materialInstanceId }) => materialInstanceId))
    for (const existing of transaction.state.materials) {
      if (!domainIds.has(existing.materialInstanceId)) {
        throw new Error('SIM_EXTRACTION_DOMAIN_MATERIAL_REMOVED')
      }
    }

    for (const instance of domainState.materialInstances) {
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
      const material = this.#createMaterial(
        instance,
        transaction.state.materials.length,
      )
      const theoreticalMedicinalVolume =
        instance.theoreticalMedicinalVolume ??
        material.initialVolumeByType.medicinalLiquid
      const inheritedLossVolume = instance.inheritedLossAtAddition ?? 0
      if (
        !approximatelyEqual(
          theoreticalMedicinalVolume,
          material.initialVolumeByType.medicinalLiquid,
        ) ||
        inheritedLossVolume < 0 ||
        inheritedLossVolume > theoreticalMedicinalVolume + GEOMETRY_EPSILON
      ) {
        throw new Error('SIM_EXTRACTION_INHERITED_LOSS_MISMATCH')
      }
      this.#applyInheritedLossToMaterial(material, inheritedLossVolume)
      transaction.inheritedLosses.push({
        materialInstanceId: material.materialInstanceId,
        theoreticalMedicinalVolume,
        volume: inheritedLossVolume,
      })
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
    const slot = this.#config.materialPlacement.slots[layer]
    if (slot === undefined) {
      throw new Error('SIM_EXTRACTION_MATERIAL_PLACEMENT_FULL')
    }
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
    const layout = deriveMaterialFrameLayout(
      definition.composition,
      this.#config.materialPlacement.visibleLongEdge,
    )
    const placement: ExtractionMaterialPlacement = {
      center: alignMaterialFrameToContentCenter(
        slot.center,
        slot.rotationRadians,
        layout,
      ),
      width: layout.frameWidth,
      height: layout.frameHeight,
      rotationRadians: slot.rotationRadians,
      layer,
    }
    return {
      materialInstanceId: instance.materialInstanceId,
      materialDefinitionId: instance.materialDefinitionId,
      inventoryBatchId: instance.inventoryBatchId,
      tagIds: [...(instance.tagIds ?? [])].sort(compareStableId),
      definition,
      placement,
      initialVolume: totalVolume,
      remainingVolume: totalVolume,
      initialVolumeByType,
      initialCellVolumes,
      remainingCellVolumes: new Float64Array(initialCellVolumes),
      fireErodedCells: new Uint8Array(EXTRACTION_COMPOSITION_CELL_COUNT),
      spawnAccumulators: emptyTypeVolumes(),
      lastDissolvedPositions: centeredTypePositions(placement.center),
      nextPearlOrdinals: emptyTypeVolumes(),
      pendingFireCellIndex: null,
    }
  }

  #applyInheritedLossToMaterial(
    material: MutableMaterial,
    requestedLoss: number,
  ): void {
    if (requestedLoss <= 0) return
    const medicinalCells: number[] = []
    for (let cellIndex = 0; cellIndex < material.definition.composition.length; cellIndex += 1) {
      if (material.definition.composition[cellIndex] === 1) medicinalCells.push(cellIndex)
    }
    let remainingLoss = requestedLoss
    let remainingCapacity = material.initialVolumeByType.medicinalLiquid
    for (let index = 0; index < medicinalCells.length; index += 1) {
      const cellIndex = medicinalCells[index]!
      const available = material.remainingCellVolumes[cellIndex]!
      const loss =
        index === medicinalCells.length - 1
          ? remainingLoss
          : Math.min(available, remainingLoss * (available / remainingCapacity))
      material.remainingCellVolumes[cellIndex] = Math.max(0, available - loss)
      remainingLoss -= loss
      remainingCapacity -= available
    }
    if (!approximatelyEqual(remainingLoss, 0)) {
      throw new Error('SIM_EXTRACTION_INHERITED_LOSS_ALLOCATION_FAILED')
    }
    material.remainingVolume = clampVolumeToZero(
      sumCellVolumes(material.remainingCellVolumes),
      material.initialVolume,
    )
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
      if (
        pearl === undefined ||
        pearl.state !== 'active' ||
        pearl.safeZoneEnteredTick !== null
      ) continue
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
      const allocations = this.#allocateFireFront(
        transaction,
        material,
        exposed,
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
        while (
          material.spawnAccumulators[pearlType] +
            volumeTolerance(
              material.spawnAccumulators[pearlType],
              this.#config.standardPearlVolume,
            ) >=
          this.#config.standardPearlVolume
        ) {
          if (
            !this.#spawnPearl(
              transaction,
              material,
              pearlType,
              this.#config.standardPearlVolume,
              material.lastDissolvedPositions[pearlType],
            )
          ) {
            throw new Error('SIM_EXTRACTION_PEARL_SPAWN_BLOCKED')
          }
          material.spawnAccumulators[pearlType] = clampVolumeToZero(
            material.spawnAccumulators[pearlType] -
              this.#config.standardPearlVolume,
            this.#config.standardPearlVolume,
          )
        }
        const tailVolume = material.spawnAccumulators[pearlType]
        if (tailVolume <= 0) continue
        if (
          !this.#spawnPearl(
            transaction,
            material,
            pearlType,
            tailVolume,
            material.lastDissolvedPositions[pearlType],
          )
        ) {
          throw new Error('SIM_EXTRACTION_PEARL_SPAWN_BLOCKED')
        }
        material.spawnAccumulators[pearlType] = 0
      }
    }
  }

  #findExposedCells(
    transaction: TickTransaction,
    material: MutableMaterial,
  ): number[] {
    const direction = transaction.fireDirection
    const perpendicular = { x: -direction.y, y: direction.x }
    const halfFireWidth = transaction.fireWidth * 0.5
    const targetCosine = Math.cos(material.placement.rotationRadians)
    const targetSine = Math.sin(material.placement.rotationRadians)
    const targetCellWidth =
      material.placement.width / EXTRACTION_COMPOSITION_GRID_SIZE
    const targetCellHeight =
      material.placement.height / EXTRACTION_COMPOSITION_GRID_SIZE
    const targetProjectedCellWidth =
      Math.abs(
        perpendicular.x * targetCosine +
          perpendicular.y * targetSine,
      ) *
        targetCellWidth +
      Math.abs(
        perpendicular.x * -targetSine +
          perpendicular.y * targetCosine,
      ) *
        targetCellHeight
    const laneWidth = Math.max(
      GEOMETRY_EPSILON,
      targetProjectedCellWidth * this.#config.frontLaneWidthCells,
    )
    const minimumLaneIndex = Math.ceil(-halfFireWidth / laneWidth)
    const maximumLaneIndex = Math.floor(halfFireWidth / laneWidth)
    const lanes: {
      readonly lateral: number
      projection: number
      material: MutableMaterial | null
      materialIndex: number
      cellIndex: number
    }[] = []
    for (
      let laneIndex = minimumLaneIndex;
      laneIndex <= maximumLaneIndex;
      laneIndex += 1
    ) {
      lanes.push({
        lateral: laneIndex * laneWidth,
        projection: Number.POSITIVE_INFINITY,
        material: null,
        materialIndex: -1,
        cellIndex: -1,
      })
    }
    const addEdgeLane = (lateral: number): void => {
      if (
        lanes.some(
          (lane) => Math.abs(lane.lateral - lateral) <= GEOMETRY_EPSILON,
        )
      ) {
        return
      }
      lanes.push({
        lateral,
        projection: Number.POSITIVE_INFINITY,
        material: null,
        materialIndex: -1,
        cellIndex: -1,
      })
    }
    addEdgeLane(-halfFireWidth)
    addEdgeLane(halfFireWidth)
    lanes.sort((left, right) => left.lateral - right.lateral)

    for (
      let materialIndex = 0;
      materialIndex < transaction.state.materials.length;
      materialIndex += 1
    ) {
      const blocker = transaction.state.materials[materialIndex]!
      const cosine = Math.cos(blocker.placement.rotationRadians)
      const sine = Math.sin(blocker.placement.rotationRadians)
      const cellWidth =
        blocker.placement.width / EXTRACTION_COMPOSITION_GRID_SIZE
      const cellHeight =
        blocker.placement.height / EXTRACTION_COMPOSITION_GRID_SIZE
      const lateralHalfExtent =
        0.5 *
        (
          Math.abs(perpendicular.x * cosine + perpendicular.y * sine) *
            cellWidth +
          Math.abs(perpendicular.x * -sine + perpendicular.y * cosine) *
            cellHeight
        )
      for (
        let cellIndex = 0;
        cellIndex < blocker.remainingCellVolumes.length;
        cellIndex += 1
      ) {
        if (blocker.remainingCellVolumes[cellIndex]! <= 0) continue
        const center = materialCellWorldPosition(blocker, cellIndex)
        const relativeX = center.x - this.#config.fireSource.origin.x
        const relativeY = center.y - this.#config.fireSource.origin.y
        const signedLateral =
          relativeX * perpendicular.x + relativeY * perpendicular.y
        if (
          signedLateral + lateralHalfExtent <
            -halfFireWidth - GEOMETRY_EPSILON ||
          signedLateral - lateralHalfExtent >
            halfFireWidth + GEOMETRY_EPSILON
        ) {
          continue
        }
        for (const lane of lanes) {
          if (
            lane.lateral <
              signedLateral - lateralHalfExtent - GEOMETRY_EPSILON ||
            lane.lateral >
              signedLateral + lateralHalfExtent + GEOMETRY_EPSILON
          ) {
            continue
          }
          const projection = this.#fireLaneCellEntryProjection(
            blocker,
            cellIndex,
            lane.lateral,
            direction,
            perpendicular,
          )
          if (projection === null) continue
          if (
            projection < lane.projection - GEOMETRY_EPSILON ||
            (
              Math.abs(projection - lane.projection) <= GEOMETRY_EPSILON &&
              (
                lane.material === null ||
                materialIndex < lane.materialIndex ||
                (
                  materialIndex === lane.materialIndex &&
                  cellIndex < lane.cellIndex
                )
              )
            )
          ) {
            lane.projection = projection
            lane.material = blocker
            lane.materialIndex = materialIndex
            lane.cellIndex = cellIndex
          }
        }
      }
    }

    const result = new Set<number>()
    for (const lane of lanes) {
      if (
        lane.material !== material ||
        lane.cellIndex < 0 ||
        !this.#fireLaneHasFlow(
          transaction,
          lane.lateral,
          lane.projection,
        )
      ) {
        continue
      }
      result.add(lane.cellIndex)
    }
    if (result.size === 0) {
      const neighborOffsets = [
        { column: -1, row: 0 },
        { column: 1, row: 0 },
        { column: 0, row: -1 },
        { column: 0, row: 1 },
      ] as const
      for (
        let cellIndex = 0;
        cellIndex < material.remainingCellVolumes.length;
        cellIndex += 1
      ) {
        if (material.remainingCellVolumes[cellIndex]! <= 0) continue
        const center = materialCellWorldPosition(material, cellIndex)
        const relativeX =
          center.x - this.#config.fireSource.origin.x
        const relativeY =
          center.y - this.#config.fireSource.origin.y
        const signedLateral =
          relativeX * perpendicular.x + relativeY * perpendicular.y
        if (
          Math.abs(signedLateral) >
          halfFireWidth +
            laneWidth +
            GEOMETRY_EPSILON
        ) {
          continue
        }
        const column = cellIndex % EXTRACTION_COMPOSITION_GRID_SIZE
        const row = Math.floor(
          cellIndex / EXTRACTION_COMPOSITION_GRID_SIZE,
        )
        for (const offset of neighborOffsets) {
          const neighborColumn = column + offset.column
          const neighborRow = row + offset.row
          if (
            neighborColumn < 0 ||
            neighborColumn >= EXTRACTION_COMPOSITION_GRID_SIZE ||
            neighborRow < 0 ||
            neighborRow >= EXTRACTION_COMPOSITION_GRID_SIZE
          ) {
            continue
          }
          const neighborIndex =
            neighborRow * EXTRACTION_COMPOSITION_GRID_SIZE +
            neighborColumn
          if (
            material.remainingCellVolumes[neighborIndex]! > 0 ||
            material.fireErodedCells[neighborIndex] === 0
          ) continue
          result.add(cellIndex)
          break
        }
      }
    }
    return [...result].sort((left, right) => left - right)
  }

  #fireLaneCellEntryProjection(
    material: MutableMaterial,
    cellIndex: number,
    lateral: number,
    direction: ExtractionVector,
    perpendicular: ExtractionVector,
  ): number | null {
    const placement = material.placement
    const cosine = Math.cos(placement.rotationRadians)
    const sine = Math.sin(placement.rotationRadians)
    const rayOrigin = {
      x: this.#config.fireSource.origin.x + perpendicular.x * lateral,
      y: this.#config.fireSource.origin.y + perpendicular.y * lateral,
    }
    const originDeltaX = rayOrigin.x - placement.center.x
    const originDeltaY = rayOrigin.y - placement.center.y
    const localOrigin = {
      x: originDeltaX * cosine + originDeltaY * sine,
      y: -originDeltaX * sine + originDeltaY * cosine,
    }
    const localDirection = {
      x: direction.x * cosine + direction.y * sine,
      y: -direction.x * sine + direction.y * cosine,
    }
    const column = cellIndex % EXTRACTION_COMPOSITION_GRID_SIZE
    const row = Math.floor(cellIndex / EXTRACTION_COMPOSITION_GRID_SIZE)
    const cellWidth =
      placement.width / EXTRACTION_COMPOSITION_GRID_SIZE
    const cellHeight =
      placement.height / EXTRACTION_COMPOSITION_GRID_SIZE
    const left = -placement.width * 0.5 + column * cellWidth
    const top = -placement.height * 0.5 + row * cellHeight
    let entry = 0
    let exit = Number.POSITIVE_INFINITY
    for (const [origin, delta, minimum, maximum] of [
      [localOrigin.x, localDirection.x, left, left + cellWidth],
      [localOrigin.y, localDirection.y, top, top + cellHeight],
    ] as const) {
      if (Math.abs(delta) <= GEOMETRY_EPSILON) {
        if (
          origin < minimum - GEOMETRY_EPSILON ||
          origin > maximum + GEOMETRY_EPSILON
        ) {
          return null
        }
        continue
      }
      const first = (minimum - origin) / delta
      const second = (maximum - origin) / delta
      entry = Math.max(entry, Math.min(first, second))
      exit = Math.min(exit, Math.max(first, second))
      if (entry > exit + GEOMETRY_EPSILON) return null
    }
    return exit < -GEOMETRY_EPSILON ? null : Math.max(0, entry)
  }

  #fireLaneHasFlow(
    transaction: TickTransaction,
    lateral: number,
    entryProjection: number,
  ): boolean {
    const flowView = transaction.flowView
    if (flowView === null) return false
    const maximumProbeStep = this.#config.fireFlow.geometry.cellSize * 0.5
    const stepDistance =
      this.#config.exposureProbeDistance > 0
        ? Math.min(this.#config.exposureProbeDistance, maximumProbeStep)
        : maximumProbeStep
    const perpendicular = {
      x: -transaction.fireDirection.y,
      y: transaction.fireDirection.x,
    }
    const stepCount = Math.ceil(entryProjection / stepDistance) + 1
    for (let step = 0; step <= stepCount; step += 1) {
      const projection = Math.max(
        0,
        entryProjection - stepDistance * step,
      )
      const point = {
        x:
          this.#config.fireSource.origin.x +
          perpendicular.x * lateral +
          transaction.fireDirection.x * projection,
        y:
          this.#config.fireSource.origin.y +
          perpendicular.y * lateral +
          transaction.fireDirection.y * projection,
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
      if (projection === 0) break
    }
    return false
  }

  #allocateFireFront(
    transaction: TickTransaction,
    material: MutableMaterial,
    cellIndexes: readonly number[],
    requested: number,
  ): ReadonlyMap<number, number> {
    const allocations = new Map<number, number>()
    const origin = this.#config.fireSource.origin
    const direction = transaction.fireDirection
    let remainingRequested = requested
    const pendingCellIndex = material.pendingFireCellIndex
    if (
      pendingCellIndex !== null &&
      material.remainingCellVolumes[pendingCellIndex]! > 0
    ) {
      const available = material.remainingCellVolumes[pendingCellIndex]!
      const applied = Math.min(remainingRequested, available)
      allocations.set(pendingCellIndex, applied)
      remainingRequested = clampVolumeToZero(
        Math.max(0, remainingRequested - applied),
        requested,
      )
      if (applied < available - volumeTolerance(applied, available)) {
        return allocations
      }
      material.pendingFireCellIndex = null
      if (remainingRequested === 0) return allocations
    }
    material.pendingFireCellIndex = null

    const perpendicular = { x: -direction.y, y: direction.x }
    const coreCellIndexes = cellIndexes.filter((cellIndex) => {
      const position = materialCellWorldPosition(material, cellIndex)
      const relativeX = position.x - origin.x
      const relativeY = position.y - origin.y
      const signedLateral =
        relativeX * perpendicular.x + relativeY * perpendicular.y
      return (
        Math.abs(signedLateral) <=
        transaction.fireWidth * 0.5 + GEOMETRY_EPSILON
      )
    })
    const candidateCellIndexes =
      coreCellIndexes.length > 0 ? coreCellIndexes : cellIndexes
    const cosine = Math.cos(material.placement.rotationRadians)
    const sine = Math.sin(material.placement.rotationRadians)
    const cellWidth =
      material.placement.width / EXTRACTION_COMPOSITION_GRID_SIZE
    const cellHeight =
      material.placement.height / EXTRACTION_COMPOSITION_GRID_SIZE
    const projectedCellWidth =
      Math.abs(perpendicular.x * cosine + perpendicular.y * sine) *
        cellWidth +
      Math.abs(perpendicular.x * -sine + perpendicular.y * cosine) *
        cellHeight
    const laneWidth = Math.max(
      GEOMETRY_EPSILON,
      projectedCellWidth * this.#config.frontLaneWidthCells,
    )
    const laneMinimumProjection = new Map<number, number>()
    const cellCoordinates = (
      cellIndex: number,
    ): Readonly<{
      projection: number
      lateral: number
      laneIndex: number
    }> => {
      const position = materialCellWorldPosition(material, cellIndex)
      const relativeX = position.x - origin.x
      const relativeY = position.y - origin.y
      const projection =
        relativeX * direction.x + relativeY * direction.y
      const lateral =
        relativeX * perpendicular.x + relativeY * perpendicular.y
      return {
        projection,
        lateral,
        laneIndex: Math.floor(lateral / laneWidth + 0.5),
      }
    }
    for (
      let cellIndex = 0;
      cellIndex < material.initialCellVolumes.length;
      cellIndex += 1
    ) {
      if (material.initialCellVolumes[cellIndex]! <= 0) continue
      const coordinates = cellCoordinates(cellIndex)
      const previous = laneMinimumProjection.get(coordinates.laneIndex)
      if (
        previous === undefined ||
        coordinates.projection < previous
      ) {
        laneMinimumProjection.set(
          coordinates.laneIndex,
          coordinates.projection,
        )
      }
    }
    const ordered = candidateCellIndexes
      .map((cellIndex) => {
        const coordinates = cellCoordinates(cellIndex)
        return {
          cellIndex,
          ...coordinates,
          relativeDepth:
            coordinates.projection -
            (laneMinimumProjection.get(coordinates.laneIndex) ??
              coordinates.projection),
        }
      })
      .sort((left, right) => {
        if (
          Math.abs(left.relativeDepth - right.relativeDepth) >
          GEOMETRY_EPSILON
        ) {
          return left.relativeDepth - right.relativeDepth
        }
        const lateralDifference =
          Math.abs(left.lateral) - Math.abs(right.lateral)
        if (Math.abs(lateralDifference) > GEOMETRY_EPSILON) {
          return lateralDifference
        }
        if (
          Math.abs(left.projection - right.projection) >
          GEOMETRY_EPSILON
        ) {
          return left.projection - right.projection
        }
        return left.cellIndex - right.cellIndex
      })
    for (const selected of ordered) {
      if (remainingRequested === 0) break
      const alreadyAllocated = allocations.get(selected.cellIndex) ?? 0
      const available = Math.max(
        0,
        material.remainingCellVolumes[selected.cellIndex]! - alreadyAllocated,
      )
      if (available === 0) continue
      const applied = Math.min(remainingRequested, available)
      if (applied <= 0) continue
      allocations.set(selected.cellIndex, alreadyAllocated + applied)
      remainingRequested = clampVolumeToZero(
        Math.max(0, remainingRequested - applied),
        requested,
      )
      if (applied < available - volumeTolerance(applied, available)) {
        material.pendingFireCellIndex = selected.cellIndex
        break
      }
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
    if (applied > 0 && material.remainingCellVolumes[cellIndex] === 0) {
      material.fireErodedCells[cellIndex] = 1
    }
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
      material.spawnAccumulators[pearlType] +
        volumeTolerance(
          material.spawnAccumulators[pearlType],
          this.#config.standardPearlVolume,
        ) >=
      this.#config.standardPearlVolume
    ) {
      if (
        !this.#spawnPearl(
          transaction,
          material,
          pearlType,
          this.#config.standardPearlVolume,
          position,
        )
      ) {
        throw new Error('SIM_EXTRACTION_PEARL_SPAWN_BLOCKED')
      }
      material.spawnAccumulators[pearlType] = clampVolumeToZero(
        material.spawnAccumulators[pearlType] - this.#config.standardPearlVolume,
        this.#config.standardPearlVolume,
      )
    }
  }

  #spawnPearl(
    transaction: TickTransaction,
    material: MutableMaterial,
    pearlType: PearlType,
    volume: number,
    position: ExtractionVector,
  ): boolean {
    const physics = this.#config.pearlPhysics[pearlType]
    const radius =
      physics.radiusAtStandardVolume *
      Math.sqrt(volume / this.#config.standardPearlVolume)
    const spawnPosition = this.#findPearlSpawnPosition(
      transaction,
      material,
      position,
      radius,
      physics.spawnClearance,
    )
    if (spawnPosition === null) return false

    const ordinal = material.nextPearlOrdinals[pearlType] + 1
    const pearlId = `pearl:${material.materialInstanceId}:${pearlType}:${ordinal
      .toString()
      .padStart(6, '0')}`
    const pearlIdentity = {
      sourceMaterialDefinitionId: material.materialDefinitionId,
      pearlType,
      tagIds: material.tagIds,
    }
    const interactionProfileIds = (this.#config.interactions ?? [])
      .filter(
        (interaction) =>
          selectorMatchesPearl(interaction.participantA, pearlIdentity) ||
          selectorMatchesPearl(interaction.participantB, pearlIdentity),
      )
      .map((interaction) => interaction.id)
      .sort(compareStableId)
    material.nextPearlOrdinals[pearlType] = ordinal
    transaction.state.pearls.push({
      pearlId,
      sourceMaterialDefinitionId: material.materialDefinitionId,
      sourceMaterialInstanceId: material.materialInstanceId,
      pearlType,
      tagIds: [...material.tagIds],
      interactionProfileIds,
      initialVolume: volume,
      currentVolume: volume,
      radius,
      position: spawnPosition,
      velocity: spawnVelocity(this.#config.seed, pearlId, physics),
      state: 'newborn',
      exposureTicks: 0,
      shieldActive: false,
      safeZoneEnteredTick: null,
      activeInteractionId: null,
      interactionPartnerId: null,
      interactionStartedTick: null,
      interactionRemainingTicks: 0,
      interactionCooldownUntilTicks: {},
    })
    transaction.births.push({
      pearlId,
      sourceMaterialDefinitionId: material.materialDefinitionId,
      sourceMaterialInstanceId: material.materialInstanceId,
      pearlType,
      volume,
    })
    return true
  }

  #findPearlSpawnPosition(
    transaction: TickTransaction,
    material: MutableMaterial,
    origin: ExtractionVector,
    radius: number,
    clearance: number,
  ): ExtractionVector | null {
    const collisionRadius = radius + clearance
    const towardSource = {
      x: -transaction.fireDirection.x,
      y: -transaction.fireDirection.y,
    }
    const stepDistance =
      Math.min(material.placement.width, material.placement.height) /
      EXTRACTION_COMPOSITION_GRID_SIZE /
      2
    const world = this.#config.worldBounds
    const maximumDistance = Math.hypot(
      world.right - world.left,
      world.bottom - world.top,
    )
    const maximumStep = Math.ceil(maximumDistance / stepDistance)
    for (let step = 0; step <= maximumStep; step += 1) {
      const distance = step * stepDistance
      const candidate = {
        x: origin.x + towardSource.x * distance,
        y: origin.y + towardSource.y * distance,
      }
      if (
        candidate.x - collisionRadius < world.left ||
        candidate.x + collisionRadius > world.right ||
        candidate.y - collisionRadius < world.top ||
        candidate.y + collisionRadius > world.bottom
      ) {
        continue
      }
      if (
        !circleIntersectsRemainingMaterial(
          transaction.state.materials,
          candidate,
          collisionRadius,
        )
      ) {
        return candidate
      }
    }
    return null
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

      if (
        pearl.safeZoneEnteredTick === null &&
        nextPosition.y >= this.#config.safeZoneY
      ) {
        pearl.safeZoneEnteredTick = transaction.tick
        pearl.shieldActive = false
      }

      const flow = this.#sampleFlow(transaction.flowView, nextPosition)
      if (pearl.safeZoneEnteredTick === null && flow.intensity > 0) {
        if (pearl.exposureTicks === 0) {
          transaction.shieldActivations.push({ pearlId: pearl.pearlId })
        }
        pearl.exposureTicks += 1
        const protectionTicks = Math.ceil(
          physics.fireProtectionSeconds / this.#config.fixedDeltaSeconds,
        )
        pearl.shieldActive = pearl.exposureTicks <= protectionTicks
        if (!pearl.shieldActive) {
          const previousVolume = pearl.currentVolume
          const damage =
            (pearl.initialVolume / physics.burnDurationSeconds) *
            this.#config.fixedDeltaSeconds *
            flow.intensity
          pearl.currentVolume = clampVolumeToZero(
            Math.max(0, pearl.currentVolume - damage),
            pearl.initialVolume,
          )
          pearl.radius =
            physics.radiusAtStandardVolume *
            Math.sqrt(pearl.currentVolume / this.#config.standardPearlVolume)
          if (!approximatelyEqual(previousVolume, pearl.currentVolume)) {
            transaction.volumeChanges.push({
              pearlId: pearl.pearlId,
              previousVolume,
              currentVolume: pearl.currentVolume,
            })
          }
        }
        if (domainState.flameThrustEnabled && physics.thrustAcceleration > 0) {
          velocityX +=
            flow.x * physics.thrustAcceleration * this.#config.fixedDeltaSeconds * flow.intensity
          velocityY +=
            flow.y * physics.thrustAcceleration * this.#config.fixedDeltaSeconds * flow.intensity
        }
      } else {
        pearl.shieldActive = false
        if (pearl.safeZoneEnteredTick === null && physics.resetProtectionOnExit) {
          pearl.exposureTicks = 0
        }
      }

      if (pearl.currentVolume === 0) {
        this.#clearPearlInteraction(transaction.state, pearl)
        pearl.state = 'burned'
        pearl.velocity = { x: velocityX, y: velocityY }
        transaction.terminals.push({ pearlId: pearl.pearlId, outcome: 'burned' })
        continue
      }

      const displacement = Math.hypot(
        nextPosition.x - pearl.position.x,
        nextPosition.y - pearl.position.y,
      )
      const collisionStep = Math.min(
        ...transaction.state.materials.map(
          (material) =>
            Math.min(material.placement.width, material.placement.height) /
            EXTRACTION_COMPOSITION_GRID_SIZE /
            2,
        ),
      )
      const substeps = Math.max(1, Math.ceil(displacement / collisionStep))
      let collisionNormal: ExtractionVector | null = null
      for (let substep = 1; substep <= substeps; substep += 1) {
        const ratio = substep / substeps
        const probePosition = {
          x: pearl.position.x + (nextPosition.x - pearl.position.x) * ratio,
          y: pearl.position.y + (nextPosition.y - pearl.position.y) * ratio,
        }
        collisionNormal = circleRemainingMaterialCollisionNormal(
          transaction.state.materials,
          probePosition,
          pearl.radius,
        )
        if (collisionNormal !== null) {
          break
        }
      }
      if (collisionNormal !== null) {
        const normalVelocity =
          velocityX * collisionNormal.x + velocityY * collisionNormal.y
        const tangentVelocity = {
          x: velocityX - normalVelocity * collisionNormal.x,
          y: velocityY - normalVelocity * collisionNormal.y,
        }
        const tangentPosition = {
          x:
            pearl.position.x +
            tangentVelocity.x * this.#config.fixedDeltaSeconds,
          y:
            pearl.position.y +
            tangentVelocity.y * this.#config.fixedDeltaSeconds,
        }
        if (
          tangentPosition.x - pearl.radius >= this.#config.worldBounds.left &&
          tangentPosition.x + pearl.radius <= this.#config.worldBounds.right &&
          tangentPosition.y - pearl.radius >= this.#config.worldBounds.top &&
          tangentPosition.y + pearl.radius <= this.#config.worldBounds.bottom &&
          !circleIntersectsRemainingMaterial(
            transaction.state.materials,
            tangentPosition,
            pearl.radius,
          )
        ) {
          pearl.position = tangentPosition
        }
        const reflectedNormalVelocity =
          normalVelocity < 0
            ? -normalVelocity * physics.materialRestitution
            : normalVelocity
        pearl.velocity = {
          x:
            tangentVelocity.x +
            reflectedNormalVelocity * collisionNormal.x,
          y:
            tangentVelocity.y +
            reflectedNormalVelocity * collisionNormal.y,
        }
      } else {
        const resolved = { ...nextPosition }
        if (resolved.x - pearl.radius < this.#config.worldBounds.left) {
          resolved.x = this.#config.worldBounds.left + pearl.radius
          velocityX = Math.abs(velocityX) * physics.wallRestitution
        } else if (resolved.x + pearl.radius > this.#config.worldBounds.right) {
          resolved.x = this.#config.worldBounds.right - pearl.radius
          velocityX = -Math.abs(velocityX) * physics.wallRestitution
        }
        if (resolved.y - pearl.radius < this.#config.worldBounds.top) {
          resolved.y = this.#config.worldBounds.top + pearl.radius
          velocityY = Math.abs(velocityY) * physics.wallRestitution
        }
        pearl.position = resolved
        pearl.velocity = { x: velocityX, y: velocityY }
      }
    }
    this.#resolveInteractions(transaction)
  }

  #resolveInteractions(transaction: TickTransaction): void {
    const interactions = this.#config.interactions ?? []
    const activePearls = transaction.state.pearls
      .filter((pearl) => pearl.state === 'active')
      .sort((left, right) => compareStableId(left.pearlId, right.pearlId))
    const pearlsById = new Map(
      transaction.state.pearls.map((pearl) => [pearl.pearlId, pearl]),
    )

    for (const pearl of transaction.state.pearls) {
      if (pearl.activeInteractionId === null) continue
      const partner =
        pearl.interactionPartnerId === null
          ? undefined
          : pearlsById.get(pearl.interactionPartnerId)
      if (
        pearl.state !== 'active' ||
        partner?.state !== 'active' ||
        partner.activeInteractionId !== pearl.activeInteractionId ||
        partner.interactionPartnerId !== pearl.pearlId
      ) {
        this.#clearPearlInteraction(transaction.state, pearl)
      }
    }

    for (const pearl of activePearls) {
      if (
        pearl.activeInteractionId === null ||
        pearl.interactionPartnerId === null ||
        compareStableId(pearl.pearlId, pearl.interactionPartnerId) >= 0
      ) continue
      const partner = pearlsById.get(pearl.interactionPartnerId)
      if (partner === undefined) {
        this.#clearPearlInteraction(transaction.state, pearl)
        continue
      }
      const remainingTicks = Math.min(
        pearl.interactionRemainingTicks,
        partner.interactionRemainingTicks,
      ) - 1
      if (remainingTicks <= 0) {
        this.#clearPearlInteraction(transaction.state, pearl)
      } else {
        pearl.interactionRemainingTicks = remainingTicks
        partner.interactionRemainingTicks = remainingTicks
      }
    }

    if (interactions.length === 0 || activePearls.length < 2) return
    const maximumDistance = Math.max(...interactions.map((interaction) => interaction.distance))
    const grid = new SpatialHashGrid<MutablePearl>(maximumDistance)
    for (const pearl of activePearls) {
      grid.insert({
        id: pearl.pearlId,
        x: pearl.position.x,
        y: pearl.position.y,
        value: pearl,
      })
    }
    const busyPearlIds = new Set(
      activePearls
        .filter((pearl) => pearl.activeInteractionId !== null)
        .map((pearl) => pearl.pearlId),
    )

    for (const pearlA of activePearls) {
      if (busyPearlIds.has(pearlA.pearlId)) continue
      for (const neighbor of grid.query(
        pearlA.position.x,
        pearlA.position.y,
        maximumDistance,
      )) {
        const pearlB = neighbor.value
        if (
          compareStableId(pearlA.pearlId, pearlB.pearlId) >= 0 ||
          busyPearlIds.has(pearlB.pearlId)
        ) continue
        const interaction = interactions.find((candidate) => {
          if (
            transaction.tick < (pearlA.interactionCooldownUntilTicks[candidate.id] ?? 0) ||
            transaction.tick < (pearlB.interactionCooldownUntilTicks[candidate.id] ?? 0)
          ) return false
          const deltaX = pearlB.position.x - pearlA.position.x
          const deltaY = pearlB.position.y - pearlA.position.y
          if (deltaX * deltaX + deltaY * deltaY > candidate.distance * candidate.distance) {
            return false
          }
          return (
            (selectorMatchesPearl(candidate.participantA, pearlA) &&
              selectorMatchesPearl(candidate.participantB, pearlB)) ||
            (selectorMatchesPearl(candidate.participantA, pearlB) &&
              selectorMatchesPearl(candidate.participantB, pearlA))
          )
        })
        if (interaction === undefined) continue
        this.#startInteraction(transaction, interaction, pearlA, pearlB)
        busyPearlIds.add(pearlA.pearlId)
        busyPearlIds.add(pearlB.pearlId)
        break
      }
    }
  }

  #startInteraction(
    transaction: TickTransaction,
    interaction: ExtractionInteractionConfig,
    pearlA: MutablePearl,
    pearlB: MutablePearl,
  ): void {
    let deltaX = pearlB.position.x - pearlA.position.x
    let deltaY = pearlB.position.y - pearlA.position.y
    let distance = Math.hypot(deltaX, deltaY)
    if (distance <= GEOMETRY_EPSILON) {
      const angle =
        seededUnitInterval(
          this.#config.seed,
          `${interaction.id}:${pearlA.pearlId}:${pearlB.pearlId}`,
        ) * Math.PI * 2
      deltaX = Math.cos(angle)
      deltaY = Math.sin(angle)
      distance = 1
    }
    const directionX = deltaX / distance
    const directionY = deltaY / distance
    pearlA.velocity = {
      x: pearlA.velocity.x - directionX * interaction.impulse,
      y: pearlA.velocity.y - directionY * interaction.impulse,
    }
    pearlB.velocity = {
      x: pearlB.velocity.x + directionX * interaction.impulse,
      y: pearlB.velocity.y + directionY * interaction.impulse,
    }
    const durationTicks = Math.max(
      1,
      Math.ceil(interaction.durationSeconds / this.#config.fixedDeltaSeconds),
    )
    const cooldownTicks = Math.ceil(
      interaction.cooldownSeconds / this.#config.fixedDeltaSeconds,
    )
    const cooldownUntilTick = transaction.tick + durationTicks + cooldownTicks
    for (const [pearl, partner] of [
      [pearlA, pearlB],
      [pearlB, pearlA],
    ] as const) {
      pearl.activeInteractionId = interaction.id
      pearl.interactionPartnerId = partner.pearlId
      pearl.interactionStartedTick = transaction.tick
      pearl.interactionRemainingTicks = durationTicks
      pearl.interactionCooldownUntilTicks[interaction.id] = cooldownUntilTick
    }
    transaction.state.interactionCount += 1
    transaction.interactions.push({
      interactionId: interaction.id,
      pearlAId: pearlA.pearlId,
      pearlBId: pearlB.pearlId,
    })
  }

  #clearPearlInteraction(state: MutableSimulationState, pearl: MutablePearl): void {
    const partner =
      pearl.interactionPartnerId === null
        ? undefined
        : state.pearls.find((candidate) => candidate.pearlId === pearl.interactionPartnerId)
    pearl.activeInteractionId = null
    pearl.interactionPartnerId = null
    pearl.interactionStartedTick = null
    pearl.interactionRemainingTicks = 0
    if (partner?.interactionPartnerId === pearl.pearlId) {
      partner.activeInteractionId = null
      partner.interactionPartnerId = null
      partner.interactionStartedTick = null
      partner.interactionRemainingTicks = 0
    }
  }

  #sampleFlow(
    view: FireFlowReadView | null,
    position: ExtractionVector,
  ): Readonly<{ x: number; y: number; intensity: number }> {
    if (view === null) return { x: 0, y: 0, intensity: 0 }
    const column = Math.floor((position.x - view.originX) / view.cellSize)
    const row = Math.floor((position.y - view.originY) / view.cellSize)
    if (column < 0 || row < 0 || column >= view.columns || row >= view.rows) {
      return { x: 0, y: 0, intensity: 0 }
    }
    const index = row * view.columns + column
    return {
      x: view.flowX[index] ?? 0,
      y: view.flowY[index] ?? 0,
      intensity: (view.intensity[index] ?? 0) / 255,
    }
  }

  #applyNaturalLoss(transaction: TickTransaction): void {
    if (
      transaction.domainState.status !== 'extracting' ||
      this.#config.naturalLossRatePerMinute <= 0
    ) return

    type EligibleLoss = {
      readonly stableEntityId: string
      readonly volume: number
      apply(volume: number): void
    }
    const eligible: EligibleLoss[] = []
    for (const material of transaction.state.materials) {
      for (
        let cellIndex = 0;
        cellIndex < material.remainingCellVolumes.length;
        cellIndex += 1
      ) {
        if (material.definition.composition[cellIndex] !== 1) continue
        const volume = material.remainingCellVolumes[cellIndex]!
        if (volume <= 0) continue
        const stableEntityId = `cell:${material.materialInstanceId}:${cellIndex
          .toString()
          .padStart(4, '0')}`
        eligible.push({
          stableEntityId,
          volume,
          apply: (loss) => {
            material.remainingCellVolumes[cellIndex] = Math.max(0, volume - loss)
            transaction.naturalLosses.push({
              sourceKind: 'materialCell',
              stableEntityId,
              materialInstanceId: material.materialInstanceId,
              pearlType: 'medicinalLiquid',
              volume: loss,
            })
          },
        })
      }
    }
    for (const pearl of transaction.state.pearls) {
      if (pearl.state !== 'active' || pearl.pearlType !== 'medicinalLiquid') continue
      const stableEntityId = `pearl:${pearl.pearlId}`
      const volume = pearl.currentVolume
      if (volume <= 0) continue
      eligible.push({
        stableEntityId,
        volume,
        apply: (loss) => {
          pearl.currentVolume = clampVolumeToZero(
            Math.max(0, volume - loss),
            pearl.initialVolume,
          )
          pearl.radius =
            this.#config.pearlPhysics.medicinalLiquid.radiusAtStandardVolume *
            Math.sqrt(pearl.currentVolume / this.#config.standardPearlVolume)
          transaction.naturalLosses.push({
            sourceKind: 'pearl',
            stableEntityId,
            pearlId: pearl.pearlId,
            volume: loss,
          })
          if (pearl.currentVolume === 0) {
            this.#clearPearlInteraction(transaction.state, pearl)
            pearl.state = 'burned'
            transaction.terminals.push({
              pearlId: pearl.pearlId,
              outcome: 'burned',
            })
          }
        },
      })
    }

    eligible.sort((left, right) =>
      compareStableId(left.stableEntityId, right.stableEntityId),
    )
    const eligibleVolume = eligible.reduce((total, item) => total + item.volume, 0)
    let remainingLoss = clamp(
      eligibleVolume *
        this.#config.naturalLossRatePerMinute *
        this.#config.fixedDeltaSeconds /
        60,
      0,
      eligibleVolume,
    )
    let remainingCapacity = eligibleVolume
    for (let index = 0; index < eligible.length; index += 1) {
      const item = eligible[index]!
      const loss =
        index === eligible.length - 1
          ? remainingLoss
          : Math.min(item.volume, remainingLoss * (item.volume / remainingCapacity))
      if (loss > 0) item.apply(loss)
      remainingLoss -= loss
      remainingCapacity -= item.volume
    }
    if (!approximatelyEqual(remainingLoss, 0)) {
      throw new Error('SIM_EXTRACTION_NATURAL_LOSS_ALLOCATION_FAILED')
    }
    for (const material of transaction.state.materials) {
      material.remainingVolume = clampVolumeToZero(
        sumCellVolumes(material.remainingCellVolumes),
        material.initialVolume,
      )
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
      this.#clearPearlInteraction(transaction.state, pearl)
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
