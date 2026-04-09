/**
 * Year-one depreciation projection (Straight Line vs Declining Balance).
 * Formula per period: (base × dep rate) × (working days in month / 365).
 * Default 30 working days per month matches the spreadsheet reference.
 */

const DEFAULT_WORKING_DAYS_PER_MONTH = 30;
const DAYS_IN_YEAR = 365;
const DEFAULT_PROJECTION_MONTHS = 12;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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

export function normalizeDepreciationMethod(
  method: string | null | undefined
): "straight_line" | "declining_balance" | null {
  if (method == null || typeof method !== "string") return null;
  const t = method.trim().toLowerCase();
  if (t === "straight line") return "straight_line";
  if (t === "declining balance") return "declining_balance";
  return null;
}

export type YearOneDepreciationSummary = {
  firstMonthDepreciation: number;
  yearOneTotalDepreciation: number;
  bookValueAfterYearOne: number;
  months: number;
  workingDaysPerMonth: number;
};

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
  const rateDecimal = params.depRatePercent / 100;

  let book = params.purchaseAmount;
  let firstMonth = 0;
  let yearOneTotal = 0;

  for (let i = 0; i < months; i++) {
    const base =
      params.method === "straight_line" ? params.purchaseAmount : book;
    const dep = round2(
      base * rateDecimal * (workingDaysPerMonth / DAYS_IN_YEAR)
    );
    if (i === 0) firstMonth = dep;
    yearOneTotal = round2(yearOneTotal + dep);
    book = round2(book - dep);
  }

  return {
    firstMonthDepreciation: firstMonth,
    yearOneTotalDepreciation: yearOneTotal,
    bookValueAfterYearOne: round2(params.purchaseAmount - yearOneTotal),
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
  const method = normalizeDepreciationMethod(params.groupDepMethod);
  if (
    purchaseAmount === null ||
    depRatePercent === null ||
    method === null ||
    purchaseAmount <= 0
  ) {
    return null;
  }
  return computeYearOneDepreciation({
    purchaseAmount,
    depRatePercent,
    method,
  });
}
