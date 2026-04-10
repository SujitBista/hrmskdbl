/**
 * Fixed-asset book value depreciation schedule (Straight Line vs Declining Balance).
 * Period boundaries use Bikram Sambat (BS) dates; day counts use inclusive calendar days per period.
 */

import NepaliDate from "nepali-date-converter";
import { normalizeBsDateEnglish } from "@/lib/bs-date-english";

const DAYS_IN_YEAR = 365;

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Canonical method codes aligned with API-style names. */
export type DepreciationMethodCode = "STRAIGHT_LINE" | "DECLINING_BALANCE";

export type DepreciationPeriodMode = "monthly" | "yearly" | "custom_days";

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
  depRatePercent: number;
  calculationFromBs: string;
  calculationToBs: string;
  totalWorkingDays: number;
  /** Depreciation in the last period row (most recent slice in range). */
  thisPeriodDepreciation: number;
  totalDepreciation: number;
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

export function depreciationMethodLabel(code: DepreciationMethodCode): string {
  return code === "STRAIGHT_LINE" ? "Straight Line" : "Declining Balance";
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
  return a.valueOf() - b.valueOf();
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

/** Inclusive calendar days between two BS dates (same rules as NepaliDate AD mapping). */
export function inclusiveCalendarDays(start: NepaliDate, end: NepaliDate): number {
  if (compareBs(start, end) > 0) return 0;
  const ms = end.toJsDate().getTime() - start.toJsDate().getTime();
  return Math.floor(ms / 86400000) + 1;
}

function addDays(nd: NepaliDate, days: number): NepaliDate {
  const d = nd.toJsDate();
  d.setDate(d.getDate() + days);
  return NepaliDate.fromAD(d);
}

/**
 * Monthly BS periods clipped to [fromBs, toBs] inclusive.
 */
export function buildMonthlyPeriods(fromBs: string, toBs: string): DepreciationPeriodSlice[] {
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

/**
 * BS fiscal-year periods (Baisakh–Chaitra), clipped to [fromBs, toBs].
 */
export function buildYearlyPeriods(fromBs: string, toBs: string): DepreciationPeriodSlice[] {
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

/**
 * Fixed-length chunks of `customDays` calendar days (last chunk may be shorter).
 */
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

export type ScheduleFromPeriodsInput = {
  purchaseAmount: number;
  depRatePercent: number;
  method: DepreciationMethodCode;
  periods: DepreciationPeriodSlice[];
};

/**
 * Core engine: given pre-built periods and amounts, produce rows + running book value.
 * Testable without BS date parsing.
 */
export function computeScheduleFromPeriods(
  input: ScheduleFromPeriodsInput
): DepreciationScheduleRow[] {
  const { purchaseAmount, depRatePercent, method, periods } = input;
  const rateDec = depRatePercent / 100;
  const rows: DepreciationScheduleRow[] = [];
  let totalDep = 0;
  let opening = roundMoney(purchaseAmount);

  for (let i = 0; i < periods.length; i++) {
    const slice = periods[i]!;
    const wd = slice.workingDays;

    if (opening <= 0) {
      rows.push({
        period: slice.period,
        startDateBs: slice.startBs,
        endDateBs: slice.endBs,
        openingBookValue: 0,
        depBaseAmount: 0,
        depRatePercent,
        workingDays: wd,
        depAmount: 0,
        totalDepAmount: totalDep,
        closingBookValue: 0,
      });
      continue;
    }

    const depBase =
      method === "STRAIGHT_LINE"
        ? roundMoney(purchaseAmount)
        : roundMoney(opening);

    let depAmount = roundMoney((depBase * rateDec * wd) / DAYS_IN_YEAR);
    if (depAmount > opening) {
      depAmount = roundMoney(opening);
    }
    const closing = roundMoney(Math.max(0, opening - depAmount));
    totalDep = roundMoney(totalDep + depAmount);

    rows.push({
      period: slice.period,
      startDateBs: slice.startBs,
      endDateBs: slice.endBs,
      openingBookValue: opening,
      depBaseAmount: depBase,
      depRatePercent,
      workingDays: wd,
      depAmount,
      totalDepAmount: totalDep,
      closingBookValue: closing,
    });

    opening = closing;
  }

  return rows;
}

export type ComputeDepreciationScheduleParams = {
  purchaseAmount: number;
  purchaseDateBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  calculationFromBs: string;
  calculationToBs: string;
  periodMode: DepreciationPeriodMode;
  /** Required when periodMode === custom_days */
  customDaysPerPeriod?: number;
};

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
    errors.push("Calculation to date must be on or after calculation from date.");
  }
  if (from && purchase && compareBs(from, purchase) < 0) {
    errors.push(
      "Calculation from date cannot be before the asset purchase date."
    );
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
  if (periodMode === "yearly") {
    return buildYearlyPeriods(calculationFromBs, calculationToBs);
  }
  return buildCustomDayPeriods(
    calculationFromBs,
    calculationToBs,
    customDaysPerPeriod ?? 30
  );
}

export function computeDepreciationSchedule(
  params: ComputeDepreciationScheduleParams
): DepreciationScheduleResult {
  const errors = validateScheduleParams(params);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const slices = buildSlices(params);
  if (slices.length === 0) {
    return {
      ok: false,
      errors: [
        "No depreciation periods in the selected date range. Check dates and period mode.",
      ],
    };
  }

  const rows = computeScheduleFromPeriods({
    purchaseAmount: params.purchaseAmount,
    depRatePercent: params.depRatePercent,
    method: params.method,
    periods: slices,
  });

  const last = rows[rows.length - 1]!;
  const totalWd = rows.reduce((s, x) => s + x.workingDays, 0);

  return {
    ok: true,
    rows,
    summary: {
      purchaseAmount: roundMoney(params.purchaseAmount),
      depreciationMethodLabel: depreciationMethodLabel(params.method),
      depRatePercent: params.depRatePercent,
      calculationFromBs: normalizeBsDateEnglish(params.calculationFromBs),
      calculationToBs: normalizeBsDateEnglish(params.calculationToBs),
      totalWorkingDays: totalWd,
      thisPeriodDepreciation: last.depAmount,
      totalDepreciation: last.totalDepAmount,
      currentBookValue: last.closingBookValue,
    },
  };
}
