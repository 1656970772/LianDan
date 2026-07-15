import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

import {
  validateAppearancePngHeader,
  validateM2AppearanceMap,
} from '../src/config/assets'
import { type ConfigIssue, configIssue } from '../src/config/errors'
import { resolvePublicUrl } from '../src/config/node-loader'
import { loadAndValidatePublicM2GameplayConfig } from '../src/config/node-m2-gameplay-loader'

const defaultProjectRoot = fileURLToPath(new URL('..', import.meta.url))

function printIssues(issues: readonly ConfigIssue[]): void {
  for (const issue of issues) {
    console.error(`${issue.code} ${issue.filePath}${issue.fieldPath}: ${issue.messageZh}`)
  }
}

function projectRootFromArguments(arguments_: readonly string[]): string {
  const optionIndex = arguments_.indexOf('--project-root')
  if (optionIndex < 0) return defaultProjectRoot
  const value = arguments_[optionIndex + 1]
  if (value === undefined || value.length === 0) {
    throw new Error('ASSET_VALIDATION_PROJECT_ROOT_REQUIRED')
  }
  return value
}

async function main(projectRoot: string): Promise<void> {
  const m2Result = await loadAndValidatePublicM2GameplayConfig(projectRoot)
  if (!m2Result.ok) {
    printIssues(m2Result.issues)
    process.exitCode = 1
    return
  }

  const issues: ConfigIssue[] = []
  const materialsById = new Map(
    m2Result.config.base.materials.map((material) => [material.id, material]),
  )
  const requiredAppearanceMaterialIds = new Set(
    m2Result.config.gameplay.prototype.inventoryBatches.map(
      ({ materialDefinitionId }) => materialDefinitionId,
    ),
  )
  for (const materialId of requiredAppearanceMaterialIds) {
    const material = materialsById.get(materialId)!
    if (material.appearancePath === undefined) {
      issues.push(
        configIssue(
          'CONFIG_REQUIRED_FIELD',
          '/config/m2/prototype.json',
          '/inventoryBatches',
          `M2 库存材料 ${materialId} 必须登记 512×512 外观图`,
        ),
      )
    }
  }

  const appearanceMaterials = m2Result.config.base.materials.filter(
    (material): material is typeof material & { readonly appearancePath: string } =>
      material.appearancePath !== undefined,
  )
  const appearancePaths = new Set(
    appearanceMaterials.map((material) => material.appearancePath),
  )
  const compositionByPath = new Map(
    m2Result.compositionMaps.map((map) => [map.filePath, map] as const),
  )
  for (const material of appearanceMaterials) {
    const filePath = material.appearancePath
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(resolvePublicUrl(projectRoot, filePath)))
    } catch {
      issues.push(
        configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', '已登记的材料外观图文件不存在'),
      )
      continue
    }
    const headerIssues = validateAppearancePngHeader(filePath, bytes)
    if (headerIssues.length > 0) {
      issues.push(...headerIssues)
      continue
    }
    try {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      const composition = compositionByPath.get(material.compositionMapPath)!
      issues.push(
        ...validateM2AppearanceMap(
          {
            filePath,
            width: decoded.width,
            height: decoded.height,
            rgba: Uint8Array.from(decoded.data),
          },
          composition,
        ),
      )
    } catch {
      issues.push(
        configIssue(
          'CONFIG_ASSET_INVALID_PNG',
          filePath,
          '',
          '已登记的材料外观图 PNG 解码失败',
        ),
      )
    }
  }

  if (issues.length > 0) {
    printIssues(issues)
    process.exitCode = 1
    return
  }

  console.log(
    `素材校验通过：${m2Result.compositionMaps.length} 张已登记成分图、${appearancePaths.size} 张材料外观图，simulationContentFingerprint=${m2Result.simulationContentFingerprint}`,
  )
}

void main(projectRootFromArguments(process.argv.slice(2)))
