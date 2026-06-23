import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  pool: {
    connect: vi.fn(),
  },
  query: vi.fn(),
}));

import { pool, query } from "../db.js";
import {
  getDepreciationOpeningFiscalYear,
  getDepreciationOpeningFiscalYearFromEnv,
  getDepreciationSettingsView,
  hasDepreciationOpeningFyLock,
  upsertDepreciationSettings,
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

describe("depreciationSettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe("getDepreciationOpeningFiscalYear", () => {
    it("prefers database value over env", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2080");
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ opening_fiscal_year: 2082 }],
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

  describe("getDepreciationOpeningFiscalYearFromEnv", () => {
    it("parses valid env values", () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2082");
      expect(getDepreciationOpeningFiscalYearFromEnv()).toBe(2082);
    });

    it("rejects invalid env values", () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "abc");
      expect(getDepreciationOpeningFiscalYearFromEnv()).toBeNull();
    });
  });

  describe("hasDepreciationOpeningFyLock", () => {
    it("locks when an FY_END run exists", async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ fy_end_exists: true, rollover_exists: false }],
      } as never);
      const lock = await hasDepreciationOpeningFyLock();
      expect(lock.locked).toBe(true);
      expect(lock.reason).toMatch(/FY_END depreciation run/i);
    });

    it("locks when a rollover exists", async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ fy_end_exists: false, rollover_exists: true }],
      } as never);
      const lock = await hasDepreciationOpeningFyLock();
      expect(lock.locked).toBe(true);
      expect(lock.reason).toMatch(/rollover/i);
    });
  });

  describe("getDepreciationSettingsView", () => {
    it("reports env source when only env is configured", async () => {
      vi.stubEnv("DEPRECIATION_OPENING_FY", "2082");
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{ fy_end_exists: false, rollover_exists: false }],
        } as never);
      const view = await getDepreciationSettingsView();
      expect(view).toMatchObject({
        openingFiscalYear: 2082,
        source: "env",
        editable: true,
      });
    });
  });

  describe("upsertDepreciationSettings", () => {
    it("rejects changes after FY_END depreciation exists", async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ fy_end_exists: true, rollover_exists: false }],
      } as never);
      await expect(
        upsertDepreciationSettings({
          openingFiscalYear: 2082,
          actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
        })
      ).rejects.toThrow(/FY_END depreciation run/i);
    });

    it("creates settings and audit log", async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ fy_end_exists: false, rollover_exists: false }],
      } as never);

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never)
        .mockResolvedValueOnce(undefined as never);

      vi.mocked(query)
        .mockResolvedValueOnce({
          rows: [
            {
              opening_fiscal_year: 2082,
              configured_by_admin_id: 1,
              configured_by_admin_email: "admin@test",
              configured_at: "2026-01-01T00:00:00.000Z",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        } as never)
        .mockResolvedValueOnce({
          rows: [{ fy_end_exists: false, rollover_exists: false }],
        } as never);

      const view = await upsertDepreciationSettings({
        openingFiscalYear: 2082,
        actor: { adminId: 1, adminEmail: "admin@test", isSuperAdmin: false },
      });

      expect(view).toMatchObject({
        openingFiscalYear: 2082,
        source: "database",
        configuredByAdminEmail: "admin@test",
      });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO hrms_depreciation_settings"),
        expect.arrayContaining([2082, 1, "admin@test"])
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("hrms_depreciation_settings_audit_logs"),
        expect.arrayContaining(["CREATED", 2082, null, 1, "admin@test"])
      );
    });
  });
});
