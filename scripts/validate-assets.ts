import { fileURLToPath } from 'node:url'
import { type ConfigIssue } from '../src/config/errors'
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

  const appearancePaths = new Set(
    m2Result.config.base.materials.flatMap((material) =>
      material.appearancePath === undefined ? [] : [material.appearancePath],
    ),
  )

  console.log(
    `素材校验通过：${m2Result.compositionMaps.length} 张已登记成分图、${appearancePaths.size} 张材料外观图，simulationContentFingerprint=${m2Result.simulationContentFingerprint}`,
  )
}

void main(projectRootFromArguments(process.argv.slice(2)))
