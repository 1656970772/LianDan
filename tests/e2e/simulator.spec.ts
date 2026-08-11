import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("默认成丹、结果过期与炸炉分支可在真实浏览器完成", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "炼丹规则工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等待第一次推演", exact: true })).toBeVisible();
  await expect(page.getByText("魔核 · 基础剂量 2")).toBeVisible();
  await expect(page.getByLabel("水系二阶魔核兽龄数值")).toHaveValue("80");

  await page.getByRole("button", { name: "推演成丹" }).click();
  await expect(page.getByRole("heading", { name: "聚气散", exact: true })).toBeVisible();
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

test("窄屏布局无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("button", { name: "推演成丹" })).toBeVisible();
});
