import type { Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./constants";

export async function loginAdminUi(page: Page): Promise<void> {
  await page.goto("/admin");
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 30_000 });
}

export async function screenshotStep(
  page: Page,
  fileName: string
): Promise<string> {
  const outPath = `e2e/test-results/screenshots/${fileName}.png`;
  await page.screenshot({ path: outPath, fullPage: true });
  return outPath;
}
