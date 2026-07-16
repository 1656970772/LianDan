import { expect, test } from '@playwright/test'

test('M5 空闲场景只发布变化后的 canvas 元数据', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready')
  const canvas = page.locator('canvas[data-scene="m2-extraction"]')
  await expect(canvas).toBeVisible()

  const diagnostics = await canvas.evaluate(async (target) => {
    let changedWrites = 0
    let sameValueWrites = 0
    let total = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === null) continue
        total += 1
        const current = target.getAttribute(record.attributeName)
        if (record.oldValue === current) sameValueWrites += 1
        else changedWrites += 1
      }
    })
    observer.observe(target, { attributes: true, attributeOldValue: true })
    const startedAt = performance.now()
    await new Promise((resolve) => window.setTimeout(resolve, 750))
    const elapsedSeconds = (performance.now() - startedAt) / 1_000
    observer.disconnect()
    return {
      changedWrites,
      elapsedSeconds,
      sameValueWrites,
      sameValueWritesPerSecond: sameValueWrites / elapsedSeconds,
      total,
    }
  })

  expect(diagnostics.sameValueWrites).toBe(0)
  expect(diagnostics.total).toBeLessThanOrEqual(200)
})
