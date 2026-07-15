import type {
  IntrinsicMaterialTagCategory,
  NormalizedMaterial,
  NormalizedTagCatalog,
  NormalizedTagStrength,
} from './model.ts'

const INTRINSIC_CATEGORIES: readonly IntrinsicMaterialTagCategory[] = [
  'medicinalProperty',
  'efficacyClue',
  'reactionTrait',
  'risk',
]

export type MaterialBatchState = Readonly<{
  preservationStateId: string
  growthSourceId: string
  ageYears: number
}>

export type DerivedBatchTagsResult =
  | Readonly<{ ok: true; tags: readonly NormalizedTagStrength[] }>
  | Readonly<{
      ok: false
      missing: 'preservationStateId' | 'growthSourceId' | 'ageYears'
      value: string | number
    }>

export function deriveBatchTags(
  catalog: NormalizedTagCatalog,
  material: NormalizedMaterial,
  state: MaterialBatchState,
): DerivedBatchTagsResult {
  const preservation = catalog.stateDerivation.preservationStates.find(
    (rule) => rule.stateId === state.preservationStateId,
  )
  if (preservation === undefined) {
    return {
      ok: false,
      missing: 'preservationStateId',
      value: state.preservationStateId,
    }
  }
  const growth = catalog.stateDerivation.growthSources.find(
    (rule) => rule.stateId === state.growthSourceId,
  )
  if (growth === undefined) {
    return {
      ok: false,
      missing: 'growthSourceId',
      value: state.growthSourceId,
    }
  }
  const age = catalog.stateDerivation.ages.find(
    (rule) => rule.ageYears === state.ageYears,
  )
  if (age === undefined) {
    return { ok: false, missing: 'ageYears', value: state.ageYears }
  }

  const intrinsic = INTRINSIC_CATEGORIES.flatMap((category) =>
    (material.intrinsicTags?.[category] ?? []).map((tag) => ({ ...tag })),
  )
  return {
    ok: true,
    tags: Object.freeze([
      ...intrinsic,
      { tagId: preservation.tagId, strength: preservation.strength },
      { tagId: growth.tagId, strength: growth.strength },
      { tagId: age.tagId, strength: age.strength },
    ]),
  }
}
