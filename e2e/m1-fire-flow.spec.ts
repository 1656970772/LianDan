import { expect, test, type Page } from '@playwright/test'

import type {
  M1BrowserApi,
  M1OverlayMode,
  M1Snapshot,
} from '../src/game/m1/contracts.ts'

declare global {
  interface Window {
    __LIANDAN_M1__?: M1BrowserApi
  }
}

async function openM1(
  page: Page,
  scenarioId: string,
  overlayMode: M1OverlayMode = 'reachable',
): Promise<M1Snapshot> {
  await page.goto(`/?scenario=${scenarioId}&overlay=${overlayMode}`)
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  const snapshot = await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot())
  expect(snapshot.ready).toBe(true)
  return snapshot
}

async function sampleInPage(page: Page, durationMilliseconds = 180): Promise<void> {
  const sample = await page.evaluate(
    (duration) => window.__LIANDAN_M1__!.startSample(duration),
    durationMilliseconds,
  )
  expect(sample.flowTimestamps.length).toBeGreaterThan(0)
  expect(sample.flowTimestamps).toHaveLength(
    sample.flowDurationsMilliseconds.length,
  )
}

test.describe('M1 火流技术场景', () => {
  test('真实首页默认展示可理解的动态火流，关闭后彻底停止展示层', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')

    const canvas = page.locator('canvas[data-game="liandan"]')
    const initial = await page.evaluate(() =>
      window.__LIANDAN_M1__!.getSnapshot(),
    )
    expect(initial.overlayMode).toBe('fire')
    await expect(canvas).toHaveAttribute('data-fire-renderer', 'heat-field')
    await expect(canvas).toHaveAttribute('data-fire-state', 'animated')
    await expect(canvas).toHaveAttribute('data-fire-particle-count', '280')
    await expect(page.locator('[data-scenario-summary]')).toContainText(
      '火从底部喷口向上',
    )
    await expect(page.getByText('运动火流', { exact: true })).toBeVisible()
    await expect(page.getByText('灰色物体', { exact: true })).toBeVisible()
    await expect(page.getByText('暗区', { exact: true })).toBeVisible()

    const firstFrame = Number(await canvas.getAttribute('data-fire-frame'))
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-fire-frame')))
      .toBeGreaterThan(firstFrame)

    const digest = initial.flowDigest
    await page.locator('button[data-overlay-mode="reachable"]').click()
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot().flowDigest),
    ).toBe(digest)
    await page.locator('button[data-overlay-mode="fire"]').click()
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot().flowDigest),
    ).toBe(digest)
    await page.locator('button[data-overlay-mode="none"]').click()
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot().flowDigest),
    ).toBe(digest)
    await expect(canvas).toHaveAttribute('data-fire-state', 'off')
    await expect(canvas).toHaveAttribute('data-fire-renderer', 'heat-field')
    await expect(canvas).toHaveAttribute('data-fire-particle-count', '0')
    await expect(canvas).not.toHaveAttribute('data-fire-frame', /.+/)
    await page.waitForTimeout(200)
    await expect(canvas).not.toHaveAttribute('data-fire-frame', /.+/)
  })

  test('减少动态效果偏好下首页提供静态火流且帧号稳定', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')

    const canvas = page.locator('canvas[data-game="liandan"]')
    await expect(canvas).toHaveAttribute('data-fire-renderer', 'heat-field')
    await expect(canvas).toHaveAttribute('data-fire-state', 'reduced')
    await expect(canvas).toHaveAttribute('data-fire-particle-count', '280')
    const frame = await canvas.getAttribute('data-fire-frame')
    await page.waitForTimeout(200)
    await expect(canvas).toHaveAttribute('data-fire-frame', frame ?? '')
  })

  test('跨边界不兼容的网格与 tick 配置在创建 Canvas 前稳定拒绝', async ({ page }) => {
    await page.route('**/config/parameters.json', (route) =>
      route.fulfill({
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          schemaVersion: 1,
          simulation: { fixedStepHz: 60 },
          flowField: { gridColumns: 79 },
        }),
      }),
    )

    await page.goto('/')

    await expect(page.locator('body')).toHaveAttribute(
      'data-app-state',
      'config-error',
    )
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(page.getByText(/M1 火流网格宽度 1580/)).toBeVisible()
    await expect(page.getByText(/M1 固定步进频率 60/)).toBeVisible()
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__),
    ).toBeUndefined()
  })

  for (const scenarioId of ['pillar', 'gap', 'crowd']) {
    test(`${scenarioId} 技术 probe 可独立进入 ready`, async ({ page }) => {
      const snapshot = await openM1(page, scenarioId)

      expect(snapshot).toMatchObject({
        scenarioId,
        scenarioKind: 'technical-probe',
        fieldGeneration: expect.any(Number),
        renderedGeneration: expect.any(Number),
        droppedTickCount: 0,
      })
      expect(snapshot.fieldGeneration).toBeGreaterThan(0)
      expect(snapshot.renderedGeneration).toBe(snapshot.fieldGeneration)
      await expect(page.locator('canvas[data-game="liandan"]')).toHaveAttribute(
        'data-scenario-id',
        scenarioId,
      )
    })
  }

  test('五项绕流行为均有可见场景元数据', async ({ page }) => {
    await openM1(page, 'pillar')

    const behaviors = page.locator('[data-behavior-id]')
    await expect(behaviors).toHaveCount(5)
    await expect(behaviors).toContainText([
      '完全阻挡与背风阴影',
      '直柱两侧绕流',
      '缺口恢复通流',
      '珠群增强阻挡',
      '绕后汇合',
    ])
    await expect(page.locator('[data-behavior-id="blocking"]')).toBeVisible()
    await expect(page.locator('[data-behavior-id="split-flow"]')).toBeVisible()
    await expect(page.locator('[data-behavior-id="gap-recovery"]')).toBeVisible()
    await expect(page.locator('[data-behavior-id="crowd-blocking"]')).toBeVisible()
    await expect(
      page.locator('[data-behavior-id="downstream-rejoin"]'),
    ).toBeVisible()
  })

  test('场景和覆盖层按钮发布明确 active 状态', async ({ page }) => {
    await openM1(page, 'pillar')

    const direction = page.locator('button[data-overlay-mode="direction"]')
    await direction.click()
    await expect(direction).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot().overlayMode),
    ).toBe('direction')

    const gap = page.locator('button[data-scenario-id="gap"]')
    await gap.click()
    await sampleInPage(page)
    await expect(gap).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot().scenarioId),
    ).toBe('gap')
  })

  test('规则与渲染读取同一 field generation 和同一采样值', async ({ page }) => {
    await openM1(page, 'crowd')
    await sampleInPage(page)

    const snapshot = await page.evaluate(() => window.__LIANDAN_M1__!.getSnapshot())
    expect(snapshot.fieldGeneration).toBe(snapshot.renderedGeneration)
    expect(snapshot.fieldUpdateCount).toBe(snapshot.fieldGeneration)
    expect(snapshot.ruleSample).toEqual(snapshot.renderSample)
    expect(snapshot.lastCommittedTick).toBe(snapshot.tick)
    expect(snapshot.nextTick).toBe(snapshot.tick + 1)
    expect(snapshot.activePearlCount).toBe(8)
    expect(snapshot.droppedTickCount).toBe(0)
  })

  test('正常水滴珠演示与小圆性能代理明确分组', async ({ page }) => {
    await openM1(page, 'crowd')

    const canvas = page.locator('canvas[data-game="liandan"]')
    const visualGroup = page.locator('[data-scenario-group="visual"]')
    const performanceGroup = page.locator('[data-scenario-group="performance"]')
    await expect(
      page.getByText('正常水滴珠尺度', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('性能基准（小圆代理）', { exact: true }),
    ).toBeVisible()
    await expect(visualGroup.locator('button[data-scenario-id]')).toHaveCount(3)
    await expect(performanceGroup.locator('button[data-scenario-id]')).toHaveCount(
      2,
    )
    await expect(page.locator('button[data-scenario-id="crowd"]')).toHaveText(
      '水滴珠挡火',
    )
    await expect(page.locator('[data-scenario-summary]')).toContainText(
      '正常尺寸的水滴珠',
    )
    await expect(canvas).toHaveAttribute('data-pearl-renderer', 'droplet')
    await expect(canvas).toHaveAttribute('data-pearl-radius', '32')
    await expect(canvas).toHaveAttribute(
      'data-fire-occlusion',
      'precise-geometry',
    )

    await page.locator('button[data-scenario-id="m1-900"]').click()
    await expect(canvas).toHaveAttribute('data-pearl-renderer', 'circle-proxy')
    await expect(canvas).toHaveAttribute('data-pearl-radius', '6')
    await expect(canvas).toHaveAttribute('data-fire-occlusion', 'flow-grid')
  })

  test('静态 pillar 切换覆盖层不改变流场 digest', async ({ page }) => {
    const initial = await openM1(page, 'pillar')
    const digest = initial.flowDigest

    for (const mode of [
      'direction',
      'obstacle',
      'timing',
      'none',
      'reachable',
    ] as const) {
      const snapshot = await page.evaluate((nextMode) => {
        window.__LIANDAN_M1__!.setOverlayMode(nextMode)
        return window.__LIANDAN_M1__!.getSnapshot()
      }, mode)
      expect(snapshot.overlayMode).toBe(mode)
      expect(snapshot.flowDigest).toBe(digest)
      expect(snapshot.fieldGeneration).toBe(snapshot.renderedGeneration)
    }
  })

  test('URL 可直接选择性能场景和关闭覆盖层', async ({ page }) => {
    const snapshot = await openM1(page, 'm1-900', 'none')

    expect(snapshot).toMatchObject({
      scenarioId: 'm1-900',
      scenarioKind: 'performance',
      overlayMode: 'none',
      activePearlCount: 900,
      seed: 900001,
    })
    await expect(page.locator('button[data-scenario-id="m1-900"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('button[data-overlay-mode="none"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
