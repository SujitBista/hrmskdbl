import { describe, expect, it } from "vitest";

import {
  buildErpAccurateDecliningSchedule,
  buildErpAccurateStraightLineSchedule,
  buildDepreciationTimeline,
  calculateLifetimeDepreciationUpToFY,
  buildExcelFixedDecliningSchedule,
  buildExcelFixedStraightLineSchedule,
  buildQuarterlyPeriods,
  computeAssetQuarterCumulative,
  computeDepreciationSchedule,
  computeOneYearDepreciationSchedule,
  computeScheduleFromPeriods,
  depreciationCommencementFromRegister,
  firstProjectedYearEndBs,
  parseCalculationMode,
  parseDepreciationMethod,
} from "./depreciation-schedule";

describe("depreciationCommencementFromRegister", () => {
  it("uses the later of purchase and depreciation start", () => {
    expect(
      depreciationCommencementFromRegister("2080/06/01", "2080/01/01")
    ).toBe("2080/06/01");
    expect(
      depreciationCommencementFromRegister("2080/01/01", "2080/06/01")
    ).toBe("2080/06/01");
  });

  it("falls back to purchase when depreciation start is missing", () => {
    expect(depreciationCommencementFromRegister("2080/03/15", null)).toBe(
      "2080/03/15"
    );
  });
});

describe("parseCalculationMode", () => {
  it("maps common labels", () => {
    expect(parseCalculationMode("ERP_ACCURATE")).toBe("ERP_ACCURATE");
    expect(parseCalculationMode("excel-fixed")).toBe("EXCEL_FIXED");
    expect(parseCalculationMode("Excel Fixed")).toBe("EXCEL_FIXED");
  });
});

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

describe("firstProjectedYearEndBs", () => {
  it("returns end of 12th BS month from Baisakh purchase", () => {
    expect(firstProjectedYearEndBs("2080/01/01")).toBe("2080/12/30");
  });
});

describe("buildQuarterlyPeriods", () => {
  it("splits a full BS year into four quarters", () => {
    const slices = buildQuarterlyPeriods("2080/01/01", "2080/12/30");
    expect(slices).toHaveLength(4);
    expect(slices[0].startBs).toBe("2080/01/01");
    expect(slices[3].endBs).toBe("2080/12/30");
  });

  it("does not emit daily rows when the range ends mid-quarter (BS string order)", () => {
    const slices = buildQuarterlyPeriods("2082/12/01", "2083/02/31");
    expect(slices.length).toBeLessThanOrEqual(3);
    expect(slices.every((s) => s.workingDays > 0)).toBe(true);
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
        r.errors.some(
          (e) =>
            e.includes("on or before calculation to") ||
            e.includes("on or after")
        )
      ).toBe(true);
    }
  });

  it("rejects calculation to before the later of from and purchase date", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_000,
      purchaseDateBs: "2080/02/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      calculationFromBs: "2080/01/01",
      calculationToBs: "2080/01/15",
      periodMode: "monthly",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("later of"))
      ).toBe(true);
    }
  });

  it("uses purchase date as schedule start when calculation from is earlier", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_000,
      purchaseDateBs: "2080/02/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      calculationFromBs: "2080/01/01",
      calculationToBs: "2080/03/30",
      periodMode: "monthly",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.calculationFromBs).toBe("2080/02/01");
    }
  });

  it("accepts quarterly period mode", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_000,
      purchaseDateBs: "2080/01/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      calculationFromBs: "2080/01/01",
      calculationToBs: "2080/12/30",
      periodMode: "quarterly",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(4);
    }
  });

  it("quarterly: only quarter-sized slices for a typical register range", () => {
    const r = computeDepreciationSchedule({
      purchaseAmount: 100_500,
      purchaseDateBs: "2082/12/01",
      depRatePercent: 25,
      method: "DECLINING_BALANCE",
      calculationFromBs: "2082/12/01",
      calculationToBs: "2083/02/31",
      periodMode: "quarterly",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.length).toBeLessThanOrEqual(3);
      expect(r.rows.every((row) => row.workingDays > 0)).toBe(true);
    }
  });
});

const oneYearBase = {
  purchaseAmount: 100_500,
  purchaseDateBs: "2080/01/01",
  depRatePercent: 25,
};

describe("computeOneYearDepreciationSchedule", () => {
  it("projects 12 monthly rows from purchase", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "STRAIGHT_LINE",
      calculationMode: "EXCEL_FIXED",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(12);
    expect(r.summary.calculationFromBs).toBe("2080/01/01");
    expect(r.summary.calculationToBs).toBe("2080/12/30");
    expect(r.summary.totalWorkingDays).toBe(360);
  });
});

describe("calculation modes (100,500 @ 25%, first-year projection)", () => {
  it("Example A: Straight Line + Excel Fixed — first two months match fixed-30 slice", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "STRAIGHT_LINE",
      calculationMode: "EXCEL_FIXED",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.rows;
    expect(a!.workingDays).toBe(30);
    expect(b!.workingDays).toBe(30);
    expect(a!.depBaseAmount).toBe(100_500);
    expect(b!.depBaseAmount).toBe(100_500);
    expect(a!.depAmount).toBe(2065.07);
    expect(b!.depAmount).toBe(2065.07);
  });

  it("Example B: Declining + Excel Fixed — second month uses prior closing", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "DECLINING_BALANCE",
      calculationMode: "EXCEL_FIXED",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.rows;
    expect(a!.depAmount).toBe(2065.07);
    expect(a!.closingBookValue).toBe(98434.93);
    expect(b!.depBaseAmount).toBe(98434.93);
    expect(b!.depAmount).toBe(2022.64);
    expect(b!.closingBookValue).toBe(96412.29);
  });

  it("Straight Line + ERP Accurate — uses actual days per BS month slice", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "STRAIGHT_LINE",
      calculationMode: "ERP_ACCURATE",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].workingDays).not.toBe(30);
    expect(r.rows.every((row) => row.depBaseAmount === 100_500)).toBe(true);
    expect(r.summary.calculationMode).toBe("ERP_ACCURATE");
  });

  it("Declining + ERP Accurate — opening BV drives dep base", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "DECLINING_BALANCE",
      calculationMode: "ERP_ACCURATE",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].depBaseAmount).toBe(100_500);
    expect(r.rows[1].openingBookValue).toBe(r.rows[0].closingBookValue);
    expect(r.rows[1].depBaseAmount).toBe(r.rows[1].openingBookValue);
    expect(r.summary.calculationMode).toBe("ERP_ACCURATE");
  });

  it("Declining + Excel Fixed — each opening BV equals prior closing BV; cumulative total dep; BV falls", () => {
    const r = computeOneYearDepreciationSchedule({
      ...oneYearBase,
      method: "DECLINING_BALANCE",
      calculationMode: "EXCEL_FIXED",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { rows } = r;
    expect(rows.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingBookValue).toBe(rows[i - 1]!.closingBookValue);
    }

    let sumDep = 0;
    for (let i = 0; i < rows.length; i++) {
      sumDep = Math.round((sumDep + rows[i]!.depAmount) * 100) / 100;
      expect(rows[i]!.totalDepAmount).toBe(sumDep);
      expect(
        Math.abs(
          rows[i]!.closingBookValue -
            Math.round((100_500 - rows[i]!.totalDepAmount) * 100) / 100
        )
      ).toBeLessThanOrEqual(0.02);
    }

    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.depAmount > 0) {
        expect(rows[i]!.closingBookValue).toBeLessThan(rows[i]!.openingBookValue);
      }
    }

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.depBaseAmount).toBe(rows[i]!.openingBookValue);
    }
  });

  it("purchase ≈ total depreciation + closing within rounding (all four strategies)", () => {
    const modes = [
      buildErpAccurateStraightLineSchedule({
        ...oneYearBase,
        calculationFromBs: oneYearBase.purchaseDateBs,
        calculationToBs: firstProjectedYearEndBs(oneYearBase.purchaseDateBs)!,
        periodMode: "monthly",
      }),
      buildExcelFixedStraightLineSchedule({
        ...oneYearBase,
        calculationFromBs: oneYearBase.purchaseDateBs,
        calculationToBs: firstProjectedYearEndBs(oneYearBase.purchaseDateBs)!,
        periodMode: "monthly",
      }),
      buildErpAccurateDecliningSchedule({
        ...oneYearBase,
        calculationFromBs: oneYearBase.purchaseDateBs,
        calculationToBs: firstProjectedYearEndBs(oneYearBase.purchaseDateBs)!,
        periodMode: "monthly",
      }),
      buildExcelFixedDecliningSchedule({
        ...oneYearBase,
        calculationFromBs: oneYearBase.purchaseDateBs,
        calculationToBs: firstProjectedYearEndBs(oneYearBase.purchaseDateBs)!,
        periodMode: "monthly",
      }),
    ];
    for (const r of modes) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const { purchaseAmount, totalDepreciation, currentBookValue } = r.summary;
      const drift = Math.abs(purchaseAmount - (totalDepreciation + currentBookValue));
      expect(drift).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("computeAssetQuarterCumulative", () => {
  /** Shrawan 1 FY 2082 — cumulative DepDays match fiscal quarter ends. */
  const depStart = "2082/04/01";

  it("uses inclusive cumulative calendar days through each quarter end", () => {
    const base = {
      purchaseAmount: 100_000,
      depreciationStartBs: depStart,
      depRatePercent: 10,
      method: "STRAIGHT_LINE" as const,
      fiscalYearStart: 2082,
    };

    const d1 = computeAssetQuarterCumulative({ ...base, quarter: 1 });
    const d2 = computeAssetQuarterCumulative({ ...base, quarter: 2 });
    const d3 = computeAssetQuarterCumulative({ ...base, quarter: 3 });
    const d4 = computeAssetQuarterCumulative({ ...base, quarter: 4 });

    expect(d1.ok && d2.ok && d3.ok && d4.ok).toBe(true);
    if (!d1.ok || !d2.ok || !d3.ok || !d4.ok) return;

    expect(d1.detail.depDays).toBe(93);
    expect(d2.detail.depDays).toBe(182);
    expect(d3.detail.depDays).toBe(271);
    expect(d4.detail.depDays).toBe(365);

    // No imported prior: ERP AccumulateDep stays zero the whole first FY.
    expect(d1.detail.accumulateDep).toBe(0);
    expect(d2.detail.accumulateDep).toBe(0);
    expect(d3.detail.accumulateDep).toBe(0);
    expect(d4.detail.accumulateDep).toBe(0);

    expect(d1.detail.bookValue).toBeCloseTo(base.purchaseAmount, 2);
    expect(d2.detail.depAmount).toBeGreaterThan(d1.detail.depAmount);
    expect(d3.detail.depAmount).toBeGreaterThan(d2.detail.depAmount);
    expect(d4.detail.depAmount).toBeGreaterThan(d3.detail.depAmount);
    expect(d1.detail.erpTimeline.accumulatedDep).toBeCloseTo(
      d1.detail.accumulateDep + d1.detail.depAmount,
      2
    );
    expect(d4.detail.erpTimeline.accumulatedDep).toBeCloseTo(
      d4.detail.accumulateDep + d4.detail.depAmount,
      2
    );
    expect(d1.detail.erpTimeline.thisYearDepAmount).toBe(d1.detail.depAmount);
  });

  it("this FY dep amount is only selected FY slice; accumulateDep is prior-only when prior FYs exist", () => {
    const base = {
      purchaseAmount: 100_000,
      depreciationStartBs: "2082/04/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE" as const,
      fiscalYearStart: 2083,
    };
    const d4 = computeAssetQuarterCumulative({ ...base, quarter: 4 });
    expect(d4.ok).toBe(true);
    if (!d4.ok) return;
    expect(d4.detail.depAmount).toBeLessThan(d4.detail.erpTimeline.accumulatedDep);
    expect(d4.detail.bookValue).toBeCloseTo(
      base.purchaseAmount - d4.detail.accumulateDep,
      2
    );
    expect(d4.detail.erpTimeline.priorYearsDepAmount).toBeGreaterThan(0);
    expect(d4.detail.accumulateDep).toBe(d4.detail.erpTimeline.priorYearsDepAmount);
    expect(d4.detail.erpTimeline.accumulatedDep).toBeCloseTo(
      d4.detail.accumulateDep + d4.detail.depAmount,
      2
    );
  });

  it("returns zero days when depreciation starts after quarter end", () => {
    const r = computeAssetQuarterCumulative({
      purchaseAmount: 50_000,
      depreciationStartBs: "2083/04/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.depDays).toBe(0);
    expect(r.detail.accumulateDep).toBe(0);
  });

  it("register prior floor: AccumulateDep column is prior only; lifetime in erpTimeline", () => {
    const r = computeAssetQuarterCumulative({
      purchaseAmount: 100_000,
      depreciationStartBs: depStart,
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 1,
      registerPriorAccumulatedDep: 40_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.erpTimeline.priorYearsDepAmount).toBe(40_000);
    expect(r.detail.depAmount).toBeCloseTo(2547.95, 2);
    expect(r.detail.accumulateDep).toBe(40_000);
    expect(r.detail.bookValue).toBeCloseTo(100_000 - 40_000, 2);
    expect(r.detail.balanceAmount).toBeCloseTo(
      100_000 - (40_000 + 2547.95),
      2
    );
    expect(r.detail.erpTimeline.accumulatedDep).toBeCloseTo(
      40_000 + 2547.95,
      2
    );
    expect(r.detail.accumulateDep).toBeGreaterThan(r.detail.depAmount);
  });

  it("AS_OF_DATE: this-year dep and lifetime are through calculation date, before Q4 FY end", () => {
    const base = {
      purchaseAmount: 100_000,
      depreciationStartBs: "2082/04/01",
      depRatePercent: 10,
      method: "STRAIGHT_LINE" as const,
      fiscalYearStart: 2082,
      quarter: 4 as const,
    };
    const full = computeAssetQuarterCumulative({ ...base });
    const asOf = computeAssetQuarterCumulative({
      ...base,
      depreciationScopeMode: "AS_OF_DATE",
      asOfDateBs: "2082/06/15",
    });
    expect(full.ok && asOf.ok).toBe(true);
    if (!full.ok || !asOf.ok) return;
    expect(asOf.detail.depDays).toBeLessThan(full.detail.depDays);
    expect(asOf.detail.depAmount).toBeLessThan(full.detail.depAmount);
    expect(asOf.detail.accumulateDep).toBe(full.detail.accumulateDep);
    expect(asOf.detail.balanceAmount).toBeGreaterThan(full.detail.balanceAmount);
  });
});

describe("buildDepreciationTimeline", () => {
  it("exposes calculateLifetimeDepreciationUpToFY as an alias", () => {
    expect(calculateLifetimeDepreciationUpToFY).toBe(buildDepreciationTimeline);
  });

  it("rejects an invalid depreciation start BS string", () => {
    const r = buildDepreciationTimeline({
      purchaseAmount: 10_000,
      depreciationStartBs: "not-a-date",
      depRatePercent: 10,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 4,
    });
    expect(r.ok).toBe(false);
  });

  it("splits prior-years and current FY depreciation without double counting", () => {
    const result = buildDepreciationTimeline({
      purchaseAmount: 13_728.64,
      depreciationStartBs: "2081/04/01",
      depRatePercent: 25,
      method: "DECLINING_BALANCE",
      fiscalYearStart: 2082,
      quarter: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const t = result.timeline;
    expect(t.priorYearsDepAmount).toBeGreaterThan(0);
    expect(t.thisYearDepAmount).toBeGreaterThan(0);
    expect(t.accumulatedDep).toBeCloseTo(
      t.priorYearsDepAmount + t.thisYearDepAmount,
      2
    );
    expect(t.accumulatedDep).toBeLessThanOrEqual(13_728.64);
    expect(t.closingBookValue).toBeGreaterThanOrEqual(0);
    expect(t.closingBookValue).toBeCloseTo(13_728.64 - t.accumulatedDep, 2);
    expect(t.thisYearDepAmount).toBeLessThan(t.accumulatedDep);
  });

  it("declining balance: lifetime accumulated through a later FY includes all prior FYs (ERP roll-forward)", () => {
    const result = buildDepreciationTimeline({
      purchaseAmount: 13_728.64,
      depreciationStartBs: "2082/04/01",
      depRatePercent: 25,
      method: "DECLINING_BALANCE",
      fiscalYearStart: 2084,
      quarter: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = result.timeline;
    expect(t.priorYearsDepAmount).toBeCloseTo(5445.7, 2);
    expect(t.thisYearDepAmount).toBeCloseTo(1849.2, 2);
    expect(t.accumulatedDep).toBeCloseTo(7294.9, 2);
    expect(t.accumulatedDep).toBeCloseTo(
      t.priorYearsDepAmount + t.thisYearDepAmount,
      2
    );
    expect(t.closingBookValue).toBeCloseTo(13_728.64 - t.accumulatedDep, 2);
    expect(t.thisYearDepAmount).toBeLessThan(t.accumulatedDep);
    expect(t.accumulatedDep).toBeLessThanOrEqual(13_728.64);
    expect(t.closingBookValue).toBeGreaterThanOrEqual(0);
  });

  it("returns full-asset depreciation cap correctly", () => {
    const result = buildDepreciationTimeline({
      purchaseAmount: 13_728.64,
      depreciationStartBs: "2070/04/01",
      depRatePercent: 25,
      method: "STRAIGHT_LINE",
      fiscalYearStart: 2082,
      quarter: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.accumulatedDep).toBeLessThanOrEqual(13_728.64);
    expect(result.timeline.closingBookValue).toBeGreaterThanOrEqual(0);
  });
});
