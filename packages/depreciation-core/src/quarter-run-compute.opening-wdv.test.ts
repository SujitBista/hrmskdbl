import { describe, expect, it } from "vitest";
import {
  buildDepreciationTimelineToPeriodEnd,
  computeAssetQuarterCumulative,
  fiscalYearEndBs,
  fiscalYearStartBs,
} from "./index.js";

const OPENING_FY = 2083;
const GROSS = 100_000;
const RATE = 10;
const FY_START = fiscalYearStartBs(OPENING_FY);

describe("opening-year imported WDV authority (core)", () => {
  it("A: WDV equals cost — opening accumulated depreciation is 0 and schedule is not used", () => {
    const scheduleOnly = buildDepreciationTimelineToPeriodEnd({
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE",
      fiscalYearStart: OPENING_FY,
      selectedPeriodEndBs: fiscalYearEndBs(OPENING_FY),
    });
    expect(scheduleOnly.ok).toBe(true);
    if (!scheduleOnly.ok) return;
    expect(scheduleOnly.timeline.priorYearsDepAmount).toBeGreaterThan(0);

    const r = computeAssetQuarterCumulative({
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE",
      fiscalYearStart: OPENING_FY,
      quarter: 4,
      depreciationScopeMode: "FY_END",
      registerPriorAccumulatedDep: 0,
      firstSystemDepreciationDateBs: FY_START,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.bookValue).toBe(GROSS);
    expect(r.detail.accumulateDep).toBe(0);
    expect(r.detail.accumulateDep).not.toBe(
      scheduleOnly.timeline.priorYearsDepAmount
    );
  });
});
