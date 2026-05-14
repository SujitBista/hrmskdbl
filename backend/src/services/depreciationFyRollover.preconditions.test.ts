import { describe, expect, it } from "vitest";
import {
  assertDepreciationFyRolloverPreconditions,
  type DepreciationFyRolloverRunDetailRow,
} from "./depreciationFyRollover.js";
import type { DepreciationScheduleAssetRow } from "./depreciationRuns.js";

function sampleEligibleAsset(
  overrides: Partial<DepreciationScheduleAssetRow> = {}
): DepreciationScheduleAssetRow {
  return {
    id: 1,
    asset_code: "SK-1",
    asset_name: "Laptop",
    group_name: "IT",
    group_dep_method: "Straight Line",
    group_dep_rate: "20",
    asset_dep_method: null,
    asset_dep_rate: null,
    sub_group_name: null,
    branch_name: "Main",
    purchase_date_bs: "2080-04-01",
    depreciation_start_date_bs: "2080-04-01",
    purchase_qty: "1",
    unit_rate: "50000",
    book_value: "40000",
    old_book_value: null,
    ...overrides,
  };
}

function detail(
  overrides: Partial<DepreciationFyRolloverRunDetailRow> = {}
): DepreciationFyRolloverRunDetailRow {
  return {
    asset_id: 1,
    asset_code: "SK-1",
    asset_name: "Laptop",
    balance_amount: "35000",
    ...overrides,
  };
}

describe("assertDepreciationFyRolloverPreconditions", () => {
  it("allows rollover when every schedule-eligible asset has a valid final run line", () => {
    const a1 = sampleEligibleAsset({ id: 1, asset_code: "A1", asset_name: "One" });
    const a2 = sampleEligibleAsset({
      id: 2,
      asset_code: "A2",
      asset_name: "Two",
      purchase_qty: "2",
      unit_rate: "10000",
      book_value: "15000",
    });
    expect(() =>
      assertDepreciationFyRolloverPreconditions({
        depreciableAssets: [a1, a2],
        runDetails: [
          detail({ asset_id: 1, asset_code: "A1", asset_name: "One", balance_amount: "100" }),
          detail({
            asset_id: 2,
            asset_code: "A2",
            asset_name: "Two",
            balance_amount: "0",
          }),
        ],
      })
    ).not.toThrow();
  });

  it("blocks rollover when a schedule-eligible asset is missing from the final run", () => {
    const a1 = sampleEligibleAsset({ id: 1, asset_code: "A1", asset_name: "One" });
    const a2 = sampleEligibleAsset({
      id: 2,
      asset_code: "A2",
      asset_name: "Two",
      purchase_qty: "1",
      unit_rate: "20000",
      book_value: "10000",
    });
    expect(() =>
      assertDepreciationFyRolloverPreconditions({
        depreciableAssets: [a1, a2],
        runDetails: [
          detail({ asset_id: 1, asset_code: "A1", asset_name: "One", balance_amount: "50" }),
        ],
      })
    ).toThrow(/missing from the prior fiscal year/i);
    expect(() =>
      assertDepreciationFyRolloverPreconditions({
        depreciableAssets: [a1, a2],
        runDetails: [
          detail({ asset_id: 1, asset_code: "A1", asset_name: "One", balance_amount: "50" }),
        ],
      })
    ).toThrow(/A2 — Two/);
  });

  it("allows legacy gross cost when purchase_qty × unit_rate is zero but old_book_value applies", () => {
    const a = sampleEligibleAsset({
      id: 7,
      asset_code: "LEG-1",
      purchase_qty: "0",
      unit_rate: "100",
      book_value: "8000",
      old_book_value: "10000",
    });
    expect(() =>
      assertDepreciationFyRolloverPreconditions({
        depreciableAssets: [a],
        runDetails: [
          detail({
            asset_id: 7,
            asset_code: "LEG-1",
            balance_amount: "7500",
          }),
        ],
      })
    ).not.toThrow();
  });

  it("blocks rollover when balance_amount is null, non-numeric, or negative", () => {
    const a1 = sampleEligibleAsset({ id: 1 });
    for (const balance_amount of [null, "", "  ", "NaN", "x", "-0.01"]) {
      expect(() =>
        assertDepreciationFyRolloverPreconditions({
          depreciableAssets: [a1],
          runDetails: [detail({ balance_amount })],
        })
      ).toThrow(/invalid closing balance/i);
    }
  });
});
