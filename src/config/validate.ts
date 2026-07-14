import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js'

import { configIssue, type ConfigIssue } from './errors'
import type {
  ConfigSchemaBundle,
  JsonSchema,
  NormalizedConfig,
  NormalizedMaterial,
  RawConfigDocument,
  RawConfigSet,
} from './model'

export type { RawConfigSet } from './model'

export type ConfigValidationResult =
  | { readonly ok: true; readonly config: NormalizedConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }

const ANNOTATION_KEYWORDS = [
  'x-owner',
  'x-defaultMultiplier',
  'x-displayNameZh',
  'x-simulation',
]

interface CompiledSchemas {
  readonly configSet: ValidateFunction
  readonly parameters: ValidateFunction
  readonly material: ValidateFunction
}

interface RawManifest {
  readonly schemaVersion: 1
  readonly parameters: string
  readonly materials: string[]
}

interface RawParameters {
  readonly schemaVersion: 1
  readonly standardPearlVolume?: number
  readonly slagUnitVolume?: number
  readonly simulation?: Readonly<{
    readonly fixedStepHz?: number
    readonly maxCatchUpSteps?: number
  }>
  readonly flowField?: Readonly<{
    readonly gridColumns?: number
    readonly gridRows?: number
    readonly cellSize?: number
    readonly circleCoverageSamplesPerAxis?: number
    readonly lateralSpread?: number
    readonly obstacleDeflection?: number
    readonly partialObstaclePenalty?: number
    readonly mergeRate?: number
    readonly fullObstacleThreshold?: number
  }>
}

interface RawMaterial {
  readonly schemaVersion: 1
  readonly id: string
  readonly nameZh: string
  readonly targetPearlCount?: number
  readonly compositionMapPath: string
}

function compileSchemas(schemas: ConfigSchemaBundle): CompiledSchemas {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    validateSchema: true,
  })
  ajv.addVocabulary(ANNOTATION_KEYWORDS)
  return {
    configSet: ajv.compile(schemas.configSet),
    parameters: ajv.compile(schemas.parameters),
    material: ajv.compile(schemas.material),
  }
}

function joinFieldPath(basePath: string, propertyName: string): string {
  const escaped = propertyName.replaceAll('~', '~0').replaceAll('/', '~1')
  return `${basePath}/${escaped}`
}

function rangeMessage(fieldPath: string): string | undefined {
  if (fieldPath === '/standardPearlVolume') return '标准珠体积必须是有限正数'
  if (fieldPath === '/slagUnitVolume') return '药渣单位体积必须是有限正数'
  if (fieldPath === '/targetPearlCount') return '目标珠数必须是 1..100000 的整数'
  if (fieldPath === '/simulation/fixedStepHz') return '固定模拟频率必须是 1..240 的整数'
  if (fieldPath === '/simulation/maxCatchUpSteps') return '单帧最大补步数必须是 1..60 的整数'
  if (fieldPath === '/flowField/gridColumns') return '流场网格列数必须是 8..512 的整数'
  if (fieldPath === '/flowField/gridRows') return '流场网格行数必须是 8..512 的整数'
  if (fieldPath === '/flowField/cellSize') return '流场网格单元尺寸必须在 1..256 之间'
  if (fieldPath === '/flowField/circleCoverageSamplesPerAxis') {
    return '圆形障碍每轴覆盖采样数必须是 1..8 的整数'
  }
  if (fieldPath === '/flowField/fullObstacleThreshold') {
    return '完全障碍判定阈值必须在 (0, 1] 之间'
  }
  if (fieldPath.startsWith('/flowField/')) return '流场系数必须在 0..1 之间'
  return undefined
}

function issueFromAjvError(filePath: string, error: ErrorObject): ConfigIssue {
  let fieldPath = error.instancePath
  if (error.keyword === 'required') {
    fieldPath = joinFieldPath(fieldPath, String(error.params.missingProperty))
    return configIssue(
      'CONFIG_REQUIRED_FIELD',
      filePath,
      fieldPath,
      `配置缺少必填字段 ${fieldPath}`,
    )
  }
  if (error.keyword === 'additionalProperties') {
    fieldPath = joinFieldPath(fieldPath, String(error.params.additionalProperty))
    return configIssue(
      'CONFIG_UNKNOWN_FIELD',
      filePath,
      fieldPath,
      `配置包含不允许的字段 ${fieldPath}`,
    )
  }
  if (error.keyword === 'const' && fieldPath === '/schemaVersion') {
    return configIssue(
      'CONFIG_SCHEMA_VERSION_UNSUPPORTED',
      filePath,
      fieldPath,
      '仅支持 schemaVersion=1，不会猜测兼容更高版本',
    )
  }

  const numericRangeMessage = rangeMessage(fieldPath)
  if (
    numericRangeMessage !== undefined &&
    ['exclusiveMinimum', 'minimum', 'maximum', 'multipleOf', 'type'].includes(error.keyword)
  ) {
    return configIssue(
      'CONFIG_VALUE_OUT_OF_RANGE',
      filePath,
      fieldPath,
      numericRangeMessage,
    )
  }
  if (error.keyword === 'type') {
    return configIssue(
      'CONFIG_INVALID_TYPE',
      filePath,
      fieldPath,
      `配置字段 ${fieldPath || '/'} 的类型不正确`,
    )
  }
  if (['exclusiveMinimum', 'minimum', 'maximum'].includes(error.keyword)) {
    return configIssue(
      'CONFIG_VALUE_OUT_OF_RANGE',
      filePath,
      fieldPath,
      `配置字段 ${fieldPath || '/'} 超出允许范围`,
    )
  }
  return configIssue(
    'CONFIG_SCHEMA_VIOLATION',
    filePath,
    fieldPath,
    `配置字段 ${fieldPath || '/'} 不符合 Schema：${error.keyword}`,
  )
}

function validateDocument(
  document: RawConfigDocument,
  validator: ValidateFunction,
): ConfigIssue[] {
  if (validator(document.value)) return []
  return (validator.errors ?? []).map((error) =>
    issueFromAjvError(document.filePath, error),
  )
}

export function validateConfigSetManifest(
  document: RawConfigDocument,
  schemas: ConfigSchemaBundle,
): readonly ConfigIssue[] {
  return validateDocument(document, compileSchemas(schemas).configSet)
}

function propertySchema(schema: JsonSchema, ...propertyPath: string[]): JsonSchema {
  let current = schema
  for (const propertyName of propertyPath) {
    const properties = current.properties
    if (
      properties === null ||
      typeof properties !== 'object' ||
      Array.isArray(properties)
    ) {
      throw new Error(`Schema 路径 ${propertyPath.join('.')} 的 properties 缺失`)
    }
    const property = (properties as Record<string, unknown>)[propertyName]
    if (
      property === null ||
      typeof property !== 'object' ||
      Array.isArray(property)
    ) {
      throw new Error(`Schema 字段 ${propertyPath.join('.')} 缺失`)
    }
    current = property as JsonSchema
  }
  return current
}

function staticNumberDefault(schema: JsonSchema, ...propertyPath: string[]): number {
  const value = propertySchema(schema, ...propertyPath).default
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Schema 字段 ${propertyPath.join('.')} 缺少有限数字 default`)
  }
  return value
}

function multipliedNumberDefault(
  schema: JsonSchema,
  propertyName: string,
  values: Readonly<Record<string, number>>,
): number {
  const annotation = propertySchema(schema, propertyName)['x-defaultMultiplier']
  if (annotation === null || typeof annotation !== 'object' || Array.isArray(annotation)) {
    throw new Error(`Schema 字段 ${propertyName} 缺少 x-defaultMultiplier`)
  }
  const source = (annotation as Record<string, unknown>).source
  const factor = (annotation as Record<string, unknown>).factor
  if (typeof source !== 'string' || typeof factor !== 'number' || !Number.isFinite(factor)) {
    throw new Error(`Schema 字段 ${propertyName} 的 x-defaultMultiplier 无效`)
  }
  const sourceValue = values[source]
  if (sourceValue === undefined) {
    throw new Error(`Schema 字段 ${propertyName} 引用未标准化的字段 ${source}`)
  }
  return sourceValue * factor
}

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  if (visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

function referenceIssues(raw: RawConfigSet): ConfigIssue[] {
  const manifest = raw.configSet.value as RawManifest
  const issues: ConfigIssue[] = []

  if (manifest.parameters !== raw.parameters.filePath) {
    issues.push(
      configIssue(
        'CONFIG_REFERENCE_NOT_FOUND',
        raw.configSet.filePath,
        '/parameters',
        `找不到已登记的参数配置 ${manifest.parameters}`,
      ),
    )
  }

  const materialsByPath = new Map(raw.materials.map((document) => [document.filePath, document]))
  const registeredPaths = new Set(manifest.materials)
  manifest.materials.forEach((filePath, index) => {
    if (!materialsByPath.has(filePath)) {
      issues.push(
        configIssue(
          'CONFIG_REFERENCE_NOT_FOUND',
          raw.configSet.filePath,
          `/materials/${index}`,
          `找不到已登记的材料配置 ${filePath}`,
        ),
      )
    }
  })
  raw.materials.forEach((document) => {
    if (!registeredPaths.has(document.filePath)) {
      issues.push(
        configIssue(
          'CONFIG_UNREGISTERED_DOCUMENT',
          document.filePath,
          '',
          '材料配置未在 config-set.json 中登记',
        ),
      )
    }
  })

  const firstPathById = new Map<string, string>()
  raw.materials.forEach((document) => {
    const material = document.value as RawMaterial
    const existingPath = firstPathById.get(material.id)
    if (existingPath !== undefined) {
      issues.push(
        configIssue(
          'CONFIG_DUPLICATE_LOGICAL_KEY',
          document.filePath,
          '/id',
          `材料稳定 ID ${material.id} 已由 ${existingPath} 定义`,
        ),
      )
    } else {
      firstPathById.set(material.id, document.filePath)
    }
  })
  return issues
}

function normalize(raw: RawConfigSet, schemas: ConfigSchemaBundle): NormalizedConfig {
  const parameters = raw.parameters.value as RawParameters
  const standardPearlVolume =
    parameters.standardPearlVolume ??
    staticNumberDefault(schemas.parameters, 'standardPearlVolume')
  const slagUnitVolume =
    parameters.slagUnitVolume ??
    multipliedNumberDefault(schemas.parameters, 'slagUnitVolume', {
      standardPearlVolume,
    })
  const simulation = {
    fixedStepHz:
      parameters.simulation?.fixedStepHz ??
      staticNumberDefault(schemas.parameters, 'simulation', 'fixedStepHz'),
    maxCatchUpSteps:
      parameters.simulation?.maxCatchUpSteps ??
      staticNumberDefault(schemas.parameters, 'simulation', 'maxCatchUpSteps'),
  }
  const flowField = {
    gridColumns:
      parameters.flowField?.gridColumns ??
      staticNumberDefault(schemas.parameters, 'flowField', 'gridColumns'),
    gridRows:
      parameters.flowField?.gridRows ??
      staticNumberDefault(schemas.parameters, 'flowField', 'gridRows'),
    cellSize:
      parameters.flowField?.cellSize ??
      staticNumberDefault(schemas.parameters, 'flowField', 'cellSize'),
    circleCoverageSamplesPerAxis:
      parameters.flowField?.circleCoverageSamplesPerAxis ??
      staticNumberDefault(
        schemas.parameters,
        'flowField',
        'circleCoverageSamplesPerAxis',
      ),
    lateralSpread:
      parameters.flowField?.lateralSpread ??
      staticNumberDefault(schemas.parameters, 'flowField', 'lateralSpread'),
    obstacleDeflection:
      parameters.flowField?.obstacleDeflection ??
      staticNumberDefault(schemas.parameters, 'flowField', 'obstacleDeflection'),
    partialObstaclePenalty:
      parameters.flowField?.partialObstaclePenalty ??
      staticNumberDefault(
        schemas.parameters,
        'flowField',
        'partialObstaclePenalty',
      ),
    mergeRate:
      parameters.flowField?.mergeRate ??
      staticNumberDefault(schemas.parameters, 'flowField', 'mergeRate'),
    fullObstacleThreshold:
      parameters.flowField?.fullObstacleThreshold ??
      staticNumberDefault(
        schemas.parameters,
        'flowField',
        'fullObstacleThreshold',
      ),
  }

  const materials: NormalizedMaterial[] = raw.materials.map((document) => {
    const material = document.value as RawMaterial
    return {
      id: material.id,
      nameZh: material.nameZh,
      targetPearlCount:
        material.targetPearlCount ??
        staticNumberDefault(schemas.material, 'targetPearlCount'),
      compositionMapPath: material.compositionMapPath,
    }
  })

  return deepFreeze({
    schemaVersion: 1,
    parameters: { standardPearlVolume, slagUnitVolume, simulation, flowField },
    materials,
  })
}

export function validateAndNormalizeConfigSet(
  raw: RawConfigSet,
  schemas: ConfigSchemaBundle,
): ConfigValidationResult {
  const compiled = compileSchemas(schemas)
  const schemaIssues = [
    ...validateDocument(raw.configSet, compiled.configSet),
    ...validateDocument(raw.parameters, compiled.parameters),
    ...raw.materials.flatMap((document) =>
      validateDocument(document, compiled.material),
    ),
  ]
  if (schemaIssues.length > 0) return { ok: false, issues: schemaIssues }

  const semanticIssues = referenceIssues(raw)
  if (semanticIssues.length > 0) return { ok: false, issues: semanticIssues }

  const config = normalize(raw, schemas)
  if (!Number.isFinite(config.parameters.standardPearlVolume)) {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_VALUE_OUT_OF_RANGE',
          raw.parameters.filePath,
          '/standardPearlVolume',
          '标准珠体积必须是有限正数',
        ),
      ],
    }
  }
  if (!Number.isFinite(config.parameters.slagUnitVolume)) {
    return {
      ok: false,
      issues: [
        configIssue(
          'CONFIG_VALUE_OUT_OF_RANGE',
          raw.parameters.filePath,
          '/slagUnitVolume',
          '药渣单位体积必须是有限正数',
        ),
      ],
    }
  }

  return { ok: true, config }
}
