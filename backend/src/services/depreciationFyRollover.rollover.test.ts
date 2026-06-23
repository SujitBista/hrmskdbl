import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock("./depreciationRuns.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./depreciationRuns.js")>();
  return {
    ...actual,
    loadDepreciationScheduleAssetsForBranch: vi.fn(async () => []),
    recordDepreciationAudit: vi.fn(async () => undefined),
  };
});

import { query, pool } from "../db.js";
import {
  performDepreciationFiscalYearRollover,
  PriorFyFinalDepreciationRequiredError,
} from "./depreciationFyRollover.js";

describe("performDepreciationFiscalYearRollover (bank-safe)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("skips rollover when prior FY is before DEPRECIATION_OPENING_FY", async () => {
    vi.stubEnv("DEPRECIATION_OPENING_FY", "2082");
    const result = await performDepreciationFiscalYearRollover({
      newFiscalYearStart: 2082,
      branchId: null,
    });
    expect(result.status).toBe("skipped_no_prior_year");
    expect(result.priorFiscalYearStart).toBe(2081);
    expect(query).not.toHaveBeenCalled();
  });

  it("throws PRIOR_FY_FINAL_DEPRECIATION_REQUIRED when prior posted final run is missing", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'posted'")) {
        return { rows: [] };
      }
      if (sql.includes("status <> 'void'")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      performDepreciationFiscalYearRollover({
        newFiscalYearStart: 2084,
        branchId: null,
      })
    ).rejects.toBeInstanceOf(PriorFyFinalDepreciationRequiredError);
  });

  it("throws when prior FY_END is draft (rollover still blocked)", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'posted'")) {
        return { rows: [] };
      }
      if (sql.includes("status <> 'void'")) {
        return { rows: [{ id: 55, status: "draft" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      performDepreciationFiscalYearRollover({
        newFiscalYearStart: 2084,
        branchId: null,
      })
    ).rejects.toBeInstanceOf(PriorFyFinalDepreciationRequiredError);
  });

  it("returns already_applied when rollover marker exists", async () => {
    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("hrms_depreciation_fy_rollovers")) {
          return { rows: [{ id: 1 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof pool.connect>>
    );

    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'posted'")) {
        return { rows: [{ id: 99 }] };
      }
      return { rows: [] };
    });

    const result = await performDepreciationFiscalYearRollover({
      newFiscalYearStart: 2084,
      branchId: null,
    });
    expect(result.status).toBe("already_applied");
    expect(result.sourceFinalRunId).toBe(99);
  });

  it("applies rollover and issues book value update when prior FY final is posted", async () => {
    const updates: unknown[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("SELECT id FROM hrms_depreciation_fy_rollovers")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE hrms_assets")) {
          updates.push(params);
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO hrms_depreciation_fy_rollovers")) {
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes("hrms_depreciation_run_details")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof pool.connect>>
    );

    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'posted'")) {
        return { rows: [{ id: 88 }] };
      }
      return { rows: [] };
    });

    const result = await performDepreciationFiscalYearRollover({
      newFiscalYearStart: 2084,
      branchId: null,
    });
    expect(result.status).toBe("applied");
    expect(result.sourceFinalRunId).toBe(88);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0]).toEqual([88, null]);
  });
});
