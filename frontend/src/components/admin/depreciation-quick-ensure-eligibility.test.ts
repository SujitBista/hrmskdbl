/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { DepreciationFyRolloverStatusView } from "./depreciation-fy-rollover-panel";
import {
  buildEmptyRunsSupportingText,
  getQuickAsOfTodayEligibility,
} from "./depreciation-quick-ensure-eligibility";

function baseStatus(
  overrides: Partial<DepreciationFyRolloverStatusView> = {}
): DepreciationFyRolloverStatusView {
  return {
    currentBsDate: "2083/04/14",
    currentFiscalYearStart: 2083,
    priorFiscalYearStart: 2082,
    status: "not_required",
    priorFyFinalRunId: null,
    priorFyFinalRunStatus: "not_applicable",
    blockers: [],
    rolloverAllowed: false,
    blockingReason: null,
    depreciationOpeningFiscalYearStart: 2083,
    migrationSettings: {
      openingFiscalYearStart: 2083,
      firstSystemDepreciationDateBs: "2083/04/01",
      lastExternalDepreciationDateBs: "2083/03/32",
      source: "env",
      configuredByAdminId: null,
      configuredByAdminEmail: null,
      configuredAt: null,
      editable: true,
      lockReason: null,
    },
    ...overrides,
  };
}

describe("buildEmptyRunsSupportingText", () => {
  it("uses authoritative opening FY and first-system date", () => {
    expect(buildEmptyRunsSupportingText(baseStatus())).toBe(
      "Your opening fiscal year is FY 2083/84. Create the first depreciation run for a valid calculation date on or after 2083/04/01."
    );
  });
});

describe("getQuickAsOfTodayEligibility", () => {
  it("enables when opening FY status is not_required and today is on/after first system date", () => {
    expect(getQuickAsOfTodayEligibility(baseStatus())).toEqual({
      enabled: true,
      reason: null,
    });
  });

  it("disables while status is loading", () => {
    expect(
      getQuickAsOfTodayEligibility(null, { statusLoading: true })
    ).toMatchObject({ enabled: false });
  });

  it("disables when today is before first system date", () => {
    const result = getQuickAsOfTodayEligibility(
      baseStatus({ currentBsDate: "2083/03/15" })
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/before the system calculation start date/i);
  });

  it("Shrawan cutover: disables on last external 2083/04/14; enables on first system 2083/04/15", () => {
    const cutoverMigration = {
      openingFiscalYearStart: 2083,
      firstSystemDepreciationDateBs: "2083/04/15",
      lastExternalDepreciationDateBs: "2083/04/14",
      source: "database" as const,
      configuredByAdminId: null,
      configuredByAdminEmail: null,
      configuredAt: null,
      editable: true,
      lockReason: null,
    };
    const before = getQuickAsOfTodayEligibility(
      baseStatus({
        currentBsDate: "2083/04/14",
        migrationSettings: cutoverMigration,
      })
    );
    expect(before.enabled).toBe(false);
    expect(before.reason).toMatch(/2083\/04\/15/);

    const onBoundary = getQuickAsOfTodayEligibility(
      baseStatus({
        currentBsDate: "2083/04/15",
        migrationSettings: cutoverMigration,
      })
    );
    expect(onBoundary).toEqual({ enabled: true, reason: null });
  });

  it("disables when rollover is blocked", () => {
    const result = getQuickAsOfTodayEligibility(
      baseStatus({
        status: "blocked",
        priorFyFinalRunStatus: null,
        blockingReason: "Previous FY_END depreciation has not been created yet.",
        depreciationOpeningFiscalYearStart: 2082,
        migrationSettings: {
          openingFiscalYearStart: 2082,
          firstSystemDepreciationDateBs: "2082/04/01",
          lastExternalDepreciationDateBs: "2082/03/32",
          source: "env",
          configuredByAdminId: null,
          configuredByAdminEmail: null,
          configuredAt: null,
          editable: true,
          lockReason: null,
        },
      })
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/Previous FY_END/i);
  });

  it("disables when rollover is pending", () => {
    const result = getQuickAsOfTodayEligibility(
      baseStatus({
        status: "pending",
        priorFyFinalRunId: 7,
        priorFyFinalRunStatus: "posted",
        rolloverAllowed: true,
      })
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/Complete fiscal year rollover/i);
  });
});
