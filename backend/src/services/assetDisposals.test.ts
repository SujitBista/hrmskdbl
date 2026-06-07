import { describe, expect, it } from "vitest";
import {
  assertAssetCanBeDisposed,
  assertDisposalDateIsValidForAsset,
  calculateAssetDisposalAmounts,
  calculateDisposalGainLoss,
  type DisposalAssetDepRow,
} from "./assetDisposals.js";
import {
  resolveAssetDepreciationEndBsForRun,
  resolveDepreciationDetailBookValues,
} from "./depreciationRuns.js";

function sampleAsset(
  overrides: Partial<DisposalAssetDepRow> = {}
): DisposalAssetDepRow {
  return {
    id: 1,
    asset_code: "SKDBL/001/IT/2080/04/01/000001",
    asset_name: "Laptop",
    asset_status: "ACTIVE",
    purchase_date_bs: "2080/04/01",
    depreciation_start_date_bs: "2080/04/01",
    purchase_qty: "1",
    unit_rate: "100000",
    book_value: null,
    old_book_value: null,
    asset_dep_method: "Straight Line",
    asset_dep_rate: "20",
    group_dep_method: "Straight Line",
    group_dep_rate: "20",
    ...overrides,
  };
}

describe("asset disposal calculations", () => {
  it("calculates profit, loss, and no-gain/no-loss outcomes", () => {
    expect(
      calculateDisposalGainLoss({ disposalAmount: 1200, netBookValue: 1000 })
    ).toEqual({ profitAmount: 200, lossAmount: 0 });
    expect(
      calculateDisposalGainLoss({ disposalAmount: 800, netBookValue: 1000 })
    ).toEqual({ profitAmount: 0, lossAmount: 200 });
    expect(
      calculateDisposalGainLoss({ disposalAmount: 1000, netBookValue: 1000 })
    ).toEqual({ profitAmount: 0, lossAmount: 0 });
  });

  it("rejects disposal before purchase or depreciation start date", () => {
    expect(() =>
      assertDisposalDateIsValidForAsset({
        disposalDateBs: "2080/03/31",
        purchaseDateBs: "2080/04/01",
        depreciationStartDateBs: "2080/04/01",
      })
    ).toThrow(/purchase date/i);
    expect(() =>
      assertDisposalDateIsValidForAsset({
        disposalDateBs: "2080/04/15",
        purchaseDateBs: "2080/04/01",
        depreciationStartDateBs: "2080/05/01",
      })
    ).toThrow(/depreciation start date/i);
  });

  it("prevents duplicate disposal for the same asset", () => {
    expect(() =>
      assertAssetCanBeDisposed({
        assetStatus: "ACTIVE",
        hasExistingDisposal: true,
      })
    ).toThrow(/already disposed/i);
    expect(() =>
      assertAssetCanBeDisposed({
        assetStatus: "DISPOSED",
        hasExistingDisposal: false,
      })
    ).toThrow(/already disposed/i);
  });

  it("calculates NBV at disposal date and profit/loss from that NBV", () => {
    const result = calculateAssetDisposalAmounts(
      sampleAsset(),
      "2080/07/01",
      98000
    );

    expect(result.accumulatedDepreciationAtDisposal).toBeGreaterThan(0);
    expect(result.netBookValueAtDisposal).toBeLessThan(100000);
    expect(result.profitAmount + result.lossAmount).toBeGreaterThanOrEqual(0);
  });

  it("uses full cost as NBV with zero accumulated depreciation when group has no depreciation", () => {
    const result = calculateAssetDisposalAmounts(
      sampleAsset({
        asset_dep_method: "-",
        group_dep_method: "-",
        asset_dep_rate: "0",
        group_dep_rate: "0",
      }),
      "2080/07/01",
      95000
    );

    expect(result.accumulatedDepreciationAtDisposal).toBe(0);
    expect(result.netBookValueAtDisposal).toBe(100000);
    expect(result.lossAmount).toBe(5000);
    expect(result.profitAmount).toBe(0);
  });
});

describe("disposed asset depreciation inclusion", () => {
  it("excludes assets disposed before the run fiscal period", () => {
    expect(
      resolveAssetDepreciationEndBsForRun({
        assetStatus: "DISPOSED",
        disposalDateBs: "2079/12/30",
        fiscalYearStartBs: "2080/04/01",
        selectedPeriodEndBs: "2080/12/30",
      })
    ).toBeNull();
  });

  it("caps depreciation at disposal date when disposal is inside the run period", () => {
    expect(
      resolveAssetDepreciationEndBsForRun({
        assetStatus: "DISPOSED",
        disposalDateBs: "2080/08/15",
        fiscalYearStartBs: "2080/04/01",
        selectedPeriodEndBs: "2080/12/30",
      })
    ).toBe("2080/08/15");
  });

  it("zeros book value and closing book value when disposed within the run period", () => {
    expect(
      resolveDepreciationDetailBookValues({
        assetStatus: "DISPOSED",
        disposalDateBs: "2080/08/15",
        depreciationEndBs: "2080/08/15",
        openingBookValue: 72_500,
        closingBookValue: 68_200,
      })
    ).toEqual({ bookValue: 0, balanceAmount: 0 });
  });

  it("keeps computed book values when asset is active", () => {
    expect(
      resolveDepreciationDetailBookValues({
        assetStatus: "ACTIVE",
        disposalDateBs: "",
        depreciationEndBs: "2080/12/30",
        openingBookValue: 72_500,
        closingBookValue: 68_200,
      })
    ).toEqual({ bookValue: 72_500, balanceAmount: 68_200 });
  });

  it("keeps computed book values when disposal is after the run period end", () => {
    expect(
      resolveDepreciationDetailBookValues({
        assetStatus: "DISPOSED",
        disposalDateBs: "2081/01/15",
        depreciationEndBs: "2080/12/30",
        openingBookValue: 72_500,
        closingBookValue: 68_200,
      })
    ).toEqual({ bookValue: 72_500, balanceAmount: 68_200 });
  });
});
