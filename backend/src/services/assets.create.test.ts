import { describe, expect, it } from "vitest";
import {
  buildAssetCode,
  expandCreateInputs,
  MAX_CREATE_UNIT_COUNT,
  resolveCreateUnitCount,
  type CreateAssetInput,
} from "./assets.js";

function sampleInput(
  overrides: Partial<CreateAssetInput> = {}
): CreateAssetInput {
  return {
    asset_name: "Office Chair",
    group_id: 1,
    sub_group_id: null,
    ownership_type: "Owner",
    working_status: "In use",
    branch_id: 1,
    department_id: null,
    purchase_date_bs: "2081/01/15",
    depreciation_start_date_bs: "2081/01/15",
    purchase_qty: null,
    unit_rate: 5000,
    purchase_invoice_no: "INV-1",
    book_value: null,
    ...overrides,
  };
}

describe("resolveCreateUnitCount", () => {
  it("returns 1 for null, unset, or single-unit qty", () => {
    expect(resolveCreateUnitCount(null)).toBe(1);
    expect(resolveCreateUnitCount(1)).toBe(1);
    expect(resolveCreateUnitCount(0.5)).toBe(1);
  });

  it("returns integer qty when registering multiple units", () => {
    expect(resolveCreateUnitCount(2)).toBe(2);
    expect(resolveCreateUnitCount(5)).toBe(5);
  });

  it("rejects fractional multi-unit qty", () => {
    expect(() => resolveCreateUnitCount(2.5)).toThrow(/whole number/i);
  });

  it("rejects qty above the configured cap", () => {
    expect(() => resolveCreateUnitCount(MAX_CREATE_UNIT_COUNT + 1)).toThrow(
      /cannot exceed/i
    );
  });
});

describe("expandCreateInputs", () => {
  it("returns the original input when qty is not split", () => {
    const input = sampleInput({ purchase_qty: null, book_value: 10000 });
    expect(expandCreateInputs(input)).toEqual([input]);
  });

  it("creates one row per unit with qty 1 and shared unit rate", () => {
    const expanded = expandCreateInputs(
      sampleInput({ purchase_qty: 3, unit_rate: 2500, book_value: null })
    );
    expect(expanded).toHaveLength(3);
    for (const row of expanded) {
      expect(row.purchase_qty).toBe(1);
      expect(row.unit_rate).toBe(2500);
      expect(row.asset_name).toBe("Office Chair");
      expect(row.book_value).toBeNull();
    }
  });

  it("splits book value across units with remainder on the last row", () => {
    const expanded = expandCreateInputs(
      sampleInput({ purchase_qty: 3, book_value: 100 })
    );
    expect(expanded.map((row) => row.book_value)).toEqual([
      33.3333, 33.3333, 33.3334,
    ]);
  });

  it("applies allocation only to the first unit", () => {
    const allocation = {
      remarks: "Assigned",
      allocation_category_name: "IT",
      allocation_branch_name: "HQ",
      emp_name: "Jane",
      serial_number: "SN-1",
      allocation_date_bs: "2081/01/15",
    };
    const expanded = expandCreateInputs(
      sampleInput({ purchase_qty: 2, allocation })
    );
    expect(expanded[0]?.allocation).toEqual(allocation);
    expect(expanded[1]?.allocation).toBeUndefined();
  });
});

describe("buildAssetCode", () => {
  it("uses the destination branch segment while keeping the asset id suffix", () => {
    const original = buildAssetCode({
      hrmsAssetId: 42,
      branchCode: "002",
      assetGroupCode: "IT",
      purchaseDateBs: "2080/04/01",
    });
    expect(original).toBe("SKDBL/002/IT/2080/04/01/000042");

    const afterTransfer = buildAssetCode({
      hrmsAssetId: 42,
      branchCode: "001",
      assetGroupCode: "IT",
      purchaseDateBs: "2080/04/01",
    });
    expect(afterTransfer).toBe("SKDBL/001/IT/2080/04/01/000042");
  });
});
