import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { createLogger } from "../logger.js";
import {
  bsDateFromJsDate,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";

const log = createLogger("depreciationAutomation");

/**
 * Advisory lock namespace for FY-scoped depreciation automation.
 * Matches the style used in `depreciationRuns.ts` (hashtext + scoped int key)
 * so we can serialize automation with the same operational patterns.
 */
const AUTOMATION_LOCK_LABEL = "hrms_depr_fy_automation";

export type EnsureFiscalYearAutomationResult = {
  nowAdIso: string;
  currentBsDate: string | null;
  fiscalYearStart: number | null;
  /** True when a DB transaction was opened and the FY advisory lock was taken. */
  ranWithTransactionLock: boolean;
};

function resolveCurrentBsDate(): string | null {
  let raw: string;
  try {
    raw = bsDateFromJsDate(new Date());
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err);
    log.error("Could not convert server date to Bikram Sambat.", err, {
      hint,
    });
    return null;
  }
  const normalized = normalizeBsDateEnglish(String(raw).trim());
  if (!normalized) {
    log.warn(
      "Today's BS date normalized to empty; check server calendar data."
    );
    return null;
  }
  return normalized;
}

async function withFiscalYearAutomationLock<T>(
  client: PoolClient,
  fiscalYearStart: number,
  fn: () => Promise<T>
): Promise<T> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1::text), $2::int)`,
    [AUTOMATION_LOCK_LABEL, fiscalYearStart]
  );
  return fn();
}

/**
 * Placeholder entry point for automatic fiscal-year depreciation processing.
 *
 * Uses a short transaction + `pg_advisory_xact_lock` per fiscal year so future
 * idempotent checks / run creation can be added without overlapping writers
 * (cron + manual trigger + future second instance).
 *
 * TODO: Ensure opening run for the current FY when business rules are defined.
 * TODO: Ensure final FY-end run when books-close rules are defined.
 * TODO: Ensure as-of-date snapshots if product requires scheduled snapshots.
 */
export async function ensureCurrentFiscalYearAutomation(): Promise<EnsureFiscalYearAutomationResult> {
  const nowAdIso = new Date().toISOString();
  const currentBsDate = resolveCurrentBsDate();
  const fiscalYearStart =
    currentBsDate != null
      ? fiscalYearStartFromBsDate(currentBsDate)
      : null;

  log.info("ensureCurrentFiscalYearAutomation: detected dates", {
    nowAdIso,
    currentBsDate,
    fiscalYearStart,
  });

  if (fiscalYearStart == null) {
    return {
      nowAdIso,
      currentBsDate,
      fiscalYearStart: null,
      ranWithTransactionLock: false,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await withFiscalYearAutomationLock(client, fiscalYearStart, async () => {
      // Future: idempotent checks (e.g. existing opening / final runs) before mutating.
      // Future: call into depreciation run services when opening/FY logic exists.
      log.info("ensureCurrentFiscalYearAutomation: inside FY advisory lock (placeholder)", {
        fiscalYearStart,
        currentBsDate,
        nowAdIso,
      });
    });
    await client.query("COMMIT");
    return {
      nowAdIso,
      currentBsDate,
      fiscalYearStart,
      ranWithTransactionLock: true,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    log.error("ensureCurrentFiscalYearAutomation failed (rolled back)", err, {
      fiscalYearStart,
      currentBsDate,
    });
    throw err;
  } finally {
    client.release();
  }
}
