import type { PoolClient } from "pg";
import { pool, query } from "../db.js";
import { createLogger } from "../logger.js";
import {
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import {
  getDepreciationSettingsView,
  getDepreciationPriorFyStrictCarryForwardFloor,
} from "./depreciationSettings.js";
import {
  depreciationOpeningFyHelpText,
  getDepreciationOpeningFiscalYear,
  getServerTodayBsEnglish,
  grossDepreciableAmountForRun,
  isDepreciableAssetEligibleForDepreciationSchedule,
  loadDepreciationScheduleAssetsForBranch,
  recordDepreciationAudit,
  type DepreciationRunActor,
  type DepreciationScheduleAssetRow,
} from "./depreciationRuns.js";

const log = createLogger("depreciationFyRollover");

const ROLLOVER_LOCK_LABEL = "hrms_depr_fy_rollover";

export const PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE =
  "PRIOR_FY_FINAL_DEPRECIATION_REQUIRED";

export class PriorFyFinalDepreciationRequiredError extends Error {
  readonly code = PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE;

  constructor(message?: string) {
    super(
      message ??
        "Prior fiscal year final depreciation must be created and posted before rollover."
    );
    this.name = "PriorFyFinalDepreciationRequiredError";
  }
}

export type DepreciationFyRolloverRunDetailRow = {
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  balance_amount: string | null;
};

export type FyRolloverStatus =
  | "blocked"
  | "pending"
  | "completed"
  | "not_required";

export type DepreciationFyRolloverStatus = {
  currentBsDate: string | null;
  currentFiscalYearStart: number;
  priorFiscalYearStart: number;
  status: FyRolloverStatus;
  priorFyFinalRunId: number | null;
  priorFyFinalRunStatus: string | null;
  priorFyFinalRunTitle?: string | null;
  blockers: string[];
  rolloverAllowed: boolean;
  blockingReason: string | null;
  sourceFinalRunId?: number | null;
  completedAt?: string | null;
  completedByAdminId?: number | null;
  completedByAdminEmail?: string | null;
  depreciationOpeningFiscalYearStart?: number | null;
  depreciationOpeningFyHelpText?: string | null;
  migrationSettings?: {
    openingFiscalYearStart: number | null;
    firstSystemDepreciationDateBs: string | null;
    lastExternalDepreciationDateBs: string | null;
    source: "database" | "env" | "none";
    configuredByAdminId: number | null;
    configuredByAdminEmail: string | null;
    configuredAt: string | null;
    editable: boolean;
    lockReason: string | null;
  };
};

type PriorFyFinalRunSnapshot = {
  id: number;
  status: string;
  dep_title: string | null;
};

type FyRolloverMarkerSnapshot = {
  id: number;
  source_final_run_id: number;
  created_at: string;
};

type FyRolloverAppliedAuditSnapshot = {
  actor_admin_id: number | null;
  actor_admin_email: string;
  created_at: string;
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
 * Pure status resolver for FY rollover (testable without DB).
 */
export function resolveFyRolloverStatus(input: {
  currentBsDate: string | null;
  currentFiscalYearStart: number;
  priorFiscalYearStart: number;
  rolloverApplied: boolean;
  priorFyFinalRun: PriorFyFinalRunSnapshot | null;
  priorFyStrictCarryForwardFloor: number;
}): DepreciationFyRolloverStatus {
  const blockers: string[] = [];
  const priorFyFinalRunId = input.priorFyFinalRun?.id ?? null;

  if (input.priorFiscalYearStart < input.priorFyStrictCarryForwardFloor) {
    // Prior FY was before system-managed opening FY: do not report it as "missing".
    return {
      currentBsDate: input.currentBsDate,
      currentFiscalYearStart: input.currentFiscalYearStart,
      priorFiscalYearStart: input.priorFiscalYearStart,
      status: "not_required",
      priorFyFinalRunId: null,
      priorFyFinalRunStatus: "not_applicable",
      priorFyFinalRunTitle: null,
      blockers,
      rolloverAllowed: false,
      blockingReason: null,
    };
  }

  if (input.rolloverApplied) {
    return {
      currentBsDate: input.currentBsDate,
      currentFiscalYearStart: input.currentFiscalYearStart,
      priorFiscalYearStart: input.priorFiscalYearStart,
      status: "completed",
      priorFyFinalRunId,
      priorFyFinalRunStatus: input.priorFyFinalRun?.status ?? null,
      priorFyFinalRunTitle: input.priorFyFinalRun?.dep_title ?? null,
      blockers,
      rolloverAllowed: false,
      blockingReason: null,
    };
  }

  if (!input.priorFyFinalRun) {
    blockers.push(PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE);
    return {
      currentBsDate: input.currentBsDate,
      currentFiscalYearStart: input.currentFiscalYearStart,
      priorFiscalYearStart: input.priorFiscalYearStart,
      status: "blocked",
      priorFyFinalRunId: null,
      priorFyFinalRunStatus: null,
      priorFyFinalRunTitle: null,
      blockers,
      rolloverAllowed: false,
      blockingReason:
        "Previous FY_END depreciation has not been created yet. Create and review the prior fiscal year final run before rollover.",
    };
  }

  if (input.priorFyFinalRun.status === "draft" || input.priorFyFinalRun.status === "review_pending") {
    blockers.push("PRIOR_FY_FINAL_DEPRECIATION_NOT_POSTED");
    return {
      currentBsDate: input.currentBsDate,
      currentFiscalYearStart: input.currentFiscalYearStart,
      priorFiscalYearStart: input.priorFiscalYearStart,
      status: "blocked",
      priorFyFinalRunId,
      priorFyFinalRunStatus: input.priorFyFinalRun.status,
      priorFyFinalRunTitle: input.priorFyFinalRun.dep_title ?? null,
      blockers,
      rolloverAllowed: false,
      blockingReason:
        "Previous FY_END depreciation exists but is not posted yet. Review and post it before rollover.",
    };
  }

  if (input.priorFyFinalRun.status !== "posted") {
    blockers.push(PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE);
    return {
      currentBsDate: input.currentBsDate,
      currentFiscalYearStart: input.currentFiscalYearStart,
      priorFiscalYearStart: input.priorFiscalYearStart,
      status: "blocked",
      priorFyFinalRunId,
      priorFyFinalRunStatus: input.priorFyFinalRun.status,
      priorFyFinalRunTitle: input.priorFyFinalRun.dep_title ?? null,
      blockers,
      rolloverAllowed: false,
      blockingReason:
        "Previous FY_END depreciation is not in a posted state. Only a posted final run can be rolled over.",
    };
  }

  return {
    currentBsDate: input.currentBsDate,
    currentFiscalYearStart: input.currentFiscalYearStart,
    priorFiscalYearStart: input.priorFiscalYearStart,
    status: "pending",
    priorFyFinalRunId,
    priorFyFinalRunStatus: input.priorFyFinalRun.status,
    priorFyFinalRunTitle: input.priorFyFinalRun.dep_title ?? null,
    blockers,
    rolloverAllowed: true,
    blockingReason: null,
  };
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

async function getLatestPriorFyFinalRun(
  priorFiscalYearStart: number,
  branchId: number | null
): Promise<PriorFyFinalRunSnapshot | null> {
  const r = await query<{ id: number; status: string; dep_title: string | null }>(
    `SELECT id, status, dep_title FROM hrms_depreciation_runs r
     WHERE r.fiscal_year_start = $1
       AND COALESCE(r.branch_id, -1) = COALESCE($2::integer, -1)
       AND r.is_final_for_fy = true
       AND r.depreciation_scope_mode = 'FY_END'
       AND r.status <> 'void'
     ORDER BY r.id DESC
     LIMIT 1`,
    [priorFiscalYearStart, branchId]
  );
  return r.rows[0] ?? null;
}

async function getFyRolloverMarker(
  newFiscalYearStart: number,
  branchId: number | null
): Promise<FyRolloverMarkerSnapshot | null> {
  const r = await query<FyRolloverMarkerSnapshot>(
    `SELECT id, source_final_run_id, created_at::text
     FROM hrms_depreciation_fy_rollovers
     WHERE new_fiscal_year_start = $1
       AND COALESCE(branch_id, -1) = COALESCE($2::integer, -1)
     ORDER BY id DESC
     LIMIT 1`,
    [newFiscalYearStart, branchId]
  );
  return r.rows[0] ?? null;
}

async function getFyRolloverAppliedAudit(
  newFiscalYearStart: number,
  sourceFinalRunId: number | null
): Promise<FyRolloverAppliedAuditSnapshot | null> {
  if (sourceFinalRunId === null) {
    return null;
  }
  const r = await query<FyRolloverAppliedAuditSnapshot>(
    `SELECT actor_admin_id, actor_admin_email, created_at::text
     FROM hrms_depreciation_run_audit_logs
     WHERE depreciation_run_id = $1
       AND action = 'FY_ROLLOVER_APPLIED'
       AND metadata ->> 'newFiscalYearStart' = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [sourceFinalRunId, String(newFiscalYearStart)]
  );
  return r.rows[0] ?? null;
}

async function withDepreciationOpeningFyFields(
  status: DepreciationFyRolloverStatus
): Promise<DepreciationFyRolloverStatus> {
  const [opening, settings] = await Promise.all([
    getDepreciationOpeningFiscalYear(),
    getDepreciationSettingsView(),
  ]);
  const migrationSettings = {
    openingFiscalYearStart: settings.openingFiscalYear,
    firstSystemDepreciationDateBs: settings.firstSystemDepreciationDateBs,
    lastExternalDepreciationDateBs: settings.lastExternalDepreciationDateBs,
    source: settings.source,
    configuredByAdminId: settings.configuredByAdminId,
    configuredByAdminEmail: settings.configuredByAdminEmail,
    configuredAt: settings.configuredAt,
    editable: settings.editable,
    lockReason: settings.lockReason,
  } as const;
  if (opening === null) {
    return {
      ...status,
      migrationSettings,
    };
  }
  return {
    ...status,
    depreciationOpeningFiscalYearStart: opening,
    depreciationOpeningFyHelpText: depreciationOpeningFyHelpText(opening),
    migrationSettings,
  };
}

async function isRolloverApplied(
  newFiscalYearStart: number,
  branchId: number | null
): Promise<boolean> {
  const r = await query<{ id: number }>(
    `SELECT id FROM hrms_depreciation_fy_rollovers
     WHERE new_fiscal_year_start = $1
       AND COALESCE(branch_id, -1) = COALESCE($2::integer, -1)
     LIMIT 1`,
    [newFiscalYearStart, branchId]
  );
  return Boolean(r.rows[0]);
}

function resolveCurrentFiscalYearFromServer(
  asOfDateBs?: string | null
): number | null {
  const bsRaw = resolveCurrentBsDate(asOfDateBs);
  if (!bsRaw) return null;
  return fiscalYearStartFromBsDate(bsRaw);
}

function resolveCurrentBsDate(asOfDateBs?: string | null): string | null {
  const bsRaw = asOfDateBs?.trim() || getServerTodayBsEnglish();
  if (!bsRaw) return null;
  const bs = normalizeBsDateEnglish(bsRaw.trim());
  if (!bs) return null;
  return bs;
}

/** Returns FY rollover workflow status for the current server BS fiscal year. */
export async function getDepreciationFyRolloverStatus(input?: {
  branchId?: number | null;
  /** E2E only: treat this BS date as “today” for current-FY detection. */
  asOfDateBs?: string | null;
}): Promise<DepreciationFyRolloverStatus> {
  const currentBsDate = resolveCurrentBsDate(input?.asOfDateBs);
  const currentFy = resolveCurrentFiscalYearFromServer(input?.asOfDateBs);
  if (currentFy === null || currentFy < 2001) {
    return withDepreciationOpeningFyFields({
      currentBsDate,
      currentFiscalYearStart: currentFy ?? 0,
      priorFiscalYearStart: (currentFy ?? 0) - 1,
      status: "not_required",
      priorFyFinalRunId: null,
      priorFyFinalRunStatus: "not_applicable",
      priorFyFinalRunTitle: null,
      blockers: [],
      rolloverAllowed: false,
      blockingReason: null,
    });
  }

  const branchId =
    input?.branchId === undefined || input?.branchId === null
      ? null
      : Math.floor(Number(input.branchId));
  if (branchId !== null && (!Number.isFinite(branchId) || branchId < 1)) {
    throw new Error("Invalid branch.");
  }

  const priorFy = currentFy - 1;
  const [rolloverMarker, priorFyFinalRun, priorFyStrictCarryForwardFloor] =
    await Promise.all([
      getFyRolloverMarker(currentFy, branchId),
      getLatestPriorFyFinalRun(priorFy, branchId),
      getDepreciationPriorFyStrictCarryForwardFloor(),
    ]);

  const resolved = await withDepreciationOpeningFyFields(
    resolveFyRolloverStatus({
      currentBsDate,
      currentFiscalYearStart: currentFy,
      priorFiscalYearStart: priorFy,
      rolloverApplied: rolloverMarker !== null,
      priorFyFinalRun,
      priorFyStrictCarryForwardFloor,
    })
  );
  const audit = await getFyRolloverAppliedAudit(
    currentFy,
    rolloverMarker?.source_final_run_id ?? null
  );
  const settingsSource = resolved.migrationSettings?.source ?? "none";
  if (settingsSource === "none") {
    return {
      ...resolved,
      status: "blocked",
      rolloverAllowed: false,
      blockingReason:
        "Depreciation migration settings are not configured. Set the opening fiscal year and first system depreciation date before rollover.",
      blockers: [...resolved.blockers, "DEPRECIATION_SETTINGS_NOT_CONFIGURED"],
    };
  }
  return {
    ...resolved,
    sourceFinalRunId:
      rolloverMarker?.source_final_run_id ?? priorFyFinalRun?.id ?? null,
    completedAt: audit?.created_at ?? rolloverMarker?.created_at ?? null,
    completedByAdminId: audit?.actor_admin_id ?? null,
    completedByAdminEmail: audit?.actor_admin_email ?? null,
  };
}

async function requirePostedFinalDepreciationRunForYear(input: {
  fiscalYearStart: number;
  branchId?: number | null;
}): Promise<number> {
  const fy = Math.floor(input.fiscalYearStart);
  const branchId =
    input.branchId === undefined || input.branchId === null
      ? null
      : Math.floor(Number(input.branchId));

  const postedId = await getPostedFinalRunId(null, fy, branchId);
  if (postedId !== null) {
    return postedId;
  }

  const latest = await getLatestPriorFyFinalRun(fy, branchId);
  if (latest && (latest.status === "draft" || latest.status === "review_pending")) {
    throw new PriorFyFinalDepreciationRequiredError(
      `Prior fiscal year FY_END depreciation exists as ${latest.status} but is not posted. Post it before rollover.`
    );
  }

  throw new PriorFyFinalDepreciationRequiredError();
}

/**
 * Idempotent depreciation-only fiscal year rollover: after a posted final run exists for
 * `newFiscalYearStart - 1`, copies closing written-down values from that run into
 * `hrms_assets.book_value` and records a single marker row per new FY (+ branch).
 *
 * Does not create or post FY_END depreciation — admin must do that first.
 */
export async function performDepreciationFiscalYearRollover(input: {
  newFiscalYearStart: number;
  branchId?: number | null;
  actor?: DepreciationRunActor;
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
  const floor = await getDepreciationPriorFyStrictCarryForwardFloor();
  if (priorFy < floor) {
    return {
      status: "skipped_no_prior_year",
      newFiscalYearStart: newFy,
      priorFiscalYearStart: priorFy,
      branchId,
      sourceFinalRunId: null,
    };
  }

  let sourceFinalRunId: number;
  try {
    sourceFinalRunId = await requirePostedFinalDepreciationRunForYear({
      fiscalYearStart: priorFy,
      branchId,
    });
  } catch (err) {
    if (err instanceof PriorFyFinalDepreciationRequiredError && input.actor) {
      await recordDepreciationAudit({
        depreciationRunId: null,
        action: "FY_ROLLOVER_BLOCKED",
        actor: input.actor,
        metadata: {
          newFiscalYearStart: newFy,
          priorFiscalYearStart: priorFy,
          branchId,
          code: PRIOR_FY_FINAL_DEPRECIATION_REQUIRED_CODE,
        },
      });
    }
    throw err;
  }

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

    await recordDepreciationAudit({
      depreciationRunId: sourceFinalRunId,
      action: "FY_ROLLOVER_APPLIED",
      actor: input.actor,
      metadata: {
        newFiscalYearStart: newFy,
        priorFiscalYearStart: priorFy,
        branchId,
        sourceFinalRunId,
      },
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

/** Detects current FY from server BS date; does not run rollover automatically. */
export async function detectDepreciationRolloverForCurrentFiscalYear(): Promise<DepreciationFyRolloverStatus | null> {
  const bsRaw = getServerTodayBsEnglish();
  if (!bsRaw) {
    log.warn("detectDepreciationRolloverForCurrentFiscalYear: no server BS date");
    return null;
  }
  const bs = normalizeBsDateEnglish(bsRaw.trim());
  if (!bs) return null;
  const fy = fiscalYearStartFromBsDate(bs);
  if (fy === null) return null;
  return getDepreciationFyRolloverStatus({ branchId: null });
}
