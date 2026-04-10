/**
 * Year-one depreciation projection (Straight Line vs Declining Balance).
 * Delegates period math to {@link computeScheduleFromPeriods} for consistency with the full schedule.
 */

import {
  computeScheduleFromPeriods,
  parseDepreciationMethod,
  type DepreciationMethodCode,
  type DepreciationPeriodSlice,
} from "@/lib/depreciation-schedule";

const DEFAULT_WORKING_DAYS_PER_MONTH = 30;
const DEFAULT_PROJECTION_MONTHS = 12;

export function parsePurchaseAmount(
  qty: string | null,
  unitRate: string | null
): number | null {
  if (qty == null || unitRate == null) return null;
  const q = Number.parseFloat(qty);
  const r = Number.parseFloat(unitRate);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  if (q < 0 || r < 0) return null;
  return q * r;
}

export function parseDepRatePercent(rate: string | null): number | null {
  if (rate == null || rate === "") return null;
  const n = Number.parseFloat(rate);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** @deprecated Use {@link parseDepreciationMethod} from depreciation-schedule for new code. */
export function normalizeDepreciationMethod(
  method: string | null | undefined
): "straight_line" | "declining_balance" | null {
  const code = parseDepreciationMethod(method);
  if (code === "STRAIGHT_LINE") return "straight_line";
  if (code === "DECLINING_BALANCE") return "declining_balance";
  return null;
}

export type YearOneDepreciationSummary = {
  firstMonthDepreciation: number;
  yearOneTotalDepreciation: number;
  bookValueAfterYearOne: number;
  months: number;
  workingDaysPerMonth: number;
};

function toSyntheticPeriods(
  months: number,
  workingDaysPerMonth: number
): DepreciationPeriodSlice[] {
  const periods: DepreciationPeriodSlice[] = [];
  for (let i = 0; i < months; i++) {
    periods.push({
      period: i + 1,
      startBs: "—",
      endBs: "—",
      workingDays: workingDaysPerMonth,
    });
  }
  return periods;
}

export function computeYearOneDepreciation(params: {
  purchaseAmount: number;
  depRatePercent: number;
  method: "straight_line" | "declining_balance";
  workingDaysPerMonth?: number;
  months?: number;
}): YearOneDepreciationSummary {
  const workingDaysPerMonth =
    params.workingDaysPerMonth ?? DEFAULT_WORKING_DAYS_PER_MONTH;
  const months = params.months ?? DEFAULT_PROJECTION_MONTHS;
  const code: DepreciationMethodCode =
    params.method === "straight_line" ? "STRAIGHT_LINE" : "DECLINING_BALANCE";

  const rows = computeScheduleFromPeriods({
    purchaseAmount: params.purchaseAmount,
    depRatePercent: params.depRatePercent,
    method: code,
    periods: toSyntheticPeriods(months, workingDaysPerMonth),
  });

  const firstMonth = rows[0]?.depAmount ?? 0;
  const last = rows[rows.length - 1];
  const yearOneTotal = last?.totalDepAmount ?? 0;
  const bookAfter = last?.closingBookValue ?? params.purchaseAmount;

  return {
    firstMonthDepreciation: firstMonth,
    yearOneTotalDepreciation: yearOneTotal,
    bookValueAfterYearOne: bookAfter,
    months,
    workingDaysPerMonth,
  };
}

export function tryComputeYearOneDepreciation(params: {
  purchaseQty: string | null;
  unitRate: string | null;
  groupDepRate: string | null;
  groupDepMethod: string | null;
}): YearOneDepreciationSummary | null {
  const purchaseAmount = parsePurchaseAmount(
    params.purchaseQty,
    params.unitRate
  );
  const depRatePercent = parseDepRatePercent(params.groupDepRate);
  const methodCode = parseDepreciationMethod(params.groupDepMethod);
  if (
    purchaseAmount === null ||
    depRatePercent === null ||
    methodCode === null ||
    purchaseAmount <= 0 ||
    depRatePercent <= 0
  ) {
    return null;
  }
  const method =
    methodCode === "STRAIGHT_LINE" ? "straight_line" : "declining_balance";
  return computeYearOneDepreciation({
    purchaseAmount,
    depRatePercent,
    method,
  });
}
