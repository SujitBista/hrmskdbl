import { describe, expect, it } from "vitest";
import {
  compareBsDateString,
  computeAssetQuarterCumulative,
  dayAfterBsDate,
  dayBeforeBsDate,
  fiscalYearStartBs,
  inclusiveCalendarDaysBetweenBs,
} from "@hrmskdbl/depreciation-core";
import {
  assertDepreciationPeriodEligibleForSystemMigration,
  DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE,
  depreciationPriorFyStrictCarryForwardFloor,
  firstSystemDateForFiscalYear,
  validateDepreciationMigrationDates,
  type DepreciationMigrationSettings,
} from "./depreciationSettings.js";
import {
  priorFiscalYearRequiresStrictCarryForward,
  validateOpeningYearImportedBookValue,
} from "./depreciationRuns.js";
import { resolveFyRolloverStatus } from "./depreciationFyRollover.js";
import {
  OPENING_BALANCE_DATE_MISMATCH_MESSAGE,
  validateMigratedDepreciableImportRow,
} from "./assets.js";

/**
 * Isolated fixtures for go-live:
 * opening FY 2083, last external 2083/04/14, first system 2083/04/15.
 * Does not touch database rows.
 */
describe("Shrawan 14/15 migration cutover (settings → gate → compute → rollover)", () => {
  const OPENING_FY = 2083;
  const LAST_EXTERNAL = "2083/04/14";
  const FIRST_SYSTEM = "2083/04/15";
  const DAY_AFTER = "2083/04/16";
  const LATER = "2083/05/01";
  const GROSS = 100_000;
  const IMPORTED_WDV = 78_500;
  const RATE = 10;

  const validated = validateDepreciationMigrationDates({
    openingFiscalYear: OPENING_FY,
    firstSystemDepreciationDateBs: FIRST_SYSTEM,
    lastExternalDepreciationDateBs: LAST_EXTERNAL,
  });
  const migration: DepreciationMigrationSettings = {
    ...validated,
    source: "database",
  };

  it("1–2: settings are consecutive valid BS dates with no gap", () => {
    expect(validated).toEqual({
      openingFiscalYear: OPENING_FY,
      firstSystemDepreciationDateBs: FIRST_SYSTEM,
      lastExternalDepreciationDateBs: LAST_EXTERNAL,
    });
    expect(dayAfterBsDate(LAST_EXTERNAL)).toBe(FIRST_SYSTEM);
    expect(dayBeforeBsDate(FIRST_SYSTEM)).toBe(LAST_EXTERNAL);
    expect(compareBsDateString(LAST_EXTERNAL, FIRST_SYSTEM)).toBeLessThan(0);
  });

  it("3: date before boundary is rejected for run creation", () => {
    expect(() =>
      assertDepreciationPeriodEligibleForSystemMigration({
        periodEndBs: LAST_EXTERNAL,
        fiscalYearStart: OPENING_FY,
        migration,
      })
    ).toThrow(DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE);
  });

  it("4–5: boundary and day-after are accepted; DepDays are 1 then 2", () => {
    assertDepreciationPeriodEligibleForSystemMigration({
      periodEndBs: FIRST_SYSTEM,
      fiscalYearStart: OPENING_FY,
      migration,
    });
    assertDepreciationPeriodEligibleForSystemMigration({
      periodEndBs: DAY_AFTER,
      fiscalYearStart: OPENING_FY,
      migration,
    });

    const firstSystem = firstSystemDateForFiscalYear(migration, OPENING_FY);
    expect(firstSystem).toBe(FIRST_SYSTEM);

    const onBoundary = computeAssetQuarterCumulative({
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE",
      fiscalYearStart: OPENING_FY,
      quarter: 1,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: FIRST_SYSTEM,
      registerPriorAccumulatedDep: GROSS - IMPORTED_WDV,
      firstSystemDepreciationDateBs: firstSystem,
    });
    expect(onBoundary.ok).toBe(true);
    if (!onBoundary.ok) return;
    expect(onBoundary.detail.depDays).toBe(1);
    expect(onBoundary.detail.bookValue).toBe(IMPORTED_WDV);
    expect(onBoundary.detail.effectiveCalcStartBs).toBe(FIRST_SYSTEM);

    const dayAfter = computeAssetQuarterCumulative({
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE",
      fiscalYearStart: OPENING_FY,
      quarter: 1,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: DAY_AFTER,
      registerPriorAccumulatedDep: GROSS - IMPORTED_WDV,
      firstSystemDepreciationDateBs: firstSystem,
    });
    expect(dayAfter.ok).toBe(true);
    if (!dayAfter.ok) return;
    expect(dayAfter.detail.depDays).toBe(2);
    expect(dayAfter.detail.depDays).toBe(
      inclusiveCalendarDaysBetweenBs(FIRST_SYSTEM, DAY_AFTER)
    );
  });

  it("6–8: imported WDV is authoritative; no overlap and no gap at boundary", () => {
    const wdv = validateOpeningYearImportedBookValue(GROSS, String(IMPORTED_WDV));
    expect(wdv.ok).toBe(true);
    if (!wdv.ok) return;
    expect(wdv.importedWdv).toBe(IMPORTED_WDV);
    expect(wdv.priorAccumulatedDep).toBe(GROSS - IMPORTED_WDV);

    expect(() =>
      validateMigratedDepreciableImportRow({
        grossCost: GROSS,
        bookValue: IMPORTED_WDV,
        openingBalanceAsOfDateBs: "2083/04/13",
        expectedOpeningBalanceDateBs: LAST_EXTERNAL,
      })
    ).toThrow(OPENING_BALANCE_DATE_MISMATCH_MESSAGE);

    expect(() =>
      validateMigratedDepreciableImportRow({
        grossCost: GROSS,
        bookValue: IMPORTED_WDV,
        openingBalanceAsOfDateBs: LAST_EXTERNAL,
        expectedOpeningBalanceDateBs: LAST_EXTERNAL,
      })
    ).not.toThrow();

    const later = computeAssetQuarterCumulative({
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE",
      fiscalYearStart: OPENING_FY,
      quarter: 1,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: LATER,
      registerPriorAccumulatedDep: wdv.priorAccumulatedDep,
      firstSystemDepreciationDateBs: FIRST_SYSTEM,
    });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.detail.effectiveCalcStartBs).toBe(FIRST_SYSTEM);
    expect(later.detail.depDays).toBe(
      inclusiveCalendarDaysBetweenBs(FIRST_SYSTEM, LATER)
    );
    // Gap check: system starts the calendar day after last external.
    expect(dayAfterBsDate(LAST_EXTERNAL)).toBe(FIRST_SYSTEM);
    // Overlap check: effective start is strictly after last external.
    expect(
      compareBsDateString(later.detail.effectiveCalcStartBs, LAST_EXTERNAL)
    ).toBeGreaterThan(0);
    expect(later.detail.bookValue).toBe(IMPORTED_WDV);
    expect(later.detail.balanceAmount).toBeCloseTo(
      IMPORTED_WDV - later.detail.depAmount,
      1
    );
  });

  it("9–10: opening FY rollover not required; later FY still needs posted FY_END", () => {
    const floor = depreciationPriorFyStrictCarryForwardFloor(OPENING_FY);
    expect(floor).toBe(OPENING_FY);
    expect(priorFiscalYearRequiresStrictCarryForward(OPENING_FY, OPENING_FY)).toBe(
      false
    );
    expect(
      priorFiscalYearRequiresStrictCarryForward(OPENING_FY + 1, OPENING_FY)
    ).toBe(true);

    const opening = resolveFyRolloverStatus({
      currentBsDate: FIRST_SYSTEM,
      currentFiscalYearStart: OPENING_FY,
      priorFiscalYearStart: OPENING_FY - 1,
      rolloverApplied: false,
      priorFyFinalRun: null,
      priorFyStrictCarryForwardFloor: floor,
    });
    expect(opening).toMatchObject({
      status: "not_required",
      priorFyFinalRunStatus: "not_applicable",
      rolloverAllowed: false,
    });

    const nextFy = resolveFyRolloverStatus({
      currentBsDate: fiscalYearStartBs(OPENING_FY + 1),
      currentFiscalYearStart: OPENING_FY + 1,
      priorFiscalYearStart: OPENING_FY,
      rolloverApplied: false,
      priorFyFinalRun: null,
      priorFyStrictCarryForwardFloor: floor,
    });
    expect(nextFy.status).toBe("blocked");
    expect(nextFy.blockers).toContain("PRIOR_FY_FINAL_DEPRECIATION_REQUIRED");

    // Mid-year system start must not invent a prior-FY rollover demand.
    expect(opening.status).not.toBe("blocked");
    expect(opening.status).not.toBe("pending");
  });

  it("11–12: identical inputs reload to identical calculated values", () => {
    const params = {
      purchaseAmount: GROSS,
      depreciationStartBs: "2075/01/01",
      depRatePercent: RATE,
      method: "DECLINING_BALANCE" as const,
      fiscalYearStart: OPENING_FY,
      quarter: 1,
      depreciationScopeMode: "AS_OF_DATE" as const,
      asOfDateBs: FIRST_SYSTEM,
      registerPriorAccumulatedDep: GROSS - IMPORTED_WDV,
      firstSystemDepreciationDateBs: FIRST_SYSTEM,
    };
    const a = computeAssetQuarterCumulative(params);
    const b = computeAssetQuarterCumulative(params);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.detail).toEqual(a.detail);
  });
});
