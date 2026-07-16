import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import type { ConfigIssue } from '../src/config/errors'
import {
  validateM1FireFlowFixtureSemantics,
  type M1FireFlowFixture,
} from '../src/config/m1-fire-flow-fixture'
import {
  validateM5VisualPerformanceFixtureSemantics,
  type M5VisualPerformanceFixture,
} from '../src/config/m5-visual-performance-fixture.ts'
import { loadAndValidatePublicConfig } from '../src/config/node-loader'
import { loadAndValidatePublicM2GameplayConfig } from '../src/config/node-m2-gameplay-loader'
import { parseStrictJson } from '../src/config/strict-json'
import {
  expandM5VisualEvidenceMatrix,
  parseAndValidateM5VisualEvidenceFixtureJson,
} from './m5-visual-evidence-support.ts'

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

function validateM5VisualFixture(): boolean {
  const fixturePath = resolve(
    projectRoot,
    'public',
    'config',
    'performance',
    'm5-visual.json',
  )
  const schemaPath = resolve(
    projectRoot,
    'schemas',
    'config',
    'm5-visual-performance.schema.json',
  )
  try {
    const fixture = readStrictJson(fixturePath) as M5VisualPerformanceFixture
    const schema = readStrictJson(schemaPath) as Record<string, unknown>
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      strictNumbers: true,
      validateSchema: true,
    }).compile(schema)
    if (!validate(fixture)) {
      for (const error of validate.errors ?? []) {
        console.error(
          `M5_VISUAL_FIXTURE_SCHEMA_VIOLATION /config/performance/m5-visual.json${error.instancePath}: ${error.message ?? error.keyword}`,
        )
      }
      return false
    }
    const issues = validateM5VisualPerformanceFixtureSemantics(fixture)
    for (const issue of issues) {
      console.error(
        `${issue.code} /config/performance/m5-visual.json${issue.fieldPath}: ${issue.messageZh}`,
      )
    }
    if (issues.length > 0) return false
    console.log(
      `M5 表现性能 fixture 校验通过：${fixture.scenarios.map((scenario) => `${scenario.id}=${scenario.activePearlCount}珠/${scenario.thresholds.minimumFramesPerCompleteSecond}FPS`).join('，')}，预热=${fixture.protocol.warmupSeconds}s，采样=${fixture.protocol.sampleSeconds}s，${fixture.protocol.viewportWidth}x${fixture.protocol.viewportHeight}@DPR${fixture.protocol.deviceScaleFactor}`,
    )
    return true
  } catch (error) {
    console.error(
      `M5_VISUAL_FIXTURE_LOAD_FAILED /config/performance/m5-visual.json: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

function validateM5VisualEvidenceFixture(): boolean {
  const fixturePath = resolve(
    projectRoot,
    'public',
    'config',
    'evidence',
    'm5-visual-matrix.json',
  )
  const schemaPath = resolve(
    projectRoot,
    'schemas',
    'config',
    'm5-visual-evidence.schema.json',
  )
  try {
    const fixture = parseAndValidateM5VisualEvidenceFixtureJson(
      readFileSync(fixturePath, 'utf8'),
      readFileSync(schemaPath, 'utf8'),
    )
    const cells = expandM5VisualEvidenceMatrix(fixture)
    const manualBlockedCount = cells.filter(
      ({ expectedStatus }) => expectedStatus === 'manual-blocked',
    ).length
    console.log(
      `M5 正式视觉证据矩阵校验通过：分区格=${cells.length}，自动采集=${cells.length - manualBlockedCount}，人工阻塞=${manualBlockedCount}，人工结论由采集器固定初始化为 pending`,
    )
    return true
  } catch (error) {
    console.error(
      `M5_VISUAL_EVIDENCE_FIXTURE_LOAD_FAILED /config/evidence/m5-visual-matrix.json: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
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
  if (!validateM5VisualFixture()) process.exitCode = 1
  if (!validateM5VisualEvidenceFixture()) process.exitCode = 1

  const m2Result = await loadAndValidatePublicM2GameplayConfig(projectRoot)
  if (!m2Result.ok) {
    printIssues(m2Result.issues)
    process.exitCode = 1
  } else {
    console.log(
      `M2 配置校验通过：${m2Result.config.gameplay.fireSources.length} 种火源，${m2Result.config.gameplay.prototype.inventoryBatches.length} 个库存批次，simulationContentFingerprint=${m2Result.simulationContentFingerprint}，presentationContentFingerprint=${m2Result.presentationContentFingerprint}`,
    )
  }
}

void main()
