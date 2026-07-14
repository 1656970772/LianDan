import { configIssue, type ConfigIssue } from './errors.ts'
import type { M1FireFlowFixture } from './m1-fire-flow-fixture.ts'
import type { NormalizedConfig } from './model.ts'

export interface M1LogicalWorldRequirement {
  readonly width: number
  readonly height: number
}

const PARAMETERS_PATH = '/config/parameters.json'
const FIXTURE_PATH = '/config/performance/m1-fire-flow.json'

export function validateM1RuntimeCompatibility(
  config: NormalizedConfig,
  fixture: M1FireFlowFixture,
  logicalWorld: M1LogicalWorldRequirement,
): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const grid = config.parameters.flowField
  const gridWidth = grid.gridColumns * grid.cellSize
  const gridHeight = grid.gridRows * grid.cellSize

  if (fixture.world.width !== logicalWorld.width) {
    issues.push(
      configIssue(
        'CONFIG_RUNTIME_INCOMPATIBLE',
        FIXTURE_PATH,
        '/world/width',
        `M1 场景世界宽度 ${fixture.world.width} 与画布逻辑宽度 ${logicalWorld.width} 不一致`,
      ),
    )
  }
  if (fixture.world.height !== logicalWorld.height) {
    issues.push(
      configIssue(
        'CONFIG_RUNTIME_INCOMPATIBLE',
        FIXTURE_PATH,
        '/world/height',
        `M1 场景世界高度 ${fixture.world.height} 与画布逻辑高度 ${logicalWorld.height} 不一致`,
      ),
    )
  }
  if (gridWidth !== fixture.world.width) {
    issues.push(
      configIssue(
        'CONFIG_RUNTIME_INCOMPATIBLE',
        PARAMETERS_PATH,
        '/flowField/gridColumns',
        `M1 火流网格宽度 ${gridWidth} 与场景世界宽度 ${fixture.world.width} 不一致`,
      ),
    )
  }
  if (gridHeight !== fixture.world.height) {
    issues.push(
      configIssue(
        'CONFIG_RUNTIME_INCOMPATIBLE',
        PARAMETERS_PATH,
        '/flowField/gridRows',
        `M1 火流网格高度 ${gridHeight} 与场景世界高度 ${fixture.world.height} 不一致`,
      ),
    )
  }
  if (
    config.parameters.simulation.fixedStepHz !==
    fixture.protocol.expectedTickHz
  ) {
    issues.push(
      configIssue(
        'CONFIG_RUNTIME_INCOMPATIBLE',
        PARAMETERS_PATH,
        '/simulation/fixedStepHz',
        `M1 固定步进频率 ${config.parameters.simulation.fixedStepHz} 与性能协议期望频率 ${fixture.protocol.expectedTickHz} 不一致`,
      ),
    )
  }

  return issues
}
