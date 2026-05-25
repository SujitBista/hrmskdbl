/**
 * Fiscal-quarter depreciation for assets: cumulative calendar days from
 * max(depreciation start, FY Shrawan 1) through the selected quarter end.
 * Monetary amounts use the same monthly ERP (actual calendar days) engine as the register.
 */

import { normalizeBsDateEnglish } from "./bs-date-english.js";
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
  fiscalQuarterEndBs,
  fiscalYearEndBs,
  fiscalYearStartBs,
} from "./fiscal-nepal.js";

/** How far into the fiscal year depreciation is measured (stored on each run). */
export type DepreciationScopeMode = "FY_END" | "AS_OF_DATE";

export function parseDepreciationScopeMode(
  raw: string | null | undefined
): DepreciationScopeMode | null {
  if (raw == null || String(raw).trim() === "") return null;
  const u = String(raw).trim().toUpperCase().replace(/-/g, "_");
  if (u === "FY_END" || u === "FULL_FISCAL_YEAR") return "FY_END";
  if (u === "AS_OF_DATE" || u === "ASOFDATE" || u === "AS_OF_TODAY") {
    return "AS_OF_DATE";
  }
  return null;
}

function minBsDate(a: string, b: string): string {
  return compareBsDateString(a, b) <= 0 ? a : b;
}

function maxBsDate(a: string, b: string): string {
  return compareBsDateString(a, b) >= 0 ? a : b;
}

function isValidBsDateString(bs: string): boolean {
  const n = normalizeBsDateEnglish(bs.trim());
  if (!n) return false;
  try {
    void new NepaliDateCtor(n.replace(/\//g, "-"));
    return true;
  } catch {
    return false;
  }
}

export type LifetimeDepreciationTimeline = {
  openingBookValueOfFY: number;
  priorYearsDepAmount: number;
  thisYearDepAmount: number;
  accumulatedDep: number;
  closingBookValue: number;
};

export type ComputedQuarterAssetDetail = {
  depDays: number;
  depAmount: number;
  /**
   * Prior accumulated depreciation before this fiscal year’s slice (ERP register
   * `AccumulateDep`): max(schedule prior, register floor), excluding `depAmount`.
   */
  accumulateDep: number;
  /** Opening written-down value at FY start after prior dep (`BookValue` on ERP register). */
  bookValue: number;
  /** Closing WDV after this run’s period (`ClosingBookValue`). */
  balanceAmount: number;
  depFormula: string;
  /** Full timeline: `accumulatedDep` = prior + this-year; ties `balanceAmount`. */
  erpTimeline: LifetimeDepreciationTimeline;
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

function clampDepreciationAmounts(
  purchaseAmount: number,
  priorYearsDepAmount: number,
  thisYearDepAmount: number
): LifetimeDepreciationTimeline {
  const cost = roundMoney(purchaseAmount);
  const priorClamped = roundMoney(Math.min(Math.max(priorYearsDepAmount, 0), cost));
  const openingBookValueOfFY = roundMoney(Math.max(0, cost - priorClamped));
  const thisYearClamped = roundMoney(
    Math.min(Math.max(thisYearDepAmount, 0), openingBookValueOfFY)
  );
  const accumulatedDep = roundMoney(
    Math.min(cost, priorClamped + thisYearClamped)
  );
  const closingBookValue = roundMoney(Math.max(0, cost - accumulatedDep));
  return {
    openingBookValueOfFY,
    priorYearsDepAmount: priorClamped,
    thisYearDepAmount: thisYearClamped,
    accumulatedDep,
    closingBookValue,
  };
}

/**
 * Lifetime depreciation through an inclusive BS end date within the active fiscal year
 * (quarter end, fiscal year end, or an as-of date capped to fiscal year end).
 */
export function buildDepreciationTimelineToPeriodEnd(params: {
  purchaseAmount: number;
  depreciationStartBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  fiscalYearStart: number;
  /** Inclusive end of the depreciation window for this run (ERP slice). */
  selectedPeriodEndBs: string;
}):
  | { ok: true; timeline: LifetimeDepreciationTimeline }
  | { ok: false; errors: string[] } {
  const depStart =
    normalizeBsDateEnglish(params.depreciationStartBs.trim()) ?? "";
  if (!depStart || !isValidBsDateString(depStart)) {
    return {
      ok: false,
      errors: ["Depreciation start date is not a valid Bikram Sambat date."],
    };
  }
  const fyStartBs = fiscalYearStartBs(params.fiscalYearStart);
  const selectedPeriodEndBs = params.selectedPeriodEndBs.trim();

  if (compareBsDateString(depStart, selectedPeriodEndBs) > 0) {
    return {
      ok: true,
      timeline: clampDepreciationAmounts(params.purchaseAmount, 0, 0),
    };
  }

  /**
   * As-of date strictly before Shrawan 1: no depreciation falls in this FY slice;
   * lifetime through that date is entirely “prior” to the active FY.
   */
  if (compareBsDateString(selectedPeriodEndBs, fyStartBs) < 0) {
    const lifetimeThrough = cumulativeDepThrough({
      purchaseAmount: params.purchaseAmount,
      depreciationStartBs: depStart,
      depRatePercent: params.depRatePercent,
      method: params.method,
      effectiveFromBs: depStart,
      toBs: selectedPeriodEndBs,
    });
    if (!lifetimeThrough.ok) {
      return { ok: false, errors: lifetimeThrough.errors };
    }
    const acc = roundMoney(lifetimeThrough.totalDep);
    return {
      ok: true,
      timeline: clampDepreciationAmounts(params.purchaseAmount, acc, 0),
    };
  }

  let priorYearsDepAmount = 0;
  if (compareBsDateString(depStart, fyStartBs) < 0) {
    const priorYearsEndBs = dayBeforeBs(fyStartBs);
    if (priorYearsEndBs !== null) {
      const priorYears = cumulativeDepThrough({
        purchaseAmount: params.purchaseAmount,
        depreciationStartBs: depStart,
        depRatePercent: params.depRatePercent,
        method: params.method,
        effectiveFromBs: depStart,
        toBs: priorYearsEndBs,
      });
      if (!priorYears.ok) {
        return { ok: false, errors: priorYears.errors };
      }
      priorYearsDepAmount = roundMoney(priorYears.totalDep);
    }
  }

  const lifetimeThroughSelected = cumulativeDepThrough({
    purchaseAmount: params.purchaseAmount,
    depreciationStartBs: depStart,
    depRatePercent: params.depRatePercent,
    method: params.method,
    effectiveFromBs: depStart,
    toBs: selectedPeriodEndBs,
  });
  if (!lifetimeThroughSelected.ok) {
    return { ok: false, errors: lifetimeThroughSelected.errors };
  }

  const thisYearDepAmount = roundMoney(
    lifetimeThroughSelected.totalDep - priorYearsDepAmount
  );
  return {
    ok: true,
    timeline: clampDepreciationAmounts(
      params.purchaseAmount,
      priorYearsDepAmount,
      thisYearDepAmount
    ),
  };
}

export function buildDepreciationTimeline(params: {
  purchaseAmount: number;
  depreciationStartBs: string;
  depRatePercent: number;
  method: DepreciationMethodCode;
  fiscalYearStart: number;
  quarter: 1 | 2 | 3 | 4;
}):
  | { ok: true; timeline: LifetimeDepreciationTimeline }
  | { ok: false; errors: string[] } {
  const selectedPeriodEndBs =
    params.quarter === 4
      ? fiscalYearEndBs(params.fiscalYearStart)
      : fiscalQuarterEndBs(params.fiscalYearStart, params.quarter);
  return buildDepreciationTimelineToPeriodEnd({
    purchaseAmount: params.purchaseAmount,
    depreciationStartBs: params.depreciationStartBs,
    depRatePercent: params.depRatePercent,
    method: params.method,
    fiscalYearStart: params.fiscalYearStart,
    selectedPeriodEndBs,
  });
}

/**
 * Alias of {@link buildDepreciationTimeline} for ERP “lifetime through selected FY/quarter end”.
 */
export const calculateLifetimeDepreciationUpToFY = buildDepreciationTimeline;

/**
 * Fiscal-year DepDays = inclusive calendar days from max(depreciation start, FY Shrawan 1)
 * through the run’s depreciation end date (quarter end, FY end, or as-of date capped to FY end).
 *
 * dep_amount = current fiscal-year depreciation only through that end date.
 * It is computed directly from cumulative depDays (not month-by-month):
 * - Straight-line base: purchase amount
 * - Declining-balance base: opening FY written-down value
 * accumulate_dep = prior accumulated depreciation only (ERP `AccumulateDep`), before
 * this year’s `dep_amount`. book_value = opening WDV after that prior (`BookValue`);
 * balance_amount = closing WDV (`ClosingBookValue`). Lifetime total =
 * `erpTimeline.accumulatedDep` (= accumulate_dep + dep_amount after rounding).
 * ERP calendar days; `calculationMode` is ignored.
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
  /**
   * FY_END: same as before — period end is the selected fiscal quarter’s end (Q4 = fiscal year end).
   * AS_OF_DATE: period end is min(calculation date, fiscal year end); `asOfDateBs` is required.
   */
  depreciationScopeMode?: DepreciationScopeMode;
  /** Required when `depreciationScopeMode` is AS_OF_DATE (English BS YYYY/MM/DD). */
  asOfDateBs?: string | null;
  /** Optional inclusive cap used when depreciation stops inside the selected period (for disposal). */
  depreciationEndBs?: string | null;
  /**
   * Floors “prior accumulated depreciation” at least this amount (e.g. historical
   * dep implied by imported register: gross cost minus carrying `book_value`).
   * Combined with {@link purchaseAmount} as gross cost, yields accumulated =
   * max(schedule prior, register floor) + this-year slice (clamped), so migrated
   * assets do not lose imported accumulated depreciation.
   *
   * Ignored when {@link carryForwardPriorAccumulatedDep} is set (rollover path).
   */
  registerPriorAccumulatedDep?: number | null;
  /**
   * Total accumulated depreciation through the end of the prior fiscal year
   * (from posted final run / FY closing). When set, prior accumulated is pinned
   * to this value (capped at gross cost), this-year depreciation uses
   * opening WDV × rate × depDays / 365 with opening WDV = cost − prior, and
   * `depDays` still runs from max(depreciation start, FY Shrawan 1) through the
   * run end date (same as the non-carry-forward path).
   */
  carryForwardPriorAccumulatedDep?: number | null;
}): { ok: true; detail: ComputedQuarterAssetDetail } | { ok: false; errors: string[] } {
  void params.calculationMode;

  const scopeMode: DepreciationScopeMode =
    params.depreciationScopeMode ?? "FY_END";
  const fyStartBs = fiscalYearStartBs(params.fiscalYearStart);
  const fyEndBs = fiscalYearEndBs(params.fiscalYearStart);
  const depStart =
    normalizeBsDateEnglish(params.depreciationStartBs.trim()) ?? "";
  if (!depStart || !isValidBsDateString(depStart)) {
    return {
      ok: false,
      errors: ["Depreciation start date is not a valid Bikram Sambat date."],
    };
  }

  let selectedPeriodEndBs: string;
  if (scopeMode === "AS_OF_DATE") {
    const rawAsOf = params.asOfDateBs;
    if (rawAsOf == null || String(rawAsOf).trim() === "") {
      return {
        ok: false,
        errors: [
          "As-of calculation date (BS) is required for AS_OF_DATE depreciation scope.",
        ],
      };
    }
    const asOfNorm = normalizeBsDateEnglish(String(rawAsOf).trim());
    if (!asOfNorm || !isValidBsDateString(asOfNorm)) {
      return {
        ok: false,
        errors: ["As-of calculation date is not a valid Bikram Sambat date."],
      };
    }
    selectedPeriodEndBs = minBsDate(asOfNorm, fyEndBs);
  } else {
    selectedPeriodEndBs =
      params.quarter === 4
        ? fyEndBs
        : fiscalQuarterEndBs(params.fiscalYearStart, params.quarter);
  }

  if (params.depreciationEndBs != null && String(params.depreciationEndBs).trim() !== "") {
    const endNorm = normalizeBsDateEnglish(String(params.depreciationEndBs).trim());
    if (!endNorm || !isValidBsDateString(endNorm)) {
      return {
        ok: false,
        errors: ["Depreciation end date is not a valid Bikram Sambat date."],
      };
    }
    selectedPeriodEndBs = minBsDate(selectedPeriodEndBs, endNorm);
  }

  if (compareBsDateString(depStart, selectedPeriodEndBs) > 0) {
    const cost = roundMoney(params.purchaseAmount);
    const rawCf = params.carryForwardPriorAccumulatedDep;
    const cf =
      rawCf != null &&
      Number.isFinite(rawCf) &&
      rawCf >= 0 &&
      rawCf <= cost * 1.000001
        ? roundMoney(Math.min(Math.max(rawCf, 0), cost))
        : null;
    const priorIdle = cf ?? 0;
    const openingIdle = roundMoney(Math.max(0, cost - priorIdle));
    const idleTimeline: LifetimeDepreciationTimeline = {
      openingBookValueOfFY: openingIdle,
      priorYearsDepAmount: priorIdle,
      thisYearDepAmount: 0,
      accumulatedDep: priorIdle,
      closingBookValue: openingIdle,
    };
    return {
      ok: true,
      detail: {
        depDays: 0,
        depAmount: 0,
        accumulateDep: priorIdle,
        bookValue: openingIdle,
        balanceAmount: openingIdle,
        depFormula: formatDepFormula(params.method, params.depRatePercent),
        erpTimeline: idleTimeline,
      },
    };
  }

  const effectiveFromBs = maxBsDate(depStart, fyStartBs);

  let depDays = 0;
  if (compareBsDateString(effectiveFromBs, selectedPeriodEndBs) <= 0) {
    depDays = inclusiveCalendarDaysBetweenBs(
      effectiveFromBs,
      selectedPeriodEndBs
    );
  }

  const cost = roundMoney(params.purchaseAmount);
  const rawCarry = params.carryForwardPriorAccumulatedDep;
  const carryForward =
    rawCarry != null &&
    Number.isFinite(rawCarry) &&
    rawCarry >= 0 &&
    rawCarry <= cost * 1.000001
      ? roundMoney(Math.min(Math.max(rawCarry, 0), cost))
      : null;

  let priorYearsDepAmount: number;
  if (carryForward !== null) {
    priorYearsDepAmount = carryForward;
  } else {
    const timeline = buildDepreciationTimelineToPeriodEnd({
      purchaseAmount: params.purchaseAmount,
      depreciationStartBs: depStart,
      depRatePercent: params.depRatePercent,
      method: params.method,
      fiscalYearStart: params.fiscalYearStart,
      selectedPeriodEndBs,
    });
    if (!timeline.ok) {
      return { ok: false, errors: timeline.errors };
    }
    const rawRegisterPrior = params.registerPriorAccumulatedDep;
    const registerPriorFloor =
      rawRegisterPrior != null &&
      Number.isFinite(rawRegisterPrior) &&
      rawRegisterPrior > 0
        ? roundMoney(Math.min(Math.max(rawRegisterPrior, 0), cost))
        : 0;
    priorYearsDepAmount = roundMoney(
      Math.min(
        cost,
        Math.max(timeline.timeline.priorYearsDepAmount, registerPriorFloor)
      )
    );
  }

  /**
   * Daily proration policy:
   * - Straight line: prorate against full gross cost.
   * - Declining balance: prorate against FY opening written-down value after the
   *   blended prior (schedule vs register floor), so this-year dep matches opening WDV.
   * - Fiscal-year rollover (carry-forward): both methods use opening WDV after
   *   pinned prior accumulated (requirement: openingWDV × rate × depDays / 365).
   */
  const isDeclining = params.method === "DECLINING_BALANCE";
  const openingBookValueAfterPrior = roundMoney(
    Math.max(0, cost - priorYearsDepAmount)
  );
  const dailyBaseAmount = roundMoney(
    carryForward !== null
      ? openingBookValueAfterPrior
      : isDeclining
        ? openingBookValueAfterPrior
        : params.purchaseAmount
  );
  const dailyRawThisYearDep =
    (dailyBaseAmount * (params.depRatePercent / 100) * depDays) / 365;
  const clamped = clampDepreciationAmounts(
    params.purchaseAmount,
    priorYearsDepAmount,
    roundMoney(dailyRawThisYearDep)
  );

  return {
    ok: true,
    detail: {
      depDays,
      depAmount: clamped.thisYearDepAmount,
      accumulateDep: clamped.priorYearsDepAmount,
      bookValue: clamped.openingBookValueOfFY,
      balanceAmount: clamped.closingBookValue,
      depFormula: formatDepFormula(params.method, params.depRatePercent),
      erpTimeline: clamped,
    },
  };
}

export function formatDepFormula(
  method: DepreciationMethodCode,
  depRatePercent: number
): string {
  return `${depreciationMethodLabel(method)} @ ${depRatePercent}%`;
}
