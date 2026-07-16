import { readFileSync, readdirSync } from 'node:fs'
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
import { applyRuleCommand, createDomainState } from '../../domain/model.ts'
import { createM2RuntimeConfiguration } from '../../game/extraction/runtime-config.ts'
import { ExtractionSimulation } from '../../simulation/extraction/extraction-simulation.ts'
import {
  deriveMaterialContentRectangle,
  deriveMaterialFrameLayout,
} from '../../shared/material-content-geometry.ts'
import {
  orientedMaterialRectangleIsWithinBounds,
  orientedMaterialRectanglesHaveInteriorIntersection,
} from '../../shared/material-placement-geometry.ts'
import {
  loadM2GameplayTestSchemaBundle,
  loadTestSchemaBundle,
} from './schema-fixture.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const EXPECTED_MATERIALS = [
  {
    id: 'red_whisker_ginseng',
    nameZh: '赤须参',
    pearlColor: '#E36B3D',
    intrinsicTagIds: ['warm_fierce', 'tonify', 'active', 'scorch_meridians'],
    batchId: 'red_whisker_ginseng_fresh_wild_10',
    preservationStateId: 'fresh',
    growthSourceId: 'wild',
    ageYears: 10,
  },
  {
    id: 'azure_dew_leaf',
    nameZh: '青露叶',
    pearlColor: '#3FAFD1',
    intrinsicTagIds: ['cool_clear', 'clear_heart', 'dispersive', 'cold_stagnation'],
    batchId: 'azure_dew_leaf_fresh_cultivated_3',
    preservationStateId: 'fresh',
    growthSourceId: 'cultivated',
    ageYears: 3,
  },
  {
    id: 'violet_star_flower',
    nameZh: '紫星花',
    pearlColor: '#C86CB4',
    intrinsicTagIds: ['balanced', 'calm_spirit', 'volatile', 'delusion'],
    batchId: 'violet_star_flower_dried_wild_5',
    preservationStateId: 'dried',
    growthSourceId: 'wild',
    ageYears: 5,
  },
  {
    id: 'golden_bell_fruit',
    nameZh: '金铃果',
    pearlColor: '#E8B943',
    intrinsicTagIds: ['sweet_warm', 'stabilize_origin', 'tough', 'qi_stagnation'],
    batchId: 'golden_bell_fruit_fresh_cultivated_8',
    preservationStateId: 'fresh',
    growthSourceId: 'cultivated',
    ageYears: 8,
  },
  {
    id: 'ash_spore_mushroom',
    nameZh: '灰孢菇',
    pearlColor: '#8BCB58',
    intrinsicTagIds: ['damp_yin', 'lure_beast', 'spore_scatter', 'rot_poison'],
    batchId: 'ash_spore_mushroom_rotten_mutated_2',
    preservationStateId: 'rotten',
    growthSourceId: 'mutated',
    ageYears: 2,
  },
  {
    id: 'coiling_cloud_vine',
    nameZh: '盘云藤',
    pearlColor: '#43B66A',
    intrinsicTagIds: ['supple', 'unblock_channels', 'adhesive', 'breath_bind'],
    batchId: 'coiling_cloud_vine_dried_wild_20',
    preservationStateId: 'dried',
    growthSourceId: 'wild',
    ageYears: 20,
  },
  {
    id: 'frost_marrow_crystal',
    nameZh: '寒髓晶',
    pearlColor: '#70CFF2',
    intrinsicTagIds: ['extreme_cold', 'suppress_heat', 'stagnant', 'cold_poison'],
    batchId: 'frost_marrow_crystal_frozen_mutated_100',
    preservationStateId: 'frozen',
    growthSourceId: 'mutated',
    ageYears: 100,
  },
  {
    id: 'sinking_fragrance_bark',
    nameZh: '沉香皮',
    pearlColor: '#C98A48',
    intrinsicTagIds: ['warm_moist', 'settle_spirit', 'settling', 'smoke_poison'],
    batchId: 'sinking_fragrance_bark_dried_cultivated_50',
    preservationStateId: 'dried',
    growthSourceId: 'cultivated',
    ageYears: 50,
  },
] as const

const MATERIAL_IDS = EXPECTED_MATERIALS.map(({ id }) => id)
const INTRINSIC_CATEGORIES = [
  'medicinalProperty',
  'efficacyClue',
  'reactionTrait',
  'risk',
] as const

function readPublicJson(path: string): unknown {
  return JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'public', path.slice(1)), 'utf8'),
  )
}

function document(path: string, value = readPublicJson(path)): RawConfigDocument {
  return { filePath: path, value }
}

function rawProductionBase(tagsValue = readPublicJson('/config/tags.json')): RawConfigSet {
  const manifestPath = '/config/config-set.json'
  const manifest = readPublicJson(manifestPath) as {
    parameters: string
    tags: string
    materials: string[]
  }
  return {
    configSet: document(manifestPath, manifest),
    parameters: document(manifest.parameters),
    tags: document(manifest.tags, tagsValue),
    materials: manifest.materials.map((path) => document(path)),
  }
}

let productionLoad: ReturnType<typeof loadAndValidatePublicM2GameplayConfig> | undefined

async function loadProduction() {
  productionLoad ??= loadAndValidatePublicM2GameplayConfig(PROJECT_ROOT)
  const result = await productionLoad
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

function compositionCodes(rgba: Uint8Array): Uint8Array {
  const codes = new Uint8Array(rgba.length / 4)
  for (let index = 0; index < codes.length; index += 1) {
    const offset = index * 4
    if (rgba[offset + 3] === 0) codes[index] = 0
    else if (rgba[offset] === 0 && rgba[offset + 1] === 255) codes[index] = 1
    else if (rgba[offset] === 128 && rgba[offset + 1] === 128) codes[index] = 2
    else codes[index] = 3
  }
  return codes
}

describe('M4 完整内容与配置', () => {
  it('正式配置提供 24 个完整位于区域内且两两不相交的显式槽位', async () => {
    const loaded = await loadProduction()
    const placement = loaded.config.gameplay.prototype.materialPlacement
    const rectangles = placement.slots.map((slot) => ({
      center: { x: slot.centerX, y: slot.centerY },
      width: placement.visibleLongEdge,
      height: placement.visibleLongEdge,
      rotationRadians: (slot.rotationDegrees * Math.PI) / 180,
    }))

    expect(rectangles).toHaveLength(24)
    expect(
      rectangles.every((rectangle) =>
        orientedMaterialRectangleIsWithinBounds(
          rectangle,
          placement.usableRegion,
        ),
      ),
    ).toBe(true)
    for (let left = 0; left < rectangles.length; left += 1) {
      for (let right = left + 1; right < rectangles.length; right += 1) {
        expect(
          orientedMaterialRectanglesHaveInteriorIntersection(
            rectangles[left]!,
            rectangles[right]!,
          ),
        ).toBe(false)
      }
    }
  })

  it('8 种材料按初始 composition bounds 固定放大到 170，24 份任意顺序的实际内容 OBB 共 276 对不相交', async () => {
    const loaded = await loadProduction()
    const runtime = createM2RuntimeConfiguration(
      loaded.config,
      loaded.compositionMaps,
    )
    for (const material of runtime.simulation.materials) {
      const layout = deriveMaterialFrameLayout(
        material.composition,
        runtime.simulation.materialPlacement.visibleLongEdge,
      )
      expect(Math.max(layout.contentWidth, layout.contentHeight)).toBeCloseTo(
        170,
        9,
      )
    }

    const instances = runtime.rules.inventoryBatches
      .flatMap((batch) =>
        Array.from({ length: batch.servings }, (_, index) => ({
          materialInstanceId: `${batch.batchId}-${index}`,
          materialDefinitionId: batch.materialDefinitionId,
          inventoryBatchId: batch.batchId,
          initialVolume: batch.volumePerServing,
          remainingVolume: batch.volumePerServing,
        })),
      )
      .reverse()
    const baseState = createDomainState(runtime.rules)
    const state = {
      ...baseState,
      status: 'extracting' as const,
      materialInstances: instances,
      isSpraying: false,
    }
    const simulation = new ExtractionSimulation(runtime.simulation)
    simulation.beginTick({ tick: 0, domainState: state })
    for (let phase = 1; phase <= 7; phase += 1) {
      simulation.runPhase(phase as 1 | 2 | 3 | 4 | 5 | 6 | 7, state)
    }
    simulation.buildCandidate()
    simulation.commitTick()

    const contentRectangles = simulation.read().materials.map((material) =>
      deriveMaterialContentRectangle(
        material.placement,
        material.composition,
      ),
    )
    expect(contentRectangles).toHaveLength(24)
    expect(
      contentRectangles.every((rectangle) =>
        orientedMaterialRectangleIsWithinBounds(
          rectangle,
          runtime.simulation.materialPlacement.usableRegion,
        ),
      ),
    ).toBe(true)
    let pairCount = 0
    for (let left = 0; left < contentRectangles.length; left += 1) {
      for (let right = left + 1; right < contentRectangles.length; right += 1) {
        pairCount += 1
        expect(
          orientedMaterialRectanglesHaveInteriorIntersection(
            contentRectangles[left]!,
            contentRectangles[right]!,
          ),
        ).toBe(false)
      }
    }
    expect(pairCount).toBe(276)
  })

  it('正式三类丹珠使用小珠半径并为出生脱离保留 2px clearance', async () => {
    const loaded = await loadProduction()
    expect(
      loaded.config.gameplay.pearlTypes.map(
        ({ pearlType, standardRadius, spawnClearance }) => ({
          pearlType,
          standardRadius,
          spawnClearance,
        }),
      ),
    ).toEqual([
      {
        pearlType: 'medicinalLiquid',
        standardRadius: 8,
        spawnClearance: 2,
      },
      { pearlType: 'slag', standardRadius: 7, spawnClearance: 2 },
      { pearlType: 'impurity', standardRadius: 6, spawnClearance: 2 },
    ])
  })

  it('逐项锁定 8 种药材、批次状态、标签强度与素材路径', async () => {
    const loaded = await loadProduction()
    expect(loaded.config.base.materials.map(({ id }) => id)).toEqual(MATERIAL_IDS)
    expect(loaded.config.base.tags?.definitions).toHaveLength(47)
    expect(loaded.config.base.materials).toHaveLength(EXPECTED_MATERIALS.length)
    expect(loaded.config.gameplay.prototype.inventoryBatches).toHaveLength(
      EXPECTED_MATERIALS.length,
    )
    for (const expected of EXPECTED_MATERIALS) {
      const material = loaded.config.base.materials.find(({ id }) => id === expected.id)
      const batch = loaded.config.gameplay.prototype.inventoryBatches.find(
        ({ batchId }) => batchId === expected.batchId,
      )
      expect(material).toMatchObject({
        id: expected.id,
        nameZh: expected.nameZh,
        pearlColor: expected.pearlColor,
        targetPearlCount: 300,
        appearancePath: `/assets/materials/${expected.id}.png`,
        compositionMapPath: `/assets/masks/${expected.id}-components.png`,
      })
      expect(
        INTRINSIC_CATEGORIES.flatMap((category) =>
          material?.intrinsicTags?.[category] ?? [],
        ),
      ).toEqual(
        expected.intrinsicTagIds.map((tagId) => ({ tagId, strength: 100 })),
      )
      expect(batch).toMatchObject({
        batchId: expected.batchId,
        materialDefinitionId: expected.id,
        servings: 3,
        preservationStateId: expected.preservationStateId,
        growthSourceId: expected.growthSourceId,
        ageYears: expected.ageYears,
      })
      expect(batch?.tags).toHaveLength(7)
      expect(batch?.tags?.every(({ strength }) => strength === 100)).toBe(true)
    }
    expect(loaded.simulationContentFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('正式 loader 把 8 定义、8 批次、8 成分映射和互动完整传入运行时', async () => {
    const loaded = await loadProduction()
    const runtime = createM2RuntimeConfiguration(
      loaded.config,
      loaded.compositionMaps,
    )

    expect(runtime.simulation.materials.map(({ id }) => id)).toEqual(MATERIAL_IDS)
    expect(runtime.simulation.materials).toHaveLength(8)
    expect(runtime.simulation.materials.every(
      ({ composition }) => composition.length === 64 * 64,
    )).toBe(true)
    for (const expected of EXPECTED_MATERIALS) {
      const sourceMap = loaded.compositionMaps.find(
        ({ filePath }) =>
          filePath === `/assets/masks/${expected.id}-components.png`,
      )!
      const runtimeMaterial = runtime.simulation.materials.find(
        ({ id }) => id === expected.id,
      )!
      expect(runtimeMaterial.composition).toEqual(compositionCodes(sourceMap.rgba))
    }
    expect(runtime.rules.inventoryBatches.map(({ batchId }) => batchId)).toEqual(
      EXPECTED_MATERIALS.map(({ batchId }) => batchId),
    )
    expect(runtime.simulation.interactions).toEqual([
      {
        id: 'red_frost_medicinal_fight',
        behavior: 'fight',
        participantA: {
          materialDefinitionIds: ['red_whisker_ginseng'],
          requiredTagIds: [],
          pearlTypes: ['medicinalLiquid'],
        },
        participantB: {
          materialDefinitionIds: ['frost_marrow_crystal'],
          requiredTagIds: [],
          pearlTypes: ['medicinalLiquid'],
        },
        distance: 64,
        durationSeconds: 0.6,
        impulse: 180,
        cooldownSeconds: 1.5,
      },
    ])
  })

  it.each(EXPECTED_MATERIALS)(
    '$batchId 可经通用预选与投入路径生成 $id 实例',
    async (expected) => {
      const loaded = await loadProduction()
      const runtime = createM2RuntimeConfiguration(
        loaded.config,
        loaded.compositionMaps,
      )
      const initial = createDomainState(runtime.rules)
      const selected = applyRuleCommand(
        initial,
        {
          type: 'PreselectMaterial',
          payload: { inventoryBatchId: expected.batchId },
        },
        runtime.rules,
      )
      expect(selected.ok).toBe(true)
      if (!selected.ok) return
      const added = applyRuleCommand(
        selected.state,
        { type: 'AddSelectedMaterial', payload: {} },
        runtime.rules,
      )

      expect(added).toMatchObject({
        ok: true,
        state: {
          materialInstances: [
            {
              inventoryBatchId: expected.batchId,
              materialDefinitionId: expected.id,
              initialVolume: 300,
              remainingVolume: 300,
            },
          ],
        },
      })
    },
  )

  it('发布目录与 manifest 的 8 份药材、外观和成分图一一对应', () => {
    const manifest = readPublicJson('/config/config-set.json') as {
      materials: string[]
    }
    const materialPaths = manifest.materials
    const materialDocuments = materialPaths.map((path) => document(path).value) as Array<{
      appearancePath: string
      compositionMapPath: string
    }>
    const fileNames = (directory: string) =>
      readdirSync(resolve(PROJECT_ROOT, 'public', directory)).sort()

    expect(new Set(materialPaths).size).toBe(materialPaths.length)
    expect(fileNames('config/materials')).toEqual(
      materialPaths.map((path) => path.split('/').at(-1)!).sort(),
    )
    expect(fileNames('assets/materials')).toEqual(
      materialDocuments.map(({ appearancePath }) => appearancePath.split('/').at(-1)!).sort(),
    )
    expect(fileNames('assets/masks')).toEqual(
      materialDocuments.map(({ compositionMapPath }) => compositionMapPath.split('/').at(-1)!).sort(),
    )
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

  it('状态规则 strength=73 会进入派生标签并改变 fingerprint', async () => {
    const loaded = await loadProduction()
    const tags = structuredClone(readPublicJson('/config/tags.json')) as {
      stateDerivation: {
        preservationStates: Array<{
          stateId: string
          tagId: string
          strength?: number
        }>
      }
    }
    const fresh = tags.stateDerivation.preservationStates.find(
      ({ stateId }) => stateId === 'fresh',
    )!
    fresh.strength = 73
    const normalized = validateAndNormalizeConfigSet(
      rawProductionBase(tags),
      loadTestSchemaBundle(),
    )
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))

    const derived = deriveBatchTags(
      normalized.config.tags!,
      normalized.config.materials[0]!,
      {
        preservationStateId: 'fresh',
        growthSourceId: 'wild',
        ageYears: 10,
      },
    )
    expect(derived.ok).toBe(true)
    if (!derived.ok) throw new Error(JSON.stringify(derived))
    expect(derived.tags).toContainEqual({ tagId: 'fresh', strength: 73 })

    const fingerprint = await computeSimulationContentFingerprint(
      createM2SimulationFingerprintInput(
        normalized.config,
        loaded.config.gameplay,
        loaded.compositionMaps,
      ),
    )
    expect(fingerprint.simulationContentFingerprint).not.toBe(
      loaded.simulationContentFingerprint,
    )
  })

  it.each([
    ['缺失', undefined, 'CONFIG_REQUIRED_FIELD'],
    ['小于下限', -0.01, 'CONFIG_VALUE_OUT_OF_RANGE'],
    ['大于上限', 100.01, 'CONFIG_VALUE_OUT_OF_RANGE'],
  ] as const)('拒绝状态规则 strength %s', (_case, strength, code) => {
    const tags = structuredClone(readPublicJson('/config/tags.json')) as {
      stateDerivation: {
        preservationStates: Array<{
          stateId: string
          tagId: string
          strength?: number
        }>
      }
    }
    const rule = tags.stateDerivation.preservationStates[0]!
    if (strength === undefined) delete rule.strength
    else rule.strength = strength

    const result = validateAndNormalizeConfigSet(
      rawProductionBase(tags),
      loadTestSchemaBundle(),
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code,
          filePath: '/config/tags.json',
          fieldPath: '/stateDerivation/preservationStates/0/strength',
        }),
      ],
    })
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
      presentation: string
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
      presentation: document(m2Manifest.presentation),
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
