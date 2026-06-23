import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { apiJson, loginAdmin } from "./helpers/api";
import { loginAdminUi, screenshotStep } from "./helpers/auth";
import { createFyEndDraftViaCli } from "./helpers/fy-end-cli.js";
import { loadFyTransitionFixture } from "./helpers/constants";
import {
  baseCarryForwardMatrix,
  expectedDepDaysFromRegisterStart,
  expectedOpeningFyRunDetail,
  formatMatrixReport,
  formatScenarioReports,
  nepaliMonthNameForBsDate,
  type FyCarryForwardMatrixRow,
  type ScenarioStepReport,
} from "./helpers/expectations";
import {
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
  fiscalYearStartFromBsDate,
} from "@hrmskdbl/depreciation-core";

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
  register_depreciation_start_bs: string;
  purchase_date_bs: string;
  book_value: string;
  accumulate_dep: string;
  balance_amount: string;
  depreciation_cost_basis: string;
  dep_amount: string;
};

type CreateRunResponse = {
  run: DepreciationRunRow;
  detailsInserted: number;
  error?: string;
};

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
    const line = assetDetail(detailRes.body.details, assetId);
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

type RunByIdResponse = {
  run: DepreciationRunRow;
  details: DepreciationRunDetailRow[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

type RolloverStatus = {
  currentFiscalYearStart: number;
  priorFiscalYearStart: number;
  status: string;
  openingFiscalYear?: number | null;
  blockers?: string[];
};

type RolloverResult = {
  status: string;
  newFiscalYearStart: number;
  priorFiscalYearStart: number;
  sourceFinalRunId?: number | null;
};

const stepReports: ScenarioStepReport[] = [];
const matrixRows: FyCarryForwardMatrixRow[] = baseCarryForwardMatrix();

function assetDetail(
  details: DepreciationRunDetailRow[],
  assetId: number
): DepreciationRunDetailRow | undefined {
  return details.find((d) => d.asset_id === assetId);
}

function num(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

test.describe.serial("Depreciation fiscal year transition", () => {
  let auth: Awaited<ReturnType<typeof loginAdmin>>;
  let fixture: ReturnType<typeof loadFyTransitionFixture>;
  let openingRunId: number;
  let fyEndRunId: number;
  let fy2082ClosingBalance: number;
  let assetBookValueAfterRollover: number | null = null;

  function recordStep(input: ScenarioStepReport): void {
    stepReports.push(input);
  }

  test.beforeAll(async ({ request }) => {
    mkdirSync("e2e/test-results/screenshots", { recursive: true });
    fixture = loadFyTransitionFixture();
    auth = await loginAdmin(request);
  });

  test.afterAll(async () => {
    writeFileSync(
      "e2e/test-results/scenario-report.md",
      formatScenarioReports(stepReports),
      "utf8"
    );
    writeFileSync(
      "e2e/test-results/carry-forward-matrix.md",
      formatMatrixReport(matrixRows),
      "utf8"
    );
  });

  test("Scenario 1: Opening FY 2082 — migrated asset uses register dep start and imported WDV", async ({
    request,
    page,
  }) => {
    const expected = expectedOpeningFyRunDetail(fixture);

    const blocked2083 = await apiJson<{ error?: string }>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: fiscalQuarterEndBs(2083, 1),
        nepaliMonth: nepaliMonthNameForBsDate(fiscalQuarterEndBs(2083, 1)),
      }
    );

    const createRes = await apiJson<CreateRunResponse>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: expected.calculationDateBs,
        nepaliMonth: expected.nepaliMonth,
        depTitle: "E2E Opening FY 2082 run",
      }
    );

    expect(createRes.status, createRes.text).toBe(201);
    openingRunId = createRes.body.run.id;

    const line = await fetchAssetRunDetail(request, auth, openingRunId, fixture.assetId);
    expect(line, "migrated asset detail line").toBeTruthy();

    const depDaysOk =
      line!.dep_days === expected.depDays &&
      line!.dep_days ===
        expectedDepDaysFromRegisterStart(fixture, expected.calculationDateBs);
    const openingOk =
      Math.abs(num(line!.book_value) - fixture.importedWdv) < 0.01;
    const priorAccumOk =
      Math.abs(num(line!.accumulate_dep) - fixture.impliedPriorAccum) < 0.01;
    const depStartOk =
      line!.dep_start_date_bs === expected.depreciationStartBs &&
      line!.register_depreciation_start_bs === fixture.depreciationStartDateBs;
    const no2081Required = createRes.status === 201;

    recordStep({
      scenario: "Scenario 1",
      step: "FY 2083 blocked before FY 2082 final exists",
      expected: "Create FY 2083 run fails (prior FY 2082 final required)",
      actual: blocked2083.status === 400
        ? (blocked2083.body.error ?? blocked2083.text)
        : `Unexpected status ${blocked2083.status}`,
      passed: blocked2083.status === 400,
    });

    await loginAdminUi(page);
    await page.goto(
      `/admin/dashboard/asset-register/depreciation/${openingRunId}`
    );
    const shot1 = await screenshotStep(page, "scenario-1-opening-fy-run-detail");

    recordStep({
      scenario: "Scenario 1",
      step: "Create FY 2082 depreciation run",
      expected:
        "Run created without requiring FY 2081 final; DepDays from register dep start; imported WDV as opening balance",
      actual: JSON.stringify({
        runId: openingRunId,
        depDays: line!.dep_days,
        expectedDepDays: expected.depDays,
        openingWdv: num(line!.book_value),
        importedWdv: fixture.importedWdv,
        priorAccum: num(line!.accumulate_dep),
        depStart: line!.dep_start_date_bs,
      }),
      passed:
        no2081Required && depDaysOk && openingOk && priorAccumOk && depStartOk,
      screenshot: shot1,
    });

    matrixRows[0]!.observedRequiresPriorFyFinal = false;
    matrixRows[0]!.observedOpeningBalanceSource = openingOk
      ? "Imported Book Value"
      : `book_value=${line!.book_value}`;
    matrixRows[0]!.consistent =
      matrixRows[0]!.observedRequiresPriorFyFinal ===
        matrixRows[0]!.requiresPriorFyFinal &&
      matrixRows[0]!.observedOpeningBalanceSource ===
        matrixRows[0]!.openingBalanceSource;

    expect(no2081Required).toBeTruthy();
    expect(depDaysOk).toBeTruthy();
    expect(openingOk).toBeTruthy();
    expect(priorAccumOk).toBeTruthy();
    expect(depStartOk).toBeTruthy();
    expect(blocked2083.status).toBe(400);
  });

  test("Scenario 2: FY_END closing for FY 2082 — draft, review, post", async ({
    request,
    page,
  }) => {
    const cliDraft = createFyEndDraftViaCli(fixture.openingFiscalYear);
    fyEndRunId = cliDraft.runId;

    const draftDetail = await apiJson<RunByIdResponse>(
      request,
      auth,
      "GET",
      `/api/admin/depreciation-runs/${fyEndRunId}`
    );

    const isDraft =
      cliDraft.status === "draft" &&
      draftDetail.body.run.depreciation_scope_mode === "FY_END" &&
      draftDetail.body.run.is_final_for_fy;

    await loginAdminUi(page);
    await page.goto(
      `/admin/dashboard/asset-register/depreciation/${fyEndRunId}`
    );
    const shot2a = await screenshotStep(page, "scenario-2-fy-end-draft-review");

    const postRes = await apiJson<{ run: DepreciationRunRow; error?: string }>(
      request,
      auth,
      "POST",
      `/api/admin/depreciation-runs/${fyEndRunId}/post`
    );
    expect(postRes.status, postRes.text).toBe(200);

    const postedLine = await fetchAssetRunDetail(
      request,
      auth,
      fyEndRunId,
      fixture.assetId
    );
    expect(postedLine).toBeTruthy();
    fy2082ClosingBalance = num(postedLine!.balance_amount);

    await page.reload();
    const shot2b = await screenshotStep(page, "scenario-2-fy-end-posted");

    recordStep({
      scenario: "Scenario 2",
      step: "Create FY_END draft for FY 2082",
      expected: "FY_END run in draft/review state; admin can open detail screen",
      actual: `status=${draftDetail.body.run.status}, scope=${draftDetail.body.run.depreciation_scope_mode}`,
      passed: isDraft,
      screenshot: shot2a,
    });

    recordStep({
      scenario: "Scenario 2",
      step: "Post FY_END depreciation",
      expected: "Posted status after admin post action",
      actual: `status=${postRes.body.run.status}, closingBalance=${fy2082ClosingBalance}`,
      passed: postRes.body.run.status === "posted",
      screenshot: shot2b,
    });

    expect(isDraft).toBeTruthy();
    expect(postRes.body.run.status).toBe("posted");
  });

  test("Scenario 3: FY 2083 creation uses FY 2082 closing carry-forward", async ({
    request,
    page,
  }) => {
    const calcBs = fiscalQuarterEndBs(2083, 2);
    const createRes = await apiJson<CreateRunResponse>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: calcBs,
        nepaliMonth: nepaliMonthNameForBsDate(calcBs),
        depTitle: "E2E FY 2083 run",
      }
    );
    expect(createRes.status, createRes.text).toBe(201);

    const line = await fetchAssetRunDetail(
      request,
      auth,
      createRes.body.run.id,
      fixture.assetId
    );
    expect(line).toBeTruthy();

    const openingFromClosing =
      Math.abs(num(line!.book_value) - fy2082ClosingBalance) < 0.05;
    const notImportedOpening =
      Math.abs(num(line!.book_value) - fixture.importedWdv) > 1;
    const priorAccumFromClosing =
      Math.abs(
        num(line!.accumulate_dep) -
          (fixture.grossCost - fy2082ClosingBalance)
      ) < 0.05;

    await loginAdminUi(page);
    await page.goto(
      `/admin/dashboard/asset-register/depreciation/${createRes.body.run.id}`
    );
    const shot3 = await screenshotStep(page, "scenario-3-fy-2083-carry-forward");

    recordStep({
      scenario: "Scenario 3",
      step: "Create FY 2083 depreciation after posted FY 2082 final",
      expected:
        "Run succeeds; opening WDV from FY 2082 closing; not imported register WDV",
      actual: JSON.stringify({
        openingWdv: num(line!.book_value),
        fy2082Closing: fy2082ClosingBalance,
        importedWdv: fixture.importedWdv,
        priorAccum: num(line!.accumulate_dep),
      }),
      passed: openingFromClosing && notImportedOpening && priorAccumFromClosing,
      screenshot: shot3,
    });

    matrixRows[1]!.observedRequiresPriorFyFinal = true;
    matrixRows[1]!.observedOpeningBalanceSource = openingFromClosing
      ? "FY 2082 closing values"
      : `book_value=${line!.book_value}`;
    matrixRows[1]!.consistent =
      matrixRows[1]!.observedRequiresPriorFyFinal ===
        matrixRows[1]!.requiresPriorFyFinal &&
      matrixRows[1]!.observedOpeningBalanceSource ===
        matrixRows[1]!.openingBalanceSource;

    expect(openingFromClosing).toBeTruthy();
    expect(notImportedOpening).toBeTruthy();
    expect(priorAccumFromClosing).toBeTruthy();
  });

  test("Scenario 4: Fiscal year rollover 2082 → 2083", async ({
    request,
    page,
  }) => {
    const rollover1 = await apiJson<RolloverResult>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-fy-rollover",
      { newFiscalYearStart: 2083 }
    );
    expect(rollover1.status, rollover1.text).toBe(200);
    expect(rollover1.body.status).toBe("applied");

    const assetRes = await apiJson<{
      assets: Array<{ id: number; book_value: string }>;
    }>(request, auth, "GET", `/api/admin/assets?q=${encodeURIComponent(fixture.assetCode)}`);
    const assetRow = assetRes.body.assets?.find((a) => a.id === fixture.assetId);
    assetBookValueAfterRollover = assetRow
      ? num(assetRow.book_value)
      : null;

    const rollover2 = await apiJson<RolloverResult>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-fy-rollover",
      { newFiscalYearStart: 2083 }
    );
    expect(rollover2.status).toBe(200);
    expect(rollover2.body.status).toBe("already_applied");

    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation");
    const shot4 = await screenshotStep(page, "scenario-4-rollover-complete");

    const bookValueMatchesClosing =
      assetBookValueAfterRollover !== null &&
      Math.abs(assetBookValueAfterRollover - fy2082ClosingBalance) < 0.05;

    recordStep({
      scenario: "Scenario 4",
      step: "Execute FY rollover to 2083",
      expected:
        "Book values copied from FY 2082 final; rollover marker created; second run returns already_applied",
      actual: JSON.stringify({
        firstStatus: rollover1.body.status,
        secondStatus: rollover2.body.status,
        assetBookValue: assetBookValueAfterRollover,
        fy2082Closing: fy2082ClosingBalance,
      }),
      passed:
        rollover1.body.status === "applied" &&
        rollover2.body.status === "already_applied" &&
        bookValueMatchesClosing,
      screenshot: shot4,
    });

    expect(bookValueMatchesClosing).toBeTruthy();
  });

  test("Scenario 5: Future fiscal year (simulated FY 2083 server date)", async ({
    request,
    page,
  }) => {
    const asOfBs = "2083/10/15";
    const statusRes = await apiJson<RolloverStatus>(
      request,
      auth,
      "GET",
      `/api/admin/depreciation-fy-rollover/status?asOfDateBs=${encodeURIComponent(asOfBs)}`
    );
    expect(statusRes.status).toBe(200);

    const fy2083Calc = fiscalQuarterEndBs(2083, 3);
    const allow2083 = await apiJson<CreateRunResponse>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: fy2083Calc,
        nepaliMonth: nepaliMonthNameForBsDate(fy2083Calc),
        depTitle: "E2E FY 2083 Q3 refresh",
      }
    );

    const block2084 = await apiJson<{ error?: string }>(
      request,
      auth,
      "POST",
      "/api/admin/depreciation-runs",
      {
        calculationDateBs: fiscalQuarterEndBs(2084, 1),
        nepaliMonth: nepaliMonthNameForBsDate(fiscalQuarterEndBs(2084, 1)),
      }
    );

    await loginAdminUi(page);
    await page.goto("/admin/dashboard/asset-register/depreciation");
    const shot5 = await screenshotStep(page, "scenario-5-future-fy-status");

    const currentFyOk =
      statusRes.body.currentFiscalYearStart === 2083 &&
      fiscalYearStartFromBsDate(asOfBs) === 2083;
    const rolloverCompleted = statusRes.body.status === "completed";
    const fy2083Allowed = allow2083.status === 201;
    const fy2084Blocked = block2084.status === 400;

    recordStep({
      scenario: "Scenario 5",
      step: "Simulated server date in FY 2083",
      expected:
        "Current FY=2083; rollover completed; FY 2083 runs allowed; FY 2084 blocked until FY 2083 final posted",
      actual: JSON.stringify({
        asOfBs,
        currentFy: statusRes.body.currentFiscalYearStart,
        rolloverStatus: statusRes.body.status,
        allow2083Status: allow2083.status,
        block2084Error: block2084.body.error ?? block2084.text,
      }),
      passed:
        currentFyOk && rolloverCompleted && fy2083Allowed && fy2084Blocked,
      screenshot: shot5,
    });

    matrixRows[2]!.observedRequiresPriorFyFinal = fy2084Blocked;
    matrixRows[2]!.observedOpeningBalanceSource = "FY 2083 closing values (not tested — FY 2083 final not posted)";
    matrixRows[2]!.consistent =
      matrixRows[2]!.observedRequiresPriorFyFinal ===
      matrixRows[2]!.requiresPriorFyFinal;

    expect(currentFyOk).toBeTruthy();
    expect(rolloverCompleted).toBeTruthy();
    expect(fy2083Allowed).toBeTruthy();
    expect(fy2084Blocked).toBeTruthy();
  });

  test("Scenario 6: Migration safety — no depreciation from 2071 purchase date", async ({
    request,
    page,
  }) => {
    const line = await fetchAssetRunDetail(
      request,
      auth,
      openingRunId,
      fixture.assetId
    );
    expect(line).toBeTruthy();

    const periodEnd = expectedOpeningFyRunDetail(fixture).calculationDateBs;
    const recalcFromPurchase = computeAssetQuarterCumulative({
      purchaseAmount: fixture.grossCost,
      depreciationStartBs: fixture.purchaseDateBs,
      depRatePercent: fixture.depRatePercent,
      method: "STRAIGHT_LINE",
      fiscalYearStart: fixture.openingFiscalYear,
      quarter: 2,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: periodEnd,
    });
    const recalcAccum =
      recalcFromPurchase.ok ? recalcFromPurchase.detail.accumulateDep : 0;

    const usesRegisterStart =
      line!.dep_start_date_bs === fixture.depreciationStartDateBs &&
      recalcFromPurchase.ok &&
      num(line!.accumulate_dep) < recalcAccum - 1000;
    const priorFromImport =
      Math.abs(num(line!.accumulate_dep) - fixture.impliedPriorAccum) < 0.01;
    const depStartNotPurchase =
      line!.dep_start_date_bs !== fixture.purchaseDateBs &&
      line!.dep_start_date_bs === fixture.depreciationStartDateBs;
    const depAmount = num(line!.dep_amount);
    const balanceConsistent =
      Math.abs(num(line!.balance_amount) - (num(line!.book_value) - depAmount)) <
      0.05;

    await loginAdminUi(page);
    await page.goto(
      `/admin/dashboard/asset-register/depreciation/${openingRunId}`
    );
    const shot6 = await screenshotStep(page, "scenario-6-migration-safety");

    recordStep({
      scenario: "Scenario 6",
      step: "Migration safety for historical asset",
      expected:
        "DepDays not from 2071; prior accum = imported implied only; dep start = register dep start; no double-counting",
      actual: JSON.stringify({
        purchaseDateBs: line!.purchase_date_bs,
        depStart: line!.dep_start_date_bs,
        registerDepStart: line!.register_depreciation_start_bs,
        depDays: line!.dep_days,
        recalcAccumFrom2071Purchase: recalcAccum,
        priorAccum: num(line!.accumulate_dep),
        impliedPriorAccum: fixture.impliedPriorAccum,
        grossCost: fixture.grossCost,
        costBasis: line!.depreciation_cost_basis,
      }),
      passed:
        usesRegisterStart &&
        priorFromImport &&
        depStartNotPurchase &&
        balanceConsistent,
      screenshot: shot6,
    });

    expect(usesRegisterStart).toBeTruthy();
    expect(priorFromImport).toBeTruthy();
    expect(depStartNotPurchase).toBeTruthy();
    expect(balanceConsistent).toBeTruthy();
  });
});
