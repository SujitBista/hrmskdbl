import type { PoolClient } from "pg";
import { pool, query } from "../db.js";
import { createLogger } from "../logger.js";
import {
  fiscalYearEndBs,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import {
  createDepreciationRun,
  getServerTodayBsEnglish,
  grossDepreciableAmountForRun,
  isDepreciableAssetEligibleForDepreciationSchedule,
  loadDepreciationScheduleAssetsForBranch,
  type DepreciationScheduleAssetRow,
} from "./depreciationRuns.js";

const log = createLogger("depreciationFyRollover");

const ROLLOVER_LOCK_LABEL = "hrms_depr_fy_rollover";

export type DepreciationFyRolloverRunDetailRow = {
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  balance_amount: string | null;
};

function formatAssetLabel(a: {
  id: number;
  asset_code: string | null;
  asset_name: string;
}): string {
  const code =
    a.asset_code != null && String(a.asset_code).trim() !== ""
      ? String(a.asset_code).trim()
      : null;
  const name =
    a.asset_name != null && String(a.asset_name).trim() !== ""
      ? String(a.asset_name).trim()
      : "(unnamed)";
  return code ? `${code} — ${name}` : `#${a.id} — ${name}`;
}

function formatRunDetailLabel(d: DepreciationFyRolloverRunDetailRow): string {
  return formatAssetLabel({
    id: d.asset_id,
    asset_code: d.asset_code,
    asset_name: d.asset_name,
  });
}

function parseClosingBalanceAmount(raw: string | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Validates that FY rollover can copy prior FY final `balance_amount` values into
 * `hrms_assets.book_value` without omitting schedule-eligible assets or applying
 * invalid balances. Throws a single `Error` with a clear, multi-sentence message.
 */
export function assertDepreciationFyRolloverPreconditions(input: {
  depreciableAssets: DepreciationScheduleAssetRow[];
  runDetails: DepreciationFyRolloverRunDetailRow[];
}): void {
  const detailByAssetId = new Map<number, DepreciationFyRolloverRunDetailRow>();
  for (const d of input.runDetails) {
    detailByAssetId.set(d.asset_id, d);
  }

  const missingFromRun: DepreciationScheduleAssetRow[] = [];
  for (const a of input.depreciableAssets) {
    if (!detailByAssetId.has(a.id)) {
      missingFromRun.push(a);
    }
  }

  const invalidBalance: DepreciationFyRolloverRunDetailRow[] = [];
  for (const d of input.runDetails) {
    const bal = parseClosingBalanceAmount(d.balance_amount);
    if (bal === null || bal < 0) {
      invalidBalance.push(d);
    }
  }

  const missingCostBasis: DepreciationScheduleAssetRow[] = [];
  for (const a of input.depreciableAssets) {
    const gross = grossDepreciableAmountForRun(
      a.book_value,
      a.purchase_qty,
      a.unit_rate,
      a.old_book_value
    );
    if (gross === null || gross <= 0) {
      missingCostBasis.push(a);
    }
  }

  if (
    missingFromRun.length === 0 &&
    invalidBalance.length === 0 &&
    missingCostBasis.length === 0
  ) {
    return;
  }

  const parts: string[] = [
    "Fiscal year depreciation rollover blocked.",
  ];
  if (missingFromRun.length > 0) {
    parts.push(
      `${missingFromRun.length} schedule-eligible asset(s) are missing from the prior fiscal year posted final run (rollover will not partially update the register): ${missingFromRun.map(formatAssetLabel).join("; ")}.`
    );
  }
  if (invalidBalance.length > 0) {
    parts.push(
      `${invalidBalance.length} final run line(s) have a missing or invalid closing balance (balance_amount must be a finite number ≥ 0): ${invalidBalance.map(formatRunDetailLabel).join("; ")}.`
    );
  }
  if (missingCostBasis.length > 0) {
    parts.push(
      `${missingCostBasis.length} asset(s) no longer have a resolvable original gross depreciable cost (purchase_qty × unit_rate, or legacy old_book_value / register book_value fallback): ${missingCostBasis.map(formatAssetLabel).join("; ")}.`
    );
  }
  throw new Error(parts.join(" "));
}

async function loadFyRolloverRunDetailRows(
  client: PoolClient,
  depreciationRunId: number,
  branchId: number | null
): Promise<DepreciationFyRolloverRunDetailRow[]> {
  const r = await client.query<DepreciationFyRolloverRunDetailRow>(
    `SELECT d.asset_id,
            a.asset_code,
            COALESCE(NULLIF(TRIM(d.asset_name), ''), a.asset_name) AS asset_name,
            d.balance_amount::text AS balance_amount
     FROM hrms_depreciation_run_details d
     INNER JOIN hrms_assets a ON a.id = d.asset_id
     WHERE d.depreciation_run_id = $1
       AND ($2::integer IS NULL OR a.branch_id = $2)
     ORDER BY d.asset_id ASC`,
    [depreciationRunId, branchId]
  );
  return r.rows;
}

export type DepreciationFyRolloverResult = {
  status: "applied" | "already_applied" | "skipped_no_prior_year";
  newFiscalYearStart: number;
  priorFiscalYearStart: number;
  branchId: number | null;
  sourceFinalRunId: number | null;
};

async function getPostedFinalRunId(
  client: PoolClient | null,
  priorFiscalYearStart: number,
  branchId: number | null
): Promise<number | null> {
  const runQuery = client?.query.bind(client) ?? query;
  const r = await runQuery<{ id: number }>(
    `SELECT id FROM hrms_depreciation_runs r
     WHERE r.fiscal_year_start = $1
       AND COALESCE(r.branch_id, -1) = COALESCE($2::integer, -1)
       AND r.is_final_for_fy = true
       AND r.status = 'posted'
     ORDER BY r.id DESC
     LIMIT 1`,
    [priorFiscalYearStart, branchId]
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Ensures a posted FY-end (final) depreciation run exists for the prior fiscal year.
 * Creates a Q4 FY_END run through fiscal year end when missing.
 */
export async function ensurePostedFinalDepreciationRunForYear(input: {
  fiscalYearStart: number;
  branchId?: number | null;
}): Promise<{ runId: number; created: boolean }> {
  const fy = Math.floor(input.fiscalYearStart);
  const branchId =
    input.branchId === undefined || input.branchId === null
      ? null
      : Math.floor(Number(input.branchId));
  if (!Number.isFinite(fy) || fy < 2000) {
    throw new Error("Invalid fiscal year.");
  }
  if (branchId !== null && (!Number.isFinite(branchId) || branchId < 1)) {
    throw new Error("Invalid branch.");
  }

  const existing = await getPostedFinalRunId(null, fy, branchId);
  if (existing !== null) {
    return { runId: existing, created: false };
  }

  const fyEndBs = fiscalYearEndBs(fy);
  const { run } = await createDepreciationRun({
    fiscalYearStart: fy,
    quarterNo: 4,
    fiscalProgressBs: fyEndBs,
    calculationDateBs: fyEndBs,
    depreciationScopeMode: "FY_END",
    branchId,
    depTitle: "Fiscal year closing (rollover)",
    remarks: "Auto-created final depreciation run for fiscal-year rollover.",
    calculationMode: "ERP_ACCURATE",
  });
  return { runId: run.id, created: true };
}

/**
 * Idempotent depreciation-only fiscal year rollover: after a final run exists for
 * `newFiscalYearStart - 1`, copies closing written-down values from that run into
 * `hrms_assets.book_value` and records a single marker row per new FY (+ branch).
 *
 * Uses a transaction-scoped advisory lock plus a unique index so concurrent callers
 * cannot apply the same rollover twice.
 */
export async function performDepreciationFiscalYearRollover(input: {
  newFiscalYearStart: number;
  branchId?: number | null;
}): Promise<DepreciationFyRolloverResult> {
  const newFy = Math.floor(input.newFiscalYearStart);
  const branchId =
    input.branchId === undefined || input.branchId === null
      ? null
      : Math.floor(Number(input.branchId));

  if (!Number.isFinite(newFy) || newFy < 2001) {
    throw new Error("Invalid new fiscal year.");
  }
  if (branchId !== null && (!Number.isFinite(branchId) || branchId < 1)) {
    throw new Error("Invalid branch.");
  }

  const priorFy = newFy - 1;
  if (priorFy < 2000) {
    return {
      status: "skipped_no_prior_year",
      newFiscalYearStart: newFy,
      priorFiscalYearStart: priorFy,
      branchId,
      sourceFinalRunId: null,
    };
  }

  const { runId: sourceFinalRunId } = await ensurePostedFinalDepreciationRunForYear({
    fiscalYearStart: priorFy,
    branchId,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext($1::text),
         ($2::int * 100000) + COALESCE($3::int, -1)
       )`,
      [ROLLOVER_LOCK_LABEL, newFy, branchId]
    );

    const existing = await client.query<{ id: number }>(
      `SELECT id FROM hrms_depreciation_fy_rollovers
       WHERE new_fiscal_year_start = $1
         AND COALESCE(branch_id, -1) = COALESCE($2::integer, -1)
       LIMIT 1
       FOR UPDATE`,
      [newFy, branchId]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return {
        status: "already_applied",
        newFiscalYearStart: newFy,
        priorFiscalYearStart: priorFy,
        branchId,
        sourceFinalRunId,
      };
    }

    const registerRows = await loadDepreciationScheduleAssetsForBranch(
      branchId,
      client
    );
    const depreciableAssets = registerRows.filter(
      isDepreciableAssetEligibleForDepreciationSchedule
    );
    const runDetails = await loadFyRolloverRunDetailRows(
      client,
      sourceFinalRunId,
      branchId
    );
    assertDepreciationFyRolloverPreconditions({
      depreciableAssets,
      runDetails,
    });

    await client.query(
      `UPDATE hrms_assets AS a
       SET book_value = d.balance_amount
       FROM hrms_depreciation_run_details d
       WHERE d.depreciation_run_id = $1
         AND d.asset_id = a.id
         AND ($2::integer IS NULL OR a.branch_id = $2)`,
      [sourceFinalRunId, branchId]
    );

    try {
      await client.query(
        `INSERT INTO hrms_depreciation_fy_rollovers (
          prior_fiscal_year_start,
          new_fiscal_year_start,
          branch_id,
          source_final_run_id
        ) VALUES ($1, $2, $3, $4)`,
        [priorFy, newFy, branchId, sourceFinalRunId]
      );
    } catch (insertErr) {
      const code =
        typeof insertErr === "object" &&
        insertErr !== null &&
        "code" in insertErr
          ? String((insertErr as { code?: unknown }).code ?? "")
          : "";
      if (code === "23505") {
        await client.query("ROLLBACK");
        return {
          status: "already_applied",
          newFiscalYearStart: newFy,
          priorFiscalYearStart: priorFy,
          branchId,
          sourceFinalRunId,
        };
      }
      throw insertErr;
    }

    await client.query("COMMIT");
    log.info("performDepreciationFiscalYearRollover applied", {
      newFy,
      priorFy,
      branchId,
      sourceFinalRunId,
    });
    return {
      status: "applied",
      newFiscalYearStart: newFy,
      priorFiscalYearStart: priorFy,
      branchId,
      sourceFinalRunId,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    log.error("performDepreciationFiscalYearRollover failed", err, {
      newFy,
      branchId,
    });
    throw err;
  } finally {
    client.release();
  }
}

/** Runs FY rollover for the fiscal year containing the server BS “today” date. */
export async function performDepreciationRolloverForCurrentFiscalYear(): Promise<DepreciationFyRolloverResult | null> {
  const bsRaw = getServerTodayBsEnglish();
  if (!bsRaw) {
    log.warn("performDepreciationRolloverForCurrentFiscalYear: no server BS date");
    return null;
  }
  const bs = normalizeBsDateEnglish(bsRaw.trim());
  if (!bs) return null;
  const fy = fiscalYearStartFromBsDate(bs);
  if (fy === null) return null;
  return performDepreciationFiscalYearRollover({ newFiscalYearStart: fy, branchId: null });
}
