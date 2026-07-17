import type { PoolClient } from "pg";
import {
  compareBsDateString,
  dayAfterBsDate,
  dayBeforeBsDate,
  fiscalYearStartBs,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import { pool, query } from "../db.js";
import type { DepreciationRunActor } from "./depreciationRuns.js";

/** Serializes depreciation settings changes vs run create/refresh. */
export const DEPRECIATION_SETTINGS_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(
  hashtext('hrms_depr_settings'),
  1
)`;

export type DepreciationSettingsRow = {
  opening_fiscal_year: number;
  first_system_depreciation_date_bs: string | null;
  last_external_depreciation_date_bs: string | null;
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
  first_system_depreciation_date_bs: string | null;
  previous_first_system_depreciation_date_bs: string | null;
  last_external_depreciation_date_bs: string | null;
  previous_last_external_depreciation_date_bs: string | null;
  configured_by_admin_id: number | null;
  configured_by_admin_email: string;
  configured_at: string;
};

export type DepreciationSettingsSource = "database" | "env" | "none";

export type DepreciationMigrationSettings = {
  openingFiscalYear: number;
  firstSystemDepreciationDateBs: string;
  lastExternalDepreciationDateBs: string | null;
  source: Exclude<DepreciationSettingsSource, "none">;
};

export type DepreciationSettingsView = {
  openingFiscalYear: number | null;
  firstSystemDepreciationDateBs: string | null;
  lastExternalDepreciationDateBs: string | null;
  source: DepreciationSettingsSource;
  configuredByAdminId: number | null;
  configuredByAdminEmail: string | null;
  configuredAt: string | null;
  editable: boolean;
  lockReason: string | null;
};

export const DEPRECIATION_OPENING_FY_NOT_CONFIGURED_MESSAGE =
  "Depreciation opening fiscal year is not configured. Set it in Admin → Depreciation → Settings or DEPRECIATION_OPENING_FY.";

export const DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE =
  "This depreciation period ends before the system migration date.";

/** Reads DEPRECIATION_OPENING_FY from the environment (migration fallback only). */
export function getDepreciationOpeningFiscalYearFromEnv(): number | null {
  const raw = process.env.DEPRECIATION_OPENING_FY?.trim();
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2000) return null;
  return Math.floor(n);
}

/** Optional env fallback for first system depreciation date (YYYY/MM/DD or YYYY-MM-DD). */
export function getDepreciationFirstSystemDateFromEnv(): string | null {
  const raw = process.env.DEPRECIATION_FIRST_SYSTEM_DATE_BS?.trim();
  if (raw == null || raw === "") return null;
  return normalizeBsDateEnglish(raw);
}

export function depreciationPriorFyStrictCarryForwardFloor(
  openingFy: number | null
): number {
  return openingFy ?? 2000;
}

function isMissingRelationError(err: unknown): boolean {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return code === "42P01";
}

async function loadSettingsRow(
  client?: PoolClient
): Promise<DepreciationSettingsRow | null> {
  const runQuery = client?.query.bind(client) ?? query;
  try {
    const r = await runQuery<DepreciationSettingsRow>(
      `SELECT opening_fiscal_year,
              first_system_depreciation_date_bs,
              last_external_depreciation_date_bs,
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
    if (isMissingRelationError(err)) {
      return null;
    }
    throw err;
  }
}

async function loadOpeningFiscalYearFromDb(
  client?: PoolClient
): Promise<number | null> {
  const row = await loadSettingsRow(client);
  if (!row) return null;
  const fy = Math.floor(Number(row.opening_fiscal_year));
  if (!Number.isFinite(fy) || fy < 2000) return null;
  return fy;
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

/**
 * Defaults first-system date to Shrawan 1 of the opening FY when only the
 * opening fiscal year is configured (fiscal-year-boundary migration).
 */
export function defaultFirstSystemDepreciationDateBs(
  openingFiscalYear: number
): string {
  return fiscalYearStartBs(openingFiscalYear);
}

export function deriveLastExternalDepreciationDateBs(
  firstSystemDepreciationDateBs: string
): string | null {
  return dayBeforeBsDate(firstSystemDepreciationDateBs);
}

export function validateDepreciationMigrationDates(input: {
  openingFiscalYear: number;
  firstSystemDepreciationDateBs: string;
  lastExternalDepreciationDateBs?: string | null;
}): {
  openingFiscalYear: number;
  firstSystemDepreciationDateBs: string;
  lastExternalDepreciationDateBs: string | null;
} {
  const openingFy = Math.floor(input.openingFiscalYear);
  if (!Number.isFinite(openingFy) || openingFy < 2000) {
    throw new Error("Opening fiscal year must be an integer ≥ 2000.");
  }

  const firstSystem = normalizeBsDateEnglish(
    input.firstSystemDepreciationDateBs.trim()
  );
  if (!firstSystem) {
    throw new Error(
      "First system depreciation date must be a valid Bikram Sambat date."
    );
  }

  const fyOfFirst = fiscalYearStartFromBsDate(firstSystem);
  if (fyOfFirst == null) {
    throw new Error(
      "First system depreciation date must be a valid Bikram Sambat date."
    );
  }
  if (fyOfFirst !== openingFy) {
    throw new Error(
      `First system depreciation date must fall within opening fiscal year ${openingFy}-${openingFy + 1}.`
    );
  }

  let lastExternal: string | null = null;
  const rawLast = input.lastExternalDepreciationDateBs;
  if (rawLast != null && String(rawLast).trim() !== "") {
    lastExternal = normalizeBsDateEnglish(String(rawLast).trim());
    if (!lastExternal) {
      throw new Error(
        "Last externally processed date must be a valid Bikram Sambat date."
      );
    }
    const expectedFirst = dayAfterBsDate(lastExternal);
    if (expectedFirst == null || expectedFirst !== firstSystem) {
      throw new Error(
        "Last externally processed date must be the day immediately before the first system depreciation date."
      );
    }
  } else {
    lastExternal = deriveLastExternalDepreciationDateBs(firstSystem);
  }

  return {
    openingFiscalYear: openingFy,
    firstSystemDepreciationDateBs: firstSystem,
    lastExternalDepreciationDateBs: lastExternal,
  };
}

/**
 * Resolves opening FY + first-system date from DB (preferred) or env fallbacks.
 * Returns null when opening FY cannot be resolved.
 */
export async function resolveDepreciationMigrationSettings(
  client?: PoolClient
): Promise<DepreciationMigrationSettings | null> {
  const row = await loadSettingsRow(client);
  if (row) {
    const openingFy = Math.floor(Number(row.opening_fiscal_year));
    if (!Number.isFinite(openingFy) || openingFy < 2000) {
      return null;
    }
    const firstFromRow =
      row.first_system_depreciation_date_bs != null &&
      String(row.first_system_depreciation_date_bs).trim() !== ""
        ? normalizeBsDateEnglish(String(row.first_system_depreciation_date_bs))
        : null;
    const firstSystem =
      firstFromRow ?? defaultFirstSystemDepreciationDateBs(openingFy);
    const validated = validateDepreciationMigrationDates({
      openingFiscalYear: openingFy,
      firstSystemDepreciationDateBs: firstSystem,
      lastExternalDepreciationDateBs:
        row.last_external_depreciation_date_bs ?? null,
    });
    return {
      ...validated,
      source: "database",
    };
  }

  const envOpening = getDepreciationOpeningFiscalYearFromEnv();
  if (envOpening == null) {
    return null;
  }
  const envFirst =
    getDepreciationFirstSystemDateFromEnv() ??
    defaultFirstSystemDepreciationDateBs(envOpening);
  const validated = validateDepreciationMigrationDates({
    openingFiscalYear: envOpening,
    firstSystemDepreciationDateBs: envFirst,
    lastExternalDepreciationDateBs: null,
  });
  return {
    ...validated,
    source: "env",
  };
}

export async function requireDepreciationMigrationSettings(
  client?: PoolClient
): Promise<DepreciationMigrationSettings> {
  const settings = await resolveDepreciationMigrationSettings(client);
  if (!settings) {
    throw new Error(DEPRECIATION_OPENING_FY_NOT_CONFIGURED_MESSAGE);
  }
  return settings;
}

/**
 * First-system date applies only in the opening fiscal year.
 * Later FYs ignore the migration date and use normal FY-start rules.
 */
export function firstSystemDateForFiscalYear(
  migration: DepreciationMigrationSettings | null,
  fiscalYearStart: number
): string | null {
  if (!migration) return null;
  if (Math.floor(fiscalYearStart) !== migration.openingFiscalYear) {
    return null;
  }
  return migration.firstSystemDepreciationDateBs;
}

export function assertDepreciationPeriodEligibleForSystemMigration(params: {
  periodEndBs: string;
  fiscalYearStart: number;
  migration: DepreciationMigrationSettings | null;
}): void {
  const firstSystem = firstSystemDateForFiscalYear(
    params.migration,
    params.fiscalYearStart
  );
  if (!firstSystem) return;
  if (compareBsDateString(params.periodEndBs, firstSystem) < 0) {
    throw new Error(DEPRECIATION_PERIOD_BEFORE_MIGRATION_MESSAGE);
  }
}

export async function hasDepreciationOpeningFyLock(
  openingFiscalYear?: number | null,
  client?: PoolClient
): Promise<{
  locked: boolean;
  reason: string | null;
}> {
  try {
    const runQuery = client?.query.bind(client) ?? query;
    const storedOpening = await getDepreciationOpeningFiscalYear(client);
    const openingFy =
      openingFiscalYear !== undefined && openingFiscalYear !== null
        ? openingFiscalYear
        : storedOpening;
    const fyParams =
      storedOpening != null &&
      openingFy != null &&
      storedOpening !== openingFy
        ? [storedOpening, openingFy]
        : openingFy != null
          ? [openingFy]
          : storedOpening != null
            ? [storedOpening]
            : [];

    const r = await runQuery<{
      opening_history_exists: boolean;
      rollover_exists: boolean;
    }>(
      fyParams.length === 0
        ? `SELECT
             EXISTS (
               SELECT 1 FROM hrms_depreciation_runs
               WHERE status IN ('draft', 'review_pending', 'posted', 'void')
             ) AS opening_history_exists,
             EXISTS (
               SELECT 1 FROM hrms_depreciation_fy_rollovers
             ) AS rollover_exists`
        : fyParams.length === 1
          ? `SELECT
               EXISTS (
                 SELECT 1 FROM hrms_depreciation_runs
                 WHERE fiscal_year_start = $1
                   AND status IN ('draft', 'review_pending', 'posted', 'void')
               ) OR EXISTS (
                 SELECT 1
                 FROM hrms_depreciation_run_details d
                 INNER JOIN hrms_depreciation_runs r
                   ON r.id = d.depreciation_run_id
                 WHERE r.fiscal_year_start = $1
               ) AS opening_history_exists,
               EXISTS (
                 SELECT 1 FROM hrms_depreciation_fy_rollovers
               ) AS rollover_exists`
          : `SELECT
               EXISTS (
                 SELECT 1 FROM hrms_depreciation_runs
                 WHERE fiscal_year_start = ANY($1::int[])
                   AND status IN ('draft', 'review_pending', 'posted', 'void')
               ) OR EXISTS (
                 SELECT 1
                 FROM hrms_depreciation_run_details d
                 INNER JOIN hrms_depreciation_runs r
                   ON r.id = d.depreciation_run_id
                 WHERE r.fiscal_year_start = ANY($1::int[])
               ) AS opening_history_exists,
               EXISTS (
                 SELECT 1 FROM hrms_depreciation_fy_rollovers
               ) AS rollover_exists`,
      fyParams.length === 0
        ? []
        : fyParams.length === 1
          ? [fyParams[0]]
          : [fyParams]
    );
    const row = r.rows[0];
    if (!row) {
      return { locked: false, reason: null };
    }
    if (row.opening_history_exists) {
      return {
        locked: true,
        reason:
          openingFy != null
            ? `Depreciation migration settings cannot be changed after opening fiscal year ${openingFy} depreciation accounting history exists (including voided posted runs).`
            : "Depreciation migration settings cannot be changed after depreciation accounting history exists.",
      };
    }
    if (row.rollover_exists) {
      return {
        locked: true,
        reason:
          "Depreciation migration settings cannot be changed after a fiscal year rollover has been applied.",
      };
    }
    return { locked: false, reason: null };
  } catch (err) {
    if (isMissingRelationError(err)) {
      return { locked: false, reason: null };
    }
    throw err;
  }
}

export async function getDepreciationSettingsView(): Promise<DepreciationSettingsView> {
  const [row, envOpening, envFirst] = await Promise.all([
    loadSettingsRow(),
    Promise.resolve(getDepreciationOpeningFiscalYearFromEnv()),
    Promise.resolve(getDepreciationFirstSystemDateFromEnv()),
  ]);

  const openingForLock = row?.opening_fiscal_year ?? envOpening;
  const lock = await hasDepreciationOpeningFyLock(openingForLock);

  if (row) {
    const openingFy = row.opening_fiscal_year;
    const firstSystem =
      row.first_system_depreciation_date_bs != null &&
      String(row.first_system_depreciation_date_bs).trim() !== ""
        ? normalizeBsDateEnglish(String(row.first_system_depreciation_date_bs))
        : defaultFirstSystemDepreciationDateBs(openingFy);
    const lastExternal =
      row.last_external_depreciation_date_bs != null &&
      String(row.last_external_depreciation_date_bs).trim() !== ""
        ? normalizeBsDateEnglish(String(row.last_external_depreciation_date_bs))
        : deriveLastExternalDepreciationDateBs(firstSystem ?? "");
    return {
      openingFiscalYear: openingFy,
      firstSystemDepreciationDateBs: firstSystem,
      lastExternalDepreciationDateBs: lastExternal,
      source: "database",
      configuredByAdminId: row.configured_by_admin_id,
      configuredByAdminEmail: row.configured_by_admin_email,
      configuredAt: row.configured_at,
      editable: !lock.locked,
      lockReason: lock.locked ? lock.reason : null,
    };
  }

  if (envOpening !== null) {
    const firstSystem =
      envFirst ?? defaultFirstSystemDepreciationDateBs(envOpening);
    return {
      openingFiscalYear: envOpening,
      firstSystemDepreciationDateBs: firstSystem,
      lastExternalDepreciationDateBs:
        deriveLastExternalDepreciationDateBs(firstSystem),
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
    firstSystemDepreciationDateBs: null,
    lastExternalDepreciationDateBs: null,
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
              first_system_depreciation_date_bs,
              previous_first_system_depreciation_date_bs,
              last_external_depreciation_date_bs,
              previous_last_external_depreciation_date_bs,
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
    if (isMissingRelationError(err)) {
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
    firstSystemDepreciationDateBs: string;
    previousFirstSystemDepreciationDateBs: string | null;
    lastExternalDepreciationDateBs: string | null;
    previousLastExternalDepreciationDateBs: string | null;
    actor: DepreciationRunActor;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO hrms_depreciation_settings_audit_logs (
      action,
      opening_fiscal_year,
      previous_opening_fiscal_year,
      first_system_depreciation_date_bs,
      previous_first_system_depreciation_date_bs,
      last_external_depreciation_date_bs,
      previous_last_external_depreciation_date_bs,
      configured_by_admin_id,
      configured_by_admin_email,
      configured_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      input.action,
      input.openingFiscalYear,
      input.previousOpeningFiscalYear,
      input.firstSystemDepreciationDateBs,
      input.previousFirstSystemDepreciationDateBs,
      input.lastExternalDepreciationDateBs,
      input.previousLastExternalDepreciationDateBs,
      input.actor.adminId,
      input.actor.adminEmail,
    ]
  );
}

export async function upsertDepreciationSettings(input: {
  openingFiscalYear: number | string;
  firstSystemDepreciationDateBs?: string | null;
  lastExternalDepreciationDateBs?: string | null;
  actor: DepreciationRunActor;
}): Promise<DepreciationSettingsView> {
  const openingFy = parseOpeningFiscalYearInput(input.openingFiscalYear);
  const firstRaw =
    input.firstSystemDepreciationDateBs != null &&
    String(input.firstSystemDepreciationDateBs).trim() !== ""
      ? String(input.firstSystemDepreciationDateBs).trim()
      : defaultFirstSystemDepreciationDateBs(openingFy);
  const validated = validateDepreciationMigrationDates({
    openingFiscalYear: openingFy,
    firstSystemDepreciationDateBs: firstRaw,
    lastExternalDepreciationDateBs: input.lastExternalDepreciationDateBs,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(DEPRECIATION_SETTINGS_ADVISORY_LOCK_SQL);
    const lock = await hasDepreciationOpeningFyLock(openingFy, client);
    if (lock.locked) {
      throw new Error(
        lock.reason ??
          "Depreciation migration settings cannot be changed after depreciation processing has started."
      );
    }

    const existing = await client.query<{
      opening_fiscal_year: number;
      first_system_depreciation_date_bs: string | null;
      last_external_depreciation_date_bs: string | null;
    }>(
      `SELECT opening_fiscal_year,
              first_system_depreciation_date_bs,
              last_external_depreciation_date_bs
       FROM hrms_depreciation_settings
       WHERE id = 1
       FOR UPDATE`
    );
    const previousRow = existing.rows[0] ?? null;
    const previousOpening = previousRow?.opening_fiscal_year ?? null;
    const previousFirst =
      previousRow?.first_system_depreciation_date_bs != null &&
      String(previousRow.first_system_depreciation_date_bs).trim() !== ""
        ? normalizeBsDateEnglish(
            String(previousRow.first_system_depreciation_date_bs)
          )
        : previousOpening != null
          ? defaultFirstSystemDepreciationDateBs(previousOpening)
          : null;
    const previousLast =
      previousRow?.last_external_depreciation_date_bs != null &&
      String(previousRow.last_external_depreciation_date_bs).trim() !== ""
        ? normalizeBsDateEnglish(
            String(previousRow.last_external_depreciation_date_bs)
          )
        : previousFirst
          ? deriveLastExternalDepreciationDateBs(previousFirst)
          : null;

    const unchanged =
      previousOpening === validated.openingFiscalYear &&
      previousFirst === validated.firstSystemDepreciationDateBs &&
      previousLast === validated.lastExternalDepreciationDateBs;

    if (unchanged) {
      await client.query("COMMIT");
      return getDepreciationSettingsView();
    }

    if (previousRow == null) {
      await client.query(
        `INSERT INTO hrms_depreciation_settings (
          id,
          opening_fiscal_year,
          first_system_depreciation_date_bs,
          last_external_depreciation_date_bs,
          configured_by_admin_id,
          configured_by_admin_email,
          configured_at,
          created_at,
          updated_at
        ) VALUES (1, $1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
        [
          validated.openingFiscalYear,
          validated.firstSystemDepreciationDateBs,
          validated.lastExternalDepreciationDateBs,
          input.actor.adminId,
          input.actor.adminEmail,
        ]
      );
      await insertSettingsAudit(client, {
        action: "CREATED",
        openingFiscalYear: validated.openingFiscalYear,
        previousOpeningFiscalYear: null,
        firstSystemDepreciationDateBs: validated.firstSystemDepreciationDateBs,
        previousFirstSystemDepreciationDateBs: null,
        lastExternalDepreciationDateBs: validated.lastExternalDepreciationDateBs,
        previousLastExternalDepreciationDateBs: null,
        actor: input.actor,
      });
    } else {
      await client.query(
        `UPDATE hrms_depreciation_settings
         SET opening_fiscal_year = $1,
             first_system_depreciation_date_bs = $2,
             last_external_depreciation_date_bs = $3,
             configured_by_admin_id = $4,
             configured_by_admin_email = $5,
             configured_at = NOW(),
             updated_at = NOW()
         WHERE id = 1`,
        [
          validated.openingFiscalYear,
          validated.firstSystemDepreciationDateBs,
          validated.lastExternalDepreciationDateBs,
          input.actor.adminId,
          input.actor.adminEmail,
        ]
      );
      await insertSettingsAudit(client, {
        action: "UPDATED",
        openingFiscalYear: validated.openingFiscalYear,
        previousOpeningFiscalYear: previousOpening,
        firstSystemDepreciationDateBs: validated.firstSystemDepreciationDateBs,
        previousFirstSystemDepreciationDateBs: previousFirst,
        lastExternalDepreciationDateBs: validated.lastExternalDepreciationDateBs,
        previousLastExternalDepreciationDateBs: previousLast,
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
