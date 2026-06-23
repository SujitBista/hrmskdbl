import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { createLogger } from "../logger.js";
import {
  bsDateFromJsDate,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import type { DepreciationFyRolloverStatus } from "./depreciationFyRollover.js";
import { detectDepreciationRolloverForCurrentFiscalYear } from "./depreciationFyRollover.js";

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
  /** FY rollover workflow status for the current BS fiscal year (detection only; no auto-rollover). */
  fyRolloverStatus: DepreciationFyRolloverStatus | null;
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
 * Fiscal-year automation: detects FY rollover status from server BS date only.
 * Does not create, post, or apply FY_END depreciation or rollover automatically.
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
      fyRolloverStatus: null,
      ranWithTransactionLock: false,
    };
  }

  let fyRolloverStatus: DepreciationFyRolloverStatus | null = null;
  try {
    fyRolloverStatus = await detectDepreciationRolloverForCurrentFiscalYear();
  } catch (err) {
    log.error("ensureCurrentFiscalYearAutomation: status detection failed", err, {
      fiscalYearStart,
    });
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await withFiscalYearAutomationLock(client, fiscalYearStart, async () => {
      log.info("ensureCurrentFiscalYearAutomation: inside FY advisory lock", {
        fiscalYearStart,
        currentBsDate,
        nowAdIso,
        fyRolloverStatus: fyRolloverStatus?.status,
      });
    });
    await client.query("COMMIT");
    return {
      nowAdIso,
      currentBsDate,
      fiscalYearStart,
      fyRolloverStatus,
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

