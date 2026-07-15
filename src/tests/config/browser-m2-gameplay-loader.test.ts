import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  loadBrowserM2GameplayConfig,
  type BrowserM2GameplayLoaderOptions,
} from '../../config/browser-m2-gameplay-loader'

function validCompositionPng(): Uint8Array {
  const png = new PNG({ width: 64, height: 64 })
  png.data.fill(0)
  png.data.set([0, 255, 255, 255], 0)
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6 })
}

function validAppearancePng(): Uint8Array {
  const png = new PNG({ width: 512, height: 512 })
  png.data.fill(0)
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      png.data.set([64, 128, 72, 255], (y * 512 + x) * 4)
    }
  }
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6 })
}

function validPearlTypes() {
  const shared = {
    color: '#78E6D0',
    outlineColor: '#D9FFF6',
    spawnVelocity: { minX: -45, maxX: 45, minY: 60, maxY: 120 },
    gravity: 350,
    drift: 12,
    maxSpeed: 500,
    materialRestitution: 0.25,
    wallRestitution: 0.5,
    fireProtectionSeconds: 0.5,
    resetProtectionOnExit: true,
    burnDurationSeconds: 2.5,
    thrustAcceleration: 500,
  }
  return [
    { ...shared, id: 'medicinal-liquid', pearlType: 'medicinalLiquid', standardRadius: 24 },
    { ...shared, id: 'slag', pearlType: 'slag', standardRadius: 22 },
    { ...shared, id: 'impurity', pearlType: 'impurity', standardRadius: 20 },
  ]
}

function documents(): Record<string, unknown> {
  return {
    '/config/config-set.json': {
      schemaVersion: 1,
      parameters: '/config/parameters.json',
      materials: ['/config/materials/moon-leaf.json'],
    },
    '/config/parameters.json': { schemaVersion: 1 },
    '/config/materials/moon-leaf.json': {
      schemaVersion: 1,
      id: 'moon-leaf',
      nameZh: '月露叶',
      targetPearlCount: 24,
      compositionMapPath: '/assets/masks/moon-leaf-components.png',
      appearancePath: '/assets/materials/moon-leaf.png',
    },
    '/config/m2-config-set.json': {
      schemaVersion: 1,
      baseConfigSet: '/config/config-set.json',
      prototype: '/config/m2/prototype.json',
      fireSources: '/config/m2/fire-sources.json',
      pearlTypes: '/config/m2/pearl-types.json',
      collector: '/config/m2/collector.json',
    },
    '/config/m2/prototype.json': {
      schemaVersion: 1,
      seed: 123,
      logicalWidth: 1600,
      logicalHeight: 900,
      materialPlacement: {
        centerX: 800,
        centerY: 300,
        size: 180,
        offsetPerInstance: { x: 200, y: 0 },
        rotationDegreesPerInstance: 2,
      },
      availableFireSourceIds: ['basic-fire'],
      initialFireSize: 32,
      fireSizeWheelStep: 4,
      initialFireDirection: { x: 0, y: -1 },
      theme: {
        colors: {
          background: '#12100E',
          surface: '#201C18',
          surfaceRaised: '#2C2620',
          border: '#594B3D',
          text: '#F4EBDD',
          muted: '#B8AA98',
          accent: '#D19A45',
          danger: '#C65D4B',
          focus: '#F2C66D',
        },
        radius: 8,
      },
      inventoryBatches: [
        { batchId: 'moon-leaf-batch', materialDefinitionId: 'moon-leaf', servings: 3 },
      ],
    },
    '/config/m2/fire-sources.json': {
      schemaVersion: 1,
      fireSources: [
        {
          id: 'basic-fire',
          nameZh: '凡火',
          origin: { x: 800, y: 700 },
          halfAngleDegrees: 70,
          minWidth: 24,
          maxWidth: 280,
        },
      ],
    },
    '/config/m2/pearl-types.json': {
      schemaVersion: 1,
      pearlTypes: validPearlTypes(),
    },
    '/config/m2/collector.json': {
      schemaVersion: 1,
      initialX: 800,
      y: 820,
      width: 180,
      height: 48,
      minX: 160,
      maxX: 1440,
      acceleration: 1200,
      deceleration: 1600,
      maxSpeed: 500,
    },
  }
}

function options(overrides: Record<string, unknown> = {}): BrowserM2GameplayLoaderOptions {
  const json = { ...documents(), ...overrides }
  const png = validCompositionPng()
  const appearance = validAppearancePng()
  return {
    fetch: async (input) => {
      const path = String(input)
      if (path === '/assets/masks/moon-leaf-components.png') {
        return new Response(Uint8Array.from(png).buffer)
      }
      if (path.startsWith('/assets/materials/')) {
        return new Response(Uint8Array.from(appearance).buffer)
      }
      const value = json[path]
      return value === undefined ? new Response('', { status: 404 }) : Response.json(value)
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

describe('loadBrowserM2GameplayConfig', () => {
  it('加载 base + M2 规则，返回深冻结配置与统一 fingerprint', async () => {
    const result = await loadBrowserM2GameplayConfig(options())

    expect(result).toMatchObject({
      ok: true,
      config: {
        base: { materials: [{ id: 'moon-leaf' }] },
        gameplay: {
          prototype: { availableFireSourceIds: ['basic-fire'], fireSizeWheelStep: 4 },
          pearlTypes: expect.any(Array),
        },
      },
      compositionMaps: [
        expect.objectContaining({
          filePath: '/assets/masks/moon-leaf-components.png',
          width: 64,
          height: 64,
        }),
      ],
      simulationContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    if (result.ok) {
      expect(result.config.gameplay.pearlTypes.map(({ pearlType }) => pearlType)).toEqual([
        'medicinalLiquid',
        'slag',
        'impurity',
      ])
    }
    if (result.ok) {
      expect(Object.isFrozen(result.config.gameplay.collector)).toBe(true)
      expect(Object.isFrozen(result.compositionMaps)).toBe(true)
    }
  })

  it('规则变化改变 fingerprint，nameZh/appearancePath 变化不改变', async () => {
    const baseResult = await loadBrowserM2GameplayConfig(options())
    const renamedMaterial = {
      ...(documents()['/config/materials/moon-leaf.json'] as object),
      nameZh: '重命名药材',
      appearancePath: '/assets/materials/renamed.png',
    }
    const renamedFireSources = structuredClone(
      documents()['/config/m2/fire-sources.json'],
    ) as { fireSources: Array<{ nameZh: string }> }
    renamedFireSources.fireSources[0]!.nameZh = '重命名火种'
    const rethemedPrototype = structuredClone(
      documents()['/config/m2/prototype.json'],
    ) as { theme: { colors: { accent: string }; radius: number } }
    rethemedPrototype.theme.colors.accent = '#00AAFF'
    rethemedPrototype.theme.radius = 24
    const presentationResult = await loadBrowserM2GameplayConfig(
      options({
        '/config/materials/moon-leaf.json': renamedMaterial,
        '/config/m2/fire-sources.json': renamedFireSources,
        '/config/m2/prototype.json': rethemedPrototype,
      }),
    )
    const changedPearlTypes = structuredClone(
      documents()['/config/m2/pearl-types.json'],
    ) as { pearlTypes: Array<{ gravity: number }> }
    changedPearlTypes.pearlTypes[0]!.gravity += 1
    const ruleResult = await loadBrowserM2GameplayConfig(
      options({ '/config/m2/pearl-types.json': changedPearlTypes }),
    )

    expect(baseResult.ok && presentationResult.ok && ruleResult.ok).toBe(true)
    if (baseResult.ok && presentationResult.ok && ruleResult.ok) {
      expect(presentationResult.simulationContentFingerprint).toBe(
        baseResult.simulationContentFingerprint,
      )
      expect(ruleResult.simulationContentFingerprint).not.toBe(
        baseResult.simulationContentFingerprint,
      )
    }
  })

  it.each([
    ['fireSizeWheelStep', '/config/m2/prototype.json'],
    ['materialRestitution', '/config/m2/pearl-types.json'],
    ['materialPlacement', '/config/m2/prototype.json'],
  ] as const)('%s 变化会改变 fingerprint', async (field, path) => {
    const baseResult = await loadBrowserM2GameplayConfig(options())
    const changed = structuredClone(documents()[path]) as Record<string, unknown>
    if (field === 'fireSizeWheelStep') {
      changed.fireSizeWheelStep = 8
    } else if (field === 'materialPlacement') {
      ;(changed.materialPlacement as {
        offsetPerInstance: { x: number }
      }).offsetPerInstance.x += 1
    } else {
      const pearlTypes = changed.pearlTypes as Array<{ materialRestitution: number }>
      pearlTypes[0]!.materialRestitution = 0.4
    }
    const changedResult = await loadBrowserM2GameplayConfig(options({ [path]: changed }))

    expect(baseResult.ok && changedResult.ok).toBe(true)
    if (baseResult.ok && changedResult.ok) {
      expect(changedResult.simulationContentFingerprint).not.toBe(
        baseResult.simulationContentFingerprint,
      )
    }
  })

  it('M3 在进入运行时前稳定拒绝未登记的成分颜色', async () => {
    const purple = validCompositionPng()
    const decoded = PNG.sync.read(Buffer.from(purple))
    decoded.data.set([255, 0, 0, 255], 0)
    const purpleBytes = PNG.sync.write(decoded, { colorType: 6, inputColorType: 6 })
    const baseOptions = options()
    const result = await loadBrowserM2GameplayConfig({
      ...baseOptions,
      fetch: async (input) =>
        String(input) === '/assets/masks/moon-leaf-components.png'
          ? new Response(Uint8Array.from(purpleBytes).buffer)
          : baseOptions.fetch!(input),
    })

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_ASSET_INVALID_COLOR',
          filePath: '/assets/masks/moon-leaf-components.png',
          fieldPath: '/pixels/0/0',
        }),
      ],
    })
  })

  it('在进入运行时前完整解码外观 PNG 并拒绝与成分轮廓错位', async () => {
    const baseOptions = options()
    const appearance = PNG.sync.read(Buffer.from(validAppearancePng()))
    appearance.data.set([64, 128, 72, 255], 8 * 4)
    const misaligned = PNG.sync.write(appearance, { colorType: 6, inputColorType: 6 })
    const result = await loadBrowserM2GameplayConfig({
      ...baseOptions,
      fetch: async (input) =>
        String(input).startsWith('/assets/materials/')
          ? new Response(Uint8Array.from(misaligned).buffer)
          : baseOptions.fetch!(input),
    })

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_ASSET_INVALID_COLOR',
          filePath: '/assets/materials/moon-leaf.png',
          fieldPath: '/pixels/0/8',
        }),
      ],
    })
  })

  it('加载器返回的 typed array 只是隔离副本，外部写入不会改写权威素材', async () => {
    const result = await loadBrowserM2GameplayConfig(options())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const map = result.compositionMaps[0]!
    const original = map.rgba[0]!

    map.rgba[0] = original ^ 0xff

    expect(map.rgba[0]).toBe(original)
  })
})
