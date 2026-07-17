import { describe, expect, it } from "vitest";
import {
  compareBsDateString,
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
  fiscalYearEndBs,
  fiscalYearStartBs,
  inclusiveCalendarDaysBetweenBs,
  resolveEffectiveDepreciationFromBs,
} from "./index.js";

/**
 * Documented mid-year migration example (FY 2083/2084):
 * Opening FY 2083, first system date Ashwin 1 2083 (= 2083/06/01),
 * gross 100_000, imported WDV 78_500, rate 10%, declining balance.
 */
const OPENING_FY = 2083;
const FY_START = fiscalYearStartBs(OPENING_FY); // 2083/04/01 Shrawan 1
const ASHWIN_1 = "2083/06/01";
const GROSS = 100_000;
const IMPORTED_WDV = 78_500;
const IMPLIED_PRIOR = GROSS - IMPORTED_WDV; // 21_500
const RATE = 10;

describe("mid-year / FY-boundary depreciation migration (core)", () => {
  describe("Test A: fiscal-year-start migration", () => {
    it("calculates from Shrawan 1 with imported WDV preserved as opening", () => {
      const firstSystem = FY_START;
      const periodEnd = fiscalYearEndBs(OPENING_FY);
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 4,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: firstSystem,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.detail.effectiveCalcStartBs).toBe(FY_START);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
      expect(r.detail.accumulateDep).toBe(IMPLIED_PRIOR);
      const expectedDays = inclusiveCalendarDaysBetweenBs(FY_START, periodEnd);
      expect(r.detail.depDays).toBe(expectedDays);
      const expectedDep =
        (IMPORTED_WDV * (RATE / 100) * expectedDays) / 365;
      expect(Math.abs(r.detail.depAmount - expectedDep)).toBeLessThan(0.02);
      expect(r.detail.balanceAmount).toBeCloseTo(
        IMPORTED_WDV - r.detail.depAmount,
        1
      );
    });
  });

  describe("Test B: mid-year migration", () => {
    it("declining balance: starts Ashwin 1, does not recalculate Shrawan/Bhadra", () => {
      const q2End = fiscalQuarterEndBs(OPENING_FY, 2);
      const fullFromFyStart = inclusiveCalendarDaysBetweenBs(FY_START, q2End);
      const fromMigration = inclusiveCalendarDaysBetweenBs(ASHWIN_1, q2End);

      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 2,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: ASHWIN_1,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.detail.effectiveCalcStartBs).toBe(ASHWIN_1);
      expect(r.detail.depDays).toBe(fromMigration);
      expect(r.detail.depDays).toBeLessThan(fullFromFyStart);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
      expect(r.detail.accumulateDep).toBe(IMPLIED_PRIOR);

      const expectedDep =
        (IMPORTED_WDV * (RATE / 100) * fromMigration) / 365;
      expect(Math.abs(r.detail.depAmount - expectedDep)).toBeLessThan(0.02);
      expect(r.detail.balanceAmount).toBeCloseTo(
        IMPORTED_WDV - r.detail.depAmount,
        1
      );
    });

    it("straight-line: excludes pre-migration days from eligible day count", () => {
      const fyEnd = fiscalYearEndBs(OPENING_FY);
      const fromMigration = inclusiveCalendarDaysBetweenBs(ASHWIN_1, fyEnd);
      const fromFyStart = inclusiveCalendarDaysBetweenBs(FY_START, fyEnd);

      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "STRAIGHT_LINE",
        fiscalYearStart: OPENING_FY,
        quarter: 4,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: ASHWIN_1,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.detail.effectiveCalcStartBs).toBe(ASHWIN_1);
      expect(r.detail.depDays).toBe(fromMigration);
      expect(r.detail.depDays).toBeLessThan(fromFyStart);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);

      // SL daily base is gross cost (non-carry-forward path).
      const expectedDep = (GROSS * (RATE / 100) * fromMigration) / 365;
      expect(Math.abs(r.detail.depAmount - expectedDep)).toBeLessThan(0.02);
      expect(r.detail.balanceAmount).toBeCloseTo(
        IMPORTED_WDV - r.detail.depAmount,
        1
      );
    });
  });

  describe("Test D: run containing the migration date", () => {
    it("Q1 ending after Ashwin 1 calculates only from Ashwin 1", () => {
      const q1End = fiscalQuarterEndBs(OPENING_FY, 1);
      expect(compareBsDateString(q1End, ASHWIN_1)).toBeGreaterThan(0);

      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 1,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: ASHWIN_1,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.effectiveCalcStartBs).toBe(ASHWIN_1);
      expect(r.detail.depDays).toBe(
        inclusiveCalendarDaysBetweenBs(ASHWIN_1, q1End)
      );
    });
  });

  describe("Test E: FY_END opening year", () => {
    it("includes only first-system date through FY end", () => {
      const fyEnd = fiscalYearEndBs(OPENING_FY);
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 4,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: ASHWIN_1,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.effectiveCalcStartBs).toBe(ASHWIN_1);
      expect(r.detail.depDays).toBe(
        inclusiveCalendarDaysBetweenBs(ASHWIN_1, fyEnd)
      );
      expect(r.detail.balanceAmount).toBeCloseTo(
        IMPORTED_WDV - r.detail.depAmount,
        1
      );
    });
  });

  describe("Test F: next FY ignores migration date", () => {
    it("does not apply first-system date when omitted (post-opening FY)", () => {
      const nextFy = OPENING_FY + 1;
      const nextFyStart = fiscalYearStartBs(nextFy);
      const priorAccum = IMPLIED_PRIOR + 5_000;
      const openingWdv = GROSS - priorAccum;

      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: nextFy,
        quarter: 1,
        depreciationScopeMode: "FY_END",
        carryForwardPriorAccumulatedDep: priorAccum,
        // Intentionally omit firstSystem — caller must not pass it after opening FY.
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.effectiveCalcStartBs).toBe(nextFyStart);
      expect(r.detail.bookValue).toBe(openingWdv);
      expect(r.detail.depDays).toBe(
        inclusiveCalendarDaysBetweenBs(
          nextFyStart,
          fiscalQuarterEndBs(nextFy, 1)
        )
      );
    });
  });

  describe("resolveEffectiveDepreciationFromBs", () => {
    it("takes max of commencement, FY start, and first-system date", () => {
      expect(
        resolveEffectiveDepreciationFromBs({
          depreciationStartBs: "2075/01/01",
          fiscalYearStart: OPENING_FY,
          firstSystemDepreciationDateBs: ASHWIN_1,
        })
      ).toBe(ASHWIN_1);

      expect(
        resolveEffectiveDepreciationFromBs({
          depreciationStartBs: "2083/07/15",
          fiscalYearStart: OPENING_FY,
          firstSystemDepreciationDateBs: ASHWIN_1,
        })
      ).toBe("2083/07/15");

      expect(
        resolveEffectiveDepreciationFromBs({
          depreciationStartBs: "2075/01/01",
          fiscalYearStart: OPENING_FY,
        })
      ).toBe(FY_START);
    });
  });
});
