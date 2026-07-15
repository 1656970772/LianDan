import { expect, test, type Page } from '@playwright/test'

import type { M2Snapshot } from '../src/game/extraction/contracts.ts'

const FIRST_BATCH_ID = 'red_whisker_ginseng_fresh_wild_10'
const FIRST_BATCH_SELECTOR = `button[data-inventory-batch-id="${FIRST_BATCH_ID}"]`
type FireStartupSample = Readonly<{
  frame: string | null
  frontDistance: string | null
  startup: string | null
  state: string | null
}>
type FireStartupTrace = {
  observer: MutationObserver
  samples: FireStartupSample[]
}
type FireStartupTraceWindow = typeof window & {
  __LIANDAN_FIRE_STARTUP_TRACE__?: FireStartupTrace
}

async function openM2(page: Page): Promise<M2Snapshot> {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'm2')
  await expect(page.locator('canvas[data-scene="m2-extraction"]')).toBeVisible()
  return page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot())
}

async function aimAtMaterial(page: Page): Promise<void> {
  const canvas = page.locator('canvas[data-scene="m2-extraction"]')
  const bounds = await canvas.boundingBox()
  if (bounds === null) throw new Error('M2_CANVAS_NOT_VISIBLE')
  const aim = await page.evaluate(async () => {
    const snapshot = window.__LIANDAN_M2__!.getSnapshot()
    const response = await fetch('/config/m2/prototype.json')
    if (!response.ok) throw new Error('M2_PROTOTYPE_CONFIG_UNAVAILABLE')
    const prototype = (await response.json()) as {
      materialPlacement: { centerX: number; centerY: number }
    }
    return {
      logicalHeight: snapshot.logicalHeight,
      logicalWidth: snapshot.logicalWidth,
      materialX: prototype.materialPlacement.centerX,
      materialY: prototype.materialPlacement.centerY,
    }
  })
  if (aim.logicalWidth <= 0 || aim.logicalHeight <= 0) {
    throw new Error('M2_CANVAS_LOGICAL_SIZE_INVALID')
  }
  await page.mouse.move(
    bounds.x + bounds.width * (aim.materialX / aim.logicalWidth),
    bounds.y + bounds.height * (aim.materialY / aim.logicalHeight),
  )
}

async function beginFireStartupTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-scene="m2-extraction"]',
    )
    if (target === null) throw new Error('M2_CANVAS_NOT_FOUND')

    const traceWindow = window as FireStartupTraceWindow
    traceWindow.__LIANDAN_FIRE_STARTUP_TRACE__?.observer.disconnect()
    const samples: FireStartupSample[] = []
    const record = (): void => {
      const sample: FireStartupSample = {
        frame: target.dataset.fireFrame ?? null,
        frontDistance: target.dataset.fireFrontDistance ?? null,
        startup: target.dataset.fireStartup ?? null,
        state: target.dataset.fireState ?? null,
      }
      const previous = samples.at(-1)
      if (
        previous?.frame === sample.frame &&
        previous.frontDistance === sample.frontDistance &&
        previous.startup === sample.startup &&
        previous.state === sample.state
      ) {
        return
      }
      samples.push(sample)
    }
    const observer = new MutationObserver(record)
    observer.observe(target, {
      attributeFilter: [
        'data-fire-frame',
        'data-fire-front-distance',
        'data-fire-startup',
        'data-fire-state',
      ],
      attributes: true,
    })
    record()
    traceWindow.__LIANDAN_FIRE_STARTUP_TRACE__ = { observer, samples }
  })
}

async function endFireStartupTrace(page: Page): Promise<FireStartupSample[]> {
  return page.evaluate(() => {
    const traceWindow = window as FireStartupTraceWindow
    const trace = traceWindow.__LIANDAN_FIRE_STARTUP_TRACE__
    if (trace === undefined) throw new Error('M2_FIRE_STARTUP_TRACE_MISSING')
    trace.observer.disconnect()
    delete traceWindow.__LIANDAN_FIRE_STARTUP_TRACE__
    return trace.samples
  })
}

function expectRapidFireStartup(samples: readonly FireStartupSample[]): void {
  const emergingFronts = samples
    .filter(
      (sample) =>
        sample.state === 'emerging' &&
        sample.startup === 'emerging' &&
        sample.frontDistance !== null,
    )
    .map((sample) => Number(sample.frontDistance))
    .filter(Number.isFinite)
  expect(emergingFronts.length).toBeGreaterThan(1)
  expect(emergingFronts[0]).toBeGreaterThanOrEqual(0)
  expect(emergingFronts[0]).toBeLessThan(300)
  expect(emergingFronts.some((front) => front > emergingFronts[0]!)).toBe(true)
}

async function alignCollectorWithMaterial(page: Page): Promise<void> {
  const movement = await page.evaluate(async () => {
    const [prototypeResponse, collectorResponse] = await Promise.all([
      fetch('/config/m2/prototype.json'),
      fetch('/config/m2/collector.json'),
    ])
    if (!prototypeResponse.ok || !collectorResponse.ok) {
      throw new Error('M2_COLLECTOR_ALIGNMENT_CONFIG_UNAVAILABLE')
    }
    const prototype = (await prototypeResponse.json()) as {
      materialPlacement: { centerX: number }
    }
    const collector = (await collectorResponse.json()) as {
      acceleration: number
      deceleration: number
      initialX: number
      maxSpeed: number
    }
    return {
      acceleration: collector.acceleration,
      deceleration: collector.deceleration,
      distance: prototype.materialPlacement.centerX - collector.initialX,
      maxSpeed: collector.maxSpeed,
    }
  })
  if (Math.abs(movement.distance) <= 1) return

  const distance = Math.abs(movement.distance)
  const timeToMaxSpeed = movement.maxSpeed / movement.acceleration
  const accelerationDistance =
    0.5 * movement.acceleration * timeToMaxSpeed ** 2
  const coastFromMaxSpeed =
    movement.maxSpeed ** 2 / (2 * movement.deceleration)
  const triangularHoldSeconds = Math.sqrt(
    distance /
      (0.5 * movement.acceleration +
        movement.acceleration ** 2 / (2 * movement.deceleration)),
  )
  const holdSeconds =
    triangularHoldSeconds <= timeToMaxSpeed
      ? triangularHoldSeconds
      : timeToMaxSpeed +
        Math.max(0, distance - accelerationDistance - coastFromMaxSpeed) /
          movement.maxSpeed
  const releaseSpeed = Math.min(
    movement.maxSpeed,
    movement.acceleration * holdSeconds,
  )

  await page.locator('[data-m2-stage]').focus()
  const key = movement.distance < 0 ? 'a' : 'd'
  await page.keyboard.down(key)
  await page.waitForTimeout(holdSeconds * 1_000)
  await page.keyboard.up(key)
  await page.waitForTimeout((releaseSpeed / movement.deceleration) * 1_000 + 100)
}

test.describe('M2/M4 多药材萃取闭环', () => {
  test('WebGL 渲染器不保留 drawing buffer', async ({ page }) => {
    await openM2(page)

    const attributes = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-scene="m2-extraction"]',
      )
      if (canvas === null) throw new Error('M2_CANVAS_NOT_FOUND')
      const context =
        canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (context === null) throw new Error('M2_WEBGL_CONTEXT_NOT_FOUND')
      return context.getContextAttributes()
    })

    expect(attributes).not.toBeNull()
    expect(attributes!.preserveDrawingBuffer).toBe(false)
  })

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    test(`${viewport.width}×${viewport.height} 玩家工作台完整可见`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const snapshot = await openM2(page)

      expect(snapshot).toMatchObject({
        ready: true,
        status: 'ready',
        equippedFireSourceId: null,
        isSpraying: false,
      })
      await expect(page.locator('[data-m2-shell]')).toBeVisible()
      await expect(page.locator('[data-game-host]')).toBeVisible()
      await expect(page.locator('[data-action="finish"]')).toBeVisible()
    })
  }

  for (const width of [900, 950]) {
    test(`${width}×700 窄屏允许滚动到完整操作面板`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await openM2(page)

      const layout = await page.evaluate(() => ({
        clientHeight: document.documentElement.clientHeight,
        overflowY: getComputedStyle(document.body).overflowY,
        scrollHeight: document.documentElement.scrollHeight,
      }))
      expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
      expect(layout.overflowY).not.toBe('hidden')

      await page.mouse.wheel(0, 1_200)
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(0)
      await expect(page.locator('[data-action="finish"]')).toBeInViewport()
    })
  }

  test('运行帧刷新不夺走背包按钮焦点', async ({ page }) => {
    await openM2(page)
    const inventoryButton = page.locator(FIRST_BATCH_SELECTOR)

    await inventoryButton.focus()
    await expect(inventoryButton).toBeFocused()
    await page.waitForTimeout(350)

    await expect(inventoryButton).toBeFocused()
  })

  test('M4 背包展示 8 个批次及五类标签 Tips', async ({ page }) => {
    const snapshot = await openM2(page)
    expect(snapshot.inventory).toHaveLength(8)
    expect(snapshot.inventory.every((batch) => batch.tags.length === 7)).toBe(true)

    const inventoryButton = page.locator(FIRST_BATCH_SELECTOR)
    await inventoryButton.focus()
    const tip = page.locator(`[data-material-tip="${FIRST_BATCH_ID}"]`)
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('新鲜 · 野生 · 十年')
    await expect(tip.locator('[data-tag-category]')).toHaveCount(5)
    await expect(tip.locator('[role="meter"]')).toHaveCount(7)
  })

  test('复用 M1 连续火焰热场与 M3 类型化丹珠表现', async ({ page }) => {
    await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')

    await expect(canvas).toHaveAttribute('data-fire-renderer', 'heat-field')
    await expect(canvas).toHaveAttribute('data-pearl-renderer', 'typed-m3')
    await expect(canvas).toHaveAttribute(
      'data-fire-occlusion',
      'precise-geometry',
    )

    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await page.locator('[data-fire-size]').focus()
    await page.keyboard.press('End')
    await page.locator(FIRST_BATCH_SELECTOR).click()
    await page.locator('[data-action="add-material"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().remainingMaterialCellCount,
        ),
      )
      .toBeGreaterThan(0)
    await aimAtMaterial(page)
    await page.mouse.down()
    await expect(canvas).toHaveAttribute('data-fire-state', 'animated')
    await expect(canvas).toHaveAttribute('data-fire-particle-count', '280')
    const firstFrame = Number(await canvas.getAttribute('data-fire-frame'))
    const firstPixels = await canvas.screenshot()
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-fire-frame')))
      .toBeGreaterThan(firstFrame)
    expect((await canvas.screenshot()).equals(firstPixels)).toBe(false)
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__LIANDAN_M2__!.getSnapshot().activePearlCount,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0)
    await expect(canvas).toHaveAttribute('data-active-pearl-count', /[1-9]\d*/)
    await expect(canvas).toHaveAttribute('data-pearl-renderer', 'typed-m3')
    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-fire-state', 'off')
  })

  test('按下后火焰从底部快速喷出，不整条瞬间出现', async ({ page }) => {
    await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await aimAtMaterial(page)
    await beginFireStartupTrace(page)
    await page.mouse.down()

    await expect(canvas).toHaveAttribute('data-fire-state', 'animated', {
      timeout: 1_000,
    })
    await expect(canvas).toHaveAttribute('data-fire-startup', 'steady')
    await expect(canvas).toHaveAttribute('data-fire-front-distance', 'full')
    expectRapidFireStartup(await endFireStartupTrace(page))

    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-fire-state', 'off')
    await expect(canvas).not.toHaveAttribute('data-fire-startup')
    await expect(canvas).not.toHaveAttribute('data-fire-front-distance')

    await beginFireStartupTrace(page)
    await page.mouse.down()
    await expect(canvas).toHaveAttribute('data-fire-state', 'animated', {
      timeout: 1_000,
    })
    expectRapidFireStartup(await endFireStartupTrace(page))
    await page.mouse.up()
  })

  test('喷火中暂停会立即关闭表现层且不再推进旧火焰帧', async ({ page }) => {
    await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await aimAtMaterial(page)
    await page.mouse.down()
    await expect(canvas).toHaveAttribute('data-fire-state', 'animated')
    const frameBeforePause = await canvas.getAttribute('data-fire-frame')

    await page.evaluate(() => window.__LIANDAN_M2__!.pause())
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().paused))
      .toBe(true)
    await page.waitForTimeout(500)

    await expect(canvas).toHaveAttribute('data-fire-state', 'off')
    await expect(canvas).toHaveAttribute('data-fire-particle-count', '0')
    expect(frameBeforePause).not.toBeNull()
    expect(await canvas.getAttribute('data-fire-frame')).toBeNull()
    await page.mouse.up()
  })

  test('减少动态效果时 source 改变仍重绘权威静态火焰', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const snapshot = await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    const bounds = await canvas.boundingBox()
    if (bounds === null) throw new Error('M2_CANVAS_NOT_VISIBLE')
    const logicalToClient = (x: number, y: number) => ({
      x: bounds.x + bounds.width * (x / snapshot.logicalWidth),
      y: bounds.y + bounds.height * (y / snapshot.logicalHeight),
    })
    const firstAim = logicalToClient(380, 260)
    const secondAim = logicalToClient(1_220, 260)
    await page.mouse.move(firstAim.x, firstAim.y)
    await page.mouse.down()
    await expect(canvas).toHaveAttribute('data-fire-state', 'reduced')
    const before = await page.evaluate(() => ({
      frame: document.querySelector<HTMLCanvasElement>(
        'canvas[data-scene="m2-extraction"]',
      )!.dataset.fireFrame,
      generation: window.__LIANDAN_M2__!.getSnapshot().flowGeneration,
      sourceDirection: document.querySelector<HTMLCanvasElement>(
        'canvas[data-scene="m2-extraction"]',
      )!.dataset.fireSourceDirection,
    }))
    const beforePixels = await canvas.screenshot()

    await page.mouse.move(secondAim.x, secondAim.y)
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().flowGeneration),
      )
      .toBeGreaterThan(before.generation)
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => ({
      frame: document.querySelector<HTMLCanvasElement>(
        'canvas[data-scene="m2-extraction"]',
      )!.dataset.fireFrame,
      sourceDirection: document.querySelector<HTMLCanvasElement>(
        'canvas[data-scene="m2-extraction"]',
      )!.dataset.fireSourceDirection,
    }))
    const afterPixels = await canvas.screenshot()

    expect(after.frame).toBe(before.frame)
    expect(after.sourceDirection).not.toBe(before.sourceDirection)
    expect(afterPixels.equals(beforePixels)).toBe(false)
    await page.mouse.up()
  })

  test('火力滑条连续覆盖 0..100，wheel 步长不改变 DOM 可达值', async ({
    page,
  }) => {
    await openM2(page)
    const slider = page.locator('[data-fire-size]')

    await expect(slider).toHaveAttribute('min', '0')
    await expect(slider).toHaveAttribute('max', '100')
    await expect(slider).toHaveAttribute('step', 'any')
    await slider.focus()
    await page.keyboard.press('End')
    await expect(slider).toHaveValue('100')
  })

  test('火势助推开关即时同步到模拟状态', async ({ page }) => {
    await openM2(page)
    const thrust = page.locator('[data-flame-thrust]')

    await thrust.check()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().flameThrustEnabled,
        ),
      )
      .toBe(true)

    await thrust.uncheck()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().flameThrustEnabled,
        ),
      )
      .toBe(false)
  })

  test('非等宽舞台只允许从实际画布内开始喷火', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openM2(page)
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().equippedFireSourceId,
        ),
      )
      .toBe('basic-fire')

    const stageBounds = await page.locator('[data-m2-stage]').boundingBox()
    const canvasBounds = await page
      .locator('canvas[data-scene="m2-extraction"]')
      .boundingBox()
    if (stageBounds === null || canvasBounds === null) {
      throw new Error('M2_INPUT_SURFACES_NOT_VISIBLE')
    }
    expect(canvasBounds.width).toBeLessThan(stageBounds.width)

    await page.mouse.move(
      stageBounds.x + 1,
      canvasBounds.y + canvasBounds.height / 2,
    )
    await page.mouse.down()
    await page.waitForTimeout(150)
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
    ).toBe(false)
    await page.mouse.up()

    await page.mouse.move(
      canvasBounds.x + canvasBounds.width / 2,
      canvasBounds.y + canvasBounds.height / 2,
    )
    await page.mouse.down()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(true)
    await page.mouse.up()
  })

  test('药材批次耗尽后清除待投展示并禁用投入', async ({ page }) => {
    await openM2(page)
    await page.locator(FIRST_BATCH_SELECTOR).click()

    for (const remainingServings of [2, 1, 0]) {
      await page.locator('[data-action="add-material"]').click()
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__LIANDAN_M2__!.getSnapshot().inventory[0]?.servings,
          ),
        )
        .toBe(remainingServings)
    }

    await expect(page.locator(FIRST_BATCH_SELECTOR)).toBeDisabled()
    await expect(page.locator('[data-action="add-material"]')).toBeDisabled()
    await expect(page.locator('[data-selected-material]')).toContainText(
      '尚未选择药材',
    )
  })

  test('火种不自动装备，旧按下不潜伏，装备后必须重新按下', async ({
    page,
  }) => {
    await openM2(page)
    await aimAtMaterial(page)
    await page.mouse.down()
    await page.waitForTimeout(100)
    await page.mouse.up()

    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot()),
    ).toMatchObject({ equippedFireSourceId: null, isSpraying: false })

    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().equippedFireSourceId,
        ),
      )
      .toBe('basic-fire')
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
    ).toBe(false)

    await aimAtMaterial(page)
    await page.mouse.down()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(true)
    await page.mouse.up()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(false)
  })

  test('背包预选、取消、投入后真实烧完并接珠完成一炉', async ({ page }) => {
    await page.route('**/config/materials/red_whisker_ginseng.json', async (route) => {
      const response = await route.fetch()
      const material = await response.json() as Record<string, unknown>
      await route.fulfill({
        response,
        json: { ...material, targetPearlCount: 24 },
      })
    })
    await openM2(page)
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await page.locator('[data-fire-size]').focus()
    await page.keyboard.press('End')
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().fireSize))
      .toBe(100)
    await page.locator(FIRST_BATCH_SELECTOR).click()
    await expect(page.locator('[data-selected-material]')).toContainText('赤须参')
    await page.locator('[data-action="cancel-material"]').click()
    await expect(page.locator('[data-selected-material]')).toContainText(
      '尚未选择药材',
    )

    await page.locator(FIRST_BATCH_SELECTOR).click()
    await page.locator('[data-action="add-material"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().remainingMaterialCellCount,
        ),
      )
      .toBeGreaterThan(0)

    await alignCollectorWithMaterial(page)

    await aimAtMaterial(page)
    await page.mouse.down()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const snapshot = window.__LIANDAN_M2__!.getSnapshot()
            return {
              active: snapshot.activePearlCount,
              canFinish: snapshot.canFinish,
              caught: snapshot.caughtPearlCount,
              hasCaught: snapshot.caughtPearlCount > 0,
              remainingCells: snapshot.remainingMaterialCellCount,
              remainingVolume: snapshot.materialRemaining,
            }
          }),
        { timeout: 20_000 },
      )
      .toMatchObject({
        active: 0,
        canFinish: true,
        caught: expect.any(Number),
        hasCaught: true,
        remainingCells: 0,
        remainingVolume: 0,
      })
    await page.mouse.up()

    const finished = await page.evaluate(() =>
      window.__LIANDAN_M2__!.getSnapshot(),
    )
    expect(finished.caughtPearlCount).toBeGreaterThan(0)
    expect(finished.materialRemaining).toBeCloseTo(0, 8)
    expect(finished.activePearlCount).toBe(0)
    await page.locator('[data-action="finish"]').click()
    await expect(page.locator('[data-completion-dialog]')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().status))
      .toBe('completed')

    await page
      .locator('[data-completion-dialog] [data-action="again"]')
      .click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return {
            sessionId: snapshot.sessionId,
            status: snapshot.status,
            tick: snapshot.tick,
          }
        }),
      )
      .toMatchObject({
        sessionId: 'session-000002',
        status: 'ready',
        tick: expect.any(Number),
      })
  })

  test('暂停可恢复，重开取消不改会话，确认重开建立全新 ready', async ({
    page,
  }) => {
    await openM2(page)
    await page.locator('[data-action="pause"]').click()
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().paused))
      .toBe(true)
    await page.locator('[data-action="resume"]').click()
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().paused))
      .toBe(false)

    const sessionId = await page.evaluate(
      () => window.__LIANDAN_M2__!.getSnapshot().sessionId,
    )
    await page.locator('[data-action="restart"]').click()
    await expect(page.locator('[data-restart-dialog]')).toBeVisible()
    await expect(page.locator('[data-action="cancel-restart"]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-restart-dialog]')).toBeHidden()
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().sessionId),
    ).toBe(sessionId)

    await page.locator('[data-action="restart"]').click()
    await page.locator('[data-action="confirm-restart"]').click()
    await expect
      .poll(() =>
        page.evaluate((previousSessionId) => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return (
            snapshot.sessionId !== previousSessionId &&
            snapshot.status === 'ready'
          )
        }, sessionId),
      )
      .toBe(true)
    expect(await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot())).toMatchObject({
      activePearlCount: 0,
      canFinish: false,
      caughtPearlCount: 0,
      equippedFireSourceId: null,
      materialRemaining: 0,
      remainingMaterialCellCount: 0,
      status: 'ready',
    })
  })
})
