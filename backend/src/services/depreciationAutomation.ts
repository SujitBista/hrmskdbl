import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { createLogger } from "../logger.js";
import {
  bsDateFromJsDate,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import type { DepreciationFyRolloverResult } from "./depreciationFyRollover.js";
import { performDepreciationRolloverForCurrentFiscalYear } from "./depreciationFyRollover.js";

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
  /** Result of idempotent FY depreciation rollover for the current BS fiscal year, if applicable. */
  depreciationRollover: DepreciationFyRolloverResult | null;
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
 * Fiscal-year automation: runs idempotent depreciation rollover (carry-forward
 * register WDV from the prior FY’s posted final run) in its own transaction, then
 * takes a short transaction + `pg_advisory_xact_lock` per fiscal year for any
 * additional serialized work.
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
      depreciationRollover: null,
      ranWithTransactionLock: false,
    };
  }

  let depreciationRollover: DepreciationFyRolloverResult | null = null;
  try {
    depreciationRollover =
      await performDepreciationRolloverForCurrentFiscalYear();
  } catch (err) {
    log.error("ensureCurrentFiscalYearAutomation: rollover failed", err, {
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
        depreciationRolloverStatus: depreciationRollover?.status,
      });
    });
    await client.query("COMMIT");
    return {
      nowAdIso,
      currentBsDate,
      fiscalYearStart,
      depreciationRollover,
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

