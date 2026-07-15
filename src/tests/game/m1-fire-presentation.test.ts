import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { M1FireFlowFixture } from '../../config/m1-fire-flow-fixture.ts'
import { loadAndValidatePublicConfig } from '../../config/node-loader.ts'
import { M1_OVERLAY_MODES } from '../../game/m1/contracts.ts'
import { M1_FIRE_PRESENTATION_CONFIG } from '../../game/m1/fire-presentation-config.ts'
import { M1FirePresentation } from '../../game/m1/fire-presentation.ts'
import {
  createM1CircleObstacles,
  rasterizeM1FullObstacles,
} from '../../game/m1/scenario-runtime.ts'
import { listM1Scenarios } from '../../game/m1/scenarios.ts'
import {
  FireFlowField,
  type FireFlowReadView,
} from '../../simulation/fire-flow/index.ts'

function createUpwardFlowView(): FireFlowReadView {
  const columns = 80
  const rows = 45
  const cellCount = columns * rows
  return {
    generation: 1,
    tick: 1,
    columns,
    rows,
    cellSize: 20,
    originX: 0,
    originY: 0,
    obstacle: new Float32Array(cellCount),
    flowX: new Float32Array(cellCount),
    flowY: new Float32Array(cellCount).fill(-1),
    intensity: new Uint8Array(cellCount).fill(255),
  }
}

function loadFixture(): M1FireFlowFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        '../../../public/config/performance/m1-fire-flow.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as M1FireFlowFixture
}

function createProductionPillarView(): {
  view: FireFlowReadView
  source: M1FireFlowFixture['technicalProbes'][number]['source']
} {
  const fixture = loadFixture()
  const pillar = fixture.technicalProbes.find((probe) => probe.id === 'pillar')!
  const normalized = loadAndValidatePublicConfig(
    fileURLToPath(new URL('../../../', import.meta.url)),
  )
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
  const flow = normalized.config.parameters.flowField
  const geometry = {
    columns: flow.gridColumns,
    rows: flow.gridRows,
    cellSize: flow.cellSize,
    originX: 0,
    originY: 0,
  }
  const view = new FireFlowField({
    geometry,
    solver: {
      circleCoverageSamplesPerAxis: flow.circleCoverageSamplesPerAxis,
      lateralSpread: flow.lateralSpread,
      obstacleDeflection: flow.obstacleDeflection,
      partialObstaclePenalty: flow.partialObstaclePenalty,
      mergeRate: flow.mergeRate,
      fullObstacleThreshold: flow.fullObstacleThreshold,
    },
  }).update({
    tick: 0,
    source: {
      x: pillar.source.position.x,
      y: pillar.source.position.y,
      directionX: pillar.source.direction.x,
      directionY: pillar.source.direction.y,
      width: pillar.source.width,
    },
    fullObstacles: rasterizeM1FullObstacles(
      pillar.fullObstacleRects,
      geometry,
    ),
    circles: createM1CircleObstacles(pillar),
  })
  return { view, source: pillar.source }
}

function measurePillarTrajectory(): {
  aroundPillarCount: number
  aroundPillarMeanOffset: number
  downstreamCount: number
  downstreamMeanOffset: number
  downstreamCenterRatio: number
} {
  const { view, source } = createProductionPillarView()
  const presentation = new M1FirePresentation(M1_FIRE_PRESENTATION_CONFIG)
  presentation.reset(view, source)
  let aroundPillarCount = 0
  let aroundPillarOffset = 0
  let downstreamCount = 0
  let downstreamOffset = 0
  let downstreamCenterCount = 0

  for (let step = 0; step < 600; step += 1) {
    presentation.advance(view, source, 1 / 60)
    const particles = presentation.particles
    for (let index = 0; index < particles.count; index += 1) {
      const x = particles.x[index]!
      const y = particles.y[index]!
      const offset = Math.abs(x - source.position.x)
      if (y >= 320 && y <= 560 && (x < 760 || x > 840)) {
        aroundPillarCount += 1
        aroundPillarOffset += offset
      }
      if (y >= 100 && y <= 280) {
        downstreamCount += 1
        downstreamOffset += offset
        if (offset <= 40) downstreamCenterCount += 1
      }
    }
  }

  return {
    aroundPillarCount,
    aroundPillarMeanOffset: aroundPillarOffset / aroundPillarCount,
    downstreamCount,
    downstreamMeanOffset: downstreamOffset / downstreamCount,
    downstreamCenterRatio: downstreamCenterCount / downstreamCount,
  }
}

describe('M1 玩家可读火流展示契约', () => {
  it('提供独立火焰展示模式，不把可达域调试色块冒充火焰', () => {
    expect(M1_OVERLAY_MODES).toContain('fire')
  })

  it('pillar 场景用大白话解释火从哪里来以及如何绕柱', () => {
    const pillar = listM1Scenarios(loadFixture()).find(
      (scenario) => scenario.metadata.id === 'pillar',
    )

    expect(pillar?.metadata).toMatchObject({
      summaryZh:
        '火从底部喷口向上，撞上直柱后分成两股，从左右绕过后继续向上。',
    })
  })

  it('预热会跨越重生继续推进，避免粒子同步堆在火源附近', () => {
    const presentation = new M1FirePresentation(
      M1_FIRE_PRESENTATION_CONFIG,
    )
    presentation.reset(createUpwardFlowView(), {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    })

    const sourceBandStartY = 780
    let sourceBandCount = 0
    for (const y of presentation.particles.y) {
      if (y >= sourceBandStartY) sourceBandCount += 1
    }

    expect(sourceBandCount).toBeLessThanOrEqual(
      Math.floor(presentation.particles.count * 0.2),
    )
  })

  it('快速出火保留预热粒子，但可见前沿从喷口按真实时间向前推进', () => {
    const presentation = new M1FirePresentation({
      ...M1_FIRE_PRESENTATION_CONFIG,
      startup: {
        mode: 'rapid-reveal',
        propagationSpeedPixelsPerSecond: 3_000,
        frontFeatherPixels: 70,
      },
    })
    const view = createUpwardFlowView()
    const source = {
      position: { x: 800, y: 700 },
      direction: { x: 0, y: -1 },
      width: 240,
    }

    presentation.reset(view, source)
    expect(presentation.revealDistancePixels).toBe(0)

    for (let frame = 0; frame < 3; frame += 1) {
      presentation.advance(view, source, 1 / 30)
    }
    expect(presentation.revealDistancePixels).toBeCloseTo(300, 6)

    presentation.reset(view, source)
    presentation.advance(view, source, 0.2)
    expect(presentation.revealDistancePixels).toBeCloseTo(600, 6)

    presentation.resetSteady(view, source)
    expect(presentation.revealDistancePixels).toBeNull()
  })

  it('喷口横向出生分布的中段密度明显高于等宽外侧', () => {
    const config = {
      ...M1_FIRE_PRESENTATION_CONFIG,
      lifetimeSeconds: 0,
    }
    const presentation = new M1FirePresentation(config)
    const source = {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    }
    presentation.reset(createUpwardFlowView(), source)
    const halfWidth = (source.width * config.sourceWidthScale) / 2
    let centerCount = 0
    let outerCount = 0

    for (const x of presentation.particles.x) {
      const normalizedOffset = Math.abs(x - source.position.x) / halfWidth
      if (normalizedOffset <= 1 / 3) centerCount += 1
      if (normalizedOffset >= 2 / 3) outerCount += 1
    }

    expect(centerCount).toBeGreaterThan(outerCount * 1.5)
  })

  it('pillar 粒子轨迹如实沿当前流场从两侧继续向上', () => {
    const metrics = measurePillarTrajectory()

    expect(metrics.aroundPillarCount).toBeGreaterThan(0)
    expect(metrics.downstreamCount).toBeGreaterThan(0)
    expect(metrics.downstreamMeanOffset).toBeGreaterThan(
      metrics.aroundPillarMeanOffset * 0.9,
    )
    expect(metrics.downstreamCenterRatio).toBe(0)
  })
})
