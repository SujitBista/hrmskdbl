import { describe, expect, it } from "vitest";

import {
  computeDepreciationSchedule,
  computeScheduleFromPeriods,
  parseDepreciationMethod,
} from "./depreciation-schedule";

describe("parseDepreciationMethod", () => {
  it("maps group labels from the API", () => {
    expect(parseDepreciationMethod("Straight Line")).toBe("STRAIGHT_LINE");
    expect(parseDepreciationMethod("Declining Balance")).toBe(
      "DECLINING_BALANCE"
    );
  });

  it("accepts underscore-style codes", () => {
    expect(parseDepreciationMethod("STRAIGHT_LINE")).toBe("STRAIGHT_LINE");
    expect(parseDepreciationMethod("DECLINING_BALANCE")).toBe(
      "DECLINING_BALANCE"
    );
  });
});

describe("computeScheduleFromPeriods", () => {
  const twoMonths30 = [
    { period: 1, startBs: "2080/01/01", endBs: "2080/01/30", workingDays: 30 },
    { period: 2, startBs: "2080/02/01", endBs: "2080/02/30", workingDays: 30 },
  ];

  it("straight line: month 1 and 2 use original cost as base", () => {
    const rows = computeScheduleFromPeriods({
      purchaseAmount: 100_000,
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      periods: twoMonths30,
    });
    expect(rows[0].depBaseAmount).toBe(100_000);
    expect(rows[1].depBaseAmount).toBe(100_000);
    expect(rows[0].depAmount).toBe(2054.79);
    expect(rows[0].closingBookValue).toBe(97945.21);
    expect(rows[1].depAmount).toBe(2054.79);
    expect(rows[1].totalDepAmount).toBe(4109.58);
    expect(rows[1].closingBookValue).toBe(95890.42);
  });

  it("declining balance: month 2 dep uses opening book value", () => {
    const rows = computeScheduleFromPeriods({
      purchaseAmount: 100_000,
      depRatePercent: 25,
      method: "DECLINING_BALANCE",
      periods: twoMonths30,
    });
    expect(rows[0].depAmount).toBe(2054.79);
    expect(rows[0].closingBookValue).toBe(97945.21);
    expect(rows[1].depBaseAmount).toBe(97945.21);
    expect(rows[1].depAmount).toBe(2012.57);
    expect(rows[1].closingBookValue).toBe(95932.64);
  });

  it("accumulates total depreciation and ties closing book value", () => {
    const rows = computeScheduleFromPeriods({
      purchaseAmount: 100_000,
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      periods: twoMonths30,
    });
    expect(rows[1].totalDepAmount).toBe(
      rows[0].depAmount + rows[1].depAmount
    );
    expect(rows[1].closingBookValue).toBe(
      100_000 - rows[1].totalDepAmount
    );
  });
});

describe("computeDepreciationSchedule validation", () => {
  it("rejects calculation to before calculation from", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_000,
      purchaseDateBs: "2080/01/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      calculationFromBs: "2080/02/01",
      calculationToBs: "2080/01/15",
      periodMode: "monthly",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("on or after"))
      ).toBe(true);
    }
  });

  it("rejects calculation from before purchase date", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_000,
      purchaseDateBs: "2080/02/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      calculationFromBs: "2080/01/01",
      calculationToBs: "2080/03/01",
      periodMode: "monthly",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("purchase date"))
      ).toBe(true);
    }
  });
});
