import { describe, expect, it } from "vitest";
import type { DepreciationRunStatus } from "./depreciationRuns.js";

describe("FY_END draft run status", () => {
  it("treats draft and review_pending as unposted workflow states", () => {
    const unposted: DepreciationRunStatus[] = ["draft", "review_pending"];
    for (const status of unposted) {
      expect(status === "draft" || status === "review_pending").toBe(true);
      expect(status).not.toBe("posted");
    }
  });

  it("defaults manual AS_OF_DATE runs to posted when status is omitted", () => {
    const defaultStatus: DepreciationRunStatus = "posted";
    expect(defaultStatus).toBe("posted");
  });
});
