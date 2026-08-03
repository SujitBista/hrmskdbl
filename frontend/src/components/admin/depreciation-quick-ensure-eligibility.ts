import { compareBsDateString } from "@hrmskdbl/depreciation-core";

import {
  userFacingRolloverReason,
  type DepreciationFyRolloverStatusView,
} from "./depreciation-fy-rollover-panel";

export function formatOpeningFySlashLabel(start: number): string {
  return `FY ${start}/${String(start + 1).slice(-2)}`;
}

export function buildEmptyRunsSupportingText(
  status: DepreciationFyRolloverStatusView | null
): string {
  const opening =
    status?.migrationSettings?.openingFiscalYearStart ??
    status?.depreciationOpeningFiscalYearStart ??
    null;
  const firstSystem =
    status?.migrationSettings?.firstSystemDepreciationDateBs ?? null;

  if (opening != null && firstSystem) {
    return `Your opening fiscal year is ${formatOpeningFySlashLabel(opening)}. Create the first depreciation run for a valid calculation date on or after ${firstSystem}.`;
  }
  if (opening != null) {
    return `Your opening fiscal year is ${formatOpeningFySlashLabel(opening)}. Create the first depreciation run for a valid calculation date in that year.`;
  }
  return "Create the first depreciation run for a valid system-owned calculation date.";
}

/**
 * Whether “Calculate as of today” / ensure-current is eligible from authoritative
 * rollover status fields (no extra API). Disabled reasons are user-facing.
 */
export function getQuickAsOfTodayEligibility(
  status: DepreciationFyRolloverStatusView | null,
  options?: { statusLoading?: boolean }
): { enabled: boolean; reason: string | null } {
  if (options?.statusLoading) {
    return { enabled: false, reason: "Waiting for year-end status…" };
  }
  if (!status) {
    return { enabled: false, reason: "Year-end status is unavailable." };
  }
  if (status.migrationSettings?.source === "none") {
    return {
      enabled: false,
      reason:
        "Configure Depreciation → Settings before calculating as of today.",
    };
  }
  if (status.status === "blocked") {
    return {
      enabled: false,
      reason:
        userFacingRolloverReason(status) ??
        status.blockingReason ??
        "Finish previous year-end depreciation before calculating as of today.",
    };
  }
  if (status.status === "pending") {
    return {
      enabled: false,
      reason:
        "Set opening balances for the new fiscal year (panel above) before calculating as of today.",
    };
  }

  const today = status.currentBsDate;
  if (!today) {
    return { enabled: false, reason: "Today’s BS date is unavailable." };
  }

  const firstSystem =
    status.migrationSettings?.firstSystemDepreciationDateBs ?? null;
  const openingFy =
    status.migrationSettings?.openingFiscalYearStart ??
    status.depreciationOpeningFiscalYearStart ??
    null;

  if (
    firstSystem &&
    openingFy != null &&
    status.currentFiscalYearStart === openingFy &&
    compareBsDateString(today, firstSystem) < 0
  ) {
    return {
      enabled: false,
      reason: `Today (${today}) is before the system calculation start date (${firstSystem}).`,
    };
  }

  return { enabled: true, reason: null };
}
