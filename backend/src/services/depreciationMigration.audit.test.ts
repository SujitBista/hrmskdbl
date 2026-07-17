import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
} from "@hrmskdbl/depreciation-core";

vi.mock("../db.js", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

import { pool, query } from "../db.js";
import {
  MIGRATION_REGISTER_FROZEN_MESSAGE,
  OPENING_BALANCE_DATE_MISMATCH_MESSAGE,
  importAssetsFromRows,
  validateMigratedDepreciableImportRow,
} from "./assets.js";
import { assertDepreciationProductionEnv } from "../config/depreciationEnv.js";
import {
  hasDepreciationOpeningFyLock,
  upsertDepreciationSettings,
} from "./depreciationSettings.js";
import {
  allowLegacyRegisterCarryForward,
  assertPriorFyCarryForwardForDepreciationRun,
  MIGRATED_BOOK_VALUE_EXCEEDS_GROSS_MESSAGE,
  MIGRATED_BOOK_VALUE_NEGATIVE_MESSAGE,
  MIGRATED_DEPRECIABLE_BOOK_VALUE_REQUIRED_MESSAGE,
  refreshDepreciationRunDetailsFromAssets,
  refreshMutableDepreciationRunsForBranch,
  validateOpeningYearImportedBookValue,
} from "./depreciationRuns.js";

function mockClient() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  vi.mocked(pool.connect).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof pool.connect>>
  );
  return client;
}

describe("depreciation migration production audit fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("A/C: opening-year imported WDV validation", () => {
    it("A: book_value equal to gross yields zero prior and opening WDV equals gross", () => {
      const validated = validateOpeningYearImportedBookValue(100_000, "100000");
      expect(validated.ok).toBe(true);
      if (!validated.ok) return;
      expect(validated.priorAccumulatedDep).toBe(0);
      expect(validated.importedWdv).toBe(100_000);

      const computed = computeAssetQuarterCumulative({
        purchaseAmount: 100_000,
        depreciationStartBs: "2075/01/01",
        depRatePercent: 10,
        method: "DECLINING_BALANCE",
        fiscalYearStart: 2083,
        quarter: 2,
        depreciationScopeMode: "FY_END",
        registerPriorAccumulatedDep: validated.priorAccumulatedDep,
        firstSystemDepreciationDateBs: "2083/06/01",
      });
      expect(computed.ok).toBe(true);
      if (!computed.ok) return;
      expect(computed.detail.bookValue).toBe(100_000);
      expect(computed.detail.accumulateDep).toBe(0);
    });

    it("B: missing book_value is rejected", () => {
      const result = validateOpeningYearImportedBookValue(100_000, null);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(MIGRATED_DEPRECIABLE_BOOK_VALUE_REQUIRED_MESSAGE);
    });

    it("C: book_value greater than gross is rejected", () => {
      const result = validateOpeningYearImportedBookValue(100_000, "100001");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(MIGRATED_BOOK_VALUE_EXCEEDS_GROSS_MESSAGE);
    });

    it("C: negative book_value is rejected", () => {
      const result = validateOpeningYearImportedBookValue(100_000, "-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(MIGRATED_BOOK_VALUE_NEGATIVE_MESSAGE);
    });
  });

  describe("D/E: import opening balance as-of date", () => {
    const baseMocks = () => {
      vi.mocked(query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name: "IT",
              code: "IT",
              dep_method: "Declining Balance",
              dep_rate: "10",
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{ id: 1, branch_name: "Main", branch_code: "001" }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_fiscal_year: 2083,
              first_system_depreciation_date_bs: "2083/06/01",
              last_external_depreciation_date_bs: "2083/05/31",
              configured_by_admin_id: 1,
              configured_by_admin_email: "admin@test",
              configured_at: "2026-01-01",
              created_at: "2026-01-01",
              updated_at: "2026-01-01",
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [{ exists: false }] } as never);
    };

    it("D: mixed balance dates reject the complete import with no partial rows", async () => {
      baseMocks();
      const result = await importAssetsFromRows({
        rows: [
          {
            asset_name: "Laptop A",
            group_name: "IT",
            branch_name: "Main",
            purchase_date_bs: "2075/01/01",
            purchase_amount: 100_000,
            book_value: 80_000,
            opening_balance_as_of_date_bs: "2083/05/15",
          },
        ],
      });
      expect(result.importedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toBe(
        OPENING_BALANCE_DATE_MISMATCH_MESSAGE
      );
    });

    it("E: correct balance date passes row validation", () => {
      expect(() =>
        validateMigratedDepreciableImportRow({
          grossCost: 100_000,
          bookValue: 80_000,
          openingBalanceAsOfDateBs: "2083/05/31",
          expectedOpeningBalanceDateBs: "2083/05/31",
        })
      ).not.toThrow();
    });
  });

  describe("F: void then edit settings remains locked", () => {
    it("locks when void opening-year run exists", async () => {
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: true,
              rollover_exists: false,
            },
          ],
        } as never);
      const lock = await hasDepreciationOpeningFyLock(2083);
      expect(lock.locked).toBe(true);
      expect(lock.reason).toMatch(/voided posted runs/i);
    });

    it("rejects settings upsert after void opening-year history", async () => {
      const client = mockClient();
      client.query
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: true,
              rollover_exists: false,
            },
          ],
        } as never);

      await expect(
        upsertDepreciationSettings({
          openingFiscalYear: 2083,
          firstSystemDepreciationDateBs: "2083/07/01",
          actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
        })
      ).rejects.toThrow(/voided posted runs/i);
    });
  });

  describe("G: concurrent settings update uses advisory lock inside transaction", () => {
    it("acquires settings advisory lock before updating", async () => {
      const client = mockClient();
      client.query
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: false,
              rollover_exists: false,
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never);

      vi.mocked(query)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_fiscal_year: 2083,
              first_system_depreciation_date_bs: "2083/06/01",
              last_external_depreciation_date_bs: "2083/05/31",
              configured_by_admin_id: 1,
              configured_by_admin_email: "admin@test",
              configured_at: "2026-01-01T00:00:00.000Z",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: false,
              rollover_exists: false,
            },
          ],
        } as never);

      await upsertDepreciationSettings({
        openingFiscalYear: 2083,
        firstSystemDepreciationDateBs: "2083/06/01",
        actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
      });

      expect(
        client.query.mock.calls.some(([sql]) =>
          String(sql).includes("pg_advisory_xact_lock")
        )
      ).toBe(true);
    });
  });

  describe("H: legacy carry-forward safety", () => {
    it("fails application startup in production when legacy flag is enabled", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD", "true");
      expect(() => assertDepreciationProductionEnv()).toThrow(
        /cannot be enabled in production/i
      );
    });

    it("disables legacy carry-forward in production even if env flag is set", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD", "true");
      expect(allowLegacyRegisterCarryForward()).toBe(false);
      expect(() =>
        assertPriorFyCarryForwardForDepreciationRun(2084, null, 2083)
      ).toThrow(/Previous fiscal year final depreciation run is not posted/i);
    });
  });

  describe("I: late import after opening-year post", () => {
    it("rejects migrated depreciable import when register is frozen", async () => {
      vi.mocked(query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name: "IT",
              code: "IT",
              dep_method: "Declining Balance",
              dep_rate: "10",
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{ id: 1, branch_name: "Main", branch_code: "001" }],
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_fiscal_year: 2083,
              first_system_depreciation_date_bs: "2083/06/01",
              last_external_depreciation_date_bs: "2083/05/31",
              configured_by_admin_id: 1,
              configured_by_admin_email: "admin@test",
              configured_at: "2026-01-01",
              created_at: "2026-01-01",
              updated_at: "2026-01-01",
            },
          ],
        } as never)
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never);

      const result = await importAssetsFromRows({
        rows: [
          {
            asset_name: "Late asset",
            group_name: "IT",
            branch_name: "Main",
            purchase_date_bs: "2075/01/01",
            purchase_amount: 100_000,
            book_value: 80_000,
            opening_balance_as_of_date_bs: "2083/05/31",
          },
        ],
      });
      expect(result.importedCount).toBe(0);
      expect(result.errors[0]?.message).toBe(MIGRATION_REGISTER_FROZEN_MESSAGE);
    });
  });

  describe("J: draft import refresh", () => {
    it("queries only draft/review_pending runs when refreshing a branch", async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [],
      } as never);

      await refreshMutableDepreciationRunsForBranch(7);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('draft', 'review_pending')"),
        [7]
      );
    });
  });

  describe("K: posted AS_OF refresh rejected", () => {
    it("rejects refresh for posted runs", async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [
          {
            id: 9,
            fiscal_year_start: 2083,
            dep_title: "As of",
            quarter_no: 2,
            months_covered: 12,
            calculation_date_ad: "2026-01-01",
            calculation_date_bs: fiscalQuarterEndBs(2083, 2),
            depreciation_scope_mode: "AS_OF_DATE",
            remarks: null,
            is_final_for_fy: false,
            status: "posted",
            branch_id: 1,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
      } as never);

      await expect(
        refreshDepreciationRunDetailsFromAssets(9)
      ).rejects.toThrow(/Cannot refresh a posted depreciation run/i);
    });

    it("rejects refresh for void runs", async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [
          {
            id: 10,
            fiscal_year_start: 2083,
            dep_title: "Void",
            quarter_no: 4,
            months_covered: 12,
            calculation_date_ad: "2026-01-01",
            calculation_date_bs: "2084/03/31",
            depreciation_scope_mode: "FY_END",
            remarks: null,
            is_final_for_fy: false,
            status: "void",
            branch_id: 1,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
      } as never);

      await expect(
        refreshDepreciationRunDetailsFromAssets(10)
      ).rejects.toThrow(/Cannot refresh a void depreciation run/i);
    });
  });
});
