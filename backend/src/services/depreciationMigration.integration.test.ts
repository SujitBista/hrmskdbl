import { describe, expect, it } from "vitest";
import {
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
  fiscalYearEndBs,
  fiscalYearStartBs,
  inclusiveCalendarDaysBetweenBs,
} from "@hrmskdbl/depreciation-core";
import {
  assertDepreciationPeriodEligibleForSystemMigration,
  DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE,
  firstSystemDateForFiscalYear,
  validateDepreciationMigrationDates,
  type DepreciationMigrationSettings,
} from "./depreciationSettings.js";
import {
  priorFiscalYearRequiresStrictCarryForward,
  selectedDepreciationPeriodEndBs,
} from "./depreciationRuns.js";

/**
 * Integration-style flow without a live DB: settings validation → period gate →
 * opening-year compute → posted closing → next-FY carry-forward rules.
 */
describe("depreciation mid-year migration integration flow", () => {
  const migration = validateDepreciationMigrationDates({
    openingFiscalYear: 2083,
    firstSystemDepreciationDateBs: "2083/06/01",
  });
  const settings: DepreciationMigrationSettings = {
    ...migration,
    source: "database",
  };

  const gross = 100_000;
  const importedWdv = 78_500;
  const impliedPrior = gross - importedWdv;
  const rate = 10;

  it("1–5: rejects pre-migration AS_OF, accepts Q2 from Ashwin 1 with imported WDV", () => {
    const q1EndBeforeMigrationWouldBe = "2083/05/31";
    expect(() =>
      assertDepreciationPeriodEligibleForSystemMigration({
        periodEndBs: q1EndBeforeMigrationWouldBe,
        fiscalYearStart: 2083,
        migration: settings,
      })
    ).toThrow(DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE);

    const q2End = selectedDepreciationPeriodEndBs({
      fiscalYearStart: 2083,
      quarterNo: 2,
      calculationDateBs: fiscalQuarterEndBs(2083, 2),
      depreciationScopeMode: "AS_OF_DATE",
    });
    assertDepreciationPeriodEligibleForSystemMigration({
      periodEndBs: q2End,
      fiscalYearStart: 2083,
      migration: settings,
    });

    const firstSystem = firstSystemDateForFiscalYear(settings, 2083);
    expect(firstSystem).toBe("2083/06/01");

    const computed = computeAssetQuarterCumulative({
      purchaseAmount: gross,
      depreciationStartBs: "2075/01/15",
      depRatePercent: rate,
      method: "DECLINING_BALANCE",
      fiscalYearStart: 2083,
      quarter: 2,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: q2End,
      registerPriorAccumulatedDep: impliedPrior,
      firstSystemDepreciationDateBs: firstSystem,
    });
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;

    expect(computed.detail.effectiveCalcStartBs).toBe("2083/06/01");
    expect(computed.detail.bookValue).toBe(importedWdv);
    expect(computed.detail.depDays).toBe(
      inclusiveCalendarDaysBetweenBs("2083/06/01", q2End)
    );
    expect(computed.detail.depDays).toBeLessThan(
      inclusiveCalendarDaysBetweenBs(fiscalYearStartBs(2083), q2End)
    );
  });

  it("6–9: FY_END system-owned portion then next FY requires prior final and ignores migration", () => {
    const firstSystem = firstSystemDateForFiscalYear(settings, 2083);
    const fyEnd = fiscalYearEndBs(2083);
    const openingFinal = computeAssetQuarterCumulative({
      purchaseAmount: gross,
      depreciationStartBs: "2075/01/15",
      depRatePercent: rate,
      method: "DECLINING_BALANCE",
      fiscalYearStart: 2083,
      quarter: 4,
      depreciationScopeMode: "FY_END",
      registerPriorAccumulatedDep: impliedPrior,
      firstSystemDepreciationDateBs: firstSystem,
    });
    expect(openingFinal.ok).toBe(true);
    if (!openingFinal.ok) return;

    expect(openingFinal.detail.depDays).toBe(
      inclusiveCalendarDaysBetweenBs("2083/06/01", fyEnd)
    );
    const closingWdv = openingFinal.detail.balanceAmount;
    const priorAccumForNext =
      openingFinal.detail.accumulateDep + openingFinal.detail.depAmount;

    expect(priorFiscalYearRequiresStrictCarryForward(2084, 2083)).toBe(true);
    expect(firstSystemDateForFiscalYear(settings, 2084)).toBeNull();

    const nextFy = computeAssetQuarterCumulative({
      purchaseAmount: gross,
      depreciationStartBs: "2075/01/15",
      depRatePercent: rate,
      method: "DECLINING_BALANCE",
      fiscalYearStart: 2084,
      quarter: 1,
      depreciationScopeMode: "FY_END",
      carryForwardPriorAccumulatedDep: priorAccumForNext,
    });
    expect(nextFy.ok).toBe(true);
    if (!nextFy.ok) return;
    expect(nextFy.detail.effectiveCalcStartBs).toBe(fiscalYearStartBs(2084));
    expect(nextFy.detail.bookValue).toBeCloseTo(closingWdv, 1);
  });
});
