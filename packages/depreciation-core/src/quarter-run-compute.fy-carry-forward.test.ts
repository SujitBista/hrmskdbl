import { describe, expect, it } from "vitest";
import { computeAssetQuarterCumulative } from "./quarter-run-compute";

describe("computeAssetQuarterCumulative FY carry-forward", () => {
  it("uses opening WDV × rate × depDays / 365 for straight line when prior accum is pinned", () => {
    const r = computeAssetQuarterCumulative({
      purchaseAmount: 100_000,
      depreciationStartBs: "2079/01/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 4,
      depreciationScopeMode: "FY_END",
      carryForwardPriorAccumulatedDep: 30_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.accumulateDep).toBe(30_000);
    expect(r.detail.bookValue).toBe(70_000);
    expect(r.detail.depDays).toBeGreaterThan(300);
    const expected = (70_000 * 0.1 * r.detail.depDays) / 365;
    expect(Math.abs(r.detail.depAmount - expected)).toBeLessThan(0.02);
    expect(r.detail.balanceAmount).toBeCloseTo(
      70_000 - r.detail.depAmount,
      1
    );
  });

  it("keeps depDays from max(depreciation start, FY Shrawan 1) when carry-forward is set", () => {
    const r = computeAssetQuarterCumulative({
      purchaseAmount: 50_000,
      depreciationStartBs: "2082/06/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 4,
      depreciationScopeMode: "FY_END",
      carryForwardPriorAccumulatedDep: 5_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.depDays).toBeGreaterThan(0);
    expect(r.detail.depAmount).toBeGreaterThan(0);
  });
});
