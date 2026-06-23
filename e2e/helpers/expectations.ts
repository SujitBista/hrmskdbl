import {
  computeAssetQuarterCumulative,
  depreciationCommencementFromRegister,
  fiscalQuarterEndBs,
  fiscalYearEndBs,
  fiscalYearStartBs,
  inclusiveCalendarDaysBetweenBs,
  maxBsDateString,
  nepaliCalendarMonthIndexFromBs,
  NEPALI_MONTHS_ORDERED_EN,
} from "@hrmskdbl/depreciation-core";
import type { E2eFyTransitionFixture } from "./constants";

export function nepaliMonthNameForBsDate(bs: string): string {
  const idx = nepaliCalendarMonthIndexFromBs(bs);
  if (idx === null) {
    throw new Error(`Could not resolve Nepali month for ${bs}`);
  }
  const name = NEPALI_MONTHS_ORDERED_EN[idx];
  if (!name) {
    throw new Error(`Invalid Nepali month index ${idx} for ${bs}`);
  }
  return name;
}

export function expectedOpeningFyRunDetail(fixture: E2eFyTransitionFixture) {
  const calculationDateBs = fiscalQuarterEndBs(fixture.openingFiscalYear, 2);
  const depreciationStartBs = depreciationCommencementFromRegister(
    fixture.purchaseDateBs,
    fixture.depreciationStartDateBs
  );
  if (!depreciationStartBs) {
    throw new Error("Could not resolve depreciation commencement date.");
  }
  const fyStartBs = fiscalYearStartBs(fixture.openingFiscalYear);
  const effectiveFromBs = maxBsDateString(depreciationStartBs, fyStartBs);
  const depDays = inclusiveCalendarDaysBetweenBs(
    effectiveFromBs,
    calculationDateBs
  );

  const computed = computeAssetQuarterCumulative({
    purchaseAmount: fixture.grossCost,
    depreciationStartBs,
    depRatePercent: fixture.depRatePercent,
    method: "STRAIGHT_LINE",
    fiscalYearStart: fixture.openingFiscalYear,
    quarter: 2,
    depreciationScopeMode: "AS_OF_DATE",
    asOfDateBs: calculationDateBs,
    registerPriorAccumulatedDep: fixture.impliedPriorAccum,
  });

  if (!computed.ok) {
    throw new Error(`Expected compute failed: ${computed.errors.join("; ")}`);
  }

  return {
    calculationDateBs,
    nepaliMonth: nepaliMonthNameForBsDate(calculationDateBs),
    depreciationStartBs,
    effectiveFromBs,
    depDays,
    openingWdv: fixture.importedWdv,
    priorAccum: fixture.impliedPriorAccum,
    detail: computed.detail,
  };
}

export function expectedDepDaysFromRegisterStart(
  fixture: E2eFyTransitionFixture,
  periodEndBs: string
): number {
  const depreciationStartBs = depreciationCommencementFromRegister(
    fixture.purchaseDateBs,
    fixture.depreciationStartDateBs
  );
  if (!depreciationStartBs) {
    throw new Error("Could not resolve depreciation commencement date.");
  }
  const fyStartBs = fiscalYearStartBs(fixture.openingFiscalYear);
  const effectiveFromBs = maxBsDateString(depreciationStartBs, fyStartBs);
  return inclusiveCalendarDaysBetweenBs(effectiveFromBs, periodEndBs);
}

export function fyEndBs(fiscalYearStart: number): string {
  return fiscalYearEndBs(fiscalYearStart);
}

export type FyCarryForwardMatrixRow = {
  fiscalYear: number;
  requiresPriorFyFinal: boolean;
  openingBalanceSource: string;
  observedRequiresPriorFyFinal?: boolean;
  observedOpeningBalanceSource?: string;
  consistent?: boolean;
};

export function baseCarryForwardMatrix(): FyCarryForwardMatrixRow[] {
  return [
    {
      fiscalYear: 2082,
      requiresPriorFyFinal: false,
      openingBalanceSource: "Imported Book Value",
    },
    {
      fiscalYear: 2083,
      requiresPriorFyFinal: true,
      openingBalanceSource: "FY 2082 closing values",
    },
    {
      fiscalYear: 2084,
      requiresPriorFyFinal: true,
      openingBalanceSource: "FY 2083 closing values",
    },
  ];
}

export type ScenarioStepReport = {
  scenario: string;
  step: string;
  expected: string;
  actual: string;
  passed: boolean;
  screenshot?: string;
  assertion?: string;
};

export function formatScenarioReports(reports: ScenarioStepReport[]): string {
  const lines = reports.map((r) => {
    const status = r.passed ? "PASS" : "FAIL";
    const parts = [
      `## ${r.scenario} — ${r.step} [${status}]`,
      `**Expected:** ${r.expected}`,
      `**Actual:** ${r.actual}`,
    ];
    if (r.screenshot) {
      parts.push(`**Screenshot:** ${r.screenshot}`);
    }
    if (r.assertion) {
      parts.push(`**Assertion:** ${r.assertion}`);
    }
    return parts.join("\n");
  });
  return lines.join("\n\n");
}

export function formatMatrixReport(rows: FyCarryForwardMatrixRow[]): string {
  const header =
    "| FY | Requires Prior FY Final? | Source of Opening Balance | Observed Requires Prior? | Observed Source | Consistent? |";
  const sep =
    "|---|---|---|---|---|---|";
  const body = rows.map(
    (r) =>
      `| ${r.fiscalYear} | ${r.requiresPriorFyFinal ? "Yes" : "No"} | ${r.openingBalanceSource} | ${r.observedRequiresPriorFyFinal === undefined ? "—" : r.observedRequiresPriorFyFinal ? "Yes" : "No"} | ${r.observedOpeningBalanceSource ?? "—"} | ${r.consistent === undefined ? "—" : r.consistent ? "Yes" : "No"} |`
  );
  return [header, sep, ...body].join("\n");
}
