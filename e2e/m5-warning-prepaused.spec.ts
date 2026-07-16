import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  parseAndValidateM5VisualEvidenceFixtureJson,
  type M5VisualEvidenceFixture,
  type M5VisualWarningTransitionLatch,
} from '../scripts/m5-visual-evidence-support.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const fixture = parseAndValidateM5VisualEvidenceFixtureJson(
  readFileSync(
    resolve(
      repositoryRoot,
      'public',
      'config',
      'evidence',
      'm5-visual-matrix.json',
    ),
    'utf8',
  ),
  readFileSync(
    resolve(
      repositoryRoot,
      'schemas',
      'config',
      'm5-visual-evidence.schema.json',
    ),
    'utf8',
  ),
)
const flow = fixture.coverage.warningFlow
const warningTwo = fixture.coverage.cases.find(
  ({ automation, warningLevel }) =>
    automation === 'm2-loss-warning' && warningLevel === 2,
)

if (
  warningTwo?.expectedEffect === undefined ||
  warningTwo.expectedMessageZh === undefined
) {
  throw new Error('M5_WARNING_PREPAUSED_FIXTURE_INVALID')
}
const warningTwoExpectedEffect = warningTwo.expectedEffect
const warningTwoExpectedMessageZh = warningTwo.expectedMessageZh

async function aimAtLogicalPoint(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
): Promise<void> {
  const canvas = page.locator('canvas[data-scene="m2-extraction"]')
  const bounds = await canvas.boundingBox()
  if (bounds === null) throw new Error('M5_WARNING_PREPAUSED_CANVAS_MISSING')
  const logical = await page.evaluate(() => {
    const snapshot = window.__LIANDAN_M2__?.getSnapshot()
    if (snapshot === undefined) throw new Error('M5_WARNING_PREPAUSED_API_MISSING')
    return { width: snapshot.logicalWidth, height: snapshot.logicalHeight }
  })
  await page.mouse.move(
    bounds.x + bounds.width * (point.x / logical.width),
    bounds.y + bounds.height * (point.y / logical.height),
  )
}

async function pauseFromPageClock(
  page: Page,
  visualFixture: M5VisualEvidenceFixture,
): Promise<void> {
  let lastError: unknown
  for (
    let attempt = 0;
    attempt < visualFixture.protocol.clock.pauseMaximumAttempts;
    attempt += 1
  ) {
    const now = await page.evaluate(() => Date.now())
    try {
      await page.clock.pauseAt(
        now + visualFixture.protocol.clock.pauseLeadMilliseconds,
      )
      return
    } catch (error) {
      lastError = error
      if (
        !(error instanceof Error) ||
        !/past/i.test(error.message)
      ) {
        throw error
      }
    }
  }
  throw lastError
}

test('warning2 先暂停再受控寻找边界，真实 Chrome 不产生 capture tick 追赶', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.clock.install({ time: Date.now() })
  await page.setViewportSize(fixture.coverage.viewport)
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')

  await page.evaluate((warningFlow) => {
    const api = window.__LIANDAN_M2__
    if (api === undefined) throw new Error('M5_WARNING_PREPAUSED_API_MISSING')
    api.selectFireSource(warningFlow.fireSourceId)
    api.setFireSize(warningFlow.fireSize)
    api.setFlameThrust(warningFlow.flameThrust)
    api.preselectMaterial(warningFlow.materialBatchId)
    api.addSelectedMaterial()
  }, flow)
  await page.waitForFunction(
    ({ fireSourceId, fireSize, materialDefinitionId }) => {
      const api = window.__LIANDAN_M2__
      const snapshot = api?.getSnapshot()
      return (
        snapshot?.equippedFireSourceId === fireSourceId &&
        snapshot.fireSize === fireSize &&
        api
          ?.getMaterialTopologyEvidence()
          .some(
            (material) =>
              material.materialDefinitionId === materialDefinitionId,
          ) === true
      )
    },
    flow,
    { timeout: fixture.protocol.timeouts.browserOperationMilliseconds },
  )

  await page.locator('[data-m2-stage]').focus()
  await page.keyboard.down(flow.collectorMoveKey)
  try {
    await page.waitForTimeout(flow.collectorMoveMilliseconds)
  } finally {
    await page.keyboard.up(flow.collectorMoveKey)
  }
  await page.waitForTimeout(flow.collectorSettleMilliseconds)
  await aimAtLogicalPoint(page, flow.logicalTarget)
  await page.evaluate(() => {
    const stage = document.querySelector('[data-m2-stage]')
    if (!(stage instanceof HTMLElement)) {
      throw new Error('M5_WARNING_PREPAUSED_STAGE_MISSING')
    }
    stage.addEventListener(
      'pointerdown',
      (event) => {
        stage.dataset.m5EvidencePointerId = String(event.pointerId)
      },
      { capture: true, once: true },
    )
  })

  await page.mouse.down()
  let pointerDown = true
  let clockPaused = false
  try {
    await page.waitForFunction(
      () => {
        const snapshot = window.__LIANDAN_M2__?.getSnapshot()
        return (
          snapshot?.lossWarningLevel === 1 &&
          snapshot.lastDomainEventTypes.includes('LossWarningChanged')
        )
      },
      undefined,
      { timeout: flow.maximumWaitMilliseconds },
    )

    await pauseFromPageClock(page, fixture)
    clockPaused = true
    let advancedMilliseconds = 0
    let latch: M5VisualWarningTransitionLatch | undefined
    for (;;) {
      const transition = await page.evaluate(
        ({ expectedEffect, expectedMessageZh, stopLevel }) => {
          const api = window.__LIANDAN_M2__
          const snapshot = api?.getSnapshot()
          const warning = document.querySelector(
            '[data-loss-warning][data-level]',
          )
          const presentation = api?.getPresentationEvidence()
          if (
            snapshot === undefined ||
            warning === null ||
            presentation === undefined
          ) {
            return false
          }
          const rectangle = warning.getBoundingClientRect()
          const matches =
            snapshot.lossWarningLevel === stopLevel &&
            snapshot.lastDomainEventTypes.includes('LossWarningChanged') &&
            warning.getAttribute('data-level') === String(stopLevel) &&
            (warning.textContent ?? '').includes(expectedMessageZh) &&
            !warning.hasAttribute('hidden') &&
            rectangle.width > 0 &&
            rectangle.height > 0 &&
            presentation.activeEffectKinds.includes(expectedEffect)
          if (!matches) return false
          const stage = document.querySelector('[data-m2-stage]')
          const pointerId = Number(
            stage instanceof HTMLElement
              ? stage.dataset.m5EvidencePointerId
              : Number.NaN,
          )
          if (!Number.isInteger(pointerId) || pointerId < 0) {
            throw new Error('M5_WARNING_PREPAUSED_POINTER_ID_MISSING')
          }
          window.dispatchEvent(
            new PointerEvent('pointerup', {
              pointerId,
              button: 0,
              buttons: 0,
              bubbles: true,
              cancelable: true,
            }),
          )
          return {
            sessionId: snapshot.sessionId,
            tick: snapshot.tick,
            eventObserved: true as const,
            eventType: 'LossWarningChanged' as const,
            level: 2 as const,
            effectKind: 'warningTwo' as const,
          }
        },
        {
          expectedEffect: warningTwoExpectedEffect,
          expectedMessageZh: warningTwoExpectedMessageZh,
          stopLevel: flow.stopSprayingAtWarningLevel,
        },
      )
      if (transition !== false) {
        latch = transition
        break
      }
      expect(advancedMilliseconds).toBeLessThan(flow.maximumWaitMilliseconds)
      await page.clock.runFor(fixture.protocol.clock.sequenceStepMilliseconds)
      advancedMilliseconds += fixture.protocol.clock.sequenceStepMilliseconds
    }

    await page.mouse.up()
    pointerDown = false
    for (;;) {
      const snapshot = await page.evaluate(() =>
        window.__LIANDAN_M2__?.getSnapshot(),
      )
      if (snapshot === undefined) {
        throw new Error('M5_WARNING_PREPAUSED_API_MISSING')
      }
      expect(snapshot.status).toBe('extracting')
      expect(snapshot.failurePresentationState).toBe('idle')
      expect(snapshot.tick - latch.tick).toBeLessThanOrEqual(
        flow.maximumStoppedCaptureTickDrift,
      )
      if (!snapshot.isSpraying) {
        expect(snapshot.lossWarningLevel).toBe(2)
        break
      }
      await page.clock.runFor(fixture.protocol.clock.sequenceStepMilliseconds)
    }
  } finally {
    if (pointerDown) await page.mouse.up()
    if (clockPaused) await page.clock.resume()
  }
})
