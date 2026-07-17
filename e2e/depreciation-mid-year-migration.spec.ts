import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { apiJson, loginAdmin } from "./helpers/api";
import { loginAdminUi, screenshotStep } from "./helpers/auth";
import { createFyEndDraftViaCli } from "./helpers/fy-end-cli.js";
import {
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
  fiscalYearEndBs,
  fiscalYearStartBs,
  inclusiveCalendarDaysBetweenBs,
} from "@hrmskdbl/depreciation-core";

type MidYearFixture = {
  openingFiscalYear: number;
  firstSystemDepreciationDateBs: string;
  lastExternalDepreciationDateBs: string;
  branchId: number;
  assetId: number;
  assetCode: string;
  purchaseDateBs: string;
  depreciationStartDateBs: string;
  grossCost: number;
  importedWdv: number;
  impliedPriorAccum: number;
  depRatePercent: number;
};

type DepreciationRunRow = {
  id: number;
  fiscal_year_start: number;
  status: string;
  depreciation_scope_mode: string;
  is_final_for_fy: boolean;
};

type DepreciationRunDetailRow = {
  asset_id: number;
  dep_days: number;
  dep_start_date_bs: string;
  effective_calc_start_date_bs: string | null;
  book_value: string;
  accumulate_dep: string;
  balance_amount: string;
  dep_amount: string;
};

function loadMidYearFixture(): MidYearFixture {
  const fixturePath = path.join(__dirname, "fixtures", "mid-year-migration.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as MidYearFixture;
}

function seedMidYearFixture(): MidYearFixture {
  execSync("npm run seed:e2e-mid-year-migration --workspace=backend", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: process.env,
  });
  return loadMidYearFixture();
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
  for (let page = 1; page <= 40; page += 1) {
    const detailRes = await apiJson<{
      details: DepreciationRunDetailRow[];
      pagination?: { totalPages: number };
    }>(
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

test.describe.serial("Depreciation mid-year migration", () => {
  let auth: Awaited<ReturnType<typeof loginAdmin>>;
  let fixture: MidYearFixture;
  let firstValidRunId: number;
  let fyEndRunId: number;

  test.beforeAll(async ({ request }) => {
    mkdirSync("e2e/test-results/screenshots", { recursive: true });
    fixture = seedMidYearFixture();
    auth = await loginAdmin(request);
  });

  test("settings UI: set mid-year migration dates and persist after reload", async ({
    page,
  }) => {
    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation/settings");
    await expect(
      page.getByRole("heading", { name: "Depreciation Settings", exact: true })
    ).toBeVisible();

    await page.getByLabel(/Opening fiscal year/i).fill(String(fixture.openingFiscalYear));
    await page
      .getByLabel(/First system depreciation date/i)
      .fill(fixture.firstSystemDepreciationDateBs);
    await page
      .getByLabel(/Last depreciation date calculated by the previous system/i)
      .fill(fixture.lastExternalDepreciationDateBs);

    // Settings may already be seeded and locked only after posted runs — seed clears runs.
    const saveBtn = page.getByRole("button", { name: /Save settings/i });
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      await expect(page.getByRole("status")).toContainText(/saved/i);
    }

    await page.reload();
    await expect(page.getByLabel(/Opening fiscal year/i)).toHaveValue(
      String(fixture.openingFiscalYear)
    );
    await expect(page.getByLabel(/First system depreciation date/i)).toHaveValue(
      fixture.firstSystemDepreciationDateBs
    );
    await screenshotStep(page, "mid-year-settings-persisted");
  });

  test("rejects run ending before migration date", async ({ request, page }) => {
    const beforeMigration = fixture.lastExternalDepreciationDateBs;
    const createRes = await apiJson<{ error?: string }>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: beforeMigration,
        nepaliMonth: "Bhadra",
        depTitle: "E2E pre-migration AS_OF (should fail)",
      }
    );

    expect(createRes.status).toBe(400);
    expect(createRes.body.error ?? createRes.text).toMatch(
      /before the system migration date/i
    );

    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation/new");
    await screenshotStep(page, "mid-year-pre-migration-rejected");
  });

  test("first valid run calculates from Ashwin 1 using imported WDV", async ({
    request,
    page,
  }) => {
    const q2End = fiscalQuarterEndBs(fixture.openingFiscalYear, 2);
    const expectedDays = inclusiveCalendarDaysBetweenBs(
      fixture.firstSystemDepreciationDateBs,
      q2End
    );
    const expected = computeAssetQuarterCumulative({
      purchaseAmount: fixture.grossCost,
      depreciationStartBs: fixture.depreciationStartDateBs,
      depRatePercent: fixture.depRatePercent,
      method: "DECLINING_BALANCE",
      fiscalYearStart: fixture.openingFiscalYear,
      quarter: 2,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: q2End,
      registerPriorAccumulatedDep: fixture.impliedPriorAccum,
      firstSystemDepreciationDateBs: fixture.firstSystemDepreciationDateBs,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;

    const createRes = await apiJson<{
      run: DepreciationRunRow;
      error?: string;
    }>(request, auth, "POST", "/api/admin/depreciation-runs", {
      calculationDateBs: q2End,
      nepaliMonth: "Poush",
      depTitle: "E2E mid-year first valid run",
    });
    expect(createRes.status, createRes.text).toBe(201);
    firstValidRunId = createRes.body.run.id;

    const line = await fetchAssetRunDetail(
      request,
      auth,
      firstValidRunId,
      fixture.assetId
    );
    expect(line).toBeTruthy();
    expect(line!.effective_calc_start_date_bs).toBe(
      fixture.firstSystemDepreciationDateBs
    );
    expect(line!.dep_days).toBe(expectedDays);
    expect(Math.abs(num(line!.book_value) - fixture.importedWdv)).toBeLessThan(
      0.01
    );
    expect(Math.abs(num(line!.dep_amount) - expected.detail.depAmount)).toBeLessThan(
      0.02
    );
    expect(
      Math.abs(num(line!.balance_amount) - expected.detail.balanceAmount)
    ).toBeLessThan(0.02);

    // Pre-migration day count (Shrawan 1 → Q2 end) must be larger.
    const fullFromFyStart = inclusiveCalendarDaysBetweenBs(
      fiscalYearStartBs(fixture.openingFiscalYear),
      q2End
    );
    expect(line!.dep_days).toBeLessThan(fullFromFyStart);

    await loginAdminUi(page);
    await page.goto(
      `/admin/dashboard/asset-register/depreciation/${firstValidRunId}`
    );
    await expect(
      page.getByRole("heading", { level: 2 }).first()
    ).toBeVisible({ timeout: 15_000 });
    await screenshotStep(page, "mid-year-first-valid-run-detail");
  });

  test("FY_END posts system-owned portion only; settings lock; next FY carry-forward", async ({
    request,
    page,
  }) => {
    const fyEnd = fiscalYearEndBs(fixture.openingFiscalYear);
    const expectedFyEnd = computeAssetQuarterCumulative({
      purchaseAmount: fixture.grossCost,
      depreciationStartBs: fixture.depreciationStartDateBs,
      depRatePercent: fixture.depRatePercent,
      method: "DECLINING_BALANCE",
      fiscalYearStart: fixture.openingFiscalYear,
      quarter: 4,
      depreciationScopeMode: "FY_END",
      registerPriorAccumulatedDep: fixture.impliedPriorAccum,
      firstSystemDepreciationDateBs: fixture.firstSystemDepreciationDateBs,
    });
    expect(expectedFyEnd.ok).toBe(true);
    if (!expectedFyEnd.ok) return;

    const cliDraft = createFyEndDraftViaCli(fixture.openingFiscalYear);
    fyEndRunId = cliDraft.runId;

    const postRes = await apiJson<{ run?: DepreciationRunRow; error?: string }>(
      request,
      auth,
      "POST",
      `/api/admin/depreciation-runs/${fyEndRunId}/post`
    );
    expect(postRes.status, postRes.text).toBe(200);

    const line = await fetchAssetRunDetail(
      request,
      auth,
      fyEndRunId,
      fixture.assetId
    );
    expect(line).toBeTruthy();
    expect(line!.effective_calc_start_date_bs).toBe(
      fixture.firstSystemDepreciationDateBs
    );
    expect(line!.dep_days).toBe(
      inclusiveCalendarDaysBetweenBs(
        fixture.firstSystemDepreciationDateBs,
        fyEnd
      )
    );
    expect(
      Math.abs(num(line!.balance_amount) - expectedFyEnd.detail.balanceAmount)
    ).toBeLessThan(0.02);

    const settingsRes = await apiJson<{
      settings: { editable: boolean; lockReason: string | null };
    }>(request, auth, "GET", "/api/admin/depreciation-settings");
    expect(settingsRes.body.settings.editable).toBe(false);
    expect(settingsRes.body.settings.lockReason ?? "").toMatch(/posted/i);

    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation/settings");
    await expect(page.getByLabel(/Opening fiscal year/i)).toBeDisabled();
    await screenshotStep(page, "mid-year-settings-locked");

    const applyRes = await apiJson<{ status?: string; error?: string }>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-fy-rollover",
      { newFiscalYearStart: fixture.openingFiscalYear + 1 }
    );
    expect(applyRes.status, applyRes.text).toBe(200);

    const nextFy = fixture.openingFiscalYear + 1;
    const nextQ1End = fiscalQuarterEndBs(nextFy, 1);
    const nextCreate = await apiJson<{
      run: DepreciationRunRow;
      error?: string;
    }>(request, auth, "POST", "/api/admin/depreciation-runs", {
      calculationDateBs: nextQ1End,
      nepaliMonth: "Ashwin",
      depTitle: "E2E next FY after mid-year migration",
    });

    // After rollover + posted prior final, next FY should succeed and use carry-forward.
    expect(nextCreate.status, nextCreate.text).toBe(201);
    const nextLine = await fetchAssetRunDetail(
      request,
      auth,
      nextCreate.body.run.id,
      fixture.assetId
    );
    expect(nextLine).toBeTruthy();
    expect(nextLine!.effective_calc_start_date_bs).toBe(
      fiscalYearStartBs(nextFy)
    );
    expect(nextLine!.effective_calc_start_date_bs).not.toBe(
      fixture.firstSystemDepreciationDateBs
    );
    expect(Math.abs(num(nextLine!.book_value) - num(line!.balance_amount))).toBeLessThan(
      0.02
    );

    writeFileSync(
      "e2e/test-results/mid-year-migration-summary.md",
      [
        "# Mid-year migration E2E",
        "",
        `- Opening FY: ${fixture.openingFiscalYear}`,
        `- First system date: ${fixture.firstSystemDepreciationDateBs}`,
        `- Imported WDV: ${fixture.importedWdv}`,
        `- First valid run id: ${firstValidRunId}`,
        `- FY_END run id: ${fyEndRunId}`,
        `- FY_END closing WDV: ${line!.balance_amount}`,
        `- Next FY opening WDV: ${nextLine!.book_value}`,
        "",
      ].join("\n"),
      "utf8"
    );
  });
});
