import type { PoolClient } from "pg";
import { pool, query } from "../db.js";
import type { DepreciationRunActor } from "./depreciationRuns.js";

export type DepreciationSettingsRow = {
  opening_fiscal_year: number;
  configured_by_admin_id: number | null;
  configured_by_admin_email: string;
  configured_at: string;
  created_at: string;
  updated_at: string;
};

export type DepreciationSettingsAuditRow = {
  id: number;
  action: "CREATED" | "UPDATED";
  opening_fiscal_year: number;
  previous_opening_fiscal_year: number | null;
  configured_by_admin_id: number | null;
  configured_by_admin_email: string;
  configured_at: string;
};

export type DepreciationSettingsSource = "database" | "env" | "none";

export type DepreciationSettingsView = {
  openingFiscalYear: number | null;
  source: DepreciationSettingsSource;
  configuredByAdminId: number | null;
  configuredByAdminEmail: string | null;
  configuredAt: string | null;
  editable: boolean;
  lockReason: string | null;
};

/** Reads DEPRECIATION_OPENING_FY from the environment (migration fallback only). */
export function getDepreciationOpeningFiscalYearFromEnv(): number | null {
  const raw = process.env.DEPRECIATION_OPENING_FY?.trim();
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2000) return null;
  return Math.floor(n);
}

export function depreciationPriorFyStrictCarryForwardFloor(
  openingFy: number | null
): number {
  return openingFy ?? 2000;
}

async function loadOpeningFiscalYearFromDb(
  client?: PoolClient
): Promise<number | null> {
  const runQuery = client?.query.bind(client) ?? query;
  try {
    const r = await runQuery<{ opening_fiscal_year: number }>(
      `SELECT opening_fiscal_year
       FROM hrms_depreciation_settings
       WHERE id = 1
       LIMIT 1`
    );
    const row = r.rows[0];
    if (!row) return null;
    const fy = Math.floor(Number(row.opening_fiscal_year));
    if (!Number.isFinite(fy) || fy < 2000) return null;
    return fy;
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "42P01") {
      return null;
    }
    throw err;
  }
}

/** Resolves opening FY from database, falling back to DEPRECIATION_OPENING_FY env. */
export async function getDepreciationOpeningFiscalYear(
  client?: PoolClient
): Promise<number | null> {
  const fromDb = await loadOpeningFiscalYearFromDb(client);
  if (fromDb !== null) return fromDb;
  return getDepreciationOpeningFiscalYearFromEnv();
}

export async function getDepreciationPriorFyStrictCarryForwardFloor(
  client?: PoolClient
): Promise<number> {
  const opening = await getDepreciationOpeningFiscalYear(client);
  return depreciationPriorFyStrictCarryForwardFloor(opening);
}

export async function hasDepreciationOpeningFyLock(): Promise<{
  locked: boolean;
  reason: string | null;
}> {
  try {
    const r = await query<{ fy_end_exists: boolean; rollover_exists: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM hrms_depreciation_runs
           WHERE depreciation_scope_mode = 'FY_END'
         ) AS fy_end_exists,
         EXISTS (
           SELECT 1 FROM hrms_depreciation_fy_rollovers
         ) AS rollover_exists`
    );
    const row = r.rows[0];
    if (!row) {
      return { locked: false, reason: null };
    }
    if (row.fy_end_exists) {
      return {
        locked: true,
        reason:
          "Opening fiscal year cannot be changed after an FY_END depreciation run has been created.",
      };
    }
    if (row.rollover_exists) {
      return {
        locked: true,
        reason:
          "Opening fiscal year cannot be changed after a fiscal year rollover has been applied.",
      };
    }
    return { locked: false, reason: null };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "42P01") {
      return { locked: false, reason: null };
    }
    throw err;
  }
}

async function loadSettingsRow(): Promise<DepreciationSettingsRow | null> {
  try {
    const r = await query<DepreciationSettingsRow>(
      `SELECT opening_fiscal_year,
              configured_by_admin_id,
              configured_by_admin_email,
              configured_at::text,
              created_at::text,
              updated_at::text
       FROM hrms_depreciation_settings
       WHERE id = 1
       LIMIT 1`
    );
    return r.rows[0] ?? null;
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "42P01") {
      return null;
    }
    throw err;
  }
}

export async function getDepreciationSettingsView(): Promise<DepreciationSettingsView> {
  const [row, lock, envOpening] = await Promise.all([
    loadSettingsRow(),
    hasDepreciationOpeningFyLock(),
    Promise.resolve(getDepreciationOpeningFiscalYearFromEnv()),
  ]);

  if (row) {
    return {
      openingFiscalYear: row.opening_fiscal_year,
      source: "database",
      configuredByAdminId: row.configured_by_admin_id,
      configuredByAdminEmail: row.configured_by_admin_email,
      configuredAt: row.configured_at,
      editable: !lock.locked,
      lockReason: lock.locked ? lock.reason : null,
    };
  }

  if (envOpening !== null) {
    return {
      openingFiscalYear: envOpening,
      source: "env",
      configuredByAdminId: null,
      configuredByAdminEmail: null,
      configuredAt: null,
      editable: !lock.locked,
      lockReason: lock.locked ? lock.reason : null,
    };
  }

  return {
    openingFiscalYear: null,
    source: "none",
    configuredByAdminId: null,
    configuredByAdminEmail: null,
    configuredAt: null,
    editable: !lock.locked,
    lockReason: lock.locked ? lock.reason : null,
  };
}

export async function listDepreciationSettingsAuditLogs(
  limit = 50
): Promise<DepreciationSettingsAuditRow[]> {
  const capped = Math.min(Math.max(Math.floor(limit), 1), 200);
  try {
    const r = await query<DepreciationSettingsAuditRow>(
      `SELECT id,
              action,
              opening_fiscal_year,
              previous_opening_fiscal_year,
              configured_by_admin_id,
              configured_by_admin_email,
              configured_at::text
       FROM hrms_depreciation_settings_audit_logs
       ORDER BY id DESC
       LIMIT $1`,
      [capped]
    );
    return r.rows;
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "42P01") {
      return [];
    }
    throw err;
  }
}

function parseOpeningFiscalYearInput(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? Math.floor(raw)
      : typeof raw === "string"
        ? Number.parseInt(raw.trim(), 10)
        : NaN;
  if (!Number.isFinite(n) || n < 2000) {
    throw new Error("Opening fiscal year must be an integer ≥ 2000.");
  }
  return n;
}

async function insertSettingsAudit(
  client: PoolClient,
  input: {
    action: "CREATED" | "UPDATED";
    openingFiscalYear: number;
    previousOpeningFiscalYear: number | null;
    actor: DepreciationRunActor;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO hrms_depreciation_settings_audit_logs (
      action,
      opening_fiscal_year,
      previous_opening_fiscal_year,
      configured_by_admin_id,
      configured_by_admin_email,
      configured_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      input.action,
      input.openingFiscalYear,
      input.previousOpeningFiscalYear,
      input.actor.adminId,
      input.actor.adminEmail,
    ]
  );
}

export async function upsertDepreciationSettings(input: {
  openingFiscalYear: number | string;
  actor: DepreciationRunActor;
}): Promise<DepreciationSettingsView> {
  const openingFy = parseOpeningFiscalYearInput(input.openingFiscalYear);
  const lock = await hasDepreciationOpeningFyLock();
  if (lock.locked) {
    throw new Error(
      lock.reason ??
        "Opening fiscal year cannot be changed after depreciation processing has started."
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<{ opening_fiscal_year: number }>(
      `SELECT opening_fiscal_year
       FROM hrms_depreciation_settings
       WHERE id = 1
       FOR UPDATE`
    );
    const previous = existing.rows[0]?.opening_fiscal_year ?? null;

    if (previous === openingFy) {
      await client.query("COMMIT");
      return getDepreciationSettingsView();
    }

    if (previous === null || previous === undefined) {
      await client.query(
        `INSERT INTO hrms_depreciation_settings (
          id,
          opening_fiscal_year,
          configured_by_admin_id,
          configured_by_admin_email,
          configured_at,
          created_at,
          updated_at
        ) VALUES (1, $1, $2, $3, NOW(), NOW(), NOW())`,
        [openingFy, input.actor.adminId, input.actor.adminEmail]
      );
      await insertSettingsAudit(client, {
        action: "CREATED",
        openingFiscalYear: openingFy,
        previousOpeningFiscalYear: null,
        actor: input.actor,
      });
    } else {
      await client.query(
        `UPDATE hrms_depreciation_settings
         SET opening_fiscal_year = $1,
             configured_by_admin_id = $2,
             configured_by_admin_email = $3,
             configured_at = NOW(),
             updated_at = NOW()
         WHERE id = 1`,
        [openingFy, input.actor.adminId, input.actor.adminEmail]
      );
      await insertSettingsAudit(client, {
        action: "UPDATED",
        openingFiscalYear: openingFy,
        previousOpeningFiscalYear: previous,
        actor: input.actor,
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getDepreciationSettingsView();
}
