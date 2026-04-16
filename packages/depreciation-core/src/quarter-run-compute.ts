/**
 * Fiscal-quarter depreciation for assets: cumulative calendar days from
 * max(depreciation start, FY Shrawan 1) through the selected quarter end.
 * Monetary amounts use the same monthly ERP (actual calendar days) engine as the register.
 */

import {
  computeDepreciationSchedule,
  depreciationMethodLabel,
  inclusiveCalendarDaysBetweenBs,
  roundMoney,
  type DepreciationCalculationMode,
  type DepreciationMethodCode,
} from "./depreciation-schedule.js";
import { NepaliDateCtor } from "./nepali-date-import.js";
import {
  compareBsDateString,
  fiscalYearEndBs,
  fiscalYearStartBs,
} from "./fiscal-nepal.js";

export type ComputedQuarterAssetDetail = {
  depDays: number;
  depAmount: number;
  accumulateDep: number;
  bookValue: number;
  balanceAmount: number;
  depFormula: string;
};

function cumulativeDepThrough(
  params: {
    purchaseAmount: number;
    depreciationStartBs: string;
    depRatePercent: number;
    method: DepreciationMethodCode;
    effectiveFromBs: string;
    toBs: string;
  }
):
  | { ok: true; totalDep: number; closingBookValue: number }
  | { ok: false; errors: string[] } {
  const {
    purchaseAmount,
    depreciationStartBs,
    depRatePercent,
    method,
    effectiveFromBs,
    toBs,
  } = params;

  if (compareBsDateString(effectiveFromBs, toBs) > 0) {
    return {
      ok: true,
      totalDep: 0,
      closingBookValue: roundMoney(purchaseAmount),
    };
  }

  const sch = computeDepreciationSchedule({
    purchaseAmount,
    purchaseDateBs: depreciationStartBs,
    depRatePercent,
    method,
    calculationMode: "ERP_ACCURATE",
    calculationFromBs: effectiveFromBs,
    calculationToBs: toBs,
    periodMode: "monthly",
  });

  if (!sch.ok) {
    return { ok: false, errors: sch.errors };
  }
  if (sch.rows.length === 0) {
    return {
      ok: false,
      errors: ["No depreciation periods in the selected fiscal range."],
    };
  }

  const last = sch.rows[sch.rows.length - 1]!;
  return {
    ok: true,
    totalDep: last.totalDepAmount,
    closingBookValue: last.closingBookValue,
  };
}

function dayBeforeBs(bs: string): string | null {
  try {
    const d = new NepaliDateCtor(bs.replace(/\//g, "-"));
    d.setDate(d.getDate() - 1);
    return d.format("YYYY/MM/DD");
  } catch {
    return null;
  }
}

/**
 * Fiscal-year DepDays = inclusive days from max(depreciation start, FY Shrawan 1) to fiscal year end.
 * dep_amount = current fiscal-year depreciation only. For declining-balance, this
 * uses opening WDV carried from previous years (no fiscal-year reset to original cost).
 * accumulate_dep = lifetime depreciation from depreciation start through fiscal year end.
 * Book value = cost minus lifetime accumulated depreciation. Always uses actual calendar days (ERP_ACCURATE); `calculationMode` is ignored.
 */
export function computeAssetQuarterCumulative(params: {
  purchaseAmount: number;
  depreciationStartBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  /** Ignored — quarter runs always use cumulative actual calendar days (ERP). */
  calculationMode?: DepreciationCalculationMode;
  fiscalYearStart: number;
  quarter: 1 | 2 | 3 | 4;
}): { ok: true; detail: ComputedQuarterAssetDetail } | { ok: false; errors: string[] } {
  void params.calculationMode;

  const fiscalEndBs = fiscalYearEndBs(params.fiscalYearStart);
  const fyStartBs = fiscalYearStartBs(params.fiscalYearStart);
  const depStart = params.depreciationStartBs.trim();

  if (compareBsDateString(depStart, fiscalEndBs) > 0) {
    const cost = roundMoney(params.purchaseAmount);
    return {
      ok: true,
      detail: {
        depDays: 0,
        depAmount: 0,
        accumulateDep: 0,
        bookValue: cost,
        balanceAmount: cost,
        depFormula: formatDepFormula(params.method, params.depRatePercent),
      },
    };
  }

  const effectiveFromBs =
    compareBsDateString(depStart, fyStartBs) > 0 ? depStart : fyStartBs;

  const depDays = inclusiveCalendarDaysBetweenBs(effectiveFromBs, fiscalEndBs);

  const currentFiscalYear = cumulativeDepThrough({
    purchaseAmount: params.purchaseAmount,
    depreciationStartBs: depStart,
    depRatePercent: params.depRatePercent,
    method: params.method,
    effectiveFromBs,
    toBs: fiscalEndBs,
  });

  if (!currentFiscalYear.ok) {
    return { ok: false, errors: currentFiscalYear.errors };
  }

  const lifetimeDepreciation = cumulativeDepThrough({
    purchaseAmount: params.purchaseAmount,
    depreciationStartBs: depStart,
    depRatePercent: params.depRatePercent,
    method: params.method,
    effectiveFromBs: depStart,
    toBs: fiscalEndBs,
  });

  if (!lifetimeDepreciation.ok) {
    return { ok: false, errors: lifetimeDepreciation.errors };
  }

  const accumulateDep = lifetimeDepreciation.totalDep;
  let depAmount = currentFiscalYear.totalDep;
  if (
    params.method === "DECLINING_BALANCE" &&
    compareBsDateString(depStart, fyStartBs) < 0
  ) {
    const priorDay = dayBeforeBs(fyStartBs);
    if (priorDay !== null) {
      const lifetimeBeforeFy = cumulativeDepThrough({
        purchaseAmount: params.purchaseAmount,
        depreciationStartBs: depStart,
        depRatePercent: params.depRatePercent,
        method: params.method,
        effectiveFromBs: depStart,
        toBs: priorDay,
      });
      if (!lifetimeBeforeFy.ok) {
        return { ok: false, errors: lifetimeBeforeFy.errors };
      }
      depAmount = roundMoney(accumulateDep - lifetimeBeforeFy.totalDep);
    }
  }
  const bookValue = lifetimeDepreciation.closingBookValue;

  return {
    ok: true,
    detail: {
      depDays,
      depAmount,
      accumulateDep,
      bookValue,
      balanceAmount: bookValue,
      depFormula: formatDepFormula(params.method, params.depRatePercent),
    },
  };
}

export function formatDepFormula(
  method: DepreciationMethodCode,
  depRatePercent: number
): string {
  return `${depreciationMethodLabel(method)} @ ${depRatePercent}%`;
}
