import type { ExtractionSimulationReadView } from '../../simulation/index.ts'

export type M5PearlEvidence = Readonly<{
  pearlId: string
  pearlType: 'medicinalLiquid' | 'slag' | 'impurity'
  sourceMaterialDefinitionId: string
  sourceMaterialInstanceId: string
  state: 'active' | 'caught' | 'missed' | 'burned'
  radius: number
  position: Readonly<{ x: number; y: number }>
  velocity: Readonly<{ x: number; y: number }>
}>

export function copyM5PearlEvidence(
  view: ExtractionSimulationReadView,
): readonly M5PearlEvidence[] {
  return view.pearls.map((pearl) => ({
    pearlId: pearl.pearlId,
    pearlType: pearl.pearlType,
    sourceMaterialDefinitionId: pearl.sourceMaterialDefinitionId,
    sourceMaterialInstanceId: pearl.sourceMaterialInstanceId,
    state: pearl.state,
    radius: pearl.radius,
    position: { ...pearl.position },
    velocity: { ...pearl.velocity },
  }))
}
