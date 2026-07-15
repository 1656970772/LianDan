import type {
  MaterialTagCategory,
  NormalizedM2Config,
} from '../../config/index.ts'
import type { M2InventoryBatchView } from '../../ui/createM2Workbench.ts'

const TAG_CATEGORY_NAMES: Readonly<Record<MaterialTagCategory, string>> = {
  medicinalProperty: '药性',
  efficacyClue: '功效线索',
  reactionTrait: '反应特征',
  risk: '风险',
  state: '批次状态',
}

export function buildM2InventoryViews(
  config: NormalizedM2Config,
  servingsByBatchId: Readonly<Record<string, number>>,
): readonly M2InventoryBatchView[] {
  const materialById = new Map(
    config.base.materials.map((material) => [material.id, material] as const),
  )
  const tagById = new Map(
    (config.base.tags?.definitions ?? []).map((tag) => [tag.id, tag] as const),
  )
  return config.gameplay.prototype.inventoryBatches.map((batch) => {
    const material = materialById.get(batch.materialDefinitionId)
    const tags = (batch.tags ?? []).flatMap((tagStrength) => {
      const tag = tagById.get(tagStrength.tagId)
      return tag === undefined
        ? []
        : [{
            id: tag.id,
            nameZh: tag.nameZh,
            category: tag.category,
            categoryNameZh: TAG_CATEGORY_NAMES[tag.category],
            descriptionZh: tag.descriptionZh,
            strength: tagStrength.strength,
          }]
    })
    return {
      batchId: batch.batchId,
      materialDefinitionId: batch.materialDefinitionId,
      nameZh: material?.nameZh ?? batch.materialDefinitionId,
      servings: servingsByBatchId[batch.batchId] ?? 0,
      stateSummaryZh: tags
        .filter((tag) => tag.category === 'state')
        .map((tag) => tag.nameZh)
        .join(' · '),
      tags,
      ...(material?.appearancePath === undefined
        ? {}
        : { imagePath: material.appearancePath }),
    }
  })
}
