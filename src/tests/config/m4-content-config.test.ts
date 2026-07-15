import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeSimulationContentFingerprint } from '../../config/fingerprint.ts'
import { createM2SimulationFingerprintInput } from '../../config/m2-fingerprint-input.ts'
import type { RawM2GameplayConfig } from '../../config/m2-gameplay-model.ts'
import { validateAndNormalizeM2GameplayConfig } from '../../config/m2-gameplay-validate.ts'
import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader.ts'
import type { RawConfigDocument } from '../../config/model.ts'
import { deriveBatchTags } from '../../config/tag-derivation.ts'
import { validateAndNormalizeConfigSet, type RawConfigSet } from '../../config/validate.ts'
import {
  loadM2GameplayTestSchemaBundle,
  loadTestSchemaBundle,
} from './schema-fixture.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MATERIAL_IDS = [
  'red_whisker_ginseng',
  'azure_dew_leaf',
  'violet_star_flower',
  'golden_bell_fruit',
  'ash_spore_mushroom',
  'coiling_cloud_vine',
  'frost_marrow_crystal',
  'sinking_fragrance_bark',
] as const
const MATERIAL_NAMES = ['赤须参', '青露叶', '紫星花', '金铃果', '灰孢菇', '盘云藤', '寒髓晶', '沉香皮']

function readPublicJson(path: string): unknown {
  return JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'public', path.slice(1)), 'utf8'),
  )
}

function document(path: string, value = readPublicJson(path)): RawConfigDocument {
  return { filePath: path, value }
}

async function loadProduction() {
  const result = await loadAndValidatePublicM2GameplayConfig(PROJECT_ROOT)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result
}

function countComponents(rgba: Uint8Array): Readonly<Record<'medicinal' | 'slag' | 'impurity', number>> {
  const counts = { medicinal: 0, slag: 0, impurity: 0 }
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) continue
    const key = `${rgba[offset]},${rgba[offset + 1]},${rgba[offset + 2]}`
    if (key === '0,255,255') counts.medicinal += 1
    else if (key === '128,128,128') counts.slag += 1
    else if (key === '128,0,128') counts.impurity += 1
  }
  return counts
}

describe('M4 完整内容与配置', () => {
  it('加载 8 种药材、8 个三状态批次、47 个标签与赤寒互动', async () => {
    const loaded = await loadProduction()
    expect(loaded.config.base.materials.map(({ id }) => id)).toEqual(MATERIAL_IDS)
    expect(loaded.config.base.materials.map(({ nameZh }) => nameZh)).toEqual(MATERIAL_NAMES)
    expect(loaded.config.base.tags?.definitions).toHaveLength(47)
    expect(loaded.config.gameplay.prototype.inventoryBatches).toHaveLength(8)
    expect(loaded.config.gameplay.prototype.inventoryBatches.every(
      (batch) =>
        batch.servings === 3 &&
        batch.preservationStateId !== undefined &&
        batch.growthSourceId !== undefined &&
        batch.ageYears !== undefined &&
        batch.tags?.length === 7,
    )).toBe(true)
    expect(loaded.config.base.materials.every((material) =>
      material.targetPearlCount === 300 &&
      material.pearlColor !== undefined &&
      Object.values(material.intrinsicTags ?? {}).every((tags) => tags.length === 1),
    )).toBe(true)
    expect(loaded.config.gameplay.interactions).toEqual([
      expect.objectContaining({
        id: 'red_frost_medicinal_fight',
        behavior: 'fight',
        distance: 64,
        durationSeconds: 0.6,
        impulse: 180,
        cooldownSeconds: 1.5,
      }),
    ])
    expect(loaded.simulationContentFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('8 张成分图都保持约 25/60/15，并换算为约 75/180/45 颗理论丹珠', async () => {
    const loaded = await loadProduction()
    expect(loaded.compositionMaps).toHaveLength(8)
    for (const map of loaded.compositionMaps) {
      const counts = countComponents(map.rgba)
      const total = counts.medicinal + counts.slag + counts.impurity
      expect(counts.medicinal / total).toBeCloseTo(0.25, 2)
      expect(counts.slag / total).toBeCloseTo(0.6, 2)
      expect(counts.impurity / total).toBeCloseTo(0.15, 2)
      expect(counts.medicinal / total * 300).toBeCloseTo(75, 0)
      expect(counts.slag / total * 300).toBeCloseTo(180, 0)
      expect(counts.impurity / total * 300).toBeCloseTo(45, 0)
    }
  })

  it('批次状态只改变派生标签，不回写药材本征配置', async () => {
    const loaded = await loadProduction()
    const catalog = loaded.config.base.tags!
    const material = loaded.config.base.materials[0]!
    const beforeMaterial = JSON.stringify(material)
    const original = deriveBatchTags(catalog, material, {
      preservationStateId: 'fresh',
      growthSourceId: 'wild',
      ageYears: 10,
    })
    const changed = deriveBatchTags(catalog, material, {
      preservationStateId: 'dried',
      growthSourceId: 'cultivated',
      ageYears: 20,
    })
    expect(original.ok && changed.ok).toBe(true)
    if (!original.ok || !changed.ok) throw new Error('派生失败')
    expect(original.tags.slice(0, 4)).toEqual(changed.tags.slice(0, 4))
    expect(original.tags.slice(4).map(({ tagId }) => tagId)).not.toEqual(
      changed.tags.slice(4).map(({ tagId }) => tagId),
    )
    expect(JSON.stringify(material)).toBe(beforeMaterial)
  })

  it('展示名和药液颜色不影响指纹，成分像素变化会影响指纹', async () => {
    const loaded = await loadProduction()
    const renamedBase = {
      ...loaded.config.base,
      materials: loaded.config.base.materials.map((material, index) =>
        index === 0
          ? { ...material, nameZh: '仅展示改名', pearlColor: '#000000' }
          : material,
      ),
    }
    const renamed = await computeSimulationContentFingerprint(
      createM2SimulationFingerprintInput(
        renamedBase,
        loaded.config.gameplay,
        loaded.compositionMaps,
      ),
    )
    expect(renamed.simulationContentFingerprint).toBe(
      loaded.simulationContentFingerprint,
    )

    const first = loaded.compositionMaps[0]!
    const changedRgba = first.rgba
    const opaqueOffset = changedRgba.findIndex((value, index) => index % 4 === 3 && value === 255) - 3
    changedRgba[opaqueOffset] = changedRgba[opaqueOffset] === 0 ? 128 : 0
    const changedMaps = [
      { ...first, rgba: changedRgba },
      ...loaded.compositionMaps.slice(1),
    ]
    const changed = await computeSimulationContentFingerprint(
      createM2SimulationFingerprintInput(
        loaded.config.base,
        loaded.config.gameplay,
        changedMaps,
      ),
    )
    expect(changed.simulationContentFingerprint).not.toBe(
      loaded.simulationContentFingerprint,
    )
  })

  it('负向夹具拒绝不存在的标签引用与互动材料引用', async () => {
    const loaded = await loadProduction()
    const configManifestPath = '/config/config-set.json'
    const configManifest = structuredClone(readPublicJson(configManifestPath)) as {
      parameters: string
      tags: string
      materials: string[]
    }
    const materialDocuments = configManifest.materials.map((path) => document(path))
    const firstMaterial = structuredClone(materialDocuments[0]!.value) as {
      intrinsicTags: { medicinalProperty: Array<{ tagId: string; strength: number }> }
    }
    firstMaterial.intrinsicTags.medicinalProperty[0]!.tagId = 'missing_tag'
    materialDocuments[0] = { ...materialDocuments[0]!, value: firstMaterial }
    const rawBase: RawConfigSet = {
      configSet: document(configManifestPath, configManifest),
      parameters: document(configManifest.parameters),
      tags: document(configManifest.tags),
      materials: materialDocuments,
    }
    const invalidTag = validateAndNormalizeConfigSet(rawBase, loadTestSchemaBundle())
    expect(invalidTag.ok).toBe(false)
    if (invalidTag.ok) throw new Error('负向标签夹具意外通过')
    expect(JSON.stringify(invalidTag.issues)).toContain('missing_tag')

    const m2ManifestPath = '/config/m2-config-set.json'
    const m2Manifest = structuredClone(readPublicJson(m2ManifestPath)) as {
      prototype: string
      fireSources: string
      pearlTypes: string
      collector: string
      interactions: string
    }
    const interactions = structuredClone(readPublicJson(m2Manifest.interactions)) as {
      interactions: Array<{ participantA: { materialDefinitionIds: string[] } }>
    }
    interactions.interactions[0]!.participantA.materialDefinitionIds = ['missing_material']
    const rawM2: RawM2GameplayConfig = {
      manifest: document(m2ManifestPath, m2Manifest),
      prototype: document(m2Manifest.prototype),
      fireSources: document(m2Manifest.fireSources),
      pearlTypes: document(m2Manifest.pearlTypes),
      collector: document(m2Manifest.collector),
      interactions: document(m2Manifest.interactions, interactions),
    }
    const invalidInteraction = validateAndNormalizeM2GameplayConfig(
      rawM2,
      loadM2GameplayTestSchemaBundle(),
      loaded.config.base,
      '/config/config-set.json',
    )
    expect(invalidInteraction.ok).toBe(false)
    if (invalidInteraction.ok) throw new Error('负向互动夹具意外通过')
    expect(JSON.stringify(invalidInteraction.issues)).toContain('missing_material')
  })
})
