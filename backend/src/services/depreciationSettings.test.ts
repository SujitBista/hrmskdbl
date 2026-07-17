import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  pool: {
    connect: vi.fn(),
  },
  query: vi.fn(),
}));

import { pool, query } from "../db.js";
import {
  assertDepreciationPeriodEligibleForSystemMigration,
  DEPRECIATION_OPENING_FY_NOT_CONFIGURED_MESSAGE,
  DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE,
  getDepreciationOpeningFiscalYear,
  getDepreciationOpeningFiscalYearFromEnv,
  getDepreciationFirstSystemDateFromEnv,
  getDepreciationSettingsView,
  hasDepreciationOpeningFyLock,
  requireDepreciationMigrationSettings,
  resolveDepreciationMigrationSettings,
  upsertDepreciationSettings,
  validateDepreciationMigrationDates,
} from "./depreciationSettings.js";

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

describe("depreciationSettings migration", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe("getDepreciationOpeningFiscalYear", () => {
    it("prefers database value over env", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2080");
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            opening_fiscal_year: 2082,
            first_system_depreciation_date_bs: null,
            last_external_depreciation_date_bs: null,
            configured_by_admin_id: null,
            configured_by_admin_email: "a@b.c",
            configured_at: "2026-01-01",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
      } as never);
      await expect(getDepreciationOpeningFiscalYear()).resolves.toBe(2082);
    });

    it("falls back to DEPRECIATION_OPENING_FY when database row is missing", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2082");
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
      await expect(getDepreciationOpeningFiscalYear()).resolves.toBe(2082);
    });

    it("returns null when neither database nor env is set", async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
      await expect(getDepreciationOpeningFiscalYear()).resolves.toBeNull();
    });
  });

  describe("Test G: missing / invalid opening settings", () => {
    it("uses env opening FY and optional first-system date when DB is absent", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2083");
      vi.stubEnv("DEPRECIATION_FIRST_SYSTEM_DATE_BS", "2083-06-01");
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
      const settings = await resolveDepreciationMigrationSettings();
      expect(settings).toMatchObject({
        openingFiscalYear: 2083,
        firstSystemDepreciationDateBs: "2083/06/01",
        source: "env",
      });
      expect(getDepreciationFirstSystemDateFromEnv()).toBe("2083/06/01");
    });

    it("fails clearly when both DB and env opening FY are missing", async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
      await expect(requireDepreciationMigrationSettings()).rejects.toThrow(
        DEPRECIATION_OPENING_FY_NOT_CONFIGURED_MESSAGE
      );
    });

    it("rejects invalid opening FY from env", () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "abc");
      expect(getDepreciationOpeningFiscalYearFromEnv()).toBeNull();
    });

    it("rejects first system date outside opening FY", () => {
      expect(() =>
        validateDepreciationMigrationDates({
          openingFiscalYear: 2083,
          firstSystemDepreciationDateBs: "2082/04/01",
        })
      ).toThrow(/must fall within opening fiscal year 2083/);
    });
  });

  describe("Test C: run before migration date", () => {
    it("rejects period end before first system date with stable message", () => {
      expect(() =>
        assertDepreciationPeriodEligibleForSystemMigration({
          periodEndBs: "2083/05/31",
          fiscalYearStart: 2083,
          migration: {
            openingFiscalYear: 2083,
            firstSystemDepreciationDateBs: "2083/06/01",
            lastExternalDepreciationDateBs: "2083/05/31",
            source: "database",
          },
        })
      ).toThrow(DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE);
    });

    it("allows period end on or after first system date", () => {
      expect(() =>
        assertDepreciationPeriodEligibleForSystemMigration({
          periodEndBs: "2083/06/01",
          fiscalYearStart: 2083,
          migration: {
            openingFiscalYear: 2083,
            firstSystemDepreciationDateBs: "2083/06/01",
            lastExternalDepreciationDateBs: "2083/05/31",
            source: "database",
          },
        })
      ).not.toThrow();
    });

    it("ignores migration date for later fiscal years", () => {
      expect(() =>
        assertDepreciationPeriodEligibleForSystemMigration({
          periodEndBs: "2084/04/01",
          fiscalYearStart: 2084,
          migration: {
            openingFiscalYear: 2083,
            firstSystemDepreciationDateBs: "2083/06/01",
            lastExternalDepreciationDateBs: "2083/05/31",
            source: "database",
          },
        })
      ).not.toThrow();
    });
  });

  describe("Test H: settings locking", () => {
    it("locks when a posted opening-year run exists", async () => {
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
      expect(lock.reason).toMatch(/depreciation accounting history/i);
    });

    it("locks when draft opening-year runs exist", async () => {
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
      expect(lock.reason).toMatch(/depreciation accounting history/i);
    });

    it("rejects upsert after posted opening-year run", async () => {
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
          firstSystemDepreciationDateBs: "2083/06/01",
          actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
        })
      ).rejects.toThrow(/depreciation accounting history/i);
    });
  });

  describe("getDepreciationSettingsView", () => {
    it("reports env source when only env is configured", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2082");
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [] } as never) // loadSettingsRow
        .mockResolvedValueOnce({ rows: [] } as never) // getOpening inside lock
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: false,
              rollover_exists: false,
            },
          ],
        } as never);
      const view = await getDepreciationSettingsView();
      expect(view).toMatchObject({
        openingFiscalYear: 2082,
        firstSystemDepreciationDateBs: "2082/04/01",
        source: "env",
        editable: true,
      });
    });
  });

  describe("upsertDepreciationSettings", () => {
    it("creates settings with first-system date and audit log", async () => {
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
        .mockResolvedValueOnce({
          rows: [
            {
              opening_history_exists: false,
              rollover_exists: false,
            },
          ],
        } as never);

      const view = await upsertDepreciationSettings({
        openingFiscalYear: 2083,
        firstSystemDepreciationDateBs: "2083/06/01",
        actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
      });

      expect(view).toMatchObject({
        openingFiscalYear: 2083,
        firstSystemDepreciationDateBs: "2083/06/01",
        lastExternalDepreciationDateBs: "2083/05/31",
        source: "database",
      });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO hrms_depreciation_settings"),
        expect.arrayContaining([2083, "2083/06/01", "2083/05/31", 1, "admin@test"])
      );
    });
  });

  describe("validateDepreciationMigrationDates", () => {
    it("requires last external date to be day before first system date", () => {
      expect(() =>
        validateDepreciationMigrationDates({
          openingFiscalYear: 2083,
          firstSystemDepreciationDateBs: "2083/06/01",
          lastExternalDepreciationDateBs: "2083/05/15",
        })
      ).toThrow(/immediately before/);
    });
  });
});
