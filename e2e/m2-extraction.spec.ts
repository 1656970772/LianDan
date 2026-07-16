import { expect, test, type Page } from '@playwright/test'

import type { M2Snapshot } from '../src/game/extraction/contracts.ts'
import {
  createM5VisualFirePhaseChecks,
  M5_VISUAL_IDENTITY_COLOR_MATRIX,
} from '../scripts/m5-visual-evidence-support.ts'
import {
  assertM5VisualVisionTransformPrepared,
  prepareM5VisualVisionTransform,
  type M5VisionTransformPreparedToken,
} from '../scripts/m5-visual-evidence-vision.ts'

const FIRST_BATCH_ID = 'red_whisker_ginseng_fresh_wild_10'
const FIRST_BATCH_SELECTOR = `button[data-inventory-batch-id="${FIRST_BATCH_ID}"]`
const SECOND_BATCH_ID = 'azure_dew_leaf_fresh_cultivated_3'

type SerializedPlacement = Readonly<{
  center: Readonly<{ x: number; y: number }>
  width: number
  height: number
  rotationRadians: number
}>

function placementsHaveInteriorIntersection(
  first: SerializedPlacement,
  second: SerializedPlacement,
): boolean {
  const axes = [first.rotationRadians, second.rotationRadians].flatMap((rotation) => [
    { x: Math.cos(rotation), y: Math.sin(rotation) },
    { x: -Math.sin(rotation), y: Math.cos(rotation) },
  ])
  const centerDelta = {
    x: second.center.x - first.center.x,
    y: second.center.y - first.center.y,
  }
  const projectionRadius = (
    placement: SerializedPlacement,
    axis: Readonly<{ x: number; y: number }>,
  ): number => {
    const localX = {
      x: Math.cos(placement.rotationRadians),
      y: Math.sin(placement.rotationRadians),
    }
    const localY = { x: -localX.y, y: localX.x }
    return (
      Math.abs(axis.x * localX.x + axis.y * localX.y) * placement.width * 0.5 +
      Math.abs(axis.x * localY.x + axis.y * localY.y) * placement.height * 0.5
    )
  }
  return axes.every((axis) => {
    const distance = Math.abs(centerDelta.x * axis.x + centerDelta.y * axis.y)
    return distance < projectionRadius(first, axis) + projectionRadius(second, axis) - 1e-7
  })
}

const M5_TEST_GRAYSCALE_MATRIX = Object.freeze([
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0, 0, 0, 1, 0,
])

async function verifyPreparedClockCapture(input: Readonly<{
  page: Page
  visionMode: 'normal' | 'grayscale'
  colorMatrix: readonly number[]
}>): Promise<M5VisionTransformPreparedToken> {
  const { page, visionMode, colorMatrix } = input
  const installedAt = Date.now()
  await page.clock.install({ time: installedAt })
  await page.setViewportSize({ width: 320, height: 180 })
  await page.setContent('<main id="app">clock capture</main>')
  const token = await prepareM5VisualVisionTransform(
    page,
    visionMode,
    colorMatrix,
  )
  const pauseTarget = (await page.evaluate('Date.now() + 16')) as number
  await page.clock.pauseAt(pauseTarget)
  const before = (await page.evaluate('Date.now()')) as number
  const critical = (async () => {
    assertM5VisualVisionTransformPrepared({
      token,
      page,
      visionMode,
      colorMatrix,
    })
    await page.screenshot({ animations: 'allow', type: 'png' })
    return (await page.evaluate('Date.now()')) as number
  })()
  const outcome = await Promise.race([
    critical.then((after) => ({ result: 'completed' as const, after })),
    new Promise<Readonly<{ result: 'watchdog'; after: -1 }>>(
      (resolvePromise) =>
        setTimeout(
          () => resolvePromise({ result: 'watchdog', after: -1 }),
          500,
        ),
    ),
  ])
  expect(outcome.result).toBe('completed')
  expect(outcome.after).toBe(before)
  await page.clock.resume()
  return token
}

test('M5 fire sequence 使用正式 opaque token，冻结 critical 不等待 rAF', async ({ page }) => {
  const token = await verifyPreparedClockCapture({
    page,
    visionMode: 'normal',
    colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
  })
  const pauseTarget = (await page.evaluate('Date.now() + 16')) as number
  await page.clock.pauseAt(pauseTarget)
  expect(() =>
    assertM5VisualVisionTransformPrepared({
      token,
      page,
      visionMode: 'normal',
      colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
    }),
  ).not.toThrow()
  await page.clock.resume()
})

test('M5 material transient 使用正式 opaque token，冻结 critical 不等待 rAF', async ({ page }) => {
  await verifyPreparedClockCapture({
    page,
    visionMode: 'normal',
    colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
  })
})

test('M5 warning transient 使用正式视觉模式 token，冻结 critical 不等待 rAF', async ({ page }) => {
  await verifyPreparedClockCapture({
    page,
    visionMode: 'grayscale',
    colorMatrix: M5_TEST_GRAYSCALE_MATRIX,
  })
})

test('M5 failure sequence 使用正式 opaque token，冻结 critical 不等待 rAF', async ({ page }) => {
  await verifyPreparedClockCapture({
    page,
    visionMode: 'normal',
    colorMatrix: M5_VISUAL_IDENTITY_COLOR_MATRIX,
  })
})

test('M5 opaque token 在真实 Page 上拒绝 wrong page/mode/matrix 与伪造 literal', async ({
  page,
  context,
}) => {
  await page.setContent('<main id="app">token authority</main>')
  const token = await prepareM5VisualVisionTransform(
    page,
    'normal',
    M5_VISUAL_IDENTITY_COLOR_MATRIX,
  )
  const otherPage = await context.newPage()
  await otherPage.setContent('<main id="app">other page</main>')
  const rejects = (
    candidate: M5VisionTransformPreparedToken,
    candidatePage: Page,
    visionMode: 'normal' | 'grayscale',
    colorMatrix: readonly number[],
  ): void =>
    assertM5VisualVisionTransformPrepared({
      token: candidate,
      page: candidatePage,
      visionMode,
      colorMatrix,
    })

  expect(() =>
    rejects(token, otherPage, 'normal', M5_VISUAL_IDENTITY_COLOR_MATRIX),
  ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  expect(() =>
    rejects(token, page, 'grayscale', M5_VISUAL_IDENTITY_COLOR_MATRIX),
  ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  expect(() =>
    rejects(token, page, 'normal', [...M5_VISUAL_IDENTITY_COLOR_MATRIX]),
  ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  expect(() =>
    rejects(
      {} as M5VisionTransformPreparedToken,
      page,
      'normal',
      M5_VISUAL_IDENTITY_COLOR_MATRIX,
    ),
  ).toThrow('M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED')
  await otherPage.close()
})

test('M5 fire phase gate 由真实 Page Clock 的 79/81ms 独立读数判早/迟', async ({ page }) => {
  const installedAt = Date.now()
  await page.clock.install({ time: installedAt })
  await page.setContent('<main id="app">phase gate</main>')

  const fireObservation = {
    firePresentationState: 'emerging',
    isSpraying: true,
  }
  const pauseTarget = (await page.evaluate('Date.now() + 16')) as number
  await page.clock.pauseAt(pauseTarget)
  const earlyAnchor = (await page.evaluate('Date.now()')) as number
  await page.clock.runFor(79)
  const earlyOffset =
    ((await page.evaluate('Date.now()')) as number) - earlyAnchor
  const earlyChecks = createM5VisualFirePhaseChecks({
    phaseId: 'startup',
    configuredOffsetMilliseconds: 80,
    screenshotStartedOffsetMilliseconds: earlyOffset,
    screenshotFinishedOffsetMilliseconds: earlyOffset,
    maximumSampleLatenessMilliseconds: 0,
    before: fireObservation,
    after: fireObservation,
  })
  expect(earlyOffset).toBe(79)
  expect(
    earlyChecks.find(({ id }) => id === 'phase-screenshot-not-early'),
  ).toMatchObject({ passed: false })

  const lateAnchor = (await page.evaluate('Date.now()')) as number
  await page.clock.runFor(81)
  const lateOffset =
    ((await page.evaluate('Date.now()')) as number) - lateAnchor
  const lateChecks = createM5VisualFirePhaseChecks({
    phaseId: 'startup',
    configuredOffsetMilliseconds: 80,
    screenshotStartedOffsetMilliseconds: lateOffset,
    screenshotFinishedOffsetMilliseconds: lateOffset,
    maximumSampleLatenessMilliseconds: 0,
    before: fireObservation,
    after: fireObservation,
  })
  expect(lateOffset).toBe(81)
  expect(
    lateChecks.find(({ id }) => id === 'phase-screenshot-lateness-bounded'),
  ).toMatchObject({ passed: false })
  await page.clock.resume()
})
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
type LifecycleOverrideStore = Readonly<{
  hasFocus: PropertyDescriptor | undefined
  visibilityState: PropertyDescriptor | undefined
}>
type LifecycleOverrideWindow = typeof window & {
  __LIANDAN_LIFECYCLE_OVERRIDE__?: LifecycleOverrideStore
}
type LifecycleTransitionKind = 'blur' | 'hidden'

async function dispatchLifecyclePause(
  page: Page,
  kind: LifecycleTransitionKind,
): Promise<void> {
  await page.evaluate((transitionKind) => {
    const lifecycleWindow = window as LifecycleOverrideWindow
    lifecycleWindow.__LIANDAN_LIFECYCLE_OVERRIDE__ ??= {
      hasFocus: Object.getOwnPropertyDescriptor(document, 'hasFocus'),
      visibilityState: Object.getOwnPropertyDescriptor(
        document,
        'visibilityState',
      ),
    }
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => transitionKind !== 'blur',
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (transitionKind === 'hidden' ? 'hidden' : 'visible'),
    })
    if (transitionKind === 'blur') {
      window.dispatchEvent(new FocusEvent('blur'))
    } else {
      document.dispatchEvent(new Event('visibilitychange'))
    }
  }, kind)
}

async function dispatchLifecycleResumeAtFirstRuntimeFrame(
  page: Page,
  kind: LifecycleTransitionKind,
): Promise<Readonly<{ isSpraying: boolean; paused: boolean; tick: number }>> {
  return page.evaluate(async (transitionKind) => {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    if (transitionKind === 'blur') {
      window.dispatchEvent(new FocusEvent('focus'))
    } else {
      document.dispatchEvent(new Event('visibilitychange'))
    }

    return new Promise((resolve, reject) => {
      let remainingFrames = 20
      const sample = (): void => {
        const snapshot = window.__LIANDAN_M2__!.getSnapshot()
        if (!snapshot.paused) {
          resolve({
            isSpraying: snapshot.isSpraying,
            paused: snapshot.paused,
            tick: snapshot.tick,
          })
          return
        }
        remainingFrames -= 1
        if (remainingFrames <= 0) {
          reject(new Error('M2_LIFECYCLE_RESUME_TIMEOUT'))
          return
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }, kind)
}

async function restoreLifecycleOverrides(page: Page): Promise<void> {
  await page.evaluate(() => {
    const lifecycleWindow = window as LifecycleOverrideWindow
    const stored = lifecycleWindow.__LIANDAN_LIFECYCLE_OVERRIDE__
    if (stored === undefined) return
    for (const [key, descriptor] of [
      ['hasFocus', stored.hasFocus],
      ['visibilityState', stored.visibilityState],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(document, key)
      else Object.defineProperty(document, key, descriptor)
    }
    delete lifecycleWindow.__LIANDAN_LIFECYCLE_OVERRIDE__
  })
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
      materialPlacement: {
        slots: Array<{ centerX: number; centerY: number }>
      }
    }
    const firstMaterialSlot = prototype.materialPlacement.slots[0]!
    return {
      logicalHeight: snapshot.logicalHeight,
      logicalWidth: snapshot.logicalWidth,
      materialX: firstMaterialSlot.centerX,
      materialY: firstMaterialSlot.centerY,
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
      materialPlacement: { slots: Array<{ centerX: number }> }
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
      distance:
        prototype.materialPlacement.slots[0]!.centerX - collector.initialX,
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
  test('依次投入赤须参与青露叶后权威内容 OBB 不发生内部相交', async ({ page }) => {
    await openM2(page)
    await page.evaluate((batchId) => {
      const api = window.__LIANDAN_M2__!
      api.preselectMaterial(batchId)
      api.addSelectedMaterial()
    }, FIRST_BATCH_ID)
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getMaterialTopologyEvidence().length,
        ),
      )
      .toBe(1)
    await page.evaluate((batchId) => {
      const api = window.__LIANDAN_M2__!
      api.preselectMaterial(batchId)
      api.addSelectedMaterial()
    }, SECOND_BATCH_ID)

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getMaterialTopologyEvidence().length,
        ),
      )
      .toBe(2)
    const placements = await page.evaluate(() =>
      window.__LIANDAN_M2__!
        .getMaterialTopologyEvidence()
        .map(({ contentPlacement }) => contentPlacement),
    )

    expect(placementsHaveInteriorIntersection(placements[0]!, placements[1]!)).toBe(false)
  })

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
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
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

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
  ]) {
    test(`${viewport.width}×${viewport.height} 背包八批次逐项滚动可达且不受祖先裁切`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await openM2(page)

      const inventoryButtons = page.locator(
        'button[data-inventory-batch-id]',
      )
      await expect(inventoryButtons).toHaveCount(8)
      for (let index = 0; index < 8; index += 1) {
        const observation = await inventoryButtons.nth(index).evaluate(
          (element) => {
            element.scrollIntoView({ block: 'center', inline: 'nearest' })
            const rectangle = element.getBoundingClientRect()
            const inventoryRectangle = element.parentElement?.parentElement?.getBoundingClientRect()
            const selectedRectangle = document
              .querySelector('[data-selected-material]')
              ?.getBoundingClientRect()
            let ancestor = element.parentElement
            let clippedByAncestor: string | null = null
            while (ancestor !== null) {
              const style = getComputedStyle(ancestor)
              const ancestorRectangle = ancestor.getBoundingClientRect()
              const clipsX = style.overflowX !== 'visible'
              const clipsY = style.overflowY !== 'visible'
              if (
                (clipsX &&
                  (rectangle.left < ancestorRectangle.left - 1 ||
                    rectangle.right > ancestorRectangle.right + 1)) ||
                (clipsY &&
                  (rectangle.top < ancestorRectangle.top - 1 ||
                    rectangle.bottom > ancestorRectangle.bottom + 1))
              ) {
                clippedByAncestor = ancestor.className
                break
              }
              ancestor = ancestor.parentElement
            }
            return {
              width: rectangle.width,
              height: rectangle.height,
              inViewport:
                rectangle.left >= -1 &&
                rectangle.right <= window.innerWidth + 1 &&
                rectangle.top >= -1 &&
                  rectangle.bottom <= window.innerHeight + 1,
              clippedByAncestor,
              centerHit:
                (() => {
                  const hit = document.elementFromPoint(
                    rectangle.left + rectangle.width / 2,
                    rectangle.top + rectangle.height / 2,
                  )
                  return hit === element || (hit !== null && element.contains(hit))
                })(),
              hitClassName:
                document.elementFromPoint(
                  rectangle.left + rectangle.width / 2,
                  rectangle.top + rectangle.height / 2,
                )?.className ?? '',
              inventoryRectangle:
                inventoryRectangle === undefined
                  ? null
                  : {
                      top: inventoryRectangle.top,
                      bottom: inventoryRectangle.bottom,
                      height: inventoryRectangle.height,
                    },
              selectedRectangle:
                selectedRectangle === undefined
                  ? null
                  : {
                      top: selectedRectangle.top,
                      bottom: selectedRectangle.bottom,
                      height: selectedRectangle.height,
                    },
            }
          },
        )
        expect(observation, `inventory index ${index}`).toMatchObject({
          width: expect.any(Number),
          height: expect.any(Number),
          inViewport: true,
          clippedByAncestor: null,
        })
        expect(
          observation.centerHit,
          `inventory index ${index}: ${JSON.stringify(observation)}`,
        ).toBe(true)
        expect(observation.width).toBeGreaterThan(0)
        expect(observation.height).toBeGreaterThan(0)
      }
      await inventoryButtons.first().click()
      await expect(inventoryButtons.first()).toHaveAttribute('aria-pressed', 'true')
    })
  }

  test('1920×1080 DPR=2 玩家工作台冒烟', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    try {
      const snapshot = await openM2(page)
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2)
      expect(snapshot).toMatchObject({ ready: true, status: 'ready' })
      await expect(page.locator('[data-game-host]')).toBeVisible()
      await expect(page.locator('[data-action="finish"]')).toBeVisible()
    } finally {
      await context.close()
    }
  })

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
    await expect(canvas).toHaveAttribute(
      'data-pearl-renderer',
      'm5-formal-sprite-pool',
    )
    await expect(canvas).toHaveAttribute('data-pearl-sprite-capacity', '128')
    await expect(canvas).toHaveAttribute(
      'data-pearl-sprite-growth-count',
      '0',
    )
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
    const configuredParticleCount = await page.evaluate(async () => {
      const response = await fetch('/config/m2/presentation.json')
      const presentation = (await response.json()) as {
        fire: { geometry: { particleCount: number } }
      }
      return presentation.fire.geometry.particleCount
    })
    await expect(canvas).toHaveAttribute(
      'data-fire-particle-count',
      String(configuredParticleCount),
    )
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
    await expect(canvas).toHaveAttribute(
      'data-pearl-renderer',
      'm5-formal-sprite-pool',
    )
    await expect(canvas).toHaveAttribute(
      'data-pearl-sprite-initialized-count',
      /[1-9]\d*/,
    )
    await expect(canvas).toHaveAttribute(
      'data-pearl-sprite-texture-count',
      /[1-9]\d*/,
    )
    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-fire-state', 'cooling')
    await expect(canvas).toHaveAttribute('data-fire-state', 'off', {
      timeout: 2_000,
    })
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
    await expect(canvas).toHaveAttribute('data-fire-state', 'cooling')
    await expect(canvas).toHaveAttribute('data-fire-state', 'off', {
      timeout: 2_000,
    })
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

  test('M5 炉温与余焰分离：停火后规则已停而短余焰继续衰减', async ({
    page,
  }) => {
    await page.route('**/config/parameters.json', async (route) => {
      const response = await route.fetch()
      const parameters = (await response.json()) as {
        loss: Record<string, unknown>
      }
      await route.fulfill({
        response,
        json: {
          ...parameters,
          loss: { ...parameters.loss, naturalRatePerMinute: 0 },
        },
      })
    })
    const initial = await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    const meter = page.locator(
      '[role="progressbar"][data-furnace-temperature]',
    )

    await expect(meter).toHaveAttribute('role', 'progressbar')
    await expect(meter).toHaveAttribute('aria-valuetext', '余温稳定')
    expect(initial.furnaceTemperature).toBe(8)

    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await page.locator(FIRST_BATCH_SELECTOR).click()
    await page.locator('[data-action="add-material"]').click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().materialRemaining,
        ),
      )
      .toBeGreaterThan(0)
    await aimAtMaterial(page)
    await page.mouse.down()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().furnaceTemperature,
        ),
      )
      .toBeGreaterThan(initial.furnaceTemperature)
    await page.mouse.up()

    await expect
      .poll(() =>
        page.evaluate(() => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return {
            isSpraying: snapshot.isSpraying,
            presentation: snapshot.firePresentationState,
          }
        }),
      )
      .toEqual({ isSpraying: false, presentation: 'cooling' })

    const coolingBaseline = await page.evaluate(() => {
      const snapshot = window.__LIANDAN_M2__!.getSnapshot()
      return {
        furnaceTemperature: snapshot.furnaceTemperature,
        interactionCount: snapshot.interactionCount,
        isSpraying: snapshot.isSpraying,
        materialRemaining: snapshot.materialRemaining,
        remainingMaterialCellCount: snapshot.remainingMaterialCellCount,
        tick: snapshot.tick,
        visualIntensity: snapshot.fireVisualIntensity,
      }
    })
    expect(coolingBaseline.visualIntensity).toBeGreaterThan(0)

    const coolingSamples = [coolingBaseline]
    for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
      await page.waitForTimeout(70)
      const sample = await page.evaluate(() => {
        const snapshot = window.__LIANDAN_M2__!.getSnapshot()
        return {
          furnaceTemperature: snapshot.furnaceTemperature,
          interactionCount: snapshot.interactionCount,
          isSpraying: snapshot.isSpraying,
          materialRemaining: snapshot.materialRemaining,
          remainingMaterialCellCount: snapshot.remainingMaterialCellCount,
          tick: snapshot.tick,
          visualIntensity: snapshot.fireVisualIntensity,
        }
      })
      if (sample.visualIntensity > 0) coolingSamples.push(sample)
    }

    expect(coolingSamples.length).toBeGreaterThanOrEqual(3)
    expect(coolingSamples.at(-1)!.tick).toBeGreaterThan(coolingBaseline.tick)
    for (const [index, sample] of coolingSamples.entries()) {
      expect(sample.isSpraying).toBe(false)
      expect(sample.visualIntensity).toBeGreaterThan(0)
      expect(sample.interactionCount).toBe(coolingBaseline.interactionCount)
      expect(sample.materialRemaining).toBeCloseTo(
        coolingBaseline.materialRemaining,
        8,
      )
      expect(sample.remainingMaterialCellCount).toBe(
        coolingBaseline.remainingMaterialCellCount,
      )
      expect(sample.furnaceTemperature).toBeLessThanOrEqual(
        coolingBaseline.furnaceTemperature,
      )
      if (index > 0) {
        expect(sample.furnaceTemperature).toBeLessThanOrEqual(
          coolingSamples[index - 1]!.furnaceTemperature,
        )
      }
    }

    await expect(canvas).toHaveAttribute('data-fire-state', 'off', {
      timeout: 2_000,
    })
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().fireVisualIntensity,
        ),
      )
      .toBe(0)
  })

  test('M5 展示指纹独立，总音量与静音在首次用户操作后可控', async ({
    page,
  }) => {
    const snapshot = await openM2(page)
    expect(snapshot.presentationContentFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.presentationContentFingerprint).not.toBe(
      snapshot.simulationContentFingerprint,
    )

    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    await expect(canvas).toHaveAttribute(
      'data-presentation-content-fingerprint',
      snapshot.presentationContentFingerprint,
    )
    const volume = page.locator('[data-audio-volume]')
    const muted = page.locator('[data-audio-muted]')
    await expect(volume).toHaveValue('0.65')
    await expect(muted).toBeChecked()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().audioMuted),
      )
      .toBe(true)
    await volume.fill('0.25')
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().audioVolume),
      )
      .toBeCloseTo(0.25)
    await muted.uncheck()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().audioMuted),
      )
      .toBe(false)
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().audioDiagnostics.unlocked,
        ),
      )
      .toBe(true)
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

  for (const transition of [
    { kind: 'blur', name: 'blur→focus', pauseReason: 'blur' },
    { kind: 'hidden', name: 'hidden→visible', pauseReason: 'hidden' },
  ] as const) {
    test(`${transition.name} 真实事件链停火暂停，恢复首帧不追赶且不自动复喷`, async ({
      page,
    }) => {
      await openM2(page)
      const canvas = page.locator('canvas[data-scene="m2-extraction"]')
      let pointerHeld = false
      try {
        await page.locator('button[data-fire-source-id="basic-fire"]').click()
        await aimAtMaterial(page)
        await page.mouse.down()
        pointerHeld = true
        await expect(canvas).toHaveAttribute('data-fire-state', 'animated')
        const fireFrameBeforePause = await canvas.getAttribute('data-fire-frame')
        expect(fireFrameBeforePause).not.toBeNull()

        await dispatchLifecyclePause(page, transition.kind)
        await expect
          .poll(() =>
            page.evaluate(() => {
              const snapshot = window.__LIANDAN_M2__!.getSnapshot()
              return {
                isSpraying: snapshot.isSpraying,
                paused: snapshot.paused,
                pauseReasons: snapshot.pauseReasons,
              }
            }),
          )
          .toEqual({
            isSpraying: false,
            paused: true,
            pauseReasons: [transition.pauseReason],
          })
        await page.mouse.up()
        pointerHeld = false

        await expect(canvas).toHaveAttribute('data-fire-state', 'off')
        await expect(canvas).not.toHaveAttribute('data-fire-frame')
        const pausedTick = await page.evaluate(
          () => window.__LIANDAN_M2__!.getSnapshot().tick,
        )
        await page.waitForTimeout(400)
        expect(
          await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().tick),
        ).toBe(pausedTick)
        await expect(canvas).not.toHaveAttribute('data-fire-frame')

        const firstResumedFrame =
          await dispatchLifecycleResumeAtFirstRuntimeFrame(page, transition.kind)
        expect(firstResumedFrame).toMatchObject({
          isSpraying: false,
          paused: false,
        })
        expect(firstResumedFrame.tick - pausedTick).toBeLessThanOrEqual(1)

        await page.waitForTimeout(120)
        const afterResume = await page.evaluate(() => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return {
            isSpraying: snapshot.isSpraying,
            pauseReasons: snapshot.pauseReasons,
            tick: snapshot.tick,
          }
        })
        expect(afterResume.tick).toBeGreaterThan(pausedTick)
        expect(afterResume).toMatchObject({
          isSpraying: false,
          pauseReasons: [],
        })
        await expect(canvas).toHaveAttribute('data-fire-state', 'off')
        await expect(canvas).not.toHaveAttribute('data-fire-frame')
      } finally {
        if (pointerHeld) await page.mouse.up()
        await restoreLifecycleOverrides(page)
      }
    })
  }

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

  test('DOM 控件不劫持 Canvas 喷火与旧瞄准，只有真实画布按下可起火', async ({
    page,
  }) => {
    await openM2(page)
    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    const slider = page.locator('[data-fire-size]')
    await page.locator('button[data-fire-source-id="basic-fire"]').click()

    await aimAtMaterial(page)
    await page.mouse.down()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(true)
    await expect(canvas).toHaveAttribute('data-fire-state', 'animated')
    const aimBeforeUi = await canvas.getAttribute('data-fire-source-direction')
    expect(aimBeforeUi).not.toBeNull()

    const sliderBounds = await slider.boundingBox()
    if (sliderBounds === null) throw new Error('M2_FIRE_SLIDER_NOT_VISIBLE')
    await page.mouse.move(
      sliderBounds.x + sliderBounds.width / 2,
      sliderBounds.y + sliderBounds.height / 2,
      { steps: 4 },
    )
    await page.waitForTimeout(80)
    const aimAtUiEntry = await canvas.getAttribute(
      'data-fire-source-direction',
    )
    expect(aimAtUiEntry).not.toBeNull()
    expect(aimAtUiEntry).not.toBe(aimBeforeUi)

    await page.mouse.move(
      sliderBounds.x + sliderBounds.width * 0.25,
      sliderBounds.y + sliderBounds.height / 2,
    )
    await page.mouse.move(
      sliderBounds.x + sliderBounds.width * 0.75,
      sliderBounds.y + sliderBounds.height / 2,
      { steps: 5 },
    )
    await page.waitForTimeout(80)
    expect(await canvas.getAttribute('data-fire-source-direction')).toBe(
      aimAtUiEntry,
    )
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
    ).toBe(true)
    await page.mouse.up()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(false)

    await slider.click({
      position: { x: sliderBounds.width * 0.25, y: sliderBounds.height / 2 },
    })
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
    ).toBe(false)
    await page.mouse.move(
      sliderBounds.x + sliderBounds.width * 0.25,
      sliderBounds.y + sliderBounds.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      sliderBounds.x + sliderBounds.width * 0.75,
      sliderBounds.y + sliderBounds.height / 2,
      { steps: 5 },
    )
    await page.mouse.up()
    expect(
      await page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
    ).toBe(false)

    await page.locator(FIRST_BATCH_SELECTOR).click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return {
            isSpraying: snapshot.isSpraying,
            selectedMaterialBatchId: snapshot.selectedMaterialBatchId,
          }
        }),
      )
      .toEqual({
        isSpraying: false,
        selectedMaterialBatchId: FIRST_BATCH_ID,
      })
    await page.locator('[data-action="pause"]').click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return { isSpraying: snapshot.isSpraying, paused: snapshot.paused }
        }),
      )
      .toEqual({ isSpraying: false, paused: true })
    await page.locator('[data-action="resume"]').click()
    await expect
      .poll(() => page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().paused))
      .toBe(false)

    await aimAtMaterial(page)
    await page.mouse.down()
    await expect
      .poll(() =>
        page.evaluate(() => window.__LIANDAN_M2__!.getSnapshot().isSpraying),
      )
      .toBe(true)
    await page.mouse.up()
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

  test('失败转化完成后才展示药渣结算且完成事件只提交一次', async ({
    page,
  }) => {
    await page.route('**/config/materials/red_whisker_ginseng.json', async (route) => {
      const response = await route.fetch()
      const material = (await response.json()) as Record<string, unknown>
      await route.fulfill({
        response,
        json: { ...material, targetPearlCount: 24 },
      })
    })
    await openM2(page)
    const readyBaseline = await page.evaluate(() => {
      const snapshot = window.__LIANDAN_M2__!.getSnapshot()
      return {
        furnaceTemperature: snapshot.furnaceTemperature,
        inventory: snapshot.inventory.map(({ batchId, servings }) => ({
          batchId,
          servings,
        })),
        sessionId: snapshot.sessionId,
      }
    })
    await page.locator('button[data-fire-source-id="basic-fire"]').click()
    await page.locator('[data-fire-size]').fill('100')
    await page.locator(FIRST_BATCH_SELECTOR).click()
    await page.locator('[data-action="add-material"]').click()

    await page.locator('[data-m2-stage]').focus()
    await page.keyboard.down('d')
    await page.waitForTimeout(2_500)
    await page.keyboard.up('d')
    await page.waitForTimeout(1_000)

    await aimAtMaterial(page)
    await page.mouse.down()
    let failedAtMilliseconds = 0
    try {
      failedAtMilliseconds = await page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const deadline = performance.now() + 25_000
            const inspect = (): void => {
              if (window.__LIANDAN_M2__!.getSnapshot().status === 'failed') {
                resolve(performance.now())
                return
              }
              if (performance.now() >= deadline) {
                reject(new Error('M5_FAILURE_START_TIMEOUT'))
                return
              }
              requestAnimationFrame(inspect)
            }
            inspect()
          }),
      )
    } finally {
      await page.mouse.up()
    }

    const conversionStarted = await page.evaluate(() => {
      const snapshot = window.__LIANDAN_M2__!.getSnapshot()
      return {
        complete: snapshot.failurePresentationComplete,
        state: snapshot.failurePresentationState,
      }
    })
    expect(conversionStarted.complete).toBe(false)
    expect(conversionStarted.state).not.toBe('result')
    await expect(page.locator('[data-failure-dialog]')).toBeHidden()

    const conversionCompleted = await page.evaluate(
      () =>
        new Promise<{
          completedAtMilliseconds: number
          complete: boolean
          completionEvents: number
          state: string
        }>((resolve, reject) => {
          const deadline = performance.now() + 6_000
          const inspect = (): void => {
            const snapshot = window.__LIANDAN_M2__!.getSnapshot()
            if (snapshot.failurePresentationComplete) {
              resolve({
                completedAtMilliseconds: performance.now(),
                complete: true,
                completionEvents: snapshot.lastDomainEventTypes.filter(
                  (type) => type === 'FailureConversionCompleted',
                ).length,
                state: snapshot.failurePresentationState,
              })
              return
            }
            if (performance.now() >= deadline) {
              reject(new Error('M5_FAILURE_COMPLETION_TIMEOUT'))
              return
            }
            requestAnimationFrame(inspect)
          }
          inspect()
        }),
    )
    expect(conversionCompleted).toMatchObject({
      complete: true,
      completionEvents: 1,
      state: 'result',
    })
    const conversionDurationMilliseconds =
      conversionCompleted.completedAtMilliseconds - failedAtMilliseconds
    expect(conversionDurationMilliseconds).toBeGreaterThanOrEqual(1_000)
    expect(conversionDurationMilliseconds).toBeLessThanOrEqual(1_500)

    const failureDialog = page.locator('[data-failure-dialog]')
    const failureResult = page.locator('[data-failure-result]')
    const failureTip = page.locator('[data-failure-result-tip]')
    await expect(failureDialog).toBeVisible()
    await expect(failureDialog).not.toHaveAttribute('aria-modal', 'true')
    await expect(failureDialog.locator('button')).toHaveCount(1)
    await expect(failureDialog.locator('[data-action="again"]')).toBeVisible()
    await expect(page.locator('[data-failure-summary]')).toContainText('药渣')
    await expect(failureResult).toBeVisible()
    await expect(failureResult).toHaveAttribute('role', 'img')
    await expect(failureResult).toHaveAttribute(
      'aria-describedby',
      'm5-failure-result-tip',
    )
    await failureResult.focus()
    await expect(failureResult).toBeFocused()
    await expect(failureTip).toContainText('失败原因：药液流失过多')
    await expect(failureTip).toContainText('投入材料：赤须参')
    await expect(failureTip).toContainText('药渣 ×')
    await expect
      .poll(() => failureTip.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1')

    const canvas = page.locator('canvas[data-scene="m2-extraction"]')
    const [canvasBox, resultBox, tipBox, dialogBox] = await Promise.all([
      canvas.boundingBox(),
      failureResult.boundingBox(),
      failureTip.boundingBox(),
      failureDialog.boundingBox(),
    ])
    expect(canvasBox).not.toBeNull()
    expect(resultBox).not.toBeNull()
    expect(tipBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    const canvasCenter = {
      x: canvasBox!.x + canvasBox!.width / 2,
      y: canvasBox!.y + canvasBox!.height / 2,
    }
    const resultCenter = {
      x: resultBox!.x + resultBox!.width / 2,
      y: resultBox!.y + resultBox!.height / 2,
    }
    expect(Math.abs(resultCenter.x - canvasCenter.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(resultCenter.y - canvasCenter.y)).toBeLessThanOrEqual(2)
    const boxesOverlap = (
      left: NonNullable<typeof tipBox>,
      right: NonNullable<typeof dialogBox>,
    ): boolean =>
      left.x < right.x + right.width &&
      left.x + left.width > right.x &&
      left.y < right.y + right.height &&
      left.y + left.height > right.y
    expect(boxesOverlap(tipBox!, dialogBox!)).toBe(false)
    expect(boxesOverlap(resultBox!, dialogBox!)).toBe(false)

    await failureDialog.locator('[data-action="again"]').click()
    await expect
      .poll(() =>
        page.evaluate((previousSessionId) => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          return {
            activePearlCount: snapshot.activePearlCount,
            audioVoiceCount: snapshot.audioDiagnostics.activeVoiceCount,
            caughtPearlCount: snapshot.caughtPearlCount,
            effectPoolActive: snapshot.effectPoolDiagnostics.activeCount,
            equippedFireSourceId: snapshot.equippedFireSourceId,
            failurePresentationProgress: snapshot.failurePresentationProgress,
            failurePresentationState: snapshot.failurePresentationState,
            failureResult: snapshot.failureResult,
            firePresentationState: snapshot.firePresentationState,
            furnaceTemperature: snapshot.furnaceTemperature,
            inventory: snapshot.inventory.map(({ batchId, servings }) => ({
              batchId,
              servings,
            })),
            materialRemaining: snapshot.materialRemaining,
            sessionChanged: snapshot.sessionId !== previousSessionId,
            status: snapshot.status,
          }
        }, readyBaseline.sessionId),
      )
      .toEqual({
        activePearlCount: 0,
        audioVoiceCount: 0,
        caughtPearlCount: 0,
        effectPoolActive: 0,
        equippedFireSourceId: null,
        failurePresentationProgress: 0,
        failurePresentationState: 'idle',
        failureResult: null,
        firePresentationState: 'off',
        furnaceTemperature: readyBaseline.furnaceTemperature,
        inventory: readyBaseline.inventory,
        materialRemaining: 0,
        sessionChanged: true,
        status: 'ready',
      })
    await expect(failureResult).toBeHidden()
    await expect(failureDialog).toBeHidden()
    await expect(canvas).not.toHaveAttribute('data-failure-result-x')
    await expect(canvas).not.toHaveAttribute('data-failure-result-y')
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

  test('连续三次重开均清空本炉输入、实体、台账与表现诊断并建立唯一会话', async ({
    page,
  }) => {
    const initial = await openM2(page)
    const sessions = new Set([initial.sessionId])
    const initialServings = initial.inventory.map(({ servings }) => servings)

    for (let restartIndex = 0; restartIndex < 3; restartIndex += 1) {
      await page.locator('button[data-fire-source-id="basic-fire"]').click()
      await page.locator('[data-fire-size]').fill('100')
      await page.locator('[data-flame-thrust]').check()
      await page.locator(FIRST_BATCH_SELECTOR).click()
      await page.locator('[data-action="add-material"]').click()
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__LIANDAN_M2__!.getSnapshot().materialRemaining,
          ),
        )
        .toBeGreaterThan(0)
      const materialBeforeFire = await page.evaluate(
        () => window.__LIANDAN_M2__!.getSnapshot().materialRemaining,
      )

      await aimAtMaterial(page)
      await page.mouse.down()
      try {
        await expect
          .poll(() =>
            page.evaluate((before) => {
              const snapshot = window.__LIANDAN_M2__!.getSnapshot()
              return (
                snapshot.materialRemaining < before &&
                snapshot.effectPoolDiagnostics.highWaterMark > 0
              )
            }, materialBeforeFire),
          )
          .toBe(true)
      } finally {
        await page.mouse.up()
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__LIANDAN_M2__!.getSnapshot().firePresentationState,
          ),
        )
        .toBe('cooling')

      const previousSessionId = await page.evaluate(
        () => window.__LIANDAN_M2__!.getSnapshot().sessionId,
      )
      const restarted = await page.evaluate(async (previous) => {
        const api = window.__LIANDAN_M2__!
        api.setFireSize(91)
        api.setFlameThrust(true)
        api.requestRestart()
        api.confirmRestart()

        return new Promise<M2Snapshot>((resolve, reject) => {
          let remainingFrames = 20
          const sample = (): void => {
            const snapshot = api.getSnapshot()
            if (snapshot.sessionId !== previous) {
              resolve(snapshot)
              return
            }
            remainingFrames -= 1
            if (remainingFrames <= 0) {
              reject(new Error('M2_RESTART_SESSION_TIMEOUT'))
              return
            }
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
      }, previousSessionId)

      expect(sessions.has(restarted.sessionId)).toBe(false)
      sessions.add(restarted.sessionId)
      expect(restarted.tick).toBeLessThanOrEqual(1)
      expect(restarted).toMatchObject({
        activePearlCount: 0,
        canFinish: false,
        caughtPearlCount: 0,
        caughtVolumes: { medicinalLiquid: 0, slag: 0, impurity: 0 },
        equippedFireSourceId: null,
        failurePresentationProgress: 0,
        failurePresentationState: 'idle',
        failureResult: null,
        firePresentationState: 'off',
        fireSize: initial.fireSize,
        fireVisualIntensity: 0,
        flameThrustEnabled: false,
        interactionCount: 0,
        isSpraying: false,
        lastDomainEventTypes: [],
        materialRemaining: 0,
        normalSlagQuantity: 0,
        paused: false,
        pauseReasons: [],
        remainingMaterialCellCount: 0,
        selectedMaterialBatchId: null,
        status: 'ready',
      })
      expect(restarted.furnaceTemperature).toBe(initial.furnaceTemperature)
      expect(restarted.inventory.map(({ servings }) => servings)).toEqual(
        initialServings,
      )
      expect(restarted.effectPoolDiagnostics).toMatchObject({
        activeCount: 0,
        droppedCount: 0,
        highWaterMark: 0,
      })
    }

    expect(sessions.size).toBe(4)
  })

  test('同一控制批次重开时不把火势助推的乐观 UI 状态带入新炉', async ({
    page,
  }) => {
    await openM2(page)
    const previousSessionId = await page.evaluate(
      () => window.__LIANDAN_M2__!.getSnapshot().sessionId,
    )

    await page.evaluate(() => {
      const checkbox = document.querySelector<HTMLInputElement>(
        '[data-flame-thrust]',
      )!
      checkbox.click()
      window.__LIANDAN_M2__!.requestRestart()
      window.__LIANDAN_M2__!.confirmRestart()
    })

    await expect
      .poll(() =>
        page.evaluate((sessionId) => {
          const snapshot = window.__LIANDAN_M2__!.getSnapshot()
          const checkbox = document.querySelector<HTMLInputElement>(
            '[data-flame-thrust]',
          )!
          return {
            sessionChanged: snapshot.sessionId !== sessionId,
            runtimeEnabled: snapshot.flameThrustEnabled,
            checkboxChecked: checkbox.checked,
          }
        }, previousSessionId),
      )
      .toEqual({
        sessionChanged: true,
        runtimeEnabled: false,
        checkboxChecked: false,
      })
  })
})
