import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  loadBrowserM2GameplayConfig,
  type BrowserM2GameplayLoaderOptions,
} from '../../config/browser-m2-gameplay-loader'
import { loadAndValidatePublicM2GameplayConfig } from '../../config/node-m2-gameplay-loader'
import { createM5AudioConfigFromPresentation } from '../../game/extraction/m5-audio-config'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const presentationPath = '/config/m2/presentation.json'

function presentationDocument(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(projectRoot, 'public/config/m2/presentation.json'), 'utf8'),
  ) as Record<string, unknown>
}

function browserOptions(
  presentationOverride?: Record<string, unknown>,
): BrowserM2GameplayLoaderOptions {
  return {
    fetch: async (input) => {
      const publicPath = String(input)
      if (publicPath === presentationPath && presentationOverride !== undefined) {
        return Response.json(presentationOverride)
      }
      try {
        const bytes = readFileSync(resolve(projectRoot, 'public', publicPath.slice(1)))
        return new Response(Uint8Array.from(bytes).buffer)
      } catch {
        return new Response('', { status: 404 })
      }
    },
    decodePng: async (bytes, filePath) => {
      const decoded = PNG.sync.read(Buffer.from(bytes))
      return {
        filePath,
        width: decoded.width,
        height: decoded.height,
        rgba: Uint8Array.from(decoded.data),
      }
    },
  }
}

describe('M5 presentation 配置边界', () => {
  it('Node 与 Browser loader 加载同一份深冻结表现配置和确定性指纹', async () => {
    const [nodeResult, browserResult] = await Promise.all([
      loadAndValidatePublicM2GameplayConfig(projectRoot),
      loadBrowserM2GameplayConfig(browserOptions()),
    ])

    expect(nodeResult.ok && browserResult.ok).toBe(true)
    if (!nodeResult.ok || !browserResult.ok) return
    expect(nodeResult.config.presentation).toMatchObject({
      temperature: { warmRatio: 0.25, blazingRatio: 0.75 },
      fire: {
        afterglowSeconds: expect.any(Number),
        geometry: {
          sourceWidthScale: expect.any(Number),
          bodyRadiusPixels: expect.any(Number),
          trailRadiusScale: expect.any(Number),
          tipRadiusScale: expect.any(Number),
          swayPixels: expect.any(Number),
          curlPixels: expect.any(Number),
          particleCount: expect.any(Number),
          bodyDensity: expect.any(Number),
          trailDensity: expect.any(Number),
        },
      },
      material: {
        maskScale: expect.any(Number),
        debrisLifetimeSeconds: expect.any(Number),
      },
      failure: {
        shatteringStartRatio: expect.any(Number),
        gatheringStartRatio: expect.any(Number),
        flyingStartRatio: expect.any(Number),
        shardsPerSource: expect.any(Number),
        maximumParticleCount: expect.any(Number),
        furnaceBottomAnchor: { xRatio: expect.any(Number), yRatio: expect.any(Number) },
        resultAnchor: { xRatio: 0.5, yRatio: 0.5 },
      },
      pearls: {
        medicinalLiquid: { shape: 'droplet', motion: 'swim', surface: 'glossy' },
        slag: { shape: 'clump', motion: 'tumble', surface: 'rough' },
        impurity: { shape: 'spike', motion: 'jitter', surface: 'smoky' },
      },
      audio: {
        initiallyMuted: true,
        profiles: { fireStart: expect.any(Object), failure: expect.any(Object) },
      },
      performance: {
        effectPoolInitialCapacity: 640,
        effectPoolMaximumCapacity: 1024,
      },
    })
    expect(Object.isFrozen(nodeResult.config.presentation.audio.profiles)).toBe(true)
    expect(
      createM5AudioConfigFromPresentation(nodeResult.config.presentation).initiallyMuted,
    ).toBe(true)
    expect(nodeResult.presentationContentFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(browserResult.presentationContentFingerprint).toBe(
      nodeResult.presentationContentFingerprint,
    )
  })

  it('纯表现变化不影响 simulation fingerprint，但改变 presentation fingerprint', async () => {
    const base = await loadBrowserM2GameplayConfig(browserOptions())
    const changed = structuredClone(presentationDocument()) as {
      fire: { core: { alpha: number } }
    }
    changed.fire.core.alpha -= 0.05
    const presentationChanged = await loadBrowserM2GameplayConfig(
      browserOptions(changed as unknown as Record<string, unknown>),
    )

    expect(base.ok && presentationChanged.ok).toBe(true)
    if (!base.ok || !presentationChanged.ok) return
    expect(presentationChanged.simulationContentFingerprint).toBe(
      base.simulationContentFingerprint,
    )
    expect(presentationChanged.presentationContentFingerprint).not.toBe(
      base.presentationContentFingerprint,
    )
  })

  it('在 loader 边界拒绝低于 2 倍的材料遮罩倍率', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      material: { maskScale: number }
    }
    invalid.material.maskScale = 1

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          filePath: presentationPath,
          fieldPath: '/material/maskScale',
        }),
      ],
    })
  })

  it('语义校验拒绝晚于火焰涌现完成时间的稳焰阈值', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      fire: { emergenceSeconds: number; steadyThresholdSeconds: number }
    }
    invalid.fire.steadyThresholdSeconds = invalid.fire.emergenceSeconds + 0.1

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: presentationPath,
          fieldPath: '/fire/steadyThresholdSeconds',
        }),
      ],
    })
  })

  it('语义校验拒绝不早于炽盛阈值的温火阈值', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      temperature: { warmRatio: number; blazingRatio: number }
    }
    invalid.temperature.warmRatio = invalid.temperature.blazingRatio

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: presentationPath,
          fieldPath: '/temperature/warmRatio',
        }),
      ],
    })
  })

  it('首版失败转化时长只接受约 1 到 1.5 秒', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      effects: { failureDurationSeconds: number }
    }
    invalid.effects.failureDurationSeconds = 3

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          filePath: presentationPath,
          fieldPath: '/effects/failureDurationSeconds',
        }),
      ],
    })
  })

  it.each([0.99, 1.51])(
    '减少动态效果的失败总时长 %s 秒仍必须处于 1 到 1.5 秒',
    async (duration) => {
      const invalid = structuredClone(presentationDocument()) as {
        accessibility: { reducedMotionFailureDurationSeconds: number }
      }
      invalid.accessibility.reducedMotionFailureDurationSeconds = duration

      const result = await loadBrowserM2GameplayConfig(
        browserOptions(invalid as unknown as Record<string, unknown>),
      )

      expect(result).toMatchObject({
        ok: false,
        issues: [
          expect.objectContaining({
            code: 'CONFIG_VALUE_OUT_OF_RANGE',
            filePath: presentationPath,
            fieldPath: '/accessibility/reducedMotionFailureDurationSeconds',
          }),
        ],
      })
    },
  )

  it('语义校验拒绝未严格递增的失败阶段比例', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      failure: {
        shatteringStartRatio: number
        gatheringStartRatio: number
        flyingStartRatio: number
      }
    }
    invalid.failure.gatheringStartRatio = invalid.failure.shatteringStartRatio

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: presentationPath,
          fieldPath: '/failure/gatheringStartRatio',
        }),
      ],
    })
  })

  it.each([
    ['furnaceBottomAnchor', 'xRatio', -0.01],
    ['resultAnchor', 'yRatio', 1.01],
  ] as const)('拒绝越界归一化锚点 %s.%s=%s', async (anchor, axis, value) => {
    const invalid = structuredClone(presentationDocument()) as {
      failure: Record<string, Record<string, number>>
    }
    invalid.failure[anchor]![axis] = value

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          fieldPath: `/failure/${anchor}/${axis}`,
        }),
      ],
    })
  })

  it.each([
    ['shardsPerSource', 0],
    ['maximumParticleCount', 0],
  ] as const)('拒绝非法失败粒子配置 %s=%s', async (field, value) => {
    const invalid = structuredClone(presentationDocument()) as {
      failure: Record<string, number>
    }
    invalid.failure[field] = value

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_VALUE_OUT_OF_RANGE',
          fieldPath: `/failure/${field}`,
        }),
      ],
    })
  })

  it('语义校验拒绝大于最大容量的特效池预热容量', async () => {
    const invalid = structuredClone(presentationDocument()) as {
      performance: {
        effectPoolInitialCapacity: number
        effectPoolMaximumCapacity: number
      }
    }
    invalid.performance.effectPoolInitialCapacity =
      invalid.performance.effectPoolMaximumCapacity + 1

    const result = await loadBrowserM2GameplayConfig(
      browserOptions(invalid as unknown as Record<string, unknown>),
    )

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_SCHEMA_VIOLATION',
          filePath: presentationPath,
          fieldPath: '/performance/effectPoolInitialCapacity',
        }),
      ],
    })
  })
})
