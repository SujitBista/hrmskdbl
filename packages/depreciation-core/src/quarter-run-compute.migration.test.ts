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

  /**
   * Go-live cutover: external through Shrawan 14; system owns from Shrawan 15.
   * Inclusive day count: as-of D includes day D when effective start ≤ D.
   */
  describe("Shrawan 14/15 migration cutover (2083/04/14 → 2083/04/15)", () => {
    const LAST_EXTERNAL = "2083/04/14";
    const FIRST_SYSTEM = "2083/04/15";
    const DAY_AFTER = "2083/04/16";

    it("as-of first system date includes exactly one system-owned day from imported WDV", () => {
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 1,
        depreciationScopeMode: "AS_OF_DATE",
        asOfDateBs: FIRST_SYSTEM,
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: FIRST_SYSTEM,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.detail.effectiveCalcStartBs).toBe(FIRST_SYSTEM);
      expect(r.detail.depDays).toBe(1);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
      const expectedDep = (IMPORTED_WDV * (RATE / 100) * 1) / 365;
      expect(Math.abs(r.detail.depAmount - expectedDep)).toBeLessThan(0.02);
      expect(r.detail.balanceAmount).toBeCloseTo(
        IMPORTED_WDV - r.detail.depAmount,
        1
      );
      // No overlap: days through last external are outside DepDays.
      expect(
        compareBsDateString(r.detail.effectiveCalcStartBs, LAST_EXTERNAL)
      ).toBeGreaterThan(0);
    });

    it("as-of day after first system includes two inclusive system-owned days", () => {
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 1,
        depreciationScopeMode: "AS_OF_DATE",
        asOfDateBs: DAY_AFTER,
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: FIRST_SYSTEM,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.effectiveCalcStartBs).toBe(FIRST_SYSTEM);
      expect(r.detail.depDays).toBe(
        inclusiveCalendarDaysBetweenBs(FIRST_SYSTEM, DAY_AFTER)
      );
      expect(r.detail.depDays).toBe(2);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
    });

    it("compute-only as-of last external yields zero system days (gate also rejects create)", () => {
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 1,
        depreciationScopeMode: "AS_OF_DATE",
        asOfDateBs: LAST_EXTERNAL,
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: FIRST_SYSTEM,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.effectiveCalcStartBs).toBe(FIRST_SYSTEM);
      expect(r.detail.depDays).toBe(0);
      expect(r.detail.depAmount).toBe(0);
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
      expect(r.detail.balanceAmount).toBe(IMPORTED_WDV);
    });

    it("later as-of date never includes pre-migration days in DepDays", () => {
      const later = "2083/05/01";
      const r = computeAssetQuarterCumulative({
        purchaseAmount: GROSS,
        depreciationStartBs: "2075/01/01",
        depRatePercent: RATE,
        method: "DECLINING_BALANCE",
        fiscalYearStart: OPENING_FY,
        quarter: 1,
        depreciationScopeMode: "AS_OF_DATE",
        asOfDateBs: later,
        registerPriorAccumulatedDep: IMPLIED_PRIOR,
        firstSystemDepreciationDateBs: FIRST_SYSTEM,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.detail.depDays).toBe(
        inclusiveCalendarDaysBetweenBs(FIRST_SYSTEM, later)
      );
      expect(r.detail.depDays).toBeLessThan(
        inclusiveCalendarDaysBetweenBs(FY_START, later)
      );
      expect(r.detail.bookValue).toBe(IMPORTED_WDV);
    });
  });
});
