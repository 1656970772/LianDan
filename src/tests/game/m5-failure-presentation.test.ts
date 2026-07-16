import { describe, expect, it } from 'vitest'

import {
  M5FailurePresentation,
  type M5FailurePresentationConfig,
} from '../../game/extraction/m5-failure-presentation.ts'
import type {
  ExtractionMaterialReadView,
  ExtractionPearlReadView,
} from '../../simulation/index.ts'

const CONFIG: M5FailurePresentationConfig = Object.freeze({
  shatteringStartRatio: 0.24,
  gatheringStartRatio: 0.5,
  flyingStartRatio: 0.8,
  shardsPerSource: 3,
  maximumParticleCount: 8,
  scatterRadiusPixels: 48,
  particleRadiusPixels: 5,
  resultRadiusPixels: 28,
  furnaceBottomAnchor: { xRatio: 0.5, yRatio: 0.88 },
  resultAnchor: { xRatio: 0.5, yRatio: 0.5 },
})

function material(
  materialInstanceId: string,
  remainingVolume: number,
  x: number,
  y: number,
): ExtractionMaterialReadView {
  return {
    materialInstanceId,
    materialDefinitionId: `definition-${materialInstanceId}`,
    inventoryBatchId: `batch-${materialInstanceId}`,
    placement: {
      center: { x, y },
      width: 40,
      height: 28,
      rotationRadians: 0,
      layer: 0,
    },
    initialVolume: 10,
    remainingVolume,
    initialVolumeByType: { medicinalLiquid: 6, slag: 4, impurity: 0 },
    composition: new Array(64 * 64).fill(1),
    initialCellVolumes: [],
    remainingCellVolumes: [],
  }
}

function pearl(
  pearlId: string,
  state: ExtractionPearlReadView['state'],
  x: number,
  y: number,
): ExtractionPearlReadView {
  return {
    pearlId,
    sourceMaterialDefinitionId: 'definition-material-1',
    sourceMaterialInstanceId: 'material-1',
    pearlType: 'medicinalLiquid',
    tags: [],
    interactionProfileIds: [],
    currentVolume: 1,
    initialVolume: 1,
    radius: 9,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    state,
    shield: { active: false, exposureTicks: 0 },
    safeZone: { entered: false, enteredTick: null },
    interaction: { activeId: null, remainingTicks: 0 },
  }
}

function captureInput() {
  return {
    logicalWidth: 1_000,
    logicalHeight: 800,
    materials: [
      material('material-consumed', 0, 50, 50),
      material('material-1', 4, 180, 220),
    ],
    pearls: [
      pearl('pearl-active', 'active', 620, 260),
      pearl('pearl-caught', 'caught', 700, 700),
      pearl('pearl-missed', 'missed', 800, 500),
      pearl('pearl-burned', 'burned', 850, 500),
    ],
    collector: {
      center: { x: 520, y: 720 },
      width: 180,
      height: 80,
      velocityX: 0,
    },
  } as const
}

function distance(
  point: Readonly<{ x: number; y: number }>,
  target: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(point.x - target.x, point.y - target.y)
}

describe('M5FailurePresentation', () => {
  it('只从剩余药材、active 珠和 caught 内容建立稳定且有上限的失败源', () => {
    const presentation = new M5FailurePresentation(CONFIG)
    presentation.resetSession('session-1')

    const sources = presentation.captureSources('session-1', captureInput())

    expect(sources.map(({ sourceId, kind }) => ({ sourceId, kind }))).toEqual([
      { sourceId: 'material:material-1', kind: 'material' },
      { sourceId: 'active-pearl:pearl-active', kind: 'activePearl' },
      { sourceId: 'caught-pearl:pearl-caught', kind: 'caughtPearl' },
    ])
    expect(sources[2]?.origin).toEqual({ x: 520, y: 720 })

    const shattering = presentation.frame('session-1', 0.3)
    expect(shattering?.particles).toHaveLength(CONFIG.maximumParticleCount)
    expect(
      new Set(shattering?.particles.map(({ particleId }) => particleId)).size,
    ).toBe(CONFIG.maximumParticleCount)
  })

  it('按焦黑、从各源破碎、炉底汇聚、飞向逻辑中心生成确定性帧', () => {
    const presentation = new M5FailurePresentation(CONFIG)
    presentation.resetSession('session-1')
    const sources = presentation.captureSources('session-1', captureInput())

    const charred = presentation.frame('session-1', 0.12)
    expect(charred).toMatchObject({ state: 'charring' })
    expect(charred?.sourceVisuals).toHaveLength(3)
    expect(charred?.sourceVisuals.every(({ charred }) => charred)).toBe(true)

    const shatterStart = presentation.frame(
      'session-1',
      CONFIG.shatteringStartRatio,
    )
    expect(shatterStart).toMatchObject({ state: 'shattering' })
    for (const particle of shatterStart?.particles ?? []) {
      const source = sources.find(({ sourceId }) => sourceId === particle.sourceId)
      expect(particle.position).toEqual(source?.origin)
    }

    const furnaceBottom = { x: 500, y: 704 }
    const gatheringFrames = [0.55, 0.65, 0.75].map((progress) =>
      presentation.frame('session-1', progress),
    )
    for (let frameIndex = 1; frameIndex < gatheringFrames.length; frameIndex += 1) {
      const previous = gatheringFrames[frameIndex - 1]!
      const current = gatheringFrames[frameIndex]!
      expect(current.state).toBe('gathering')
      for (let particleIndex = 0; particleIndex < current.particles.length; particleIndex += 1) {
        expect(
          distance(current.particles[particleIndex]!.position, furnaceBottom),
        ).toBeLessThanOrEqual(
          distance(previous.particles[particleIndex]!.position, furnaceBottom),
        )
      }
    }

    const flying = presentation.frame('session-1', 0.9)
    expect(flying).toMatchObject({
      state: 'flying',
      result: { visible: true },
    })
    expect(flying?.result.position).not.toEqual(furnaceBottom)

    const result = presentation.frame('session-1', 1)
    expect(result).toMatchObject({
      state: 'result',
      result: { visible: true, position: { x: 500, y: 400 } },
    })
    expect(presentation.frame('session-1', 1)).toBe(result)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('reset 清空失败源与终态缓存，旧 session 帧不能污染新炉次', () => {
    const presentation = new M5FailurePresentation(CONFIG)
    presentation.resetSession('session-old')
    presentation.captureSources('session-old', captureInput())
    expect(presentation.frame('session-old', 1)?.state).toBe('result')

    const reset = presentation.resetSession('session-new')

    expect(reset).toMatchObject({ state: 'idle', sources: [], particles: [] })
    expect(presentation.frame('session-old', 1)).toBeNull()
    expect(presentation.getSources('session-new')).toEqual([])
    expect(presentation.captureSources('session-new', captureInput())).toHaveLength(3)
  })
})
