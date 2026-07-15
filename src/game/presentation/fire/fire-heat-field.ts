import type { FireFlowReadView } from '../../../simulation/fire-flow/index.ts'
import type {
  FireOcclusionRect,
  FirePresentationSource,
} from './contracts.ts'
import type { FireHeatFieldConfig } from './fire-presentation-config.ts'
import type { FireParticleView } from './fire-presentation.ts'

export type FireHeatFrame = Readonly<{
  width: number
  height: number
  pixels: Uint8ClampedArray<ArrayBuffer>
}>

export interface FireOcclusionInput {
  fullObstacleRects: readonly FireOcclusionRect[]
  circles: Readonly<{
    count: number
    x: Float32Array
    y: Float32Array
    radius: Float32Array
    eligible: Uint8Array
  }>
  circleRadiusScale: number
  circleFeatherPixels: number
  /**
   * 与热场像素一一对应的通用覆盖率遮罩。0 表示完全可见，255 表示完全遮挡。
   * 调用方负责把领域几何光栅化；热场只负责与矩形、圆形遮挡取最大值。
   */
  coverageMask?: Readonly<{
    width: number
    height: number
    coverage: Uint8Array
  }>
}

export type FireRevealInput = Readonly<{
  frontDistancePixels: number
  frontFeatherPixels: number
}>

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function interpolate(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

const TWO_PI = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * 把跟随权威流场的 carrier 融合为低分辨率 metaball 密度/温度双场。
 * 类本身不依赖 Canvas/Phaser，且逐帧复用密度、温度、RGBA 与 frame 对象。
 */
export class FireHeatField {
  readonly #config: FireHeatFieldConfig
  readonly #density: Float32Array<ArrayBuffer>
  readonly #temperature: Float32Array<ArrayBuffer>
  readonly #occlusion: Uint8Array<ArrayBuffer>
  readonly #pixels: Uint8ClampedArray<ArrayBuffer>
  readonly #frame: FireHeatFrame

  constructor(config: FireHeatFieldConfig) {
    this.#config = config
    const pixelCount = config.width * config.height
    this.#density = new Float32Array(pixelCount)
    this.#temperature = new Float32Array(pixelCount)
    this.#occlusion = new Uint8Array(pixelCount)
    this.#pixels = new Uint8ClampedArray(pixelCount * 4)
    this.#frame = Object.freeze({
      width: config.width,
      height: config.height,
      pixels: this.#pixels,
    })
  }

  get density(): Float32Array<ArrayBuffer> {
    return this.#density
  }

  get temperature(): Float32Array<ArrayBuffer> {
    return this.#temperature
  }

  get occlusion(): Uint8Array<ArrayBuffer> {
    return this.#occlusion
  }

  render(
    view: FireFlowReadView,
    particles: FireParticleView,
    source: FirePresentationSource,
    occlusion?: FireOcclusionInput,
    reveal?: FireRevealInput,
  ): FireHeatFrame {
    this.#density.fill(0)
    this.#temperature.fill(0)
    this.#pixels.fill(0)
    if (occlusion === undefined) {
      this.#occlusion.fill(0)
    } else {
      this.#rasterizeOcclusion(occlusion)
    }

    this.#splatSource(source)
    const sourceDirectionLength = Math.hypot(
      source.direction.x,
      source.direction.y,
    )
    const sourceDirectionX =
      sourceDirectionLength > 0.001
        ? source.direction.x / sourceDirectionLength
        : 0
    const sourceDirectionY =
      sourceDirectionLength > 0.001
        ? source.direction.y / sourceDirectionLength
        : 0
    for (let index = 0; index < particles.count; index += 1) {
      const x = particles.x[index]! + particles.displayOffsetX[index]!
      const y = particles.y[index]! + particles.displayOffsetY[index]!
      const riseDistance = Math.max(
        0,
        (x - source.position.x) * sourceDirectionX +
          (y - source.position.y) * sourceDirectionY,
      )
      const coolingRatio = Math.min(
        1,
        riseDistance / this.#config.coolingDistancePixels,
      )
      const heatScale = interpolate(
        1,
        this.#config.tipHeatScale,
        coolingRatio,
      )
      const radiusScale = interpolate(
        1,
        this.#config.tipRadiusScale,
        coolingRatio,
      )
      const radius =
        this.#config.headRadiusPixels *
        particles.sizeScale[index]! *
        radiusScale
      const trailLength =
        particles.trailScale[index]! * this.#config.trailLengthPixels
      const sampleCount = Math.max(
        1,
        Math.ceil(trailLength / this.#config.trailSampleSpacingPixels),
      )

      for (let sample = 1; sample <= sampleCount; sample += 1) {
        const distance = (trailLength * sample) / sampleCount
        const fade = 1 - sample / (sampleCount + 1)
        this.#splatAdditive(
          this.#density,
          x - particles.flowX[index]! * distance,
          y - particles.flowY[index]! * distance,
          radius * this.#config.trailRadiusScale,
          this.#config.trailDensity *
            heatScale *
            interpolate(
              this.#config.trailMinimumDensityScale,
              1,
              fade,
            ),
        )
      }

      const coreSampleCount = Math.max(
        1,
        Math.ceil(
          trailLength / this.#config.coreTrailSampleSpacingPixels,
        ),
      )
      const trailPhase = (index + 1) * GOLDEN_ANGLE
      const perpendicularX = -particles.flowY[index]!
      const perpendicularY = particles.flowX[index]!
      for (let sample = 1; sample <= coreSampleCount; sample += 1) {
        const sampleRatio = sample / coreSampleCount
        const distance = trailLength * sampleRatio
        const fade = 1 - sample / (coreSampleCount + 1)
        const curl =
          Math.sin(sampleRatio * Math.PI) *
          Math.sin(
            trailPhase +
              sampleRatio * this.#config.trailCurlCycles * TWO_PI,
          ) *
          this.#config.trailCurlPixels
        this.#splatMaximum(
          this.#temperature,
          x - particles.flowX[index]! * distance + perpendicularX * curl,
          y - particles.flowY[index]! * distance + perpendicularY * curl,
          radius * this.#config.coreRadiusScale,
          this.#config.coreTemperature *
            heatScale *
            interpolate(
              this.#config.coreTrailMinimumTemperatureScale,
              1,
              fade,
            ),
        )
      }
      this.#splatAdditive(
        this.#density,
        x,
        y,
        radius,
        this.#config.bodyDensity * heatScale,
      )
      this.#splatMaximum(
        this.#temperature,
        x,
        y,
        radius * this.#config.coreRadiusScale,
        this.#config.coreTemperature * heatScale,
      )
    }

    this.#writePixels(view, source, occlusion !== undefined, reveal)
    return this.#frame
  }

  #splatSource(source: FirePresentationSource): void {
    const directionLength = Math.hypot(source.direction.x, source.direction.y)
    if (directionLength <= 0.001) return
    const directionX = source.direction.x / directionLength
    const directionY = source.direction.y / directionLength
    const perpendicularX = -directionY
    const perpendicularY = directionX
    const sourceWidth = source.width * this.#config.sourceWidthScale
    const sourceRadius =
      this.#config.headRadiusPixels * this.#config.sourceRadiusScale
    const spacing = sourceRadius * 0.9
    const sampleCount = Math.max(2, Math.ceil(sourceWidth / spacing))
    for (let sample = 0; sample <= sampleCount; sample += 1) {
      const lateral = sourceWidth * (sample / sampleCount - 0.5)
      this.#splatAdditive(
        this.#density,
        source.position.x + perpendicularX * lateral + directionX * 10,
        source.position.y + perpendicularY * lateral + directionY * 10,
        sourceRadius,
        this.#config.sourceDensity,
      )
    }
  }

  #splatAdditive(
    field: Float32Array<ArrayBuffer>,
    worldX: number,
    worldY: number,
    radiusPixels: number,
    heat: number,
  ): void {
    const scale = this.#config.pixelScale
    const centerX = worldX / scale
    const centerY = worldY / scale
    const radius = Math.max(1, radiusPixels / scale)
    const radiusSquared = radius * radius
    const minimumX = Math.max(0, Math.floor(centerX - radius))
    const maximumX = Math.min(
      this.#config.width - 1,
      Math.ceil(centerX + radius),
    )
    const minimumY = Math.max(0, Math.floor(centerY - radius))
    const maximumY = Math.min(
      this.#config.height - 1,
      Math.ceil(centerY + radius),
    )

    for (let y = minimumY; y <= maximumY; y += 1) {
      const offsetY = y + 0.5 - centerY
      for (let x = minimumX; x <= maximumX; x += 1) {
        const offsetX = x + 0.5 - centerX
        const distanceSquared = offsetX * offsetX + offsetY * offsetY
        if (distanceSquared >= radiusSquared) continue
        const falloff = 1 - distanceSquared / radiusSquared
        field[y * this.#config.width + x] += heat * falloff
      }
    }
  }

  #splatMaximum(
    field: Float32Array<ArrayBuffer>,
    worldX: number,
    worldY: number,
    radiusPixels: number,
    heat: number,
  ): void {
    const scale = this.#config.pixelScale
    const centerX = worldX / scale
    const centerY = worldY / scale
    const radius = Math.max(1, radiusPixels / scale)
    const radiusSquared = radius * radius
    const minimumX = Math.max(0, Math.floor(centerX - radius))
    const maximumX = Math.min(
      this.#config.width - 1,
      Math.ceil(centerX + radius),
    )
    const minimumY = Math.max(0, Math.floor(centerY - radius))
    const maximumY = Math.min(
      this.#config.height - 1,
      Math.ceil(centerY + radius),
    )

    for (let y = minimumY; y <= maximumY; y += 1) {
      const offsetY = y + 0.5 - centerY
      for (let x = minimumX; x <= maximumX; x += 1) {
        const offsetX = x + 0.5 - centerX
        const distanceSquared = offsetX * offsetX + offsetY * offsetY
        if (distanceSquared >= radiusSquared) continue
        const falloff = 1 - distanceSquared / radiusSquared
        const fieldIndex = y * this.#config.width + x
        field[fieldIndex] = Math.max(field[fieldIndex]!, heat * falloff)
      }
    }
  }

  #rasterizeOcclusion(input: FireOcclusionInput): void {
    const scale = this.#config.pixelScale
    this.#occlusion.fill(0)

    for (const rect of input.fullObstacleRects) {
      const firstX = Math.max(0, Math.floor(rect.x / scale))
      const lastX = Math.min(
        this.#config.width - 1,
        Math.ceil((rect.x + rect.width) / scale) - 1,
      )
      const firstY = Math.max(0, Math.floor(rect.y / scale))
      const lastY = Math.min(
        this.#config.height - 1,
        Math.ceil((rect.y + rect.height) / scale) - 1,
      )
      for (let y = firstY; y <= lastY; y += 1) {
        const rowOffset = y * this.#config.width
        this.#occlusion.fill(255, rowOffset + firstX, rowOffset + lastX + 1)
      }
    }

    const coverageMask = input.coverageMask
    if (coverageMask !== undefined) {
      if (
        coverageMask.width !== this.#config.width ||
        coverageMask.height !== this.#config.height ||
        coverageMask.coverage.length !== this.#occlusion.length
      ) {
        throw new RangeError('FIRE_OCCLUSION_COVERAGE_MASK_SIZE_INVALID')
      }
      for (let index = 0; index < this.#occlusion.length; index += 1) {
        this.#occlusion[index] = Math.max(
          this.#occlusion[index]!,
          coverageMask.coverage[index]!,
        )
      }
    }

    const radiusScale = Math.max(0, input.circleRadiusScale)
    const feather = Math.max(0, input.circleFeatherPixels)
    for (let index = 0; index < input.circles.count; index += 1) {
      if (input.circles.eligible[index] === 0) continue
      const centerX = input.circles.x[index]!
      const centerY = input.circles.y[index]!
      const radius = input.circles.radius[index]! * radiusScale
      if (
        !Number.isFinite(centerX) ||
        !Number.isFinite(centerY) ||
        !Number.isFinite(radius) ||
        radius <= 0
      ) {
        continue
      }
      const innerRadius = Math.max(0, radius - feather / 2)
      const outerRadius = radius + feather / 2
      const innerRadiusSquared = innerRadius * innerRadius
      const outerRadiusSquared = outerRadius * outerRadius
      const firstX = Math.max(
        0,
        Math.floor((centerX - outerRadius) / scale),
      )
      const lastX = Math.min(
        this.#config.width - 1,
        Math.ceil((centerX + outerRadius) / scale) - 1,
      )
      const firstY = Math.max(
        0,
        Math.floor((centerY - outerRadius) / scale),
      )
      const lastY = Math.min(
        this.#config.height - 1,
        Math.ceil((centerY + outerRadius) / scale) - 1,
      )

      for (let y = firstY; y <= lastY; y += 1) {
        const worldY = (y + 0.5) * scale
        const deltaY = worldY - centerY
        const rowOffset = y * this.#config.width
        for (let x = firstX; x <= lastX; x += 1) {
          const worldX = (x + 0.5) * scale
          const deltaX = worldX - centerX
          const distanceSquared = deltaX * deltaX + deltaY * deltaY
          if (distanceSquared >= outerRadiusSquared) continue
          const coverage =
            feather <= 0 || distanceSquared <= innerRadiusSquared
              ? 255
              : clampByte(
                  (255 *
                    (outerRadius - Math.sqrt(distanceSquared))) /
                    feather,
                )
          const fieldIndex = rowOffset + x
          this.#occlusion[fieldIndex] = Math.max(
            this.#occlusion[fieldIndex]!,
            coverage,
          )
        }
      }
    }
  }

  #writePixels(
    view: FireFlowReadView,
    source: FirePresentationSource,
    preciseOcclusion: boolean,
    reveal: FireRevealInput | undefined,
  ): void {
    const { outer, middle, core } = this.#config.palette
    const sourceDirectionLength = Math.hypot(
      source.direction.x,
      source.direction.y,
    )
    const sourceDirectionX =
      sourceDirectionLength > 0.001
        ? source.direction.x / sourceDirectionLength
        : 0
    const sourceDirectionY =
      sourceDirectionLength > 0.001
        ? source.direction.y / sourceDirectionLength
        : 0
    for (let y = 0; y < this.#config.height; y += 1) {
      const worldY = (y + 0.5) * this.#config.pixelScale
      const row = Math.floor((worldY - view.originY) / view.cellSize)
      for (let x = 0; x < this.#config.width; x += 1) {
        const fieldIndex = y * this.#config.width + x
        const worldX = (x + 0.5) * this.#config.pixelScale
        const behindSource =
          sourceDirectionLength > 0.001 &&
          (worldX - source.position.x) * sourceDirectionX +
            (worldY - source.position.y) * sourceDirectionY <
            -this.#config.sourceBackClipPixels
        const column = Math.floor((worldX - view.originX) / view.cellSize)
        const outsideView =
          column < 0 ||
          column >= view.columns ||
          row < 0 ||
          row >= view.rows
        if (behindSource || outsideView) {
          this.#density[fieldIndex] = 0
          this.#temperature[fieldIndex] = 0
          continue
        }
        if (
          reveal !== undefined &&
          Number.isFinite(reveal.frontDistancePixels)
        ) {
          const forwardDistance =
            (worldX - source.position.x) * sourceDirectionX +
            (worldY - source.position.y) * sourceDirectionY
          const frontDistance = Math.max(0, reveal.frontDistancePixels)
          if (forwardDistance > frontDistance) {
            const feather = Math.max(0, reveal.frontFeatherPixels)
            const edgeRatio =
              feather > 0
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      (frontDistance + feather - forwardDistance) / feather,
                    ),
                  )
                : 0
            const visibility = edgeRatio * edgeRatio * (3 - 2 * edgeRatio)
            if (visibility <= 0) {
              this.#density[fieldIndex] = 0
              this.#temperature[fieldIndex] = 0
              continue
            }
            this.#density[fieldIndex] =
              this.#density[fieldIndex]! * visibility
            this.#temperature[fieldIndex] =
              this.#temperature[fieldIndex]! * visibility
          }
        }
        const viewIndex = row * view.columns + column
        const occlusionRatio = preciseOcclusion
          ? this.#occlusion[fieldIndex]! / 255
          : view.obstacle[viewIndex]! > 0
            ? 1
            : 0
        if (occlusionRatio >= 1) {
          this.#density[fieldIndex] = 0
          this.#temperature[fieldIndex] = 0
          continue
        }
        if (occlusionRatio > 0) {
          const visibility = 1 - occlusionRatio
          this.#density[fieldIndex] =
            this.#density[fieldIndex]! * visibility
          this.#temperature[fieldIndex] =
            this.#temperature[fieldIndex]! * visibility
        }

        const density =
          this.#density[fieldIndex]! * this.#config.densityExposure
        if (density <= this.#config.transparentDensity) continue
        const pixelOffset = fieldIndex * 4
        if (density < outer.heat) {
          const ratio =
            (density - this.#config.transparentDensity) /
            (outer.heat - this.#config.transparentDensity)
          this.#pixels[pixelOffset] = outer.red
          this.#pixels[pixelOffset + 1] = outer.green
          this.#pixels[pixelOffset + 2] = outer.blue
          this.#pixels[pixelOffset + 3] = clampByte(outer.alpha * ratio)
          continue
        }

        const densityRatio = Math.max(
          0,
          Math.min(1, (density - outer.heat) / (middle.heat - outer.heat)),
        )
        let red = interpolate(outer.red, middle.red, densityRatio)
        let green = interpolate(outer.green, middle.green, densityRatio)
        let blue = interpolate(outer.blue, middle.blue, densityRatio)
        const temperature =
          this.#temperature[fieldIndex]! * this.#config.temperatureExposure
        if (temperature > this.#config.transparentTemperature) {
          const coreRatio = Math.max(
            0,
            Math.min(
              1,
              (temperature - middle.heat) / (core.heat - middle.heat),
            ),
          )
          if (coreRatio > 0) {
            red = interpolate(middle.red, core.red, coreRatio)
            green = interpolate(middle.green, core.green, coreRatio)
            blue = interpolate(middle.blue, core.blue, coreRatio)
          }
        }
        const denseAlphaRatio = Math.max(
          0,
          Math.min(1, (density - middle.heat) / (core.heat - middle.heat)),
        )
        this.#pixels[pixelOffset] = clampByte(red)
        this.#pixels[pixelOffset + 1] = clampByte(green)
        this.#pixels[pixelOffset + 2] = clampByte(blue)
        this.#pixels[pixelOffset + 3] = clampByte(
          density < middle.heat
            ? interpolate(outer.alpha, middle.alpha, densityRatio)
            : interpolate(middle.alpha, core.alpha, denseAlphaRatio),
        )
      }
    }
  }
}
