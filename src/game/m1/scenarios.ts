import type {
  M1FireFlowFixture,
  M1FixtureSource,
  M1FullObstacleRect,
  M1PerformanceScenario,
  M1TechnicalProbe,
} from '../../config/m1-fire-flow-fixture.ts'
import type {
  M1BehaviorId,
  M1BehaviorMetadata,
  M1ScenarioMetadata,
} from './contracts.ts'
import type { M1CircleScenario } from './scenario-runtime.ts'

export const M1_BEHAVIORS: readonly M1BehaviorMetadata[] = Object.freeze([
  { id: 'blocking', labelZh: '完全阻挡与背风阴影', scenarioId: 'pillar' },
  { id: 'split-flow', labelZh: '直柱两侧绕流', scenarioId: 'pillar' },
  { id: 'gap-recovery', labelZh: '缺口恢复通流', scenarioId: 'gap' },
  { id: 'crowd-blocking', labelZh: '珠群增强阻挡', scenarioId: 'crowd' },
  { id: 'downstream-rejoin', labelZh: '绕后汇合', scenarioId: 'pillar' },
])

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  pillar: '直柱绕流',
  gap: '缺口恢复',
  crowd: '水滴珠挡火',
  'm1-900': '900 珠基准',
  'm1-2400': '2400 珠基准',
})

const SUMMARIES: Readonly<Record<string, string>> = Object.freeze({
  pillar:
    '火从底部喷口向上，撞上直柱后分成两股，从左右绕过后继续向上。',
  gap: '火从底部喷口向上，穿过中间缺口继续上升，两侧灰墙会把火挡住。',
  crowd:
    '火从底部喷口向上，遇到几颗正常尺寸的水滴珠后被分开，珠子后方会形成暗区。',
  'm1-900': '这是 900 个小圆代理的性能基准，不代表正常珠子的画面尺寸。',
  'm1-2400': '这是 2400 个小圆代理的压力基准，不代表正常珠子的画面尺寸。',
})

export type M1ResolvedScenario = Readonly<{
  metadata: M1ScenarioMetadata
  source: M1FixtureSource
  fullObstacleRects: readonly M1FullObstacleRect[]
  circles: M1CircleScenario
  thresholds?: M1PerformanceScenario['thresholds']
}>

function behaviorIdsForProbe(id: M1TechnicalProbe['id']): readonly M1BehaviorId[] {
  return M1_BEHAVIORS.filter((behavior) => behavior.scenarioId === id).map(
    (behavior) => behavior.id,
  )
}

export function listM1Scenarios(
  fixture: M1FireFlowFixture,
): readonly M1ResolvedScenario[] {
  const technical = fixture.technicalProbes.map(
    (probe): M1ResolvedScenario => ({
      metadata: {
        id: probe.id,
        labelZh: LABELS[probe.id] ?? probe.id,
        kind: 'technical-probe',
        activePearlCount: probe.circleCount,
        seed: probe.seed,
        summaryZh: SUMMARIES[probe.id] ?? '观察火流如何绕过障碍并继续向上。',
        behaviorIds: behaviorIdsForProbe(probe.id),
      },
      source: probe.source,
      fullObstacleRects: probe.fullObstacleRects,
      circles: probe,
    }),
  )
  const performance = fixture.performanceScenarios.map(
    (scenario): M1ResolvedScenario => ({
      metadata: {
        id: scenario.id,
        labelZh: LABELS[scenario.id] ?? scenario.id,
        kind: 'performance',
        activePearlCount: scenario.activePearlCount,
        seed: scenario.seed,
        summaryZh:
          SUMMARIES[scenario.id] ?? '观察高负载下的火流方向与更新稳定性。',
        behaviorIds: [],
      },
      source: fixture.performanceSource,
      fullObstacleRects:
        fixture.performanceFullObstacleFixture.fullObstacleRects,
      circles: scenario,
      thresholds: scenario.thresholds,
    }),
  )
  return [...technical, ...performance]
}

export function resolveM1Scenario(
  fixture: M1FireFlowFixture,
  requestedId: string,
): M1ResolvedScenario {
  const scenarios = listM1Scenarios(fixture)
  return (
    scenarios.find((scenario) => scenario.metadata.id === requestedId) ??
    scenarios.find((scenario) => scenario.metadata.id === 'pillar') ??
    scenarios[0]!
  )
}
