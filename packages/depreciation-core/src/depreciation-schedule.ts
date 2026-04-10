/**
 * Fixed-asset book value depreciation schedule (Straight Line vs Declining Balance).
 * Period boundaries use Bikram Sambat (BS) dates.
 *
 * ERP_ACCURATE: inclusive calendar days per period (actual schedule days).
 * EXCEL_FIXED: spreadsheet-style fixed day counts (30 / 90 / 365 rules).
 */

import NepaliDate from "nepali-date-converter";
import { normalizeBsDateEnglish } from "./bs-date-english.js";

const DAYS_IN_YEAR = 365;
const EXCEL_DAYS_MONTH = 30;
const EXCEL_DAYS_FULL_QUARTER = 90;
const EXCEL_DAYS_FULL_YEAR = 365;

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How day counts are derived for each period row. */
export type DepreciationCalculationMode = "ERP_ACCURATE" | "EXCEL_FIXED";

/** Alias for API / form field naming (`calculationMode`). */
export type CalculationMode = DepreciationCalculationMode;

/** Canonical method codes aligned with API-style names. */
export type DepreciationMethodCode = "STRAIGHT_LINE" | "DECLINING_BALANCE";

export type DepreciationPeriodMode =
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom_days";

/** One row in the depreciation schedule grid. */
export type DepreciationScheduleRow = {
  period: number;
  startDateBs: string;
  endDateBs: string;
  openingBookValue: number;
  depBaseAmount: number;
  depRatePercent: number;
  workingDays: number;
  depAmount: number;
  totalDepAmount: number;
  closingBookValue: number;
};

export type DepreciationPeriodSlice = {
  period: number;
  startBs: string;
  endBs: string;
  workingDays: number;
};

export type DepreciationScheduleSummary = {
  purchaseAmount: number;
  depreciationMethodLabel: string;
  calculationMode: DepreciationCalculationMode;
  calculationModeLabel: string;
  depRatePercent: number;
  calculationFromBs: string;
  calculationToBs: string;
  totalWorkingDays: number;
  totalDepreciation: number;
  /** Closing book value after the last row (same as closing BV). */
  currentBookValue: number;
};

export type DepreciationScheduleSuccess = {
  ok: true;
  rows: DepreciationScheduleRow[];
  summary: DepreciationScheduleSummary;
};

export type DepreciationScheduleFailure = {
  ok: false;
  errors: string[];
};

export type DepreciationScheduleResult =
  | DepreciationScheduleSuccess
  | DepreciationScheduleFailure;

export function parseDepreciationMethod(
  raw: string | null | undefined
): DepreciationMethodCode | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (
    t === "straight_line" ||
    t === "straightline" ||
    t === "straight-line"
  ) {
    return "STRAIGHT_LINE";
  }
  if (
    t === "declining_balance" ||
    t === "decliningbalance" ||
    t === "declining-balance"
  ) {
    return "DECLINING_BALANCE";
  }
  return null;
}

export function parseCalculationMode(
  raw: string | null | undefined
): DepreciationCalculationMode | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (t === "ERP_ACCURATE") return "ERP_ACCURATE";
  if (t === "EXCEL_FIXED") return "EXCEL_FIXED";
  return null;
}

export function depreciationMethodLabel(code: DepreciationMethodCode): string {
  return code === "STRAIGHT_LINE" ? "Straight Line" : "Declining Balance";
}

export function calculationModeLabel(mode: DepreciationCalculationMode): string {
  return mode === "ERP_ACCURATE" ? "ERP Accurate" : "Excel Fixed";
}

function parseBsToNepaliDate(raw: string): NepaliDate | null {
  const n = normalizeBsDateEnglish(raw);
  if (!n) return null;
  try {
    return new NepaliDate(n.replace(/\//g, "-"));
  } catch {
    return null;
  }
}

function formatBs(nd: NepaliDate): string {
  return nd.format("YYYY/MM/DD");
}

function compareBs(a: NepaliDate, b: NepaliDate): number {
  const fa = formatBs(a);
  const fb = formatBs(b);
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  return 0;
}

function minBs(a: NepaliDate, b: NepaliDate): NepaliDate {
  return compareBs(a, b) <= 0 ? a : b;
}

function maxBs(a: NepaliDate, b: NepaliDate): NepaliDate {
  return compareBs(a, b) >= 0 ? a : b;
}

function startOfMonth(nd: NepaliDate): NepaliDate {
  return new NepaliDate(nd.getYear(), nd.getMonth(), 1);
}

function endOfMonth(nd: NepaliDate): NepaliDate {
  const s = startOfMonth(nd);
  const e = new NepaliDate(s.getYear(), s.getMonth(), 1);
  e.setMonth(e.getMonth() + 1);
  e.setDate(e.getDate() - 1);
  return e;
}

function startOfBsYear(year: number): NepaliDate {
  return new NepaliDate(year, 0, 1);
}

function endOfBsYear(year: number): NepaliDate {
  return endOfMonth(new NepaliDate(year, 11, 1));
}

function startOfQuarter(nd: NepaliDate): NepaliDate {
  const m = nd.getMonth();
  const qStartMonth = Math.floor(m / 3) * 3;
  return new NepaliDate(nd.getYear(), qStartMonth, 1);
}

/** Inclusive calendar days between two BS dates. */
export function inclusiveCalendarDays(
  start: NepaliDate,
  end: NepaliDate
): number {
  if (compareBs(start, end) > 0) return 0;
  const ms = end.toJsDate().getTime() - start.toJsDate().getTime();
  return Math.floor(ms / 86400000) + 1;
}

function addDays(nd: NepaliDate, days: number): NepaliDate {
  const d = nd.toJsDate();
  d.setDate(d.getDate() + days);
  return NepaliDate.fromAD(d);
}

/** Add whole BS months (NepaliDate month index, same as `setMonth` delta). */
function addBsMonths(nd: NepaliDate, delta: number): NepaliDate {
  const x = new NepaliDate(nd.toJsDate());
  x.setMonth(x.getMonth() + delta);
  return x;
}

/**
 * End date (BS) for the first full projected year: 12 monthly periods starting
 * from the purchase date through the end of the 12th BS month window.
 */
export function firstProjectedYearEndBs(purchaseDateBs: string): string | null {
  const purchase = parseBsToNepaliDate(purchaseDateBs);
  if (!purchase) return null;
  const monthStart = startOfMonth(purchase);
  const scheduleEnd = endOfMonth(addBsMonths(monthStart, 11));
  return formatBs(scheduleEnd);
}

function endOfQuarter(nd: NepaliDate): NepaliDate {
  const m = nd.getMonth();
  const qEndMonth = Math.floor(m / 3) * 3 + 2;
  return endOfMonth(new NepaliDate(nd.getYear(), qEndMonth, 1));
}

function isFullBsQuarterSlice(
  periodStart: NepaliDate,
  periodEnd: NepaliDate
): boolean {
  const qs = startOfQuarter(periodStart);
  if (compareBs(periodStart, qs) !== 0) return false;
  const qe = endOfQuarter(periodStart);
  return compareBs(periodEnd, qe) === 0;
}

function isFullBsYearSlice(
  periodStart: NepaliDate,
  periodEnd: NepaliDate
): boolean {
  const y = periodStart.getYear();
  return (
    compareBs(periodStart, startOfBsYear(y)) === 0 &&
    compareBs(periodEnd, endOfBsYear(y)) === 0
  );
}

/**
 * Monthly BS periods clipped to [fromBs, toBs] inclusive.
 */
export function buildMonthlyPeriods(
  fromBs: string,
  toBs: string
): DepreciationPeriodSlice[] {
  const from = parseBsToNepaliDate(fromBs);
  const to = parseBsToNepaliDate(toBs);
  if (!from || !to) return [];
  if (compareBs(from, to) > 0) return [];

  const periods: DepreciationPeriodSlice[] = [];
  let periodStart = new NepaliDate(from.toJsDate());
  let idx = 1;

  while (compareBs(periodStart, to) <= 0) {
    const monthEnd = endOfMonth(periodStart);
    const periodEnd = minBs(monthEnd, to);
    if (compareBs(periodStart, periodEnd) > 0) {
      periodStart = addDays(periodEnd, 1);
      continue;
    }
    const wd = inclusiveCalendarDays(periodStart, periodEnd);
    periods.push({
      period: idx,
      startBs: formatBs(periodStart),
      endBs: formatBs(periodEnd),
      workingDays: wd,
    });
    idx += 1;
    const next = addDays(periodEnd, 1);
    if (compareBs(next, to) > 0) break;
    periodStart = next;
  }

  return periods;
}

export function buildQuarterlyPeriods(
  fromBs: string,
  toBs: string
): DepreciationPeriodSlice[] {
  const from = parseBsToNepaliDate(fromBs);
  const to = parseBsToNepaliDate(toBs);
  if (!from || !to) return [];
  if (compareBs(from, to) > 0) return [];

  const periods: DepreciationPeriodSlice[] = [];
  let periodStart = new NepaliDate(from.toJsDate());
  let idx = 1;

  while (compareBs(periodStart, to) <= 0) {
    const quarterEnd = endOfQuarter(periodStart);
    const periodEnd = minBs(quarterEnd, to);
    if (compareBs(periodStart, periodEnd) > 0) {
      periodStart = addDays(periodEnd, 1);
      continue;
    }
    const wd = inclusiveCalendarDays(periodStart, periodEnd);
    periods.push({
      period: idx,
      startBs: formatBs(periodStart),
      endBs: formatBs(periodEnd),
      workingDays: wd,
    });
    idx += 1;
    const next = addDays(periodEnd, 1);
    if (compareBs(next, to) > 0) break;
    periodStart = next;
  }

  return periods;
}

export function buildYearlyPeriods(
  fromBs: string,
  toBs: string
): DepreciationPeriodSlice[] {
  const from = parseBsToNepaliDate(fromBs);
  const to = parseBsToNepaliDate(toBs);
  if (!from || !to) return [];
  if (compareBs(from, to) > 0) return [];

  const y0 = from.getYear();
  const y1 = to.getYear();
  const periods: DepreciationPeriodSlice[] = [];
  let p = 1;

  for (let y = y0; y <= y1; y++) {
    const ys = startOfBsYear(y);
    const ye = endOfBsYear(y);
    const periodStart = maxBs(from, ys);
    const periodEnd = minBs(to, ye);
    if (compareBs(periodStart, periodEnd) > 0) continue;
    periods.push({
      period: p,
      startBs: formatBs(periodStart),
      endBs: formatBs(periodEnd),
      workingDays: inclusiveCalendarDays(periodStart, periodEnd),
    });
    p += 1;
  }

  return periods;
}

export function buildCustomDayPeriods(
  fromBs: string,
  toBs: string,
  customDays: number
): DepreciationPeriodSlice[] {
  if (!Number.isFinite(customDays) || customDays < 1) return [];
  const from = parseBsToNepaliDate(fromBs);
  const to = parseBsToNepaliDate(toBs);
  if (!from || !to) return [];
  if (compareBs(from, to) > 0) return [];

  const periods: DepreciationPeriodSlice[] = [];
  let periodStart = new NepaliDate(from.toJsDate());
  let idx = 1;

  while (compareBs(periodStart, to) <= 0) {
    const tentativeEnd = addDays(periodStart, customDays - 1);
    const periodEnd = minBs(tentativeEnd, to);
    periods.push({
      period: idx,
      startBs: formatBs(periodStart),
      endBs: formatBs(periodEnd),
      workingDays: inclusiveCalendarDays(periodStart, periodEnd),
    });
    idx += 1;
    const next = addDays(periodEnd, 1);
    if (compareBs(next, to) > 0) break;
    periodStart = next;
  }

  return periods;
}

/**
 * Replace period working days with Excel-style fixed counts (30 / 90 / 365 / custom).
 * Partial year or partial quarter rows keep actual inclusive calendar days.
 */
export function applyExcelFixedWorkingDays(
  slices: DepreciationPeriodSlice[],
  periodMode: DepreciationPeriodMode,
  customDaysPerPeriod: number
): DepreciationPeriodSlice[] {
  return slices.map((s) => {
    const startNd = parseBsToNepaliDate(s.startBs);
    const endNd = parseBsToNepaliDate(s.endBs);
    if (!startNd || !endNd) return s;

    let wd: number;
    if (periodMode === "monthly") {
      wd = EXCEL_DAYS_MONTH;
    } else if (periodMode === "quarterly") {
      wd = isFullBsQuarterSlice(startNd, endNd)
        ? EXCEL_DAYS_FULL_QUARTER
        : inclusiveCalendarDays(startNd, endNd);
    } else if (periodMode === "yearly") {
      wd = isFullBsYearSlice(startNd, endNd)
        ? EXCEL_DAYS_FULL_YEAR
        : inclusiveCalendarDays(startNd, endNd);
    } else {
      wd = Math.max(1, Math.floor(customDaysPerPeriod));
    }

    return { ...s, workingDays: wd };
  });
}

export type ScheduleFromPeriodsInput = {
  purchaseAmount: number;
  depRatePercent: number;
  method: DepreciationMethodCode;
  periods: DepreciationPeriodSlice[];
};

/**
 * Core engine: given pre-built periods and amounts, produce rows + running book value.
 *
 * Declining balance: each period’s depreciation rate is applied only to that period’s
 * opening book value (prior period’s closing). Purchase amount is not reused after period 1.
 * Straight line: rate base is always purchase amount; carrying amount still flows opening → closing.
 */
export function computeScheduleFromPeriods(
  input: ScheduleFromPeriodsInput
): DepreciationScheduleRow[] {
  const { purchaseAmount, depRatePercent, method, periods } = input;
  const rateDec = depRatePercent / 100;
  const rows: DepreciationScheduleRow[] = [];

  let priorClosingBookValue = roundMoney(purchaseAmount);
  let totalDepreciation = 0;

  for (let i = 0; i < periods.length; i++) {
    const slice = periods[i]!;
    const wd = slice.workingDays;

    const openingBookValue = priorClosingBookValue;

    if (openingBookValue <= 0) {
      rows.push({
        period: slice.period,
        startDateBs: slice.startBs,
        endDateBs: slice.endBs,
        openingBookValue: 0,
        depBaseAmount: 0,
        depRatePercent,
        workingDays: wd,
        depAmount: 0,
        totalDepAmount: totalDepreciation,
        closingBookValue: 0,
      });
      priorClosingBookValue = 0;
      continue;
    }

    const isStraightLine = method === "STRAIGHT_LINE";
    const depBaseForFormula = isStraightLine
      ? purchaseAmount
      : openingBookValue;

    const rawDep = (depBaseForFormula * rateDec * wd) / DAYS_IN_YEAR;
    let depAmount = roundMoney(rawDep);
    if (depAmount > openingBookValue) {
      depAmount = openingBookValue;
    }

    const closingBookValue = roundMoney(
      Math.max(0, openingBookValue - depAmount)
    );
    totalDepreciation = roundMoney(totalDepreciation + depAmount);

    const depBaseAmount = isStraightLine
      ? roundMoney(purchaseAmount)
      : openingBookValue;

    rows.push({
      period: slice.period,
      startDateBs: slice.startBs,
      endDateBs: slice.endBs,
      openingBookValue,
      depBaseAmount,
      depRatePercent,
      workingDays: wd,
      depAmount,
      totalDepAmount: totalDepreciation,
      closingBookValue,
    });

    priorClosingBookValue = closingBookValue;
  }

  return rows;
}

export type ComputeDepreciationScheduleParams = {
  purchaseAmount: number;
  purchaseDateBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  calculationMode?: DepreciationCalculationMode;
  calculationFromBs: string;
  calculationToBs: string;
  periodMode: DepreciationPeriodMode;
  /** Required when periodMode === custom_days */
  customDaysPerPeriod?: number;
};

export type DepreciationScheduleStrategyParams = Omit<
  ComputeDepreciationScheduleParams,
  "method" | "calculationMode"
>;

function validateScheduleParams(
  p: ComputeDepreciationScheduleParams
): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(p.purchaseAmount) || p.purchaseAmount <= 0) {
    errors.push("Purchase amount must be greater than 0.");
  }
  if (!Number.isFinite(p.depRatePercent) || p.depRatePercent <= 0) {
    errors.push("Depreciation rate must be greater than 0.");
  }

  const from = parseBsToNepaliDate(p.calculationFromBs);
  const to = parseBsToNepaliDate(p.calculationToBs);
  const purchase = parseBsToNepaliDate(p.purchaseDateBs);

  if (!from) errors.push("Calculation from date is not a valid BS date.");
  if (!to) errors.push("Calculation to date is not a valid BS date.");
  if (!purchase) errors.push("Purchase date is not a valid BS date.");

  if (from && to && compareBs(from, to) > 0) {
    errors.push("Calculation from must be on or before calculation to.");
  }

  if (from && to && purchase) {
    const effectiveFrom = maxBs(from, purchase);
    if (compareBs(to, effectiveFrom) < 0) {
      errors.push(
        "Calculation to date must be on or after the later of calculation from and the purchase date."
      );
    }
  }

  if (p.periodMode === "custom_days") {
    const c = p.customDaysPerPeriod;
    if (!Number.isFinite(c) || !c || c < 1) {
      errors.push("Custom period length must be at least 1 day.");
    }
  }

  return errors;
}

function buildSlices(
  p: ComputeDepreciationScheduleParams
): DepreciationPeriodSlice[] {
  const { calculationFromBs, calculationToBs, periodMode, customDaysPerPeriod } =
    p;
  if (periodMode === "monthly") {
    return buildMonthlyPeriods(calculationFromBs, calculationToBs);
  }
  if (periodMode === "quarterly") {
    return buildQuarterlyPeriods(calculationFromBs, calculationToBs);
  }
  if (periodMode === "yearly") {
    return buildYearlyPeriods(calculationFromBs, calculationToBs);
  }
  return buildCustomDayPeriods(
    calculationFromBs,
    calculationToBs,
    customDaysPerPeriod ?? 30
  );
}

function finalizeScheduleResult(
  params: ComputeDepreciationScheduleParams,
  effectiveFromBs: string,
  rows: DepreciationScheduleRow[]
): DepreciationScheduleSuccess {
  const mode = params.calculationMode ?? "ERP_ACCURATE";
  const last = rows[rows.length - 1]!;
  const totalWd = rows.reduce((s, x) => s + x.workingDays, 0);

  return {
    ok: true,
    rows,
    summary: {
      purchaseAmount: roundMoney(params.purchaseAmount),
      depreciationMethodLabel: depreciationMethodLabel(params.method),
      calculationMode: mode,
      calculationModeLabel: calculationModeLabel(mode),
      depRatePercent: params.depRatePercent,
      calculationFromBs: normalizeBsDateEnglish(effectiveFromBs),
      calculationToBs: normalizeBsDateEnglish(params.calculationToBs),
      totalWorkingDays: totalWd,
      totalDepreciation: last.totalDepAmount,
      currentBookValue: last.closingBookValue,
    },
  };
}

/**
 * Builds rows + summary; selects ERP vs Excel day rules, then Straight Line vs Declining.
 */
export function buildDepreciationSchedule(
  params: ComputeDepreciationScheduleParams
): DepreciationScheduleResult {
  return computeDepreciationSchedule(params);
}

/** First-year schedule only: monthly rows from purchase date through {@link firstProjectedYearEndBs}. */
export type OneYearDepreciationScheduleParams = {
  purchaseAmount: number;
  purchaseDateBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  calculationMode?: DepreciationCalculationMode;
};

/**
 * Projected first-year depreciation (12 BS monthly slices from the purchase date),
 * regardless of how long the asset has been held. Does not use arbitrary from/to ranges.
 */
export function computeOneYearDepreciationSchedule(
  params: OneYearDepreciationScheduleParams
): DepreciationScheduleResult {
  const purchase = parseBsToNepaliDate(params.purchaseDateBs);
  if (!purchase) {
    return { ok: false, errors: ["Purchase date is not a valid BS date."] };
  }
  const errors: string[] = [];
  if (!Number.isFinite(params.purchaseAmount) || params.purchaseAmount <= 0) {
    errors.push("Purchase amount must be greater than 0.");
  }
  if (!Number.isFinite(params.depRatePercent) || params.depRatePercent <= 0) {
    errors.push("Depreciation rate must be greater than 0.");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const purchaseBs = formatBs(purchase);
  const endBs = firstProjectedYearEndBs(params.purchaseDateBs);
  if (!endBs) {
    return { ok: false, errors: ["Purchase date is not a valid BS date."] };
  }

  return computeDepreciationSchedule({
    purchaseAmount: params.purchaseAmount,
    purchaseDateBs: params.purchaseDateBs,
    depRatePercent: params.depRatePercent,
    method: params.method,
    calculationMode: params.calculationMode,
    calculationFromBs: purchaseBs,
    calculationToBs: endBs,
    periodMode: "monthly",
  });
}

export function computeDepreciationSchedule(
  params: ComputeDepreciationScheduleParams
): DepreciationScheduleResult {
  const fullParams: ComputeDepreciationScheduleParams = {
    ...params,
    calculationMode: params.calculationMode ?? "ERP_ACCURATE",
  };

  const errors = validateScheduleParams(fullParams);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const fromNd = parseBsToNepaliDate(fullParams.calculationFromBs)!;
  const purchaseNd = parseBsToNepaliDate(fullParams.purchaseDateBs)!;
  const effectiveFromBs = formatBs(maxBs(fromNd, purchaseNd));

  let slices = buildSlices({
    ...fullParams,
    calculationFromBs: effectiveFromBs,
  });

  if (slices.length === 0) {
    return {
      ok: false,
      errors: [
        "No depreciation periods in the selected date range. Check dates and period mode.",
      ],
    };
  }

  if (fullParams.calculationMode === "EXCEL_FIXED") {
    const custom =
      fullParams.periodMode === "custom_days"
        ? (fullParams.customDaysPerPeriod ?? 30)
        : 30;
    slices = applyExcelFixedWorkingDays(
      slices,
      fullParams.periodMode,
      custom
    );
  }

  const rows = computeScheduleFromPeriods({
    purchaseAmount: fullParams.purchaseAmount,
    depRatePercent: fullParams.depRatePercent,
    method: fullParams.method,
    periods: slices,
  });

  return finalizeScheduleResult(fullParams, effectiveFromBs, rows);
}

/** @internal Strategy entry points for tests and explicit composition. */
export function buildErpAccurateStraightLineSchedule(
  params: DepreciationScheduleStrategyParams
): DepreciationScheduleResult {
  return computeDepreciationSchedule({
    ...params,
    method: "STRAIGHT_LINE",
    calculationMode: "ERP_ACCURATE",
  });
}

export function buildErpAccurateDecliningSchedule(
  params: DepreciationScheduleStrategyParams
): DepreciationScheduleResult {
  return computeDepreciationSchedule({
    ...params,
    method: "DECLINING_BALANCE",
    calculationMode: "ERP_ACCURATE",
  });
}

export function buildExcelFixedStraightLineSchedule(
  params: DepreciationScheduleStrategyParams
): DepreciationScheduleResult {
  return computeDepreciationSchedule({
    ...params,
    method: "STRAIGHT_LINE",
    calculationMode: "EXCEL_FIXED",
  });
}

export function buildExcelFixedDecliningSchedule(
  params: DepreciationScheduleStrategyParams
): DepreciationScheduleResult {
  return computeDepreciationSchedule({
    ...params,
    method: "DECLINING_BALANCE",
    calculationMode: "EXCEL_FIXED",
  });
}
