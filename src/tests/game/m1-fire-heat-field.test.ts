import { describe, expect, it } from 'vitest'

import { M1_FIRE_PRESENTATION_CONFIG } from '../../game/m1/fire-presentation-config.ts'
import { M1FireHeatField } from '../../game/m1/fire-heat-field.ts'
import type { M1FireParticleView } from '../../game/m1/fire-presentation.ts'
import type { FireFlowReadView } from '../../simulation/fire-flow/index.ts'

function createPillarView(): FireFlowReadView {
  const columns = 80
  const rows = 45
  const obstacle = new Float32Array(columns * rows)
  for (let row = 16; row < 28; row += 1) {
    for (let column = 38; column < 42; column += 1) {
      obstacle[row * columns + column] = 1
    }
  }
  return {
    generation: 1,
    tick: 1,
    columns,
    rows,
    cellSize: 20,
    originX: 0,
    originY: 0,
    obstacle,
    flowX: new Float32Array(columns * rows),
    flowY: new Float32Array(columns * rows).fill(-1),
    intensity: new Uint8Array(columns * rows).fill(255),
  }
}

function createSplitParticles(): M1FireParticleView {
  const count = 18
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const flowX = new Float32Array(count)
  const flowY = new Float32Array(count).fill(-1)
  const displayOffsetX = new Float32Array(count)
  const displayOffsetY = new Float32Array(count)
  const trailScale = new Float32Array(count).fill(1.15)
  const sizeScale = new Float32Array(count).fill(1)
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1
    x[index] = 800 + side * (58 + (index % 3) * 7)
    y[index] = 300 + Math.floor(index / 2) * 58
  }
  return {
    count,
    x,
    y,
    flowX,
    flowY,
    displayOffsetX,
    displayOffsetY,
    trailScale,
    sizeScale,
  }
}

function createSingleCarrier(worldY: number): M1FireParticleView {
  return {
    count: 1,
    x: new Float32Array([800]),
    y: new Float32Array([worldY]),
    flowX: new Float32Array([0]),
    flowY: new Float32Array([-1]),
    displayOffsetX: new Float32Array(1),
    displayOffsetY: new Float32Array(1),
    trailScale: new Float32Array([1]),
    sizeScale: new Float32Array([1]),
  }
}

function createDenseLowerCarriers(): M1FireParticleView {
  const columns = 14
  const rows = 9
  const count = columns * rows
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const flowX = new Float32Array(count)
  const flowY = new Float32Array(count).fill(-1)
  const displayOffsetX = new Float32Array(count)
  const displayOffsetY = new Float32Array(count)
  const trailScale = new Float32Array(count).fill(1.15)
  const sizeScale = new Float32Array(count).fill(1)
  for (let index = 0; index < count; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    x[index] = 690 + (220 * column) / (columns - 1)
    y[index] = 640 + row * 18
  }
  return {
    count,
    x,
    y,
    flowX,
    flowY,
    displayOffsetX,
    displayOffsetY,
    trailScale,
    sizeScale,
  }
}

function createOpenView(): FireFlowReadView {
  const view = createPillarView()
  return {
    ...view,
    obstacle: new Float32Array(view.columns * view.rows),
  }
}

function createCoarseCircleObstacleView(): FireFlowReadView {
  const view = createOpenView()
  const obstacle = new Float32Array(view.columns * view.rows)
  for (let row = 33; row <= 36; row += 1) {
    for (let column = 38; column <= 41; column += 1) {
      obstacle[row * view.columns + column] = 0.25
    }
  }
  return { ...view, obstacle }
}

function maximumHeatNear(
  temperature: Float32Array,
  worldY: number,
): number {
  const { width, pixelScale } = M1_FIRE_PRESENTATION_CONFIG.heatField
  const centerX = Math.round(800 / pixelScale)
  const centerY = Math.round(worldY / pixelScale)
  const radiusX = Math.ceil(60 / pixelScale)
  const radiusY = Math.ceil(24 / pixelScale)
  let maximum = 0
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      maximum = Math.max(maximum, temperature[y * width + x]!)
    }
  }
  return maximum
}

function highHeatWidthAt(
  temperature: Float32Array,
  worldY: number,
  threshold: number,
): number {
  const { width, pixelScale } = M1_FIRE_PRESENTATION_CONFIG.heatField
  const row = Math.round(worldY / pixelScale)
  const minimumX = Math.round(680 / pixelScale)
  const maximumX = Math.round(920 / pixelScale)
  let first = -1
  let last = -1
  for (let x = minimumX; x <= maximumX; x += 1) {
    if (temperature[row * width + x]! < threshold) continue
    if (first < 0) first = x
    last = x
  }
  return first < 0 ? 0 : (last - first + 1) * pixelScale
}

function heatBoundingBox(
  temperature: Float32Array,
  minimumWorldY: number,
  maximumWorldY: number,
): { width: number; height: number } {
  const config = M1_FIRE_PRESENTATION_CONFIG.heatField
  let minimumX = config.width
  let maximumX = -1
  let minimumY = config.height
  let maximumY = -1
  const startY = Math.floor(minimumWorldY / config.pixelScale)
  const endY = Math.ceil(maximumWorldY / config.pixelScale)
  const startX = Math.floor(650 / config.pixelScale)
  const endX = Math.ceil(950 / config.pixelScale)
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (
        temperature[y * config.width + x]! <=
        config.transparentTemperature
      ) {
        continue
      }
      minimumX = Math.min(minimumX, x)
      maximumX = Math.max(maximumX, x)
      minimumY = Math.min(minimumY, y)
      maximumY = Math.max(maximumY, y)
    }
  }
  return {
    width: (maximumX - minimumX + 1) * config.pixelScale,
    height: (maximumY - minimumY + 1) * config.pixelScale,
  }
}

function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3]!
}

describe('M1 连续温度场火焰', () => {
  it('carrier 离喷口越远，高温峰值与高温宽度都明显衰减', () => {
    const source = {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    }
    const nearField = new M1FireHeatField(
      M1_FIRE_PRESENTATION_CONFIG.heatField,
    )
    nearField.render(createOpenView(), createSingleCarrier(700), source)
    const farField = new M1FireHeatField(
      M1_FIRE_PRESENTATION_CONFIG.heatField,
    )
    farField.render(createOpenView(), createSingleCarrier(180), source)

    const nearPeak = maximumHeatNear(nearField.temperature, 700)
    const farPeak = maximumHeatNear(farField.temperature, 180)
    const threshold = M1_FIRE_PRESENTATION_CONFIG.heatField.palette.middle.heat
    const nearWidth = highHeatWidthAt(nearField.temperature, 700, threshold)
    const farWidth = highHeatWidthAt(farField.temperature, 180, threshold)

    expect(farPeak).toBeLessThan(nearPeak * 0.75)
    expect(farWidth).toBeLessThan(nearWidth * 0.8)
  })

  it('单个 carrier 的热斑沿流向拉成长火舌，而不是近圆斑', () => {
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    field.render(createOpenView(), createSingleCarrier(240), {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    })

    const bounds = heatBoundingBox(field.temperature, 80, 480)
    expect(bounds.height).toBeGreaterThan(bounds.width * 1.7)
  })

  it('把 carrier 轨迹融合成连续焰体，并由柱体遮挡后保留左右两股火', () => {
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const frame = field.render(
      createPillarView(),
      createSplitParticles(),
      {
        position: { x: 800, y: 840 },
        direction: { x: 0, y: -1 },
        width: 240,
      },
      {
        fullObstacleRects: [
          { x: 760, y: 320, width: 80, height: 240, obstacleValue: 1 },
        ],
        circles: {
          count: 0,
          x: new Float32Array(0),
          y: new Float32Array(0),
          radius: new Float32Array(0),
          eligible: new Uint8Array(0),
        },
        circleRadiusScale: 0.82,
        circleFeatherPixels: 4,
      },
    )
    const row = Math.round(680 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    let longestWarmRun = 0
    let warmRun = 0
    for (let x = 130; x <= 190; x += 1) {
      if (alphaAt(frame.pixels, frame.width, x, row) >= 32) {
        warmRun += 1
        longestWarmRun = Math.max(longestWarmRun, warmRun)
      } else {
        warmRun = 0
      }
    }
    expect(longestWarmRun).toBeGreaterThanOrEqual(14)

    const pillarY = Math.round(420 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    expect(alphaAt(frame.pixels, frame.width, 160, pillarY)).toBe(0)
    expect(alphaAt(frame.pixels, frame.width, 146, pillarY)).toBeGreaterThan(20)
    expect(alphaAt(frame.pixels, frame.width, 174, pillarY)).toBeGreaterThan(20)
  })

  it('正常珠用圆形视觉遮挡，不把相交的 20px 流场格整块切成方洞', () => {
    const source = {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    }
    const particles = createDenseLowerCarriers()
    const openField = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const openFrame = openField.render(createOpenView(), particles, source)
    const roundedField = new M1FireHeatField(
      M1_FIRE_PRESENTATION_CONFIG.heatField,
    )
    const roundedFrame = roundedField.render(
      createCoarseCircleObstacleView(),
      particles,
      source,
      {
        fullObstacleRects: [],
        circles: {
          count: 1,
          x: new Float32Array([800]),
          y: new Float32Array([700]),
          radius: new Float32Array([32]),
          eligible: new Uint8Array([1]),
        },
        circleRadiusScale: 0.82,
        circleFeatherPixels: 4,
      },
    )
    const centerX = 160
    const centerY = 140
    const outsideCircleX = 167
    const outsideCircleY = 140
    const openOutsideAlpha = alphaAt(
      openFrame.pixels,
      openFrame.width,
      outsideCircleX,
      outsideCircleY,
    )

    expect(openOutsideAlpha).toBeGreaterThan(20)
    expect(
      alphaAt(roundedFrame.pixels, roundedFrame.width, centerX, centerY),
    ).toBe(0)
    expect(
      alphaAt(
        roundedFrame.pixels,
        roundedFrame.width,
        outsideCircleX,
        outsideCircleY,
      ),
    ).toBeGreaterThan(openOutsideAlpha * 0.6)
  })

  it('同时产出白黄高温焰心与暗红半透明外缘', () => {
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const frame = field.render(createPillarView(), createSplitParticles(), {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    })
    let hasHotCore = false
    let hasDarkOuter = false
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      const red = frame.pixels[offset]!
      const green = frame.pixels[offset + 1]!
      const blue = frame.pixels[offset + 2]!
      const alpha = frame.pixels[offset + 3]!
      if (alpha > 170 && red > 245 && green > 205 && blue > 115) hasHotCore = true
      if (alpha > 10 && alpha < 150 && red > green * 1.7 && green > blue) hasDarkOuter = true
    }
    expect(hasHotCore).toBe(true)
    expect(hasDarkOuter).toBe(true)
  })

  it('密集下部 carrier 仍只形成少量焰心，并在两侧保留暖色焰体', () => {
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const frame = field.render(createOpenView(), createDenseLowerCarriers(), {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    })
    const row = Math.round(730 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    const minimumX = Math.round(640 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    const maximumX = Math.round(960 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    const leftEdge = Math.round(740 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    const rightEdge = Math.round(860 / M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale)
    let warmCount = 0
    let hotCount = 0
    let leftWarmBodyCount = 0
    let rightWarmBodyCount = 0
    for (let x = minimumX; x <= maximumX; x += 1) {
      const offset = (row * frame.width + x) * 4
      const red = frame.pixels[offset]!
      const green = frame.pixels[offset + 1]!
      const blue = frame.pixels[offset + 2]!
      const alpha = frame.pixels[offset + 3]!
      const isWarm = alpha >= M1_FIRE_PRESENTATION_CONFIG.heatField.palette.outer.alpha
      const isHot = alpha >= 220 && red >= 248 && green >= 180 && blue >= 100
      if (isWarm) warmCount += 1
      if (isHot) hotCount += 1
      if (isWarm && !isHot && x <= leftEdge) leftWarmBodyCount += 1
      if (isWarm && !isHot && x >= rightEdge) rightWarmBodyCount += 1
    }

    expect.soft(hotCount / warmCount).toBeLessThan(0.55)
    expect.soft(leftWarmBodyCount).toBeGreaterThan(0)
    expect.soft(rightWarmBodyCount).toBeGreaterThan(0)
  })

  it('喷口背向一侧超过 5px 后不残留火焰像素', () => {
    const source = {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    }
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const frame = field.render(createOpenView(), createSingleCarrier(820), source)
    let maximumBackAlpha = 0

    for (let y = 0; y < frame.height; y += 1) {
      const worldY = (y + 0.5) * M1_FIRE_PRESENTATION_CONFIG.heatField.pixelScale
      if (
        worldY <=
        source.position.y + M1_FIRE_PRESENTATION_CONFIG.heatField.sourceBackClipPixels
      ) {
        continue
      }
      for (let x = 0; x < frame.width; x += 1) {
        maximumBackAlpha = Math.max(
          maximumBackAlpha,
          alphaAt(frame.pixels, frame.width, x, y),
        )
      }
    }

    expect(maximumBackAlpha).toBe(0)
  })

  it('单 carrier 焰心逐行连续，并沿流向产生小幅横向卷曲', () => {
    const config = M1_FIRE_PRESENTATION_CONFIG.heatField
    const field = new M1FireHeatField(config)
    field.render(createOpenView(), createSingleCarrier(240), {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    })
    const startRow = Math.ceil(255 / config.pixelScale)
    const endRow = Math.floor(315 / config.pixelScale)
    const minimumX = Math.floor(760 / config.pixelScale)
    const maximumX = Math.ceil(840 / config.pixelScale)
    const centroids: number[] = []

    for (let y = startRow; y <= endRow; y += 1) {
      let weightedX = 0
      let totalHeat = 0
      for (let x = minimumX; x <= maximumX; x += 1) {
        const heat = field.temperature[y * config.width + x]!
        if (heat <= config.transparentTemperature) continue
        weightedX += (x + 0.5) * config.pixelScale * heat
        totalHeat += heat
      }
      if (totalHeat > 0) centroids.push(weightedX / totalHeat)
    }

    expect.soft(centroids).toHaveLength(endRow - startRow + 1)
    expect.soft(Math.max(...centroids) - Math.min(...centroids)).toBeGreaterThan(
      config.trailCurlPixels * 0.3,
    )
  })

  it('逐帧复用温度与像素缓冲区', () => {
    const field = new M1FireHeatField(M1_FIRE_PRESENTATION_CONFIG.heatField)
    const view = createPillarView()
    const particles = createSplitParticles()
    const source = {
      position: { x: 800, y: 840 },
      direction: { x: 0, y: -1 },
      width: 240,
    }
    const first = field.render(view, particles, source)
    const pixels = first.pixels
    const density = field.density
    const temperature = field.temperature
    const second = field.render(view, particles, source)
    expect(second).toBe(first)
    expect(second.pixels).toBe(pixels)
    expect(field.density).toBe(density)
    expect(field.temperature).toBe(temperature)
  })
})
