import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

import {
  canonicalizeCompositionMap,
  validateCompositionMap,
  validateCompositionPngHeader,
} from '../src/config/assets'
import { type ConfigIssue, configIssue } from '../src/config/errors'
import { computeSimulationContentFingerprint } from '../src/config/fingerprint'
import { createSimulationFingerprintInput } from '../src/config/fingerprint-input'
import type { DecodedCompositionMap } from '../src/config/model'
import {
  loadAndValidatePublicConfig,
  resolvePublicUrl,
} from '../src/config/node-loader'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function printIssues(issues: readonly ConfigIssue[]): void {
  for (const issue of issues) {
    console.error(`${issue.code} ${issue.filePath}${issue.fieldPath}: ${issue.messageZh}`)
  }
}

async function main(): Promise<void> {
  const configResult = loadAndValidatePublicConfig(projectRoot)
  if (!configResult.ok) {
    printIssues(configResult.issues)
    process.exitCode = 1
    return
  }

  const maps: DecodedCompositionMap[] = []
  const issues: ConfigIssue[] = []
  for (const material of configResult.config.materials) {
    const filePath = material.compositionMapPath
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(resolvePublicUrl(projectRoot, filePath)))
    } catch {
      issues.push(
        configIssue('CONFIG_ASSET_NOT_FOUND', filePath, '', '已登记的成分图文件不存在'),
      )
      continue
    }

    const headerIssues = validateCompositionPngHeader(filePath, bytes)
    if (headerIssues.length > 0) {
      issues.push(...headerIssues)
      continue
    }
    try {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      const map: DecodedCompositionMap = canonicalizeCompositionMap({
        filePath,
        width: decoded.width,
        height: decoded.height,
        rgba: Uint8Array.from(decoded.data),
      })
      const mapIssues = validateCompositionMap(map)
      if (mapIssues.length > 0) issues.push(...mapIssues)
      else maps.push(map)
    } catch {
      issues.push(
        configIssue('CONFIG_ASSET_INVALID_PNG', filePath, '', '已登记的成分图 PNG 解码失败'),
      )
    }
  }

  if (issues.length > 0) {
    printIssues(issues)
    process.exitCode = 1
    return
  }

  const fingerprint = await computeSimulationContentFingerprint(
    createSimulationFingerprintInput(configResult.config, maps),
  )
  console.log(
    `素材校验通过：${maps.length} 张已登记成分图，simulationContentFingerprint=${fingerprint.simulationContentFingerprint}`,
  )
}

void main()
