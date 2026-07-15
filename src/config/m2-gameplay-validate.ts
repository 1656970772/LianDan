import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { configIssue, type ConfigIssue } from './errors'
import { deriveBatchTags } from './tag-derivation'
import type {
  M2GameplaySchemaBundle,
  NormalizedM2Collector,
  NormalizedM2FireSource,
  NormalizedM2GameplayConfig,
  NormalizedM2Interaction,
  NormalizedM2PearlType,
  NormalizedM2Prototype,
  RawM2GameplayConfig,
} from './m2-gameplay-model'
import type { NormalizedConfig, RawConfigDocument } from './model'

export type { RawM2GameplayConfig } from './m2-gameplay-model'

export type M2GameplayValidationResult =
  | Readonly<{ ok: true; config: NormalizedM2GameplayConfig }>
  | Readonly<{ ok: false; issues: readonly ConfigIssue[] }>

interface CompiledM2Schemas {
  readonly manifest: ValidateFunction
  readonly prototype: ValidateFunction
  readonly fireSources: ValidateFunction
  readonly pearlTypes: ValidateFunction
  readonly collector: ValidateFunction
  readonly interactions: ValidateFunction
}

interface RawManifest {
  readonly schemaVersion: 1
  readonly baseConfigSet: string
  readonly prototype: string
  readonly fireSources: string
  readonly pearlTypes: string
  readonly collector: string
  readonly interactions?: string
}

interface RawPrototype extends NormalizedM2Prototype {
  readonly schemaVersion: 1
}

interface RawFireSources {
  readonly schemaVersion: 1
  readonly fireSources: readonly NormalizedM2FireSource[]
}

interface RawPearlTypes {
  readonly schemaVersion: 1
  readonly pearlTypes: readonly NormalizedM2PearlType[]
}

interface RawCollector extends NormalizedM2Collector {
  readonly schemaVersion: 1
}

interface RawInteractions {
  readonly schemaVersion: 1
  readonly interactions: readonly NormalizedM2Interaction[]
}

function compileSchemas(schemas: M2GameplaySchemaBundle): CompiledM2Schemas {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    validateSchema: true,
  })
  return {
    manifest: ajv.compile(schemas.manifest),
    prototype: ajv.compile(schemas.prototype),
    fireSources: ajv.compile(schemas.fireSources),
    pearlTypes: ajv.compile(schemas.pearlTypes),
    collector: ajv.compile(schemas.collector),
    interactions: ajv.compile(schemas.interactions),
  }
}

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function schemaIssue(filePath: string, error: ErrorObject): ConfigIssue {
  let fieldPath = error.instancePath
  if (error.keyword === 'required') {
    fieldPath = `${fieldPath}/${escapePointerSegment(String(error.params.missingProperty))}`
  } else if (
    error.keyword === 'additionalProperties' ||
    error.keyword === 'unevaluatedProperties'
  ) {
    fieldPath = `${fieldPath}/${escapePointerSegment(String(error.params.additionalProperty))}`
  }

  const code =
    error.keyword === 'required'
      ? 'CONFIG_REQUIRED_FIELD'
      : error.keyword === 'additionalProperties' ||
          error.keyword === 'unevaluatedProperties'
        ? 'CONFIG_UNKNOWN_FIELD'
        : error.keyword === 'type'
          ? 'CONFIG_INVALID_TYPE'
          : error.keyword === 'minimum' ||
              error.keyword === 'maximum' ||
              error.keyword === 'exclusiveMinimum' ||
              error.keyword === 'exclusiveMaximum'
            ? 'CONFIG_VALUE_OUT_OF_RANGE'
            : error.keyword === 'const' && fieldPath === '/schemaVersion'
              ? 'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
              : 'CONFIG_SCHEMA_VIOLATION'
  return configIssue(
    code,
    filePath,
    fieldPath,
    `M2 gameplay 配置不符合 Schema：${error.message ?? error.keyword}`,
  )
}

function validateDocument(
  document: RawConfigDocument,
  validator: ValidateFunction,
): ConfigIssue[] {
  if (validator(document.value)) return []
  return (validator.errors ?? []).map((error) => schemaIssue(document.filePath, error))
}

export function validateM2GameplayManifest(
  document: RawConfigDocument,
  schemas: M2GameplaySchemaBundle,
): readonly ConfigIssue[] {
  return validateDocument(document, compileSchemas(schemas).manifest)
}

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  if (visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

function semanticIssue(
  filePath: string,
  fieldPath: string,
  messageZh: string,
): ConfigIssue {
  return configIssue('CONFIG_SCHEMA_VIOLATION', filePath, fieldPath, messageZh)
}

function normalizedRotationDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function collectSemanticIssues(
  raw: RawM2GameplayConfig,
  baseConfig: NormalizedConfig,
  baseConfigSetPath: string,
): ConfigIssue[] {
  const manifest = raw.manifest.value as RawManifest
  const prototype = raw.prototype.value as RawPrototype
  const fireDocument = raw.fireSources.value as RawFireSources
  const pearlDocument = raw.pearlTypes.value as RawPearlTypes
  const collector = raw.collector.value as RawCollector
  const interactionDocument = raw.interactions?.value as RawInteractions | undefined
  const issues: ConfigIssue[] = []

  const referencedDocuments = [
    ['baseConfigSet', manifest.baseConfigSet, baseConfigSetPath],
    ['prototype', manifest.prototype, raw.prototype.filePath],
    ['fireSources', manifest.fireSources, raw.fireSources.filePath],
    ['pearlTypes', manifest.pearlTypes, raw.pearlTypes.filePath],
    ['collector', manifest.collector, raw.collector.filePath],
  ] as const
  for (const [field, referenced, loaded] of referencedDocuments) {
    if (referenced !== loaded) {
      issues.push(
        configIssue(
          'CONFIG_REFERENCE_NOT_FOUND',
          raw.manifest.filePath,
          `/${field}`,
          `找不到已登记的 M2 配置 ${referenced}`,
        ),
      )
    }
  }
  if (
    manifest.interactions !== undefined &&
    manifest.interactions !== raw.interactions?.filePath
  ) {
    issues.push(
      configIssue(
        'CONFIG_REFERENCE_NOT_FOUND',
        raw.manifest.filePath,
        '/interactions',
        `找不到已登记的 M2 配置 ${manifest.interactions}`,
      ),
    )
  } else if (manifest.interactions === undefined && raw.interactions !== undefined) {
    issues.push(
      configIssue(
        'CONFIG_UNREGISTERED_DOCUMENT',
        raw.interactions.filePath,
        '',
        '互动配置未在 m2-config-set.json 中登记',
      ),
    )
  }

  const materialIds = new Set(baseConfig.materials.map(({ id }) => id))
  const batchIds = new Set<string>()
  prototype.inventoryBatches.forEach((batch, index) => {
    if (batchIds.has(batch.batchId)) {
      issues.push(
        configIssue(
          'CONFIG_DUPLICATE_LOGICAL_KEY',
          raw.prototype.filePath,
          `/inventoryBatches/${index}/batchId`,
          `库存批次稳定 ID ${batch.batchId} 重复`,
        ),
      )
    }
    batchIds.add(batch.batchId)
    if (!materialIds.has(batch.materialDefinitionId)) {
      issues.push(
        configIssue(
          'CONFIG_REFERENCE_NOT_FOUND',
          raw.prototype.filePath,
          `/inventoryBatches/${index}/materialDefinitionId`,
          `找不到材料稳定 ID ${batch.materialDefinitionId}`,
        ),
      )
    }
    const stateFields = [
      batch.preservationStateId,
      batch.growthSourceId,
      batch.ageYears,
    ]
    const definedStateFieldCount = stateFields.filter(
      (value) => value !== undefined,
    ).length
    if (definedStateFieldCount !== 0 && definedStateFieldCount !== stateFields.length) {
      issues.push(
        semanticIssue(
          raw.prototype.filePath,
          `/inventoryBatches/${index}`,
          '库存批次状态必须同时配置保存状态、生长来源和年份',
        ),
      )
    } else if (definedStateFieldCount === stateFields.length) {
      const material = baseConfig.materials.find(
        (candidate) => candidate.id === batch.materialDefinitionId,
      )
      if (material !== undefined && baseConfig.tags !== undefined) {
        const derived = deriveBatchTags(baseConfig.tags, material, {
          preservationStateId: batch.preservationStateId!,
          growthSourceId: batch.growthSourceId!,
          ageYears: batch.ageYears!,
        })
        if (!derived.ok) {
          issues.push(
            configIssue(
              'CONFIG_REFERENCE_NOT_FOUND',
              raw.prototype.filePath,
              `/inventoryBatches/${index}/${derived.missing}`,
              `找不到库存状态派生规则 ${derived.value}`,
            ),
          )
        }
      } else if (material !== undefined) {
        issues.push(
          configIssue(
            'CONFIG_REFERENCE_NOT_FOUND',
            raw.prototype.filePath,
            `/inventoryBatches/${index}`,
            '库存批次状态需要已登记的 tags.json 派生规则',
          ),
        )
      }
    }
  })

  const fireSourceIds = new Set<string>()
  fireDocument.fireSources.forEach((source, index) => {
    if (fireSourceIds.has(source.id)) {
      issues.push(
        configIssue(
          'CONFIG_DUPLICATE_LOGICAL_KEY',
          raw.fireSources.filePath,
          `/fireSources/${index}/id`,
          `火种稳定 ID ${source.id} 重复`,
        ),
      )
    }
    fireSourceIds.add(source.id)
    if (source.minWidth > source.maxWidth) {
      issues.push(
        semanticIssue(
          raw.fireSources.filePath,
          `/fireSources/${index}/minWidth`,
          '火种最小宽度不得大于最大宽度',
        ),
      )
    }
    if (
      source.origin.x > prototype.logicalWidth ||
      source.origin.y > prototype.logicalHeight
    ) {
      issues.push(
        semanticIssue(
          raw.fireSources.filePath,
          `/fireSources/${index}/origin`,
          '火源位置必须位于 M2 逻辑场景内',
        ),
      )
    }
  })
  prototype.availableFireSourceIds.forEach((id, index) => {
    if (!fireSourceIds.has(id)) {
      issues.push(
        configIssue(
          'CONFIG_REFERENCE_NOT_FOUND',
          raw.prototype.filePath,
          `/availableFireSourceIds/${index}`,
          `找不到火种稳定 ID ${id}`,
        ),
      )
    }
  })

  const placement = prototype.materialPlacement
  const materialInstanceCount = prototype.inventoryBatches.reduce(
    (total, batch) => total + batch.servings,
    0,
  )
  let placementOutsideScene = false
  let duplicatePlacement = false
  const placementTransforms: Array<
    Readonly<{ center: Readonly<{ x: number; y: number }>; rotationDegrees: number }>
  > = []
  for (let layer = 0; layer < materialInstanceCount; layer += 1) {
    const center = {
      x: placement.centerX + placement.offsetPerInstance.x * layer,
      y: placement.centerY + placement.offsetPerInstance.y * layer,
    }
    const rotationDegrees = normalizedRotationDegrees(
      placement.rotationDegreesPerInstance * layer,
    )
    const rotation = (rotationDegrees * Math.PI) / 180
    const halfExtent =
      placement.size * 0.5 * (Math.abs(Math.cos(rotation)) + Math.abs(Math.sin(rotation)))
    if (
      center.x - halfExtent < 0 ||
      center.x + halfExtent > prototype.logicalWidth ||
      center.y - halfExtent < 0 ||
      center.y + halfExtent > prototype.logicalHeight
    ) {
      placementOutsideScene = true
      break
    }
    if (
      placementTransforms.some(
        (previous) =>
          Math.abs(previous.center.x - center.x) <= 1e-9 &&
          Math.abs(previous.center.y - center.y) <= 1e-9 &&
          Math.abs(previous.rotationDegrees - rotationDegrees) <= 1e-9,
      )
    ) duplicatePlacement = true
    placementTransforms.push({ center, rotationDegrees })
  }
  if (placementOutsideScene) {
    issues.push(
      semanticIssue(
        raw.prototype.filePath,
        '/materialPlacement',
        '材料摆放区域必须完整位于 M2 逻辑场景内',
      ),
    )
  }
  if (duplicatePlacement) {
    issues.push(
      semanticIssue(
        raw.prototype.filePath,
        '/materialPlacement/offsetPerInstance',
        '多份材料的配置化摆放不得使用完全相同的位置与旋转',
      ),
    )
  }

  const direction = prototype.initialFireDirection
  if (Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-9 || direction.y >= 0) {
    issues.push(
      semanticIssue(
        raw.prototype.filePath,
        '/initialFireDirection',
        '初始火焰方向必须是朝上的单位向量',
      ),
    )
  }

  const requiredPearlTypes = new Set(['medicinalLiquid', 'slag', 'impurity'])
  const seenPearlTypes = new Set<string>()
  pearlDocument.pearlTypes.forEach((pearlType, index) => {
    if (seenPearlTypes.has(pearlType.pearlType)) {
      issues.push(
        semanticIssue(
          raw.pearlTypes.filePath,
          `/pearlTypes/${index}/pearlType`,
          `精灵珠类型 ${pearlType.pearlType} 不得重复`,
        ),
      )
    }
    seenPearlTypes.add(pearlType.pearlType)
    if (
      pearlType.spawnVelocity.minX > pearlType.spawnVelocity.maxX ||
      pearlType.spawnVelocity.minY > pearlType.spawnVelocity.maxY
    ) {
      issues.push(
        semanticIssue(
          raw.pearlTypes.filePath,
          `/pearlTypes/${index}/spawnVelocity`,
          '精灵珠生成速度最小值不得大于最大值',
        ),
      )
    }
  })
  for (const pearlType of requiredPearlTypes) {
    if (!seenPearlTypes.has(pearlType)) {
      issues.push(
        semanticIssue(
          raw.pearlTypes.filePath,
          '/pearlTypes',
          `三类精灵珠配置缺少 ${pearlType}`,
        ),
      )
    }
  }

  const collectorHalfWidth = collector.width * 0.5
  const collectorHalfHeight = collector.height * 0.5
  if (collector.minX > collector.maxX) {
    issues.push(
      semanticIssue(
        raw.collector.filePath,
        '/minX',
        '接液容器轨道左端不得大于右端',
      ),
    )
  }
  if (collector.initialX < collector.minX || collector.initialX > collector.maxX) {
    issues.push(
      semanticIssue(
        raw.collector.filePath,
        '/initialX',
        '接液容器初始位置必须位于轨道范围内',
      ),
    )
  }
  if (collector.minX - collectorHalfWidth < 0) {
    issues.push(
      semanticIssue(
        raw.collector.filePath,
        '/minX',
        '接液容器位于轨道左端时必须完整处于 M2 逻辑场景内',
      ),
    )
  }
  if (collector.maxX + collectorHalfWidth > prototype.logicalWidth) {
    issues.push(
      semanticIssue(
        raw.collector.filePath,
        '/maxX',
        '接液容器位于轨道右端时必须完整处于 M2 逻辑场景内',
      ),
    )
  }
  if (
    collector.y - collectorHalfHeight < 0 ||
    collector.y + collectorHalfHeight > prototype.logicalHeight
  ) {
    issues.push(
      semanticIssue(
        raw.collector.filePath,
        '/y',
        '接液容器纵向范围必须完整处于 M2 逻辑场景内',
      ),
    )
  }

  const tagIds = new Set(baseConfig.tags?.definitions.map((tag) => tag.id) ?? [])
  const interactionIds = new Set<string>()
  interactionDocument?.interactions.forEach((interaction, interactionIndex) => {
    if (interactionIds.has(interaction.id)) {
      issues.push(
        configIssue(
          'CONFIG_DUPLICATE_LOGICAL_KEY',
          raw.interactions!.filePath,
          `/interactions/${interactionIndex}/id`,
          `互动稳定 ID ${interaction.id} 重复`,
        ),
      )
    }
    interactionIds.add(interaction.id)
    for (const [participantName, selector] of [
      ['participantA', interaction.participantA],
      ['participantB', interaction.participantB],
    ] as const) {
      ;(selector.materialDefinitionIds ?? []).forEach((materialId, index) => {
        if (!materialIds.has(materialId)) {
          issues.push(
            configIssue(
              'CONFIG_REFERENCE_NOT_FOUND',
              raw.interactions!.filePath,
              `/interactions/${interactionIndex}/${participantName}/materialDefinitionIds/${index}`,
              `找不到互动材料稳定 ID ${materialId}`,
            ),
          )
        }
      })
      ;(selector.requiredTagIds ?? []).forEach((tagId, index) => {
        if (!tagIds.has(tagId)) {
          issues.push(
            configIssue(
              'CONFIG_REFERENCE_NOT_FOUND',
              raw.interactions!.filePath,
              `/interactions/${interactionIndex}/${participantName}/requiredTagIds/${index}`,
              `找不到互动标签稳定 ID ${tagId}`,
            ),
          )
        }
      })
    }
  })

  return issues
}

function normalize(
  raw: RawM2GameplayConfig,
  baseConfig: NormalizedConfig,
): NormalizedM2GameplayConfig {
  const prototype = raw.prototype.value as RawPrototype
  const fireSources = raw.fireSources.value as RawFireSources
  const pearlTypes = raw.pearlTypes.value as RawPearlTypes
  const collector = raw.collector.value as RawCollector
  const interactions = raw.interactions?.value as RawInteractions | undefined
  return deepFreeze({
    schemaVersion: 1,
    prototype: {
      seed: prototype.seed,
      logicalWidth: prototype.logicalWidth,
      logicalHeight: prototype.logicalHeight,
      materialPlacement: {
        ...prototype.materialPlacement,
        offsetPerInstance: { ...prototype.materialPlacement.offsetPerInstance },
      },
      availableFireSourceIds: [...prototype.availableFireSourceIds],
      initialFireSize: prototype.initialFireSize,
      fireSizeWheelStep: prototype.fireSizeWheelStep,
      initialFireDirection: { ...prototype.initialFireDirection },
      theme: {
        colors: { ...prototype.theme.colors },
        radius: prototype.theme.radius,
      },
      inventoryBatches: prototype.inventoryBatches.map((batch) => {
        const material = baseConfig.materials.find(
          (candidate) => candidate.id === batch.materialDefinitionId,
        )
        const hasState =
          batch.preservationStateId !== undefined &&
          batch.growthSourceId !== undefined &&
          batch.ageYears !== undefined
        const derived =
          hasState && material !== undefined && baseConfig.tags !== undefined
            ? deriveBatchTags(baseConfig.tags, material, {
                preservationStateId: batch.preservationStateId!,
                growthSourceId: batch.growthSourceId!,
                ageYears: batch.ageYears!,
              })
            : null
        return {
          ...batch,
          tags: derived?.ok === true ? derived.tags.map((tag) => ({ ...tag })) : [],
        }
      }),
    },
    fireSources: fireSources.fireSources
      .filter((source) => prototype.availableFireSourceIds.includes(source.id))
      .map((source) => ({
        ...source,
        origin: { ...source.origin },
      })),
    pearlTypes: pearlTypes.pearlTypes.map((pearlType) => ({
      ...pearlType,
      spawnVelocity: { ...pearlType.spawnVelocity },
    })),
    collector: {
      initialX: collector.initialX,
      y: collector.y,
      width: collector.width,
      height: collector.height,
      minX: collector.minX,
      maxX: collector.maxX,
      acceleration: collector.acceleration,
      deceleration: collector.deceleration,
      maxSpeed: collector.maxSpeed,
    },
    interactions: (interactions?.interactions ?? []).map((interaction) => ({
      ...interaction,
      participantA: {
        materialDefinitionIds: [
          ...(interaction.participantA.materialDefinitionIds ?? []),
        ],
        requiredTagIds: [...(interaction.participantA.requiredTagIds ?? [])],
        pearlTypes: [...(interaction.participantA.pearlTypes ?? [])],
      },
      participantB: {
        materialDefinitionIds: [
          ...(interaction.participantB.materialDefinitionIds ?? []),
        ],
        requiredTagIds: [...(interaction.participantB.requiredTagIds ?? [])],
        pearlTypes: [...(interaction.participantB.pearlTypes ?? [])],
      },
    })),
  })
}

export function validateAndNormalizeM2GameplayConfig(
  raw: RawM2GameplayConfig,
  schemas: M2GameplaySchemaBundle,
  baseConfig: NormalizedConfig,
  baseConfigSetPath: string,
): M2GameplayValidationResult {
  const compiled = compileSchemas(schemas)
  const schemaIssues = [
    ...validateDocument(raw.manifest, compiled.manifest),
    ...validateDocument(raw.prototype, compiled.prototype),
    ...validateDocument(raw.fireSources, compiled.fireSources),
    ...validateDocument(raw.pearlTypes, compiled.pearlTypes),
    ...validateDocument(raw.collector, compiled.collector),
    ...(raw.interactions === undefined
      ? []
      : validateDocument(raw.interactions, compiled.interactions)),
  ]
  if (schemaIssues.length > 0) return { ok: false, issues: schemaIssues }

  const semanticIssues = collectSemanticIssues(raw, baseConfig, baseConfigSetPath)
  if (semanticIssues.length > 0) return { ok: false, issues: semanticIssues }
  return { ok: true, config: normalize(raw, baseConfig) }
}
