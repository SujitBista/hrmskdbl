/**
 * Nepal fiscal year helpers: FY starts in Shrawan (month index 3, 0 = Baisakh).
 * Quarters are cumulative fiscal months: Q1=3, Q2=6, Q3=9, Q4=12 from FY start.
 */

import { normalizeBsDateEnglish } from "./bs-date-english.js";
import {
  NepaliDateCtor,
  type NepaliDate,
} from "./nepali-date-import.js";

const SHRAWAN_MONTH_INDEX = 3;

function formatBs(nd: NepaliDate): string {
  return nd.format("YYYY/MM/DD");
}

function parseBs(raw: string): NepaliDate | null {
  const n = normalizeBsDateEnglish(raw);
  if (!n) return null;
  try {
    return new NepaliDateCtor(n.replace(/\//g, "-"));
  } catch {
    return null;
  }
}

function compareBs(a: NepaliDate, b: NepaliDate): number {
  const fa = formatBs(a);
  const fb = formatBs(b);
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  return 0;
}

function startOfMonth(nd: NepaliDate): NepaliDate {
  return new NepaliDateCtor(nd.getYear(), nd.getMonth(), 1);
}

function endOfMonth(nd: NepaliDate): NepaliDate {
  const s = startOfMonth(nd);
  const e = new NepaliDateCtor(s.getYear(), s.getMonth(), 1);
  e.setMonth(e.getMonth() + 1);
  e.setDate(e.getDate() - 1);
  return e;
}

function addBsMonths(nd: NepaliDate, delta: number): NepaliDate {
  const x = new NepaliDateCtor(nd.toJsDate());
  x.setMonth(x.getMonth() + delta);
  return x;
}

/** First day of Nepal fiscal year (Shrawan 1) for the FY that begins in `fiscalYearStart` (BS year of Shrawan). */
export function fiscalYearStartBs(fiscalYearStart: number): string {
  return formatBs(new NepaliDateCtor(fiscalYearStart, SHRAWAN_MONTH_INDEX, 1));
}

/**
 * Last day of fiscal year (end of Ashadh of BS year fiscalYearStart+1).
 * FY = Shrawan fiscalYearStart … Ashadh fiscalYearStart+1.
 */
export function fiscalYearEndBs(fiscalYearStart: number): string {
  const ashadhMonthIndex = 2;
  return formatBs(
    endOfMonth(new NepaliDateCtor(fiscalYearStart + 1, ashadhMonthIndex, 1))
  );
}

/**
 * End BS date of fiscal quarter `quarter` (1–4), cumulative fiscal months 3/6/9/12 from Shrawan 1.
 */
export function fiscalQuarterEndBs(
  fiscalYearStart: number,
  quarter: 1 | 2 | 3 | 4
): string {
  const fyStart = new NepaliDateCtor(fiscalYearStart, SHRAWAN_MONTH_INDEX, 1);
  const monthsToAdd = 3 * quarter - 1;
  const nd = addBsMonths(fyStart, monthsToAdd);
  return formatBs(endOfMonth(nd));
}

export function quarterTitle(quarter: 1 | 2 | 3 | 4): string {
  if (quarter === 1) return "First Quarter";
  if (quarter === 2) return "Second Quarter";
  if (quarter === 3) return "Third Quarter";
  return "Fourth Quarter / Final";
}

export function monthsCoveredForQuarter(
  quarter: 1 | 2 | 3 | 4
): 3 | 6 | 9 | 12 {
  return (quarter * 3) as 3 | 6 | 9 | 12;
}

export function isFinalQuarter(quarter: 1 | 2 | 3 | 4): boolean {
  return quarter === 4;
}

/** Compare two BS date strings (-1 / 0 / 1). */
export function compareBsDateString(a: string, b: string): number {
  const pa = parseBs(a);
  const pb = parseBs(b);
  if (!pa || !pb) return 0;
  return compareBs(pa, pb);
}

/** Later of two English BS dates (YYYY/MM/DD); requires both strings to parse. */
export function maxBsDateString(a: string, b: string): string {
  return compareBsDateString(a, b) >= 0 ? a : b;
}

/**
 * BS date when depreciation may begin: the later of capitalization (purchase) and
 * register depreciation start. Missing/invalid depreciation start falls back to purchase only.
 */
export function depreciationCommencementFromRegister(
  purchaseBs: string,
  depreciationStartBs: string | null | undefined
): string | null {
  const p = normalizeBsDateEnglish(purchaseBs.trim());
  if (!p) return null;
  const raw = depreciationStartBs?.trim();
  if (!raw) return p;
  const d = normalizeBsDateEnglish(raw);
  if (!d) return p;
  return maxBsDateString(p, d);
}

/**
 * Highest quarter (1–4) that may be posted as of `progressBs` (books closed through).
 * Returns 0 if not even Q1 end reached.
 */
export function maxEligibleQuarter(
  fiscalYearStart: number,
  progressBs: string
): 0 | 1 | 2 | 3 | 4 {
  const p = parseBs(progressBs);
  if (!p) return 0;
  for (let q = 4; q >= 1; q--) {
    const end = parseBs(fiscalQuarterEndBs(fiscalYearStart, q as 1 | 2 | 3 | 4));
    if (!end) continue;
    if (compareBs(p, end) >= 0) {
      return q as 1 | 2 | 3 | 4;
    }
  }
  return 0;
}

/** BS string for “today” in local time (server). */
export function bsDateFromJsDate(d: Date): string {
  const nd = NepaliDateCtor.fromAD(d);
  return formatBs(nd);
}

/** Bikram Sambat month names (calendar order: Baisakh … Chaitra). */
export const NEPALI_MONTHS_ORDERED_EN = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

/**
 * Nepal fiscal year “start year” (Shrawan’s BS year) for a date in that FY.
 * FY = Shrawan Y … Ashadh Y+1.
 */
export function fiscalYearStartFromBsDate(bs: string): number | null {
  const nd = parseBs(normalizeBsDateEnglish(bs.trim()));
  if (!nd) return null;
  const m = nd.getMonth();
  const y = nd.getYear();
  if (m >= SHRAWAN_MONTH_INDEX) return y;
  return y - 1;
}

/** BS calendar month index 0–11 (Baisakh…Chaitra), or null if the string cannot be parsed. */
export function nepaliCalendarMonthIndexFromBs(bs: string): number | null {
  const nd = parseBs(normalizeBsDateEnglish(bs.trim()));
  if (!nd) return null;
  return nd.getMonth();
}

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  baisakh: 0,
  baishakh: 0,
  jestha: 1,
  ashadh: 2,
  asar: 2,
  asadh: 2,
  shrawan: 3,
  shravan: 3,
  bhadra: 4,
  ashwin: 5,
  asoj: 5,
  kartik: 6,
  mangsir: 7,
  mansir: 7,
  poush: 8,
  paush: 8,
  magh: 9,
  falgun: 10,
  chaitra: 11,
  chait: 11,
};

/** Map English/Nepali month label (any common spelling) to BS month index 0–11. */
export function nepaliMonthNameToCalendarIndex(raw: string): number | null {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
  if (k in MONTH_NAME_TO_INDEX) {
    return MONTH_NAME_TO_INDEX[k]!;
  }
  return null;
}

/**
 * Which cumulative fiscal quarter (1–4) contains this BS calendar month.
 * Q1 Shrawan–Ashwin, Q2 Kartik–Poush, Q3 Magh–Chaitra, Q4 Baisakh–Ashadh (of next BS year in FY).
 */
export function fiscalQuarterFromNepaliCalendarMonthIndex(
  monthIndex: number
): 1 | 2 | 3 | 4 {
  if (monthIndex >= 3 && monthIndex <= 5) return 1;
  if (monthIndex >= 6 && monthIndex <= 8) return 2;
  if (monthIndex >= 9 && monthIndex <= 11) return 3;
  return 4;
}
