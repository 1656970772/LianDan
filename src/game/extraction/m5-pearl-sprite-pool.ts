import type { PearlType } from '../../domain/index.ts'

const PEARL_VISUAL_KINDS = Object.freeze([
  'medicinalLiquid',
  'slag',
  'impurity',
] as const satisfies readonly PearlType[])

export type M5PearlPoseTarget = {
  x: number
  y: number
  rotation: number
}

export type M5PearlSpriteDefinition = Readonly<{
  pearlId: string
  pearlType: PearlType
  sourceMaterialDefinitionId: string
  /** 纹理的标准半径；逐帧实际半径通过 Sprite scale 表达。 */
  radius: number
}>

export type M5PearlSpritePoolDiagnostics = Readonly<{
  capacity: number
  initializedCount: number
  activeCount: number
  activeHighWaterMark: number
  renderedFrameCount: number
  minimumRenderedCountPerFrame: number
  maximumRenderedCountPerFrame: number
  textureCount: number
  runtimeStorageGrowthCount: number
  visualKinds: readonly PearlType[]
  sealed: boolean
}>

/** 正式 shape/surface renderer 的最小共享契约；纹理池不复制轮廓规则。 */
export interface M5PearlSpriteRenderer<TSurface = unknown> {
  draw(
    surface: TSurface,
    pearlId: string,
    pearlType: PearlType,
    sourceMaterialDefinitionId: string,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    timestampMilliseconds: number,
    animated: boolean,
  ): void
  writePose(
    target: M5PearlPoseTarget,
    pearlId: string,
    pearlType: PearlType,
    x: number,
    y: number,
    radius: number,
    timestampMilliseconds: number,
    animated: boolean,
  ): void
}

/** Phaser/测试宿主适配层；池本身不依赖浏览器全局，便于审计复用与容量。 */
export interface M5PearlSpritePoolHost<TSurface, TSprite> {
  hasTexture(key: string): boolean
  createTexture(
    key: string,
    size: number,
    draw: (surface: TSurface, center: number) => void,
  ): void
  createSprite(textureKey: string, depth: number): TSprite
  setSpritePose(
    sprite: TSprite,
    x: number,
    y: number,
    rotation: number,
    alpha: number,
    scale: number,
  ): void
  hideSprite(sprite: TSprite): void
  destroySprite(sprite: TSprite): void
  removeTexture(key: string): void
}

export type M5PearlSpritePoolOptions = Readonly<{
  textureNamespace: string
  /** fixed benchmark 的完整容量，或玩家批次的初始容量。 */
  capacity: number
  /** 仅玩家批次设置；每次按该配置块增长，不构成最大数量上限。 */
  growthCapacity?: number
  depth: number
}>

function requireFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new RangeError(code)
}

function validateDefinition(definition: M5PearlSpriteDefinition): void {
  if (
    definition.pearlId.length === 0 ||
    definition.sourceMaterialDefinitionId.length === 0
  ) {
    throw new Error('M5_PEARL_SPRITE_DEFINITION_INVALID')
  }
  requireFinite(definition.radius, 'M5_PEARL_SPRITE_RADIUS_INVALID')
  if (definition.radius <= 0) {
    throw new RangeError('M5_PEARL_SPRITE_RADIUS_INVALID')
  }
}

/**
 * 玩家场景与 benchmark 共用的正式珠 Sprite 批次。纹理由 M5PearlRenderer
 * 完整 shape/material/surface 路径生成；逐帧只写 motion pose、scale 和可见性。
 * benchmark 预热后 seal，玩家场景以配置容量为初始块并只在实体集合增长时扩容。
 */
export class M5PearlSpritePool<TSurface = unknown, TSprite = unknown> {
  readonly #host: M5PearlSpritePoolHost<TSurface, TSprite>
  readonly #renderer: M5PearlSpriteRenderer<TSurface>
  readonly #textureNamespace: string
  readonly #depth: number
  readonly #growthCapacity: number | null
  #sprites: Array<TSprite | null>
  #pearlIds: Array<string | null>
  #pearlTypes: Array<PearlType | null>
  #sourceMaterialDefinitionIds: Array<string | null>
  #baseRadii: Float32Array
  #seenEpochs: Uint32Array
  readonly #textureKeyByStyle = new Map<string, string>()
  readonly #pose: M5PearlPoseTarget = { x: 0, y: 0, rotation: 0 }
  readonly #visualKindCounts = new Uint32Array(PEARL_VISUAL_KINDS.length)
  #initializedCount = 0
  #activeCount = 0
  #activeHighWaterMark = 0
  #renderedFrameCount = 0
  #minimumRenderedCountPerFrame = Number.MAX_SAFE_INTEGER
  #maximumRenderedCountPerFrame = 0
  #runtimeStorageGrowthCount = 0
  #frameEpoch = 0
  #frameOpen = false
  #sealed = false

  constructor(
    host: M5PearlSpritePoolHost<TSurface, TSprite>,
    renderer: M5PearlSpriteRenderer<TSurface>,
    options: M5PearlSpritePoolOptions,
  ) {
    if (
      !Number.isSafeInteger(options.capacity) ||
      options.capacity <= 0 ||
      options.textureNamespace.length === 0 ||
      !Number.isFinite(options.depth) ||
      (options.growthCapacity !== undefined &&
        (!Number.isSafeInteger(options.growthCapacity) ||
          options.growthCapacity <= 0))
    ) {
      throw new RangeError('M5_PEARL_SPRITE_POOL_CONFIG_INVALID')
    }
    this.#host = host
    this.#renderer = renderer
    this.#textureNamespace = options.textureNamespace
    this.#depth = options.depth
    this.#growthCapacity = options.growthCapacity ?? null
    this.#sprites = new Array<TSprite | null>(options.capacity).fill(null)
    this.#pearlIds = new Array<string | null>(options.capacity).fill(null)
    this.#pearlTypes = new Array<PearlType | null>(options.capacity).fill(null)
    this.#sourceMaterialDefinitionIds = new Array<string | null>(
      options.capacity,
    ).fill(null)
    this.#baseRadii = new Float32Array(options.capacity)
    this.#seenEpochs = new Uint32Array(options.capacity)
  }

  get capacity(): number {
    return this.#sprites.length
  }

  get runtimeStorageGrowthCount(): number {
    return this.#runtimeStorageGrowthCount
  }

  /** fixed benchmark 在采样前逐槽预热。 */
  prewarm(index: number, definition: M5PearlSpriteDefinition): void {
    if (
      this.#sealed ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.#sprites.length ||
      this.#sprites[index] !== null
    ) {
      throw new Error('M5_PEARL_SPRITE_POOL_PREWARM_INVALID')
    }
    validateDefinition(definition)
    this.#initialize(index, definition)
  }

  /** 玩家路径：同一槽位定义未变时零分配，超过初始容量时按配置块增长。 */
  ensure(index: number, definition: M5PearlSpriteDefinition): void {
    if (
      this.#sealed ||
      this.#growthCapacity === null ||
      !Number.isSafeInteger(index) ||
      index < 0
    ) {
      throw new Error('M5_PEARL_SPRITE_POOL_ENSURE_INVALID')
    }
    validateDefinition(definition)
    this.#ensureCapacity(index + 1)
    if (
      this.#pearlIds[index] === definition.pearlId &&
      this.#pearlTypes[index] === definition.pearlType &&
      this.#sourceMaterialDefinitionIds[index] ===
        definition.sourceMaterialDefinitionId &&
      this.#baseRadii[index] === definition.radius
    ) {
      return
    }
    const oldSprite = this.#sprites[index]
    const oldType = this.#pearlTypes[index]
    if (oldSprite !== null) {
      this.#host.destroySprite(oldSprite)
      this.#initializedCount -= 1
      if (oldType !== null) {
        const oldTypeIndex = PEARL_VISUAL_KINDS.indexOf(oldType)
        this.#visualKindCounts[oldTypeIndex] -= 1
      }
    }
    this.#initialize(index, definition)
  }

  seal(): void {
    if (
      this.#growthCapacity !== null ||
      this.#sealed ||
      this.#initializedCount !== this.#sprites.length
    ) {
      throw new Error('M5_PEARL_SPRITE_POOL_SEAL_INVALID')
    }
    this.#sealed = true
  }

  beginFrame(): void {
    if (
      (!this.#sealed && this.#growthCapacity === null) ||
      this.#frameOpen
    ) {
      throw new Error('M5_PEARL_SPRITE_POOL_FRAME_INVALID')
    }
    this.#frameEpoch += 1
    if (this.#frameEpoch > 0xffff_ffff) {
      this.#seenEpochs.fill(0)
      this.#frameEpoch = 1
    }
    this.#activeCount = 0
    this.#frameOpen = true
  }

  render(
    index: number,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    timestampMilliseconds: number,
    animated: boolean,
  ): void {
    requireFinite(x, 'M5_PEARL_SPRITE_POSE_INVALID')
    requireFinite(y, 'M5_PEARL_SPRITE_POSE_INVALID')
    requireFinite(radius, 'M5_PEARL_SPRITE_POSE_INVALID')
    requireFinite(alpha, 'M5_PEARL_SPRITE_POSE_INVALID')
    requireFinite(timestampMilliseconds, 'M5_PEARL_SPRITE_POSE_INVALID')
    const sprite = this.#sprites[index]
    const pearlId = this.#pearlIds[index]
    const pearlType = this.#pearlTypes[index]
    const baseRadius = this.#baseRadii[index]
    if (
      !this.#frameOpen ||
      radius <= 0 ||
      sprite === undefined ||
      sprite === null ||
      pearlId === undefined ||
      pearlId === null ||
      pearlType === undefined ||
      pearlType === null ||
      baseRadius === undefined ||
      baseRadius <= 0
    ) {
      throw new Error('M5_PEARL_SPRITE_POOL_RENDER_INVALID')
    }
    if (this.#seenEpochs[index] === this.#frameEpoch) {
      throw new Error('M5_PEARL_SPRITE_POOL_DUPLICATE_RENDER')
    }
    this.#seenEpochs[index] = this.#frameEpoch
    this.#renderer.writePose(
      this.#pose,
      pearlId,
      pearlType,
      x,
      y,
      radius,
      timestampMilliseconds,
      animated,
    )
    this.#host.setSpritePose(
      sprite,
      this.#pose.x,
      this.#pose.y,
      this.#pose.rotation,
      Math.max(0, Math.min(1, alpha)),
      radius / baseRadius,
    )
    this.#activeCount += 1
    this.#activeHighWaterMark = Math.max(
      this.#activeHighWaterMark,
      this.#activeCount,
    )
  }

  endFrame(recordDiagnostics = true): void {
    if (!this.#frameOpen) {
      throw new Error('M5_PEARL_SPRITE_POOL_FRAME_INVALID')
    }
    for (let index = 0; index < this.#sprites.length; index += 1) {
      const sprite = this.#sprites[index]
      if (sprite !== null && this.#seenEpochs[index] !== this.#frameEpoch) {
        this.#host.hideSprite(sprite)
      }
    }
    if (recordDiagnostics) {
      this.#renderedFrameCount += 1
      this.#minimumRenderedCountPerFrame = Math.min(
        this.#minimumRenderedCountPerFrame,
        this.#activeCount,
      )
      this.#maximumRenderedCountPerFrame = Math.max(
        this.#maximumRenderedCountPerFrame,
        this.#activeCount,
      )
    }
    this.#frameOpen = false
  }

  resetFrameDiagnostics(): void {
    if (this.#frameOpen) {
      throw new Error('M5_PEARL_SPRITE_POOL_FRAME_INVALID')
    }
    this.#activeHighWaterMark = 0
    this.#renderedFrameCount = 0
    this.#minimumRenderedCountPerFrame = Number.MAX_SAFE_INTEGER
    this.#maximumRenderedCountPerFrame = 0
  }

  reset(): void {
    if (this.#frameOpen) this.endFrame()
    for (let index = 0; index < this.#sprites.length; index += 1) {
      const sprite = this.#sprites[index]
      if (sprite !== null) this.#host.hideSprite(sprite)
    }
    this.#activeCount = 0
    this.resetFrameDiagnostics()
  }

  getDiagnostics(): M5PearlSpritePoolDiagnostics {
    return {
      capacity: this.#sprites.length,
      initializedCount: this.#initializedCount,
      activeCount: this.#activeCount,
      activeHighWaterMark: this.#activeHighWaterMark,
      renderedFrameCount: this.#renderedFrameCount,
      minimumRenderedCountPerFrame:
        this.#minimumRenderedCountPerFrame === Number.MAX_SAFE_INTEGER
          ? 0
          : this.#minimumRenderedCountPerFrame,
      maximumRenderedCountPerFrame: this.#maximumRenderedCountPerFrame,
      textureCount: this.#textureKeyByStyle.size,
      runtimeStorageGrowthCount: this.#runtimeStorageGrowthCount,
      visualKinds: PEARL_VISUAL_KINDS.filter(
        (_, index) => this.#visualKindCounts[index]! > 0,
      ),
      sealed: this.#sealed,
    }
  }

  destroy(): void {
    if (this.#frameOpen) this.#frameOpen = false
    for (let index = 0; index < this.#sprites.length; index += 1) {
      const sprite = this.#sprites[index]
      if (sprite !== null) this.#host.destroySprite(sprite)
      this.#sprites[index] = null
      this.#pearlIds[index] = null
      this.#pearlTypes[index] = null
      this.#sourceMaterialDefinitionIds[index] = null
    }
    for (const textureKey of this.#textureKeyByStyle.values()) {
      this.#host.removeTexture(textureKey)
    }
    this.#textureKeyByStyle.clear()
    this.#visualKindCounts.fill(0)
    this.#initializedCount = 0
    this.#activeCount = 0
    this.#activeHighWaterMark = 0
    this.#renderedFrameCount = 0
    this.#minimumRenderedCountPerFrame = Number.MAX_SAFE_INTEGER
    this.#maximumRenderedCountPerFrame = 0
    this.#runtimeStorageGrowthCount = 0
    this.#sealed = false
  }

  #initialize(index: number, definition: M5PearlSpriteDefinition): void {
    const materialKey =
      definition.pearlType === 'medicinalLiquid'
        ? definition.sourceMaterialDefinitionId
        : 'shared'
    const styleKey = `${definition.pearlType}:${materialKey}:${definition.radius}`
    let textureKey = this.#textureKeyByStyle.get(styleKey)
    if (textureKey === undefined) {
      textureKey = `${this.#textureNamespace}-${this.#textureKeyByStyle.size}`
      const textureSize = Math.max(8, Math.ceil(definition.radius * 4))
      this.#host.createTexture(textureKey, textureSize, (surface, center) => {
        this.#renderer.draw(
          surface,
          `${this.#textureNamespace}-texture-${styleKey}`,
          definition.pearlType,
          definition.sourceMaterialDefinitionId,
          center,
          center,
          definition.radius,
          1,
          0,
          false,
        )
      })
      if (!this.#host.hasTexture(textureKey)) {
        throw new Error('M5_PEARL_SPRITE_TEXTURE_CREATE_FAILED')
      }
      this.#textureKeyByStyle.set(styleKey, textureKey)
    }
    this.#sprites[index] = this.#host.createSprite(textureKey, this.#depth)
    this.#pearlIds[index] = definition.pearlId
    this.#pearlTypes[index] = definition.pearlType
    this.#sourceMaterialDefinitionIds[index] =
      definition.sourceMaterialDefinitionId
    this.#baseRadii[index] = definition.radius
    this.#initializedCount += 1
    const typeIndex = PEARL_VISUAL_KINDS.indexOf(definition.pearlType)
    this.#visualKindCounts[typeIndex] += 1
  }

  #ensureCapacity(requiredCapacity: number): void {
    if (requiredCapacity <= this.#sprites.length) return
    const growthCapacity = this.#growthCapacity
    if (growthCapacity === null) {
      throw new Error('M5_PEARL_SPRITE_POOL_CAPACITY_EXCEEDED')
    }
    const oldCapacity = this.#sprites.length
    const blocks = Math.ceil((requiredCapacity - oldCapacity) / growthCapacity)
    const nextCapacity = oldCapacity + blocks * growthCapacity
    this.#sprites.length = nextCapacity
    this.#sprites.fill(null, oldCapacity)
    this.#pearlIds.length = nextCapacity
    this.#pearlIds.fill(null, oldCapacity)
    this.#pearlTypes.length = nextCapacity
    this.#pearlTypes.fill(null, oldCapacity)
    this.#sourceMaterialDefinitionIds.length = nextCapacity
    this.#sourceMaterialDefinitionIds.fill(null, oldCapacity)
    const nextBaseRadii = new Float32Array(nextCapacity)
    nextBaseRadii.set(this.#baseRadii)
    this.#baseRadii = nextBaseRadii
    const nextSeenEpochs = new Uint32Array(nextCapacity)
    nextSeenEpochs.set(this.#seenEpochs)
    this.#seenEpochs = nextSeenEpochs
    this.#runtimeStorageGrowthCount += 1
  }
}
