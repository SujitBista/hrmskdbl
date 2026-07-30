import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { SignJWT } from "jose";
import { apiJson, loginAdmin } from "./helpers/api";
import { loginAdminUi, screenshotStep } from "./helpers/auth";
import { loadFyTransitionFixture } from "./helpers/constants";

type DepreciationRunDetailRow = {
  asset_id: number;
  balance_amount: string;
  book_value: string;
};

type RunByIdResponse = {
  run?: {
    status: string;
  };
  details: DepreciationRunDetailRow[];
  pagination?: { totalPages: number };
};

const FRONTEND_URL =
  process.env.E2E_FRONTEND_URL ??
  `http://localhost:${process.env.E2E_FRONTEND_PORT ?? "3001"}`;

function seedFyFixture() {
  execSync("npm run seed:e2e-fy-transition --workspace=backend", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: process.env,
  });
  return loadFyTransitionFixture();
}

function num(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

async function fetchAssetRunDetail(
  request: import("@playwright/test").APIRequestContext,
  auth: import("./helpers/api").AuthSession,
  runId: number,
  assetId: number
): Promise<DepreciationRunDetailRow | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const detailRes = await apiJson<RunByIdResponse>(
      request,
      auth,
      "GET",
      `/api/admin/depreciation-runs/${runId}?page=${page}&pageSize=500`
    );
    const line = detailRes.body.details?.find((d) => d.asset_id === assetId);
    if (line) {
      return line;
    }
    const totalPages = detailRes.body.pagination?.totalPages ?? 1;
    if (page >= totalPages) {
      break;
    }
  }
  return undefined;
}

async function signNonAdminToken(): Promise<string> {
  const secret =
    process.env.JWT_SECRET ??
    "dev-secret-change-in-production-min-32-chars-ok";
  return new SignJWT({
    email: "viewer@hrms.test",
    role: "user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("999")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

test.describe.serial("Depreciation FY rollover admin UI", () => {
  test("guides admin through FY_END posting and explicit rollover", async ({
    request,
    page,
    browser,
  }) => {
    mkdirSync("e2e/test-results/screenshots", { recursive: true });
    const fixture = seedFyFixture();
    const auth = await loginAdmin(request);

    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation");

    const rolloverRegion = page.getByRole("region", {
      name: "Fiscal Year Rollover",
    });
    await expect(
      page.getByRole("heading", { name: "Fiscal Year Rollover" })
    ).toBeVisible();
    await expect(rolloverRegion.getByText("Loading rollover status…")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(rolloverRegion).toContainText("Previous FY_END missing");
    await expect(
      page.getByRole("button", { name: /roll over to fy 2083\/84/i })
    ).toHaveCount(0);
    const blockedShot = await screenshotStep(page, "fy-rollover-ui-blocked-missing");

    await page.getByRole("button", { name: /create previous fy_end run/i }).click();
    await page.waitForURL(/\/admin\/dashboard\/asset-register\/depreciation\/\d+$/);

    const fyEndRunId = Number.parseInt(page.url().split("/").pop() ?? "", 10);
    expect(Number.isFinite(fyEndRunId)).toBe(true);

    await expect(
      page.getByText(/Draft FY_END depreciation/i)
    ).toBeVisible();
    const draftShot = await screenshotStep(page, "fy-rollover-ui-fy-end-draft");

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: /post fy_end depreciation/i }).click();
    await expect
      .poll(async () => {
        const runRes = await apiJson<RunByIdResponse>(
          request,
          auth,
          "GET",
          `/api/admin/depreciation-runs/${fyEndRunId}`
        );
        return runRes.body.run?.status ?? "missing";
      })
      .toBe("posted");

    const finalLine = await fetchAssetRunDetail(
      request,
      auth,
      fyEndRunId,
      fixture.assetId
    );
    expect(finalLine).toBeTruthy();
    const closingWdv = num(finalLine!.balance_amount);

    await page.goto("/admin/dashboard/asset-register/depreciation");
    await expect(rolloverRegion).toContainText("Ready for rollover");
    await expect(
      page.getByRole("button", { name: /roll over to fy 2083\/84/i })
    ).toBeVisible();
    const readyShot = await screenshotStep(page, "fy-rollover-ui-ready");

    await page.getByRole("button", { name: /roll over to fy 2083\/84/i }).click();
    await expect(page.getByText("Confirm fiscal year rollover")).toBeVisible();
    const confirmButton = page.getByRole("button", { name: /confirm rollover/i });
    await expect(confirmButton).toBeDisabled();
    const confirmShot = await screenshotStep(page, "fy-rollover-ui-confirm");

    await page.getByRole("checkbox").check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(rolloverRegion).toContainText("Already completed");
    await expect(
      page.getByText(/Previous FY closing WDV is now the new FY opening WDV/i)
    ).toBeVisible();
    const completedShot = await screenshotStep(page, "fy-rollover-ui-completed");

    const assetRes = await apiJson<{
      assets: Array<{ id: number; book_value: string }>;
    }>(
      request,
      auth,
      "GET",
      `/api/admin/assets?q=${encodeURIComponent(fixture.assetCode)}`
    );
    const assetRow = assetRes.body.assets?.find((a) => a.id === fixture.assetId);
    expect(assetRow).toBeTruthy();
    expect(Math.abs(num(assetRow!.book_value) - closingWdv)).toBeLessThan(0.05);

    await page.reload();
    await expect(rolloverRegion).toContainText("Already completed");
    await expect(
      page.getByRole("button", { name: /roll over to fy 2083\/84/i })
    ).toHaveCount(0);

    const nonAdminContext = await browser.newContext();
    const nonAdminToken = await signNonAdminToken();
    await nonAdminContext.addCookies([
      {
        name: "admin_token",
        value: nonAdminToken,
        url: FRONTEND_URL,
      },
    ]);
    const nonAdminPage = await nonAdminContext.newPage();
    await nonAdminPage.goto(
      `${FRONTEND_URL}/admin/dashboard/asset-register/depreciation`
    );
    await expect(nonAdminPage).toHaveURL(`${FRONTEND_URL}/admin`);
    const nonAdminShot = await screenshotStep(
      nonAdminPage,
      "fy-rollover-ui-non-admin-redirect"
    );

    const nonAdminPost = await nonAdminPage.evaluate(async () => {
      const res = await fetch("/api/admin/depreciation-fy-rollover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newFiscalYearStart: 2083 }),
      });
      return {
        status: res.status,
        body: (await res.json()) as { error?: string },
      };
    });
    expect(nonAdminPost.status).toBe(401);
    await nonAdminContext.close();

    test.info().annotations.push(
      { type: "screenshot", description: blockedShot },
      { type: "screenshot", description: draftShot },
      { type: "screenshot", description: readyShot },
      { type: "screenshot", description: confirmShot },
      { type: "screenshot", description: completedShot },
      { type: "screenshot", description: nonAdminShot }
    );
  });
});
