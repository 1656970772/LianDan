import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("默认成丹、结果过期与炸炉分支可在真实浏览器完成", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "炼丹规则推演台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等待第一次推演", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "推演成丹" }).click();
  await expect(page.getByRole("heading", { name: "聚气散", exact: true })).toBeVisible();
  await page.getByText("查看完整判定依据", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "最终判定依据" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出案例" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^炼丹测试案例-\d+\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    input: { seed: number };
    result: { status: string };
  };
  expect(exported.result.status).toBe("success");

  exported.input.seed = 20260813;
  await page.getByLabel("选择要导入的 JSON 输入文件").setInputFiles({
    name: "alchemy-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ input: exported.input })),
  });
  await expect(page.getByRole("spinbutton", { name: "随机种子" })).toHaveValue("20260813");
  await expect(page.getByText("已导入 alchemy-import.json，尚未执行推演。")).toBeVisible();

  await page.getByRole("spinbutton", { name: "炉温精确数值" }).fill("73");
  await expect(page.getByText("结果已过期")).toBeVisible();

  await page.getByRole("combobox", { name: "测试预设" }).selectOption("preset_explosion");
  await page.getByRole("button", { name: "推演成丹" }).click();
  await expect(page.getByRole("heading", { name: "炸炉", exact: true })).toBeVisible();
  await expect(page.locator('img[src="/assets/pills/explosion.png"]')).toBeVisible();
});

test("六槽支持选中后点击加一，并可拖拽批量放入", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");

  const slots = page.locator(".recipe-slots .recipe-slot");
  await expect(slots).toHaveCount(6);
  await expect(page.getByRole("button", { name: /^主药一，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^主药二，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^主药三，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^辅药一，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^辅药二，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^药引，/ })).toBeVisible();

  const auxiliarySlot = page.getByRole("button", { name: "辅药二，空槽，点击选择" });
  await auxiliarySlot.click();
  await expect(auxiliarySlot).toHaveAttribute("aria-pressed", "true");

  const coldBranch = page.getByRole("button", { name: /^寒髓枝，背包剩余 \d+ 份$/ });
  const initialColdStockLabel = await coldBranch.getAttribute("aria-label");
  const initialColdStock = Number(initialColdStockLabel?.match(/背包剩余 (\d+) 份/)?.[1]);
  expect(initialColdStock).toBeGreaterThanOrEqual(2);

  await coldBranch.click();
  await expect(page.getByRole("button", { name: "辅药二，寒髓枝，数量 1" })).toBeVisible();
  await expect(coldBranch).toHaveAccessibleName(`寒髓枝，背包剩余 ${initialColdStock - 1} 份`);

  await coldBranch.click();
  await expect(page.getByRole("button", { name: "辅药二，寒髓枝，数量 2" })).toBeVisible();
  await expect(coldBranch).toHaveAccessibleName(`寒髓枝，背包剩余 ${initialColdStock - 2} 份`);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const fireRoot = page.getByRole("button", { name: /^火灵根，背包剩余 \d+ 份$/ });
  const catalystSlot = page.locator('[data-slot-id="catalyst"]');
  await fireRoot.dragTo(catalystSlot);

  const quantityDialog = page.getByRole("dialog", { name: "火灵根" });
  await expect(quantityDialog).toBeVisible();
  const quantitySlider = quantityDialog.getByRole("slider", { name: "放入数量" });
  await quantitySlider.focus();
  await quantitySlider.press("Home");
  await quantitySlider.press("ArrowRight");
  await expect(quantityDialog.getByRole("spinbutton", { name: "放入数量精确值" })).toHaveValue("2");

  await quantityDialog.getByRole("button", { name: "确认放入" }).click();
  await expect(quantityDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "药引，火灵根，数量 2" })).toBeVisible();
});

test("桌面端保持三栏，成丹结果位于六槽下方", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");

  const materialPanel = page.locator('section[aria-labelledby="materials-title"]');
  const recipePanel = page.locator('section[aria-labelledby="recipe-title"]');
  const factorPanel = page.locator('section[aria-labelledby="factors-title"]');
  const resultPanel = page.locator('section[aria-labelledby="result-title"]');
  const slots = page.locator(".recipe-slots");

  await expect(materialPanel).toBeVisible();
  await expect(recipePanel).toBeVisible();
  await expect(factorPanel).toBeVisible();
  await expect(resultPanel).toBeAttached();
  await expect(factorPanel.getByLabel("灵魂力", { exact: true })).toBeVisible();

  const [materialBox, recipeBox, factorBox, resultBox, slotsBox] = await Promise.all([
    materialPanel.boundingBox(),
    recipePanel.boundingBox(),
    factorPanel.boundingBox(),
    resultPanel.boundingBox(),
    slots.boundingBox(),
  ]);

  expect(materialBox).not.toBeNull();
  expect(recipeBox).not.toBeNull();
  expect(factorBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(slotsBox).not.toBeNull();
  expect(materialBox!.x).toBeLessThan(recipeBox!.x);
  expect(recipeBox!.x).toBeLessThan(factorBox!.x);
  expect(Math.abs(materialBox!.y - recipeBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(recipeBox!.y - factorBox!.y)).toBeLessThanOrEqual(1);
  expect(resultBox!.y).toBeGreaterThan(slotsBox!.y + slotsBox!.height);
  expect(Math.abs(resultBox!.x - recipeBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(resultBox!.width - recipeBox!.width)).toBeLessThanOrEqual(1);
});

test("窄屏布局无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "炼丹规则推演台" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("button", { name: "推演成丹" })).toBeVisible();
});
