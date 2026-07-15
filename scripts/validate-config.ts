import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import type { ConfigIssue } from '../src/config/errors'
import {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
} from '../src/config/m1-fire-flow-fixture'
import { loadAndValidatePublicConfig } from '../src/config/node-loader'
import { loadAndValidatePublicM2GameplayConfig } from '../src/config/node-m2-gameplay-loader'
import { parseStrictJson } from '../src/config/strict-json'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function printIssues(issues: readonly ConfigIssue[]): void {
  for (const issue of issues) {
    console.error(`${issue.code} ${issue.filePath}${issue.fieldPath}: ${issue.messageZh}`)
  }
}

function readStrictJson(filePath: string): unknown {
  const parsed = parseStrictJson(readFileSync(filePath, 'utf8'))
  if (!parsed.ok) throw new SyntaxError(`JSON 文件无效：${filePath}`)
  return parsed.value
}

function validateM1Fixture(): boolean {
  const fixturePath = resolve(
    projectRoot,
    'public',
    'config',
    'performance',
    'm1-fire-flow.json',
  )
  const schemaPath = resolve(
    projectRoot,
    'schemas',
    'config',
    'm1-fire-flow-performance.schema.json',
  )
  let fixture: M1FireFlowFixture
  try {
    fixture = readStrictJson(fixturePath) as M1FireFlowFixture
    const schema = readStrictJson(schemaPath) as Record<string, unknown>
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictNumbers: true,
      validateSchema: true,
    })
    const validate = ajv.compile(schema)
    if (!validate(fixture)) {
      for (const error of validate.errors ?? []) {
        console.error(
          `M1_FIXTURE_SCHEMA_VIOLATION /config/performance/m1-fire-flow.json${error.instancePath}: ${error.message ?? error.keyword}`,
        )
      }
      return false
    }
  } catch (error) {
    console.error(
      `M1_FIXTURE_LOAD_FAILED /config/performance/m1-fire-flow.json: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }

  const semanticIssues = validateM1FireFlowFixtureSemantics(fixture)
  for (const issue of semanticIssues) {
    console.error(
      `${issue.code} /config/performance/m1-fire-flow.json${issue.fieldPath}: ${issue.messageZh}`,
    )
  }
  if (semanticIssues.length > 0) return false

  const probeIds = fixture.technicalProbes.map(({ id }) => id).join('/')
  const pearlCounts = fixture.performanceScenarios
    .map(({ activePearlCount }) => activePearlCount)
    .join('/')
  console.log(
    `M1 火流 fixture 校验通过：probe=${probeIds}，性能场景=${pearlCounts} 珠，预热=${fixture.protocol.warmupSeconds}s，采样=${fixture.protocol.sampleSeconds}s，expectedTickHz=${fixture.protocol.expectedTickHz}，dropped=${fixture.protocol.expectedDroppedTickCount}`,
  )
  return true
}

async function main(): Promise<void> {
  const result = loadAndValidatePublicConfig(projectRoot)
  if (!result.ok) {
    printIssues(result.issues)
    process.exitCode = 1
  } else {
    console.log(
      `配置校验通过：${result.config.materials.length} 份材料，standardPearlVolume=${result.config.parameters.standardPearlVolume}，slagUnitVolume=${result.config.parameters.slagUnitVolume}`,
    )
  }

  if (!validateM1Fixture()) process.exitCode = 1

  const m2Result = await loadAndValidatePublicM2GameplayConfig(projectRoot)
  if (!m2Result.ok) {
    printIssues(m2Result.issues)
    process.exitCode = 1
  } else {
    console.log(
      `M2 gameplay 配置校验通过：${m2Result.config.gameplay.fireSources.length} 种火源，${m2Result.config.gameplay.prototype.inventoryBatches.length} 个库存批次，simulationContentFingerprint=${m2Result.simulationContentFingerprint}`,
    )
  }
}

void main()
