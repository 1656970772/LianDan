import { describe, expect, it, vi } from 'vitest'

import {
  M5PearlSpritePool,
  type M5PearlSpriteRenderer,
} from '../../game/extraction/m5-pearl-sprite-pool.ts'

class FakeImage {
  readonly setDepth = vi.fn((_depth: number) => this)
  readonly setPosition = vi.fn((_x: number, _y: number) => this)
  readonly setRotation = vi.fn((_rotation: number) => this)
  readonly setAlpha = vi.fn((_alpha: number) => this)
  readonly setVisible = vi.fn((_visible: boolean) => this)
  readonly setScale = vi.fn((_scale: number) => this)
  readonly destroy = vi.fn()
}

describe('M5 正式珠 Sprite 池', () => {
  it('按配置容量一次预热并跨帧复用同一显示对象，保留三类轮廓/材质纹理来源', () => {
    const textureKeys = new Set<string>()
    const images: FakeImage[] = []
    const graphics = {
      generateTexture: vi.fn((key: string) => textureKeys.add(key)),
      destroy: vi.fn(),
    }
    const host = {
      hasTexture: (key: string) => textureKeys.has(key),
      createTexture: vi.fn(
        (key: string, size: number, draw: (surface: typeof graphics, center: number) => void) => {
          draw(graphics, size / 2)
          graphics.generateTexture(key)
        },
      ),
      createSprite: vi.fn(() => {
        const image = new FakeImage()
        images.push(image)
        return image
      }),
      setSpritePose: vi.fn(
        (
          image: FakeImage,
          x: number,
          y: number,
          rotation: number,
          alpha: number,
          scale: number,
        ) => {
          image
            .setPosition(x, y)
            .setRotation(rotation)
            .setAlpha(alpha)
            .setScale(scale)
            .setVisible(true)
        },
      ),
      hideSprite: vi.fn((image: FakeImage) => image.setVisible(false)),
      destroySprite: vi.fn((image: FakeImage) => image.destroy()),
      removeTexture: vi.fn((key: string) => textureKeys.delete(key)),
    }
    const renderer: M5PearlSpriteRenderer = {
      draw: vi.fn(),
      writePose: vi.fn((target, pearlId, pearlType, x, y) => {
        target.x = x
        target.y = y
        target.rotation = pearlType === 'slag' ? pearlId.length : 0
      }),
    }
    const pool = new M5PearlSpritePool(
      host,
      renderer,
      { textureNamespace: 'unit', capacity: 4, depth: 3 },
    )
    const definitions = [
      ['liquid-a', 'medicinalLiquid', 'herb-a', 24],
      ['liquid-b', 'medicinalLiquid', 'herb-b', 24],
      ['slag', 'slag', 'herb-a', 22],
      ['impurity', 'impurity', 'herb-a', 20],
    ] as const
    definitions.forEach(
      ([pearlId, pearlType, sourceMaterialDefinitionId, radius], index) =>
        pool.prewarm(index, {
          pearlId,
          pearlType,
          sourceMaterialDefinitionId,
          radius,
        }),
    )
    pool.seal()

    pool.beginFrame()
    definitions.forEach((definition, index) =>
      pool.render(index, 10, 20, definition[3], 1, 0, true),
    )
    pool.endFrame()
    pool.beginFrame()
    definitions.forEach((definition, index) =>
      pool.render(index, 30, 40, definition[3], 1, 16, true),
    )
    pool.endFrame()

    expect(images).toHaveLength(4)
    expect(host.createSprite).toHaveBeenCalledTimes(4)
    expect(images.every((image) => image.setPosition.mock.calls.length === 2)).toBe(true)
    expect(pool.runtimeStorageGrowthCount).toBe(0)
    expect(pool.getDiagnostics()).toEqual({
      capacity: 4,
      initializedCount: 4,
      activeCount: 4,
      activeHighWaterMark: 4,
      renderedFrameCount: 2,
      minimumRenderedCountPerFrame: 4,
      maximumRenderedCountPerFrame: 4,
      textureCount: 4,
      runtimeStorageGrowthCount: 0,
      visualKinds: ['medicinalLiquid', 'slag', 'impurity'],
      sealed: true,
    })
    expect(renderer.draw).toHaveBeenCalledTimes(4)
  })

  it('同一帧重复提交同一槽位不能冒充全量珠渲染', () => {
    const textureKeys = new Set<string>()
    const host = {
      hasTexture: (key: string) => textureKeys.has(key),
      createTexture: (key: string, _size: number, draw: (surface: object, center: number) => void) => {
        draw({}, 0)
        textureKeys.add(key)
      },
      createSprite: () => ({}),
      setSpritePose: vi.fn(),
      hideSprite: vi.fn(),
      destroySprite: vi.fn(),
      removeTexture: (key: string) => textureKeys.delete(key),
    }
    const renderer: M5PearlSpriteRenderer = {
      draw: vi.fn(),
      writePose: vi.fn((target, _id, _type, x, y) => {
        target.x = x
        target.y = y
        target.rotation = 0
      }),
    }
    const pool = new M5PearlSpritePool(host, renderer, {
      textureNamespace: 'unique-probe',
      capacity: 4,
      depth: 3,
    })
    const definitions = [
      ['liquid-a', 'medicinalLiquid', 'herb-a', 24],
      ['liquid-b', 'medicinalLiquid', 'herb-b', 24],
      ['slag', 'slag', 'herb-a', 22],
      ['impurity', 'impurity', 'herb-a', 20],
    ] as const
    definitions.forEach(
      ([pearlId, pearlType, sourceMaterialDefinitionId, radius], index) =>
        pool.prewarm(index, {
          pearlId,
          pearlType,
          sourceMaterialDefinitionId,
          radius,
        }),
    )
    pool.seal()
    pool.beginFrame()
    pool.render(0, 10, 20, 24, 1, 0, true)

    expect(() => pool.render(0, 10, 20, 24, 1, 1, true)).toThrowError(
      'M5_PEARL_SPRITE_POOL_DUPLICATE_RENDER',
    )
    expect(pool.getDiagnostics().activeCount).toBe(1)
  })

  it('玩家批次以配置容量为初始块，仅在实体集合增长时扩容并复用动态半径 Sprite', () => {
    const textureKeys = new Set<string>()
    const images: FakeImage[] = []
    const host = {
      hasTexture: (key: string) => textureKeys.has(key),
      createTexture: (key: string, _size: number, draw: (surface: object, center: number) => void) => {
        draw({}, 0)
        textureKeys.add(key)
      },
      createSprite: () => {
        const image = new FakeImage()
        images.push(image)
        return image
      },
      setSpritePose: (
        image: FakeImage,
        x: number,
        y: number,
        rotation: number,
        alpha: number,
        scale: number,
      ) => image.setPosition(x, y).setRotation(rotation).setAlpha(alpha).setScale(scale).setVisible(true),
      hideSprite: vi.fn((image: FakeImage) => image.setVisible(false)),
      destroySprite: (image: FakeImage) => image.destroy(),
      removeTexture: (key: string) => textureKeys.delete(key),
    }
    const renderer: M5PearlSpriteRenderer = {
      draw: vi.fn(),
      writePose: vi.fn((target, _id, _type, x, y) => {
        target.x = x
        target.y = y
        target.rotation = 0
      }),
    }
    const pool = new M5PearlSpritePool(host, renderer, {
      textureNamespace: 'player-batch',
      capacity: 2,
      growthCapacity: 2,
      depth: 4,
    })
    pool.ensure(0, {
      pearlId: 'pearl-a',
      pearlType: 'medicinalLiquid',
      sourceMaterialDefinitionId: 'herb-a',
      radius: 24,
    })
    pool.ensure(1, {
      pearlId: 'pearl-b',
      pearlType: 'slag',
      sourceMaterialDefinitionId: 'herb-a',
      radius: 22,
    })
    expect(pool.runtimeStorageGrowthCount).toBe(0)

    pool.beginFrame()
    pool.render(0, 10, 20, 12, 1, 0, true)
    pool.render(1, 30, 40, 11, 1, 0, true)
    pool.endFrame()
    expect(images[0]!.setScale).toHaveBeenLastCalledWith(0.5)

    pool.ensure(2, {
      pearlId: 'pearl-c',
      pearlType: 'impurity',
      sourceMaterialDefinitionId: 'herb-b',
      radius: 20,
    })
    expect(pool.capacity).toBe(4)
    expect(pool.runtimeStorageGrowthCount).toBe(1)
    pool.beginFrame()
    pool.render(2, 50, 60, 20, 1, 16, true)
    pool.endFrame()
    expect(host.hideSprite).toHaveBeenCalledWith(images[0])
    expect(host.hideSprite).toHaveBeenCalledWith(images[1])

    pool.ensure(0, {
      pearlId: 'pearl-reused',
      pearlType: 'medicinalLiquid',
      sourceMaterialDefinitionId: 'herb-a',
      radius: 24,
    })
    expect(pool.runtimeStorageGrowthCount).toBe(1)
  })
})
