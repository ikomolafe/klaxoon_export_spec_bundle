import { expect, test } from "@playwright/test";

test("fixture page exposes export trigger affordance", async ({ page }) => {
  await page.goto(`file://${process.cwd()}/fixtures/klaxoon-board.html`);
  await expect(page.locator("[data-testid='export-menu-trigger']")).toBeVisible();
});
