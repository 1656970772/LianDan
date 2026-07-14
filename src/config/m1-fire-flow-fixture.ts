export interface M1FixtureVector {
  readonly x: number
  readonly y: number
}

export interface M1FixtureRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface M1FullObstacleRect extends M1FixtureRect {
  readonly obstacleValue: 1
}

export interface M1FixtureSource {
  readonly position: M1FixtureVector
  readonly direction: M1FixtureVector
  readonly width: number
}

interface M1CircleFixture {
  readonly seed: number
  readonly circleSpawnArea: M1FixtureRect
  readonly radius: number
  readonly velocity: M1FixtureVector
}

export interface M1TechnicalProbe extends M1CircleFixture {
  readonly id: 'pillar' | 'gap' | 'crowd'
  readonly source: M1FixtureSource
  readonly fullObstacleRects: M1FullObstacleRect[]
  readonly circleCount: number
}

export interface M1PerformanceThresholds {
  readonly fireFlowUpdateP95Ms: number
  readonly fireFlowUpdateMaxMs: number
  readonly minimumFpsPerFullSecond: number
}

export interface M1PerformanceScenario extends M1CircleFixture {
  readonly id: string
  readonly activePearlCount: number
  readonly fullObstacleFixtureId: string
  readonly thresholds: M1PerformanceThresholds
}

export interface M1FireFlowFixture {
  readonly schemaVersion: 1
  readonly id: 'm1-fire-flow'
  readonly world: Readonly<{ width: number; height: number }>
  readonly protocol: Readonly<{
    warmupSeconds: number
    sampleSeconds: number
    expectedTickHz: number
    expectedDroppedTickCount: number
    totalTickTolerance: number
    fullSecondTickMinimum: number
    fullSecondTickMaximum: number
  }>
  readonly performanceSource: M1FixtureSource
  readonly performanceFullObstacleFixture: Readonly<{
    id: string
    fullObstacleRects: M1FullObstacleRect[]
  }>
  readonly technicalProbes: M1TechnicalProbe[]
  readonly performanceScenarios: M1PerformanceScenario[]
}

export interface M1FireFlowFixtureIssue {
  readonly code:
    | 'M1_FIXTURE_DUPLICATE_SCENARIO_ID'
    | 'M1_FIXTURE_DUPLICATE_PEARL_COUNT'
    | 'M1_FIXTURE_REQUIRED_SCENARIO_MISSING'
    | 'M1_FIXTURE_DUPLICATE_PROBE_ID'
    | 'M1_FIXTURE_REQUIRED_PROBE_MISSING'
    | 'M1_FIXTURE_REFERENCE_NOT_FOUND'
    | 'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS'
    | 'M1_FIXTURE_DIRECTION_NOT_NORMALIZED'
    | 'M1_FIXTURE_PROTOCOL_INCONSISTENT'
    | 'M1_FIXTURE_PROBE_INCOMPLETE'
    | 'M1_FIXTURE_THRESHOLD_INCONSISTENT'
    | 'M1_FIXTURE_SPAWN_AREA_TOO_SMALL'
  readonly fieldPath: string
  readonly messageZh: string
}

function issue(
  code: M1FireFlowFixtureIssue['code'],
  fieldPath: string,
  messageZh: string,
): M1FireFlowFixtureIssue {
  return { code, fieldPath, messageZh }
}

function rectFitsWorld(
  rect: M1FixtureRect,
  world: M1FireFlowFixture['world'],
): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= world.width &&
    rect.y + rect.height <= world.height
  )
}

function sourceFitsWorld(
  source: M1FixtureSource,
  world: M1FireFlowFixture['world'],
): boolean {
  return (
    source.position.x >= 0 &&
    source.position.x <= world.width &&
    source.position.y >= 0 &&
    source.position.y <= world.height
  )
}

function directionIsNormalized(direction: M1FixtureVector): boolean {
  return Math.abs(Math.hypot(direction.x, direction.y) - 1) <= 1e-9
}

function spawnAreaFitsCircle(scenario: M1CircleFixture): boolean {
  return (
    scenario.circleSpawnArea.width >= scenario.radius * 2 &&
    scenario.circleSpawnArea.height >= scenario.radius * 2
  )
}

export function validateM1FireFlowFixtureSemantics(
  fixture: M1FireFlowFixture,
): readonly M1FireFlowFixtureIssue[] {
  const issues: M1FireFlowFixtureIssue[] = []
  const scenarioIds = new Set<string>()
  const pearlCounts = new Set<number>()

  fixture.performanceScenarios.forEach((scenario, index) => {
    const basePath = `/performanceScenarios/${index}`
    if (scenarioIds.has(scenario.id)) {
      issues.push(
        issue(
          'M1_FIXTURE_DUPLICATE_SCENARIO_ID',
          `${basePath}/id`,
          `性能场景 ID ${scenario.id} 重复`,
        ),
      )
    }
    scenarioIds.add(scenario.id)
    if (pearlCounts.has(scenario.activePearlCount)) {
      issues.push(
        issue(
          'M1_FIXTURE_DUPLICATE_PEARL_COUNT',
          `${basePath}/activePearlCount`,
          `性能场景活动珠数量 ${scenario.activePearlCount} 重复`,
        ),
      )
    }
    pearlCounts.add(scenario.activePearlCount)
    if (
      scenario.fullObstacleFixtureId !==
      fixture.performanceFullObstacleFixture.id
    ) {
      issues.push(
        issue(
          'M1_FIXTURE_REFERENCE_NOT_FOUND',
          `${basePath}/fullObstacleFixtureId`,
          `找不到完全障碍 fixture ${scenario.fullObstacleFixtureId}`,
        ),
      )
    }
    if (!rectFitsWorld(scenario.circleSpawnArea, fixture.world)) {
      issues.push(
        issue(
          'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
          `${basePath}/circleSpawnArea`,
          '性能场景圆形障碍生成区域超出世界边界',
        ),
      )
    }
    if (!spawnAreaFitsCircle(scenario)) {
      issues.push(
        issue(
          'M1_FIXTURE_SPAWN_AREA_TOO_SMALL',
          `${basePath}/circleSpawnArea`,
          '圆形障碍生成区域宽高必须均不小于圆直径',
        ),
      )
    }
    if (
      scenario.thresholds.fireFlowUpdateP95Ms >
      scenario.thresholds.fireFlowUpdateMaxMs
    ) {
      issues.push(
        issue(
          'M1_FIXTURE_THRESHOLD_INCONSISTENT',
          `${basePath}/thresholds`,
          '火流更新 p95 门限不得大于 max 门限',
        ),
      )
    }
  })

  for (const requiredCount of [900, 2400]) {
    if (!pearlCounts.has(requiredCount)) {
      issues.push(
        issue(
          'M1_FIXTURE_REQUIRED_SCENARIO_MISSING',
          '/performanceScenarios',
          `缺少活动珠数量为 ${requiredCount} 的 M1 性能场景`,
        ),
      )
    }
  }

  const probeIds = new Set<string>()
  fixture.technicalProbes.forEach((probe, index) => {
    const basePath = `/technicalProbes/${index}`
    if (probeIds.has(probe.id)) {
      issues.push(
        issue(
          'M1_FIXTURE_DUPLICATE_PROBE_ID',
          `${basePath}/id`,
          `技术探针 ID ${probe.id} 重复`,
        ),
      )
    }
    probeIds.add(probe.id)
    if (!sourceFitsWorld(probe.source, fixture.world)) {
      issues.push(
        issue(
          'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
          `${basePath}/source/position`,
          '技术探针火源位置超出世界边界',
        ),
      )
    }
    if (!directionIsNormalized(probe.source.direction)) {
      issues.push(
        issue(
          'M1_FIXTURE_DIRECTION_NOT_NORMALIZED',
          `${basePath}/source/direction`,
          '技术探针火源方向必须是单位向量',
        ),
      )
    }
    if (!rectFitsWorld(probe.circleSpawnArea, fixture.world)) {
      issues.push(
        issue(
          'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
          `${basePath}/circleSpawnArea`,
          '技术探针圆形障碍生成区域超出世界边界',
        ),
      )
    }
    if (!spawnAreaFitsCircle(probe)) {
      issues.push(
        issue(
          'M1_FIXTURE_SPAWN_AREA_TOO_SMALL',
          `${basePath}/circleSpawnArea`,
          '圆形障碍生成区域宽高必须均不小于圆直径',
        ),
      )
    }
    probe.fullObstacleRects.forEach((rect, rectIndex) => {
      if (!rectFitsWorld(rect, fixture.world)) {
        issues.push(
          issue(
            'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
            `${basePath}/fullObstacleRects/${rectIndex}`,
            '技术探针完全障碍矩形超出世界边界',
          ),
        )
      }
    })
    const probeIsIncomplete =
      (probe.id === 'pillar' && probe.fullObstacleRects.length < 1) ||
      (probe.id === 'gap' && probe.fullObstacleRects.length < 2) ||
      (probe.id === 'crowd' && probe.circleCount < 1)
    if (probeIsIncomplete) {
      issues.push(
        issue(
          'M1_FIXTURE_PROBE_INCOMPLETE',
          basePath,
          `技术探针 ${probe.id} 缺少证明目标所需的障碍输入`,
        ),
      )
    }
  })

  for (const requiredProbeId of ['pillar', 'gap', 'crowd']) {
    if (!probeIds.has(requiredProbeId)) {
      issues.push(
        issue(
          'M1_FIXTURE_REQUIRED_PROBE_MISSING',
          '/technicalProbes',
          `缺少 ${requiredProbeId} 技术探针`,
        ),
      )
    }
  }

  if (!sourceFitsWorld(fixture.performanceSource, fixture.world)) {
    issues.push(
      issue(
        'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
        '/performanceSource/position',
        '性能场景固定火源位置超出世界边界',
      ),
    )
  }
  if (!directionIsNormalized(fixture.performanceSource.direction)) {
    issues.push(
      issue(
        'M1_FIXTURE_DIRECTION_NOT_NORMALIZED',
        '/performanceSource/direction',
        '性能场景固定火源方向必须是单位向量',
      ),
    )
  }
  fixture.performanceFullObstacleFixture.fullObstacleRects.forEach(
    (rect, index) => {
      if (!rectFitsWorld(rect, fixture.world)) {
        issues.push(
          issue(
            'M1_FIXTURE_GEOMETRY_OUT_OF_BOUNDS',
            `/performanceFullObstacleFixture/fullObstacleRects/${index}`,
            '性能场景完全障碍矩形超出世界边界',
          ),
        )
      }
    },
  )

  const protocol = fixture.protocol
  if (
    protocol.fullSecondTickMinimum > protocol.expectedTickHz ||
    protocol.expectedTickHz > protocol.fullSecondTickMaximum
  ) {
    issues.push(
      issue(
        'M1_FIXTURE_PROTOCOL_INCONSISTENT',
        '/protocol',
        '完整秒 tick 范围必须包含 expectedTickHz',
      ),
    )
  }

  return issues
}
