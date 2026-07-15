import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

import { canonicalizeCompositionMap } from '../src/config/assets'
import { computeSimulationContentFingerprint } from '../src/config/fingerprint'
import { createSimulationFingerprintInput } from '../src/config/fingerprint-input'
import { loadAndValidatePublicConfigWithAssets } from '../src/config/node-loader'

const LOGICAL_WIDTH = 1600
const LOGICAL_HEIGHT = 900
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const

interface BrowserFailures {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  failedResponses: string[]
}

function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    failedResponses: [],
  }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    failures.pageErrors.push(error.message)
  })
  page.on('requestfailed', (request) => {
    failures.failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? '未知错误'}`,
    )
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failures.failedResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  return failures
}

async function expectEmptyGameFitsViewport(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')

  const canvas = page.locator('canvas[data-game="liandan"]')
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-logical-width', String(LOGICAL_WIDTH))
  await expect(canvas).toHaveAttribute('data-logical-height', String(LOGICAL_HEIGHT))

  const metrics = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement
    const bounds = canvasElement.getBoundingClientRect()

    return {
      backingWidth: canvasElement.width,
      backingHeight: canvasElement.height,
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })

  expect(metrics.backingWidth).toBe(LOGICAL_WIDTH)
  expect(metrics.backingHeight).toBe(LOGICAL_HEIGHT)
  expect(metrics.displayWidth).toBeGreaterThan(0)
  expect(metrics.displayHeight).toBeGreaterThan(0)
  expect(metrics.left).toBeGreaterThanOrEqual(-0.5)
  expect(metrics.top).toBeGreaterThanOrEqual(-0.5)
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 0.5)
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 0.5)
  expect(metrics.displayWidth / metrics.displayHeight).toBeCloseTo(
    LOGICAL_WIDTH / LOGICAL_HEIGHT,
    2,
  )
}

test.describe('M0 Phaser 空场景', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}×${viewport.height} 等比缩放且不裁切`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/?mode=technical')

      await expectEmptyGameFitsViewport(page)
    })
  }
})

test('冷启动没有浏览器控制台错误或失败资源请求', async ({ page }) => {
  const failures = observeBrowserFailures(page)

  await page.goto('/?mode=technical')
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  await page.waitForLoadState('networkidle')

  expect(failures).toEqual({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    failedResponses: [],
  })
})

test('parameters.json 越界时显示中文错误且不创建 Canvas', async ({ page }) => {
  await page.route('**/config/parameters.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json; charset=utf-8',
      json: {
        schemaVersion: 1,
        standardPearlVolume: 0,
        slagUnitVolume: 100,
      },
      status: 200,
    })
  })

  await page.goto('/?mode=technical')

  const error = page.locator('[data-config-error]')
  await expect(error).toHaveAttribute('role', 'alert')
  await expect(error).toContainText('配置加载失败')
  await expect(error.locator('[data-config-error-code]')).toContainText(
    'CONFIG_VALUE_OUT_OF_RANGE',
  )
  await expect(error).toContainText('标准珠体积必须是有限正数')
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'config-error')
})

test('gAMA 与透明隐藏 RGB 不改变跨端 canonical RGBA 指纹', async ({
  page,
}) => {
  const rgba = Buffer.alloc(64 * 64 * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set([128, 128, 128, 255], offset)
  }
  rgba.set([200, 100, 50, 0], 0)
  const image = new PNG({ width: 64, height: 64 })
  image.data.set(rgba)
  image.gamma = 1
  const png = PNG.sync.write(image, { colorType: 6, inputColorType: 6 })
  const decoded = PNG.sync.read(png)
  const canonical = canonicalizeCompositionMap({
    filePath: '/assets/masks/red_whisker_ginseng-components.png',
    width: decoded.width,
    height: decoded.height,
    rgba: Uint8Array.from(decoded.data),
  })
  const production = loadAndValidatePublicConfigWithAssets(process.cwd())
  if (!production.ok) throw new Error(JSON.stringify(production.issues))
  const maps = production.compositionMaps.map((map) =>
    map.filePath === canonical.filePath ? canonical : map,
  )
  const expected = await computeSimulationContentFingerprint(
    createSimulationFingerprintInput(production.config, maps),
  )

  await page.route('**/assets/masks/red_whisker_ginseng-components.png', async (route) => {
    await route.fulfill({ body: png, contentType: 'image/png', status: 200 })
  })
  await page.goto('/?mode=technical')

  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  await expect(page.locator('canvas[data-game="liandan"]')).toHaveAttribute(
    'data-simulation-content-fingerprint',
    expected.simulationContentFingerprint,
  )
})

test('半透明成分像素在浏览器边界稳定拒绝', async ({ page }) => {
  const rgba = Buffer.alloc(64 * 64 * 4)
  rgba.set([0, 255, 255, 255], 0)
  rgba.set([128, 64, 32, 128], 4)
  const image = new PNG({ width: 64, height: 64 })
  image.data.set(rgba)
  image.gamma = 1
  const png = PNG.sync.write(image, { colorType: 6, inputColorType: 6 })

  await page.route('**/assets/masks/red_whisker_ginseng-components.png', async (route) => {
    await route.fulfill({ body: png, contentType: 'image/png', status: 200 })
  })
  await page.goto('/?mode=technical')

  const error = page.locator('[data-config-error]')
  await expect(error.locator('[data-config-error-code]')).toContainText(
    'CONFIG_ASSET_INVALID_COLOR',
  )
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'config-error')
})
