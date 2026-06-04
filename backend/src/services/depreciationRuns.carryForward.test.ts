import { afterEach, describe, expect, it, vi } from "vitest";
import { computeAssetQuarterCumulative } from "@hrmskdbl/depreciation-core";
import {
  assertEligibleAssetsHavePriorFyCarryForward,
  assertPriorFyCarryForwardForDepreciationRun,
  assetRequiresPriorFyCarryForward,
  missingPriorFyFinalDepreciationErrorMessage,
  priorFiscalYearRequiresStrictCarryForward,
  resolveDepreciationRunCarryForwardContext,
  type PriorFyCarryForward,
  type DepreciationScheduleAssetRow,
} from "./depreciationRuns.js";

function sampleAsset(
  overrides: Partial<DepreciationScheduleAssetRow> = {}
): DepreciationScheduleAssetRow {
  return {
    id: 1,
    asset_code: "SK-1",
    asset_name: "Laptop",
    group_name: "IT",
    group_dep_method: "Straight Line",
    group_dep_rate: "10",
    asset_dep_method: null,
    asset_dep_rate: null,
    sub_group_name: null,
    branch_name: "Main",
    purchase_date_bs: "2080/04/01",
    depreciation_start_date_bs: "2080/04/01",
    purchase_qty: "1",
    unit_rate: "100000",
    book_value: "50000",
    old_book_value: null,
    asset_status: "ACTIVE",
    disposal_date_bs: null,
    ...overrides,
  };
}

function priorCarryForward(
  overrides: Partial<PriorFyCarryForward> & {
    lines?: Array<{
      assetId: number;
      priorAccumulatedDep: number;
      openingWrittenDownValue: number;
    }>;
  } = {}
): PriorFyCarryForward {
  const byAssetId = new Map<
    number,
    { priorAccumulatedDep: number; openingWrittenDownValue: number }
  >();
  for (const line of overrides.lines ?? [
    {
      assetId: 1,
      priorAccumulatedDep: 30_000,
      openingWrittenDownValue: 70_000,
    },
  ]) {
    byAssetId.set(line.assetId, {
      priorAccumulatedDep: line.priorAccumulatedDep,
      openingWrittenDownValue: line.openingWrittenDownValue,
    });
  }
  return {
    priorFiscalYearStart: overrides.priorFiscalYearStart ?? 2083,
    runId: overrides.runId ?? 99,
    byAssetId,
  };
}

describe("prior fiscal year strict carry-forward", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires strict carry-forward for FY 2084 when prior FY is 2083", () => {
    expect(priorFiscalYearRequiresStrictCarryForward(2084)).toBe(true);
    expect(missingPriorFyFinalDepreciationErrorMessage(2083, 2084)).toBe(
      "Previous fiscal year final depreciation run is not posted. Please post Q4/FY_END depreciation for FY 2083 before creating depreciation for FY 2084."
    );
  });

  it("blocks new FY run when prior posted final run is missing", () => {
    expect(() =>
      assertPriorFyCarryForwardForDepreciationRun(2084, null)
    ).toThrow(
      missingPriorFyFinalDepreciationErrorMessage(2083, 2084)
    );
    expect(() =>
      resolveDepreciationRunCarryForwardContext(2084, null)
    ).toThrow(/Previous fiscal year final depreciation run is not posted/i);
  });

  it("allows new FY run when prior posted final run exists", () => {
    const prior = priorCarryForward();
    expect(() =>
      assertPriorFyCarryForwardForDepreciationRun(2084, prior)
    ).not.toThrow();
    const ctx = resolveDepreciationRunCarryForwardContext(2084, prior);
    expect(ctx.mode).toBe("strict");
    if (ctx.mode === "strict") {
      expect(ctx.prior.runId).toBe(99);
    }
  });

  it("allows legacy register fallback only when env flag is set", () => {
    vi.stubEnv("DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD", "true");
    expect(() =>
      assertPriorFyCarryForwardForDepreciationRun(2084, null)
    ).not.toThrow();
    const ctx = resolveDepreciationRunCarryForwardContext(2084, null);
    expect(ctx.mode).toBe("legacy");
  });

  it("uses prior accumulate_dep + dep_amount and opening WDV from prior final run", () => {
    const gross = 100_000;
    const priorAccumulatedDep = 30_000;
    const openingWrittenDownValue = 70_000;

    const r = computeAssetQuarterCumulative({
      purchaseAmount: gross,
      depreciationStartBs: "2079/04/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2084,
      quarter: 1,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: "2084/06/15",
      carryForwardPriorAccumulatedDep: priorAccumulatedDep,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.accumulateDep).toBe(priorAccumulatedDep);
    expect(r.detail.bookValue).toBe(openingWrittenDownValue);
    expect(r.detail.depAmount).toBeGreaterThan(0);
    expect(r.detail.balanceAmount).toBeCloseTo(
      openingWrittenDownValue - r.detail.depAmount,
      1
    );
  });

  it("requires prior final line for assets depreciating before new FY Shrawan 1", () => {
    const asset = sampleAsset({
      purchase_date_bs: "2080/04/01",
      depreciation_start_date_bs: "2080/04/01",
    });
    expect(assetRequiresPriorFyCarryForward(asset, "2084/04/01")).toBe(true);
    expect(() =>
      assertEligibleAssetsHavePriorFyCarryForward({
        fiscalYearStart: 2084,
        assets: [asset],
        priorCarryForward: priorCarryForward({ lines: [] }),
      })
    ).toThrow(/missing from the posted FY 2083 final run/i);
  });

  it("does not require prior final line for assets first depreciated in the new FY", () => {
    const asset = sampleAsset({
      purchase_date_bs: "2084/05/01",
      depreciation_start_date_bs: "2084/05/01",
    });
    expect(assetRequiresPriorFyCarryForward(asset, "2084/04/01")).toBe(false);
    expect(() =>
      assertEligibleAssetsHavePriorFyCarryForward({
        fiscalYearStart: 2084,
        assets: [asset],
        priorCarryForward: priorCarryForward({ lines: [] }),
      })
    ).not.toThrow();
  });
});
