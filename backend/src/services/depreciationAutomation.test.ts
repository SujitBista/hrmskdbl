import { afterEach, describe, expect, it, vi } from "vitest";

const { detectMock, performRolloverMock } = vi.hoisted(() => ({
  detectMock: vi.fn(async () => ({
    currentFiscalYearStart: 2084,
    priorFiscalYearStart: 2083,
    status: "blocked" as const,
    priorFyFinalRunId: null,
    blockers: ["PRIOR_FY_FINAL_DEPRECIATION_REQUIRED"],
  })),
  performRolloverMock: vi.fn(),
}));

vi.mock("./depreciationFyRollover.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./depreciationFyRollover.js")>();
  return {
    ...actual,
    detectDepreciationRolloverForCurrentFiscalYear: detectMock,
    performDepreciationFiscalYearRollover: performRolloverMock,
  };
});

vi.mock("../db.js", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
  },
  query: vi.fn(),
}));

import { ensureCurrentFiscalYearAutomation } from "./depreciationAutomation.js";

describe("ensureCurrentFiscalYearAutomation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("detects FY rollover status without creating or applying rollover", async () => {
    const result = await ensureCurrentFiscalYearAutomation();
    expect(detectMock).toHaveBeenCalled();
    expect(performRolloverMock).not.toHaveBeenCalled();
    expect(result.fyRolloverStatus?.status).toBe("blocked");
  });
});
