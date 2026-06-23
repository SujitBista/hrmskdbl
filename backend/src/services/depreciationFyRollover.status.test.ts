import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE,
  PriorFyFinalDepreciationRequiredError,
  resolveFyRolloverStatus,
} from "./depreciationFyRollover.js";

describe("resolveFyRolloverStatus", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns not_required when prior fiscal year is before 2000", () => {
    expect(
      resolveFyRolloverStatus({
        currentFiscalYearStart: 2000,
        priorFiscalYearStart: 1999,
        rolloverApplied: false,
        priorFyFinalRun: null,
        priorFyStrictCarryForwardFloor: 2000,
      })
    ).toMatchObject({
      status: "not_required",
      blockers: [],
    });
  });

  it("returns completed when rollover is already applied", () => {
    expect(
      resolveFyRolloverStatus({
        currentFiscalYearStart: 2084,
        priorFiscalYearStart: 2083,
        rolloverApplied: true,
        priorFyFinalRun: { id: 10, status: "posted" },
        priorFyStrictCarryForwardFloor: 2000,
      })
    ).toMatchObject({
      status: "completed",
      priorFyFinalRunId: 10,
      blockers: [],
    });
  });

  it("returns blocked when prior FY final depreciation is missing", () => {
    const status = resolveFyRolloverStatus({
      currentFiscalYearStart: 2084,
      priorFiscalYearStart: 2083,
      rolloverApplied: false,
      priorFyFinalRun: null,
      priorFyStrictCarryForwardFloor: 2000,
    });
    expect(status.status).toBe("blocked");
    expect(status.blockers).toContain(PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE);
    expect(status.priorFyFinalRunId).toBeNull();
  });

  it("returns blocked while FY_END exists as draft", () => {
    const status = resolveFyRolloverStatus({
      currentFiscalYearStart: 2084,
      priorFiscalYearStart: 2083,
      rolloverApplied: false,
      priorFyFinalRun: { id: 42, status: "draft" },
      priorFyStrictCarryForwardFloor: 2000,
    });
    expect(status.status).toBe("blocked");
    expect(status.priorFyFinalRunId).toBe(42);
    expect(status.blockers).toContain("PRIOR_FY_FINAL_DEPRECIATION_NOT_POSTED");
  });

  it("returns pending when prior FY final depreciation is posted", () => {
    expect(
      resolveFyRolloverStatus({
        currentFiscalYearStart: 2084,
        priorFiscalYearStart: 2083,
        rolloverApplied: false,
        priorFyFinalRun: { id: 7, status: "posted" },
        priorFyStrictCarryForwardFloor: 2000,
      })
    ).toMatchObject({
      status: "pending",
      priorFyFinalRunId: 7,
      blockers: [],
    });
  });

  it("returns not_required when prior FY is before opening fiscal year floor", () => {
    expect(
      resolveFyRolloverStatus({
        currentFiscalYearStart: 2082,
        priorFiscalYearStart: 2081,
        rolloverApplied: false,
        priorFyFinalRun: null,
        priorFyStrictCarryForwardFloor: 2082,
      })
    ).toMatchObject({
      status: "not_required",
      blockers: [],
    });
  });

  it("requires prior FY final when current FY is after opening FY", () => {
    const status = resolveFyRolloverStatus({
      currentFiscalYearStart: 2083,
      priorFiscalYearStart: 2082,
      rolloverApplied: false,
      priorFyFinalRun: null,
      priorFyStrictCarryForwardFloor: 2082,
    });
    expect(status.status).toBe("blocked");
    expect(status.blockers).toContain(PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE);
  });
});

describe("PriorFyFinalDepreciationRequiredError", () => {
  it("exposes PRIOR_FY_FINAL_DEPRECIATION_REQUIRED code", () => {
    const err = new PriorFyFinalDepreciationRequiredError();
    expect(err.code).toBe(PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE);
    expect(err.message).toMatch(/prior fiscal year final depreciation/i);
  });
});
