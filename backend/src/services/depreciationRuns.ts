import type { PoolClient } from "pg";
import { pool, query } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("depreciationRuns");
import {
  bsDateFromJsDate,
  compareBsDateString,
  computeAssetQuarterCumulative,
  depreciationCommencementFromRegister,
  fiscalQuarterEndBs,
  fiscalQuarterFromNepaliCalendarMonthIndex,
  fiscalYearEndBs,
  fiscalYearStartBs,
  fiscalYearStartFromBsDate,
  NEPALI_MONTHS_ORDERED_EN,
  nepaliCalendarMonthIndexFromBs,
  maxEligibleQuarter,
  nepaliMonthNameToCalendarIndex,
  normalizeBsDateEnglish,
  parseDepreciationMethod,
  parseDepreciationScopeMode,
  type DepreciationCalculationMode,
  type DepreciationScopeMode,
} from "@hrmskdbl/depreciation-core";

export type DepreciationRunRow = {
  id: number;
  fiscal_year_start: number;
  dep_title: string;
  quarter_no: number;
  months_covered: number;
  calculation_date_ad: string;
  calculation_date_bs: string;
  /** FY_END = through selected quarter / FY end; AS_OF_DATE = through calculation date (capped to FY end). */
  depreciation_scope_mode: DepreciationScopeMode;
  remarks: string | null;
  is_final_for_fy: boolean;
  status: string;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
};

export type DepreciationRunDetailRow = {
  id: number;
  depreciation_run_id: number;
  asset_id: number;
  asset_code: string | null;
  asset_status: "ACTIVE" | "DISPOSED";
  disposal_date_bs: string | null;
  fiscal_year: number;
  asset_name: string;
  purchase_date_bs: string;
  actual_purchase_price: string;
  depreciation_cost_basis: string;
  dep_rate: string;
  dep_days: number;
  dep_amount: string;
  group_name: string;
  sub_group_name: string | null;
  branch_name: string;
  book_value: string;
  accumulate_dep: string;
  dep_formula: string;
  dep_start_date_bs: string;
  /** Current `hrms_assets.depreciation_start_date_bs` (register field; updates when asset is edited). */
  register_depreciation_start_bs: string;
  balance_amount: string;
  created_at: string;
};

export type DepreciationRunActor = {
  adminId: number;
  adminEmail: string;
  isSuperAdmin: boolean;
};

/** Register row shape used when deciding whether an asset belongs on a depreciation schedule. */
export type DepreciationScheduleAssetRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_dep_method: string | null;
  group_dep_rate: string | null;
  asset_dep_method: string | null;
  asset_dep_rate: string | null;
  sub_group_name: string | null;
  branch_name: string;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  /** Current carrying amount on the register; preferred depreciation cost basis when set. */
  book_value: string | null;
  old_book_value: string | null;
  asset_status: "ACTIVE" | "DISPOSED";
  disposal_date_bs: string | null;
};

type AssetDepRow = DepreciationScheduleAssetRow;

const ASSET_SELECT = `
  SELECT a.id,
    a.asset_code,
    a.asset_name,
    g.name AS group_name,
    g.dep_method AS group_dep_method,
    g.dep_rate::text AS group_dep_rate,
    a.dep_method_snapshot AS asset_dep_method,
    a.dep_rate_snapshot::text AS asset_dep_rate,
    sg.name AS sub_group_name,
    b.branch_name,
    a.purchase_date_bs,
    a.depreciation_start_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text,
    a.book_value::text,
    a.old_book_value::text,
    a.asset_status,
    disp.disposal_date_bs
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_asset_disposals disp ON disp.asset_id = a.id
`;

function parsePurchaseAmount(
  qty: string | null,
  unitRate: string | null
): number | null {
  if (qty == null || unitRate == null) return null;
  const q = Number.parseFloat(qty);
  const r = Number.parseFloat(unitRate);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  if (q < 0 || r < 0) return null;
  return q * r;
}

/**
 * Gross depreciation base for schedules: qty × unit rate (historical cost) first,
 * then legacy `old_book_value`, then register `book_value` when nothing else exists.
 * Using carrying `book_value` alone as cost made migrated assets lose imported
 * accumulated depreciation (runs treated WDV as original cost).
 */
export function grossDepreciableAmountForRun(
  registerBookValueText: string | null,
  qty: string | null,
  unitRate: string | null,
  legacyOldBookValueText: string | null
): number | null {
  const fromPurchase = parsePurchaseAmount(qty, unitRate);
  if (fromPurchase !== null && fromPurchase > 0) {
    return fromPurchase;
  }
  if (legacyOldBookValueText != null && legacyOldBookValueText !== "") {
    const ob = Number.parseFloat(legacyOldBookValueText);
    if (Number.isFinite(ob) && ob > 0) {
      return ob;
    }
  }
  if (registerBookValueText != null && registerBookValueText !== "") {
    const bv = Number.parseFloat(registerBookValueText);
    if (Number.isFinite(bv) && bv > 0) {
      return bv;
    }
  }
  return null;
}

/** True when the asset would receive a line on a depreciation run (not skipped for validation). */
export function isDepreciableAssetEligibleForDepreciationSchedule(
  a: DepreciationScheduleAssetRow
): boolean {
  if (a.asset_status === "DISPOSED") {
    return false;
  }
  const purchaseAmount = grossDepreciableAmountForRun(
    a.book_value,
    a.purchase_qty,
    a.unit_rate,
    a.old_book_value
  );
  const depRate = parseDepRatePercent(a.asset_dep_rate ?? a.group_dep_rate);
  const method = parseDepreciationMethod(a.asset_dep_method ?? a.group_dep_method);
  const depreciationStartBs = depreciationCommencementFromRegister(
    a.purchase_date_bs,
    a.depreciation_start_date_bs
  );
  return (
    purchaseAmount !== null &&
    depRate !== null &&
    method !== null &&
    purchaseAmount > 0 &&
    depRate > 0 &&
    Boolean(depreciationStartBs)
  );
}

/**
 * Prior accumulated depreciation implied by the register when WDV (`book_value`)
 * is below gross cost (e.g. imported accumulated dep). Passed into quarter compute
 * so accumulated = max(schedule prior, this floor) + this-year slice.
 */
export function registerImpliedPriorAccumulatedDep(
  gross: number,
  registerBookValueText: string | null
): number | undefined {
  if (!(gross > 0)) return undefined;
  if (registerBookValueText == null || registerBookValueText === "") {
    return undefined;
  }
  const bv = Number.parseFloat(registerBookValueText);
  if (!Number.isFinite(bv) || bv <= 0) return undefined;
  const implied = gross - bv;
  if (!(implied > 0)) return undefined;
  return implied > gross ? gross : implied;
}

function parseDepRatePercent(rate: string | null): number | null {
  if (rate == null || rate === "") return null;
  const n = Number.parseFloat(rate);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Loads register rows for depreciation / FY rollover (optional DB client for transactional reads). */
export async function loadDepreciationScheduleAssetsForBranch(
  branchId: number | null,
  client?: PoolClient | null
): Promise<DepreciationScheduleAssetRow[]> {
  const runQuery = client ? client.query.bind(client) : query;
  if (branchId === null) {
    const r = await runQuery<DepreciationScheduleAssetRow>(
      `${ASSET_SELECT} ORDER BY a.id ASC`
    );
    return r.rows;
  }
  const r = await runQuery<DepreciationScheduleAssetRow>(
    `${ASSET_SELECT} WHERE a.branch_id = $1 ORDER BY a.id ASC`,
    [branchId]
  );
  return r.rows;
}

async function loadAssetsForRun(
  branchId: number | null
): Promise<AssetDepRow[]> {
  return loadDepreciationScheduleAssetsForBranch(branchId, null);
}

export async function listDepreciationRuns(params: {
  fiscalYearStart?: number;
}): Promise<DepreciationRunRow[]> {
  if (
    params.fiscalYearStart !== undefined &&
    Number.isFinite(params.fiscalYearStart)
  ) {
    const r = await query<DepreciationRunRow>(
      `SELECT id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode,
        remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text
       FROM hrms_depreciation_runs
       WHERE fiscal_year_start = $1
       ORDER BY fiscal_year_start DESC, quarter_no ASC, id DESC`,
      [params.fiscalYearStart]
    );
    return r.rows;
  }
  const r = await query<DepreciationRunRow>(
    `SELECT id, fiscal_year_start, dep_title, quarter_no, months_covered,
      calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode,
      remarks, is_final_for_fy,
      status, branch_id, created_at::text, updated_at::text
     FROM hrms_depreciation_runs
     ORDER BY fiscal_year_start DESC, quarter_no ASC, id DESC`
  );
  return r.rows;
}

export async function getDepreciationRunById(
  id: number
): Promise<DepreciationRunRow | null> {
  const r = await query<DepreciationRunRow>(
    `SELECT id, fiscal_year_start, dep_title, quarter_no, months_covered,
      calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode,
      remarks, is_final_for_fy,
      status, branch_id, created_at::text, updated_at::text
     FROM hrms_depreciation_runs WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function listDetailsForRun(
  runId: number,
  options?: { page?: number; pageSize?: number }
): Promise<{ rows: DepreciationRunDetailRow[]; total: number }> {
  const pageRaw = options?.page ?? 1;
  const pageSizeRaw = options?.pageSize ?? 100;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(500, Math.max(1, Math.floor(pageSizeRaw)))
    : 100;
  const offset = (page - 1) * pageSize;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM hrms_depreciation_run_details
     WHERE depreciation_run_id = $1`,
    [runId]
  );
  const total = Number.parseInt(countResult.rows[0]?.total ?? "0", 10) || 0;

  // depreciation_cost_basis: same order as grossDepreciableAmountForRun (historical cost before carrying WDV).
  const r = await query<DepreciationRunDetailRow>(
    `SELECT d.id, d.depreciation_run_id, d.asset_id, a.asset_code,
      a.asset_status, disp.disposal_date_bs, d.fiscal_year,
      d.asset_name, a.purchase_date_bs,
      (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::text AS actual_purchase_price,
      (CASE
        WHEN COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0) > 0
        THEN (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::numeric
        WHEN a.old_book_value IS NOT NULL AND a.old_book_value > 0
        THEN a.old_book_value
        WHEN a.book_value IS NOT NULL AND a.book_value > 0
        THEN a.book_value
        ELSE COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0)
      END)::text AS depreciation_cost_basis,
      d.dep_rate::text, d.dep_days, d.dep_amount::text, d.group_name, d.sub_group_name,
      d.branch_name, d.book_value::text, d.accumulate_dep::text, d.dep_formula,
      d.dep_start_date_bs,
      a.depreciation_start_date_bs AS register_depreciation_start_bs,
      d.balance_amount::text, d.created_at::text
     FROM hrms_depreciation_run_details d
     INNER JOIN hrms_assets a ON a.id = d.asset_id
     LEFT JOIN hrms_asset_disposals disp ON disp.asset_id = a.id
     WHERE d.depreciation_run_id = $1
     ORDER BY d.asset_id ASC
     LIMIT $2 OFFSET $3`,
    [runId, pageSize, offset]
  );
  return { rows: r.rows, total };
}

export type DepreciationSkippedAsset = {
  asset_id: number;
  asset_name: string;
  reason: string;
};

export type CreateDepreciationRunInput = {
  fiscalYearStart: number;
  quarterNo: 1 | 2 | 3 | 4;
  fiscalProgressBs: string;
  remarks?: string | null;
  /** Overrides default quarter label (e.g. "First Quarter") when non-empty. */
  depTitle?: string | null;
  branchId?: number | null;
  calculationMode?: DepreciationCalculationMode;
  /**
   * AS_OF_DATE: through calculation date (min with fiscal year end). New runs
   * use this. FY_END is retained for existing stored runs / refresh logic.
   */
  depreciationScopeMode?: DepreciationScopeMode;
  /** Optional BS date for the run; defaults to server “today” in BS. */
  calculationDateBs?: string | null;
};

/** True when the new FY must use a posted prior-FY Q4/FY_END run (not register WDV). */
export function priorFiscalYearRequiresStrictCarryForward(
  fiscalYearStart: number
): boolean {
  const priorFy = Math.floor(fiscalYearStart) - 1;
  return Number.isFinite(priorFy) && priorFy >= 2000;
}

export function missingPriorFyFinalDepreciationErrorMessage(
  previousFY: number,
  newFY: number
): string {
  return `Previous fiscal year final depreciation run is not posted. Please post Q4/FY_END depreciation for FY ${previousFY} before creating depreciation for FY ${newFY}.`;
}

/** When true, missing prior-FY final run falls back to register-implied prior accumulated dep. */
export function allowLegacyRegisterCarryForward(): boolean {
  const raw = process.env.DEPRECIATION_LEGACY_REGISTER_CARRY_FORWARD?.trim();
  if (raw == null || raw === "") return false;
  const v = raw.toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export type PriorFyCarryForwardLine = {
  priorAccumulatedDep: number;
  openingWrittenDownValue: number;
};

export type PriorFyCarryForward = {
  priorFiscalYearStart: number;
  runId: number;
  byAssetId: Map<number, PriorFyCarryForwardLine>;
};

function parseDepreciationMoneyField(raw: string | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function loadPriorFyCarryForward(
  client: PoolClient,
  fiscalYearStart: number,
  branchId: number | null
): Promise<PriorFyCarryForward | null> {
  const fy = Math.floor(fiscalYearStart);
  const priorFy = fy - 1;
  if (!Number.isFinite(priorFy) || priorFy < 2000) {
    return null;
  }
  const runResult = await client.query<{ id: number }>(
    `SELECT r.id FROM hrms_depreciation_runs r
     WHERE r.fiscal_year_start = $1
       AND COALESCE(r.branch_id, -1) = COALESCE($2::integer, -1)
       AND r.is_final_for_fy = true
       AND r.status = 'posted'
     ORDER BY r.id DESC
     LIMIT 1`,
    [priorFy, branchId]
  );
  const runId = runResult.rows[0]?.id;
  if (!runId) {
    return null;
  }
  const dets = await client.query<{
    asset_id: number;
    prior: string;
    balance_amount: string;
  }>(
    `SELECT asset_id,
            (accumulate_dep + dep_amount)::text AS prior,
            balance_amount::text AS balance_amount
     FROM hrms_depreciation_run_details
     WHERE depreciation_run_id = $1`,
    [runId]
  );
  const byAssetId = new Map<number, PriorFyCarryForwardLine>();
  for (const row of dets.rows) {
    const priorAccumulatedDep = parseDepreciationMoneyField(row.prior);
    const openingWrittenDownValue = parseDepreciationMoneyField(row.balance_amount);
    if (priorAccumulatedDep === null || openingWrittenDownValue === null) {
      continue;
    }
    byAssetId.set(row.asset_id, {
      priorAccumulatedDep,
      openingWrittenDownValue,
    });
  }
  return {
    priorFiscalYearStart: priorFy,
    runId,
    byAssetId,
  };
}

/**
 * Resolves prior-FY carry-forward for a new depreciation run. Throws when strict
 * carry-forward is required but the prior posted final run is missing.
 */
export function assertPriorFyCarryForwardForDepreciationRun(
  fiscalYearStart: number,
  priorCarryForward: PriorFyCarryForward | null
): void {
  if (!priorFiscalYearRequiresStrictCarryForward(fiscalYearStart)) {
    return;
  }
  if (priorCarryForward !== null) {
    return;
  }
  if (allowLegacyRegisterCarryForward()) {
    return;
  }
  const newFy = Math.floor(fiscalYearStart);
  const previousFy = newFy - 1;
  throw new Error(
    missingPriorFyFinalDepreciationErrorMessage(previousFy, newFy)
  );
}

/** Assets depreciating before the new FY Shrawan 1 must appear on the prior FY final run. */
export function assetRequiresPriorFyCarryForward(
  asset: DepreciationScheduleAssetRow,
  newFiscalYearStartBs: string
): boolean {
  if (!isDepreciableAssetEligibleForDepreciationSchedule(asset)) {
    return false;
  }
  const depreciationStartBs = depreciationCommencementFromRegister(
    asset.purchase_date_bs,
    asset.depreciation_start_date_bs
  );
  if (!depreciationStartBs) {
    return false;
  }
  return compareBsDateString(depreciationStartBs, newFiscalYearStartBs) < 0;
}

export function assertEligibleAssetsHavePriorFyCarryForward(input: {
  fiscalYearStart: number;
  assets: DepreciationScheduleAssetRow[];
  priorCarryForward: PriorFyCarryForward;
}): void {
  const fyStartBs = fiscalYearStartBs(Math.floor(input.fiscalYearStart));
  const missing: DepreciationScheduleAssetRow[] = [];
  for (const a of input.assets) {
    if (!assetRequiresPriorFyCarryForward(a, fyStartBs)) {
      continue;
    }
    if (!input.priorCarryForward.byAssetId.has(a.id)) {
      missing.push(a);
    }
  }
  if (missing.length === 0) {
    return;
  }
  const labels = missing
    .map((a) => {
      const code =
        a.asset_code != null && String(a.asset_code).trim() !== ""
          ? String(a.asset_code).trim()
          : null;
      const name =
        a.asset_name != null && String(a.asset_name).trim() !== ""
          ? String(a.asset_name).trim()
          : "(unnamed)";
      return code ? `${code} — ${name}` : `#${a.id} — ${name}`;
    })
    .join("; ");
  throw new Error(
    `${missing.length} asset(s) require prior fiscal year carry-forward but are missing from the posted FY ${input.priorCarryForward.priorFiscalYearStart} final run: ${labels}.`
  );
}

export type DepreciationRunCarryForwardContext =
  | { mode: "none" }
  | { mode: "legacy" }
  | { mode: "strict"; prior: PriorFyCarryForward };

export function resolveDepreciationRunCarryForwardContext(
  fiscalYearStart: number,
  priorCarryForward: PriorFyCarryForward | null
): DepreciationRunCarryForwardContext {
  assertPriorFyCarryForwardForDepreciationRun(fiscalYearStart, priorCarryForward);
  if (priorCarryForward !== null) {
    return { mode: "strict", prior: priorCarryForward };
  }
  if (
    priorFiscalYearRequiresStrictCarryForward(fiscalYearStart) &&
    allowLegacyRegisterCarryForward()
  ) {
    return { mode: "legacy" };
  }
  return { mode: "none" };
}

export function selectedDepreciationPeriodEndBs(params: {
  fiscalYearStart: number;
  quarterNo: 1 | 2 | 3 | 4;
  calculationDateBs: string;
  depreciationScopeMode: DepreciationScopeMode;
}): string {
  if (params.depreciationScopeMode === "AS_OF_DATE") {
    const fyEndBs = fiscalYearEndBs(params.fiscalYearStart);
    return compareBsDateString(params.calculationDateBs, fyEndBs) > 0
      ? fyEndBs
      : params.calculationDateBs;
  }
  return params.quarterNo === 4
    ? fiscalYearEndBs(params.fiscalYearStart)
    : fiscalQuarterEndBs(params.fiscalYearStart, params.quarterNo);
}

export function resolveAssetDepreciationEndBsForRun(params: {
  assetStatus: "ACTIVE" | "DISPOSED";
  disposalDateBs: string | null;
  fiscalYearStartBs: string;
  selectedPeriodEndBs: string;
}): string | null {
  if (params.assetStatus !== "DISPOSED") {
    return params.selectedPeriodEndBs;
  }
  const disposalDateBs = normalizeBsDateEnglish(
    String(params.disposalDateBs ?? "").trim()
  );
  if (!disposalDateBs) {
    return null;
  }
  if (compareBsDateString(disposalDateBs, params.fiscalYearStartBs) < 0) {
    return null;
  }
  if (compareBsDateString(disposalDateBs, params.selectedPeriodEndBs) <= 0) {
    return disposalDateBs;
  }
  return params.selectedPeriodEndBs;
}

/**
 * Disposed assets whose depreciation stops at the disposal date (within the run
 * period) report zero opening and closing book value on the detail row.
 * Depreciation amounts still reflect activity through disposal.
 */
export function resolveDepreciationDetailBookValues(params: {
  assetStatus: "ACTIVE" | "DISPOSED";
  disposalDateBs: string;
  depreciationEndBs: string;
  openingBookValue: number;
  closingBookValue: number;
}): { bookValue: number; balanceAmount: number } {
  const disposedWithinPeriod =
    params.assetStatus === "DISPOSED" &&
    params.disposalDateBs !== "" &&
    params.depreciationEndBs === params.disposalDateBs;
  if (disposedWithinPeriod) {
    return { bookValue: 0, balanceAmount: 0 };
  }
  return {
    bookValue: params.openingBookValue,
    balanceAmount: params.closingBookValue,
  };
}

async function insertDepreciationDetailRows(
  client: PoolClient,
  args: {
    runId: number;
    fiscalYearStart: number;
    quarterNo: 1 | 2 | 3 | 4;
    calculationDateBs: string;
    depreciationScopeMode: DepreciationScopeMode;
    calculationMode: DepreciationCalculationMode;
    assets: AssetDepRow[];
    carryForwardContext: DepreciationRunCarryForwardContext;
  }
): Promise<{ detailsInserted: number; skippedAssets: DepreciationSkippedAsset[] }> {
  const {
    runId,
    fiscalYearStart: fy,
    quarterNo,
    calculationDateBs,
    depreciationScopeMode,
    calculationMode,
    assets,
    carryForwardContext,
  } = args;

  const skippedAssets: DepreciationSkippedAsset[] = [];
  let detailsInserted = 0;
  let loggedVerificationAsset = false;
  const selectedPeriodEndBs = selectedDepreciationPeriodEndBs({
    fiscalYearStart: fy,
    quarterNo,
    calculationDateBs,
    depreciationScopeMode,
  });
  const fyStartBs = fiscalYearStartBs(fy);

  for (const a of assets) {
    const purchaseAmount = grossDepreciableAmountForRun(
      a.book_value,
      a.purchase_qty,
      a.unit_rate,
      a.old_book_value
    );
    const useRegisterPriorAccum =
      carryForwardContext.mode === "legacy" ||
      carryForwardContext.mode === "none";
    const registerPriorAccum = useRegisterPriorAccum
      ? registerImpliedPriorAccumulatedDep(purchaseAmount ?? 0, a.book_value)
      : undefined;
    const depRate = parseDepRatePercent(a.asset_dep_rate ?? a.group_dep_rate);
    const method = parseDepreciationMethod(a.asset_dep_method ?? a.group_dep_method);
    const depreciationStartBs = depreciationCommencementFromRegister(
      a.purchase_date_bs,
      a.depreciation_start_date_bs
    );
    const disposalDateBs =
      a.asset_status === "DISPOSED" && a.disposal_date_bs
        ? normalizeBsDateEnglish(String(a.disposal_date_bs).trim())
        : "";
    const depreciationEndBs = resolveAssetDepreciationEndBsForRun({
      assetStatus: a.asset_status,
      disposalDateBs,
      fiscalYearStartBs: fyStartBs,
      selectedPeriodEndBs,
    });
    if (depreciationEndBs === null) {
      continue;
    }

    if (
      purchaseAmount === null ||
      depRate === null ||
      method === null ||
      purchaseAmount <= 0 ||
      depRate <= 0 ||
      !depreciationStartBs
    ) {
      const reason =
        purchaseAmount === null || purchaseAmount <= 0
          ? "Invalid or missing depreciable cost (register book value, qty × unit rate, or legacy old book value must be > 0)."
          : depRate === null || depRate <= 0
            ? "Asset group has no valid depreciation rate (> 0)."
            : method === null
              ? "Asset group depreciation method is missing or not recognized (use Straight Line or Declining Balance)."
              : !depreciationStartBs
                ? "Missing or invalid depreciation start / purchase date (BS)."
                : "Asset skipped (validation).";
      skippedAssets.push({
        asset_id: a.id,
        asset_name: a.asset_name,
        reason,
      });
      continue;
    }

    const priorLine =
      carryForwardContext.mode === "strict"
        ? carryForwardContext.prior.byAssetId.get(a.id)
        : undefined;
    const carryPrior = priorLine?.priorAccumulatedDep;
    const computed = computeAssetQuarterCumulative({
      purchaseAmount,
      depreciationStartBs,
      depRatePercent: depRate,
      method,
      calculationMode,
      fiscalYearStart: fy,
      quarter: quarterNo,
      depreciationScopeMode,
      asOfDateBs:
        depreciationScopeMode === "AS_OF_DATE" ? depreciationEndBs : null,
      depreciationEndBs:
        depreciationScopeMode === "FY_END" ? depreciationEndBs : null,
      registerPriorAccumulatedDep:
        carryPrior !== undefined ? undefined : registerPriorAccum,
      carryForwardPriorAccumulatedDep:
        carryPrior !== undefined ? carryPrior : null,
    });

    if (!computed.ok) {
      skippedAssets.push({
        asset_id: a.id,
        asset_name: a.asset_name,
        reason: computed.errors.join("; "),
      });
      continue;
    }

    const d = computed.detail;
    const { bookValue, balanceAmount } = resolveDepreciationDetailBookValues({
      assetStatus: a.asset_status,
      disposalDateBs,
      depreciationEndBs,
      openingBookValue: d.bookValue,
      closingBookValue: d.balanceAmount,
    });
    if (!loggedVerificationAsset) {
      const t = d.erpTimeline;
      log.info("depreciation verification sample", {
        assetId: a.id,
        purchasePrice: purchaseAmount,
        openingBookValueOfFY: t.openingBookValueOfFY,
        priorYearsDepAmount: t.priorYearsDepAmount,
        thisYearDepAmount: t.thisYearDepAmount,
        accumulatedDep: t.accumulatedDep,
        closingBookValue: t.closingBookValue,
      });
      loggedVerificationAsset = true;
    }

    await client.query(
      `INSERT INTO hrms_depreciation_run_details (
        depreciation_run_id, asset_id, fiscal_year, asset_name, dep_rate,
        dep_days, dep_amount, group_name, sub_group_name, branch_name,
        book_value, accumulate_dep, dep_formula, dep_start_date_bs,
        balance_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        runId,
        a.id,
        fy,
        a.asset_name,
        depRate,
        d.depDays,
        d.depAmount,
        a.group_name,
        a.sub_group_name,
        a.branch_name,
        bookValue,
        d.accumulateDep,
        d.depFormula,
        depreciationStartBs,
        balanceAmount,
      ]
    );
    detailsInserted += 1;
  }

  return { detailsInserted, skippedAssets };
}

export async function createDepreciationRun(
  input: CreateDepreciationRunInput
): Promise<{
  run: DepreciationRunRow;
  detailsInserted: number;
  skippedAssets: DepreciationSkippedAsset[];
}> {
  const fy = Math.floor(input.fiscalYearStart);
  if (!Number.isFinite(fy) || fy < 2000) {
    throw new Error("Invalid fiscal year.");
  }
  const quarterNo = input.quarterNo;
  if (quarterNo < 1 || quarterNo > 4) {
    throw new Error("Quarter must be between 1 and 4.");
  }

  const progressBs = normalizeBsDateEnglish(input.fiscalProgressBs.trim());
  if (!progressBs) {
    throw new Error("Fiscal progress date (BS) is required.");
  }

  const maxQ = maxEligibleQuarter(fy, progressBs);
  if (maxQ === 0) {
    throw new Error(
      "Books closed date has not reached the end of the first fiscal quarter for this year."
    );
  }
  if (quarterNo > maxQ) {
    throw new Error(
      `This quarter is not eligible yet. Books are closed only through quarter ${maxQ} of this fiscal year (based on the progress date).`
    );
  }

  const branchId =
    input.branchId === undefined || input.branchId === null
      ? null
      : Math.floor(Number(input.branchId));

  if (branchId !== null && (!Number.isFinite(branchId) || branchId < 1)) {
    throw new Error("Invalid branch.");
  }

  if (branchId !== null) {
    const b = await query<{ id: number }>(
      `SELECT id FROM hrms_branches WHERE id = $1`,
      [branchId]
    );
    if (!b.rows[0]) {
      throw new Error("Branch not found.");
    }
  }

  const calculationMode: DepreciationCalculationMode =
    input.calculationMode ?? "ERP_ACCURATE";

  const depreciationScopeMode: DepreciationScopeMode =
    input.depreciationScopeMode === "FY_END" ||
    input.depreciationScopeMode === "AS_OF_DATE"
      ? input.depreciationScopeMode
      : parseDepreciationScopeMode(
          typeof input.depreciationScopeMode === "string"
            ? input.depreciationScopeMode
            : null
        ) ?? "AS_OF_DATE";

  const customTitle = input.depTitle?.trim();
  const depTitle =
    customTitle && customTitle.length > 0
      ? customTitle.slice(0, 255)
      : depreciationScopeMode === "AS_OF_DATE"
        ? "Depreciation (as of calculation date)"
        : "Fiscal Year Depreciation";
  const monthsCovered = 12;
  const isFinal = depreciationScopeMode === "FY_END";

  let calculationDateBs = (() => {
    const raw = input.calculationDateBs;
    if (raw != null && String(raw).trim() !== "") {
      return normalizeBsDateEnglish(String(raw).trim());
    }
    return bsDateFromJsDate(new Date());
  })();
  if (!calculationDateBs) {
    throw new Error("Invalid calculation date (BS).");
  }

  const fyStartBs = fiscalYearStartBs(fy);
  const fyEndBs = fiscalYearEndBs(fy);
  if (depreciationScopeMode === "AS_OF_DATE") {
    if (compareBsDateString(calculationDateBs, fyStartBs) < 0) {
      throw new Error(
        "Calculation date must be on or after the fiscal year start (Shrawan 1) for as-of-date runs."
      );
    }
    if (compareBsDateString(calculationDateBs, fyEndBs) > 0) {
      calculationDateBs = fyEndBs;
    }
  }

  const assets = await loadAssetsForRun(branchId);

  log.debug("createDepreciationRun start", {
    fiscalYearStart: fy,
    quarterNo,
    branchId,
    assetCount: assets.length,
    calculationDateBs,
    fiscalProgressBs: progressBs,
    depreciationScopeMode,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize writes for the same fiscal-year + branch scope to avoid
    // concurrent delete/insert races against the unique FY/quarter index.
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('hrms_depr_run'),
         ($1::int * 100000) + COALESCE($2::int, -1)
       )`,
      [fy, branchId]
    );

    const priorCarryForward = await loadPriorFyCarryForward(client, fy, branchId);
    const carryForwardContext = resolveDepreciationRunCarryForwardContext(
      fy,
      priorCarryForward
    );
    if (carryForwardContext.mode === "strict") {
      assertEligibleAssetsHavePriorFyCarryForward({
        fiscalYearStart: fy,
        assets,
        priorCarryForward: carryForwardContext.prior,
      });
    }

    /**
     * Replacement policy (see also partial unique indexes on `hrms_depreciation_runs`):
     * - FY_END: keep a single “full quarter / FY” sheet per fiscal year + branch by deleting
     *   any prior FY_END run in that scope before insert (recalculate replaces the sheet).
     * - AS_OF_DATE: keep multiple dated snapshots per FY + branch; only replace a row that
     *   matches the same stored calculation_date_bs so re-running the same as-of date is idempotent
     *   without deleting other as-of snapshots.
     */
    if (depreciationScopeMode === "FY_END") {
      await client.query(
        `DELETE FROM hrms_depreciation_runs
         WHERE fiscal_year_start = $1
           AND COALESCE(branch_id, -1) = COALESCE($2, -1)
           AND depreciation_scope_mode = 'FY_END'`,
        [fy, branchId]
      );
    } else {
      await client.query(
        `DELETE FROM hrms_depreciation_runs
         WHERE fiscal_year_start = $1
           AND COALESCE(branch_id, -1) = COALESCE($2, -1)
           AND depreciation_scope_mode = 'AS_OF_DATE'
           AND calculation_date_bs = $3`,
        [fy, branchId, calculationDateBs]
      );
    }

    const ins = await client.query<DepreciationRunRow>(
      `INSERT INTO hrms_depreciation_runs (
        fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
        status, branch_id, updated_at
      ) VALUES (
        $1, $2, $3, $4, NOW(), $5, $6, $7, $8, 'posted', $9, NOW()
      )
      RETURNING id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text`,
      [
        fy,
        depTitle,
        quarterNo,
        monthsCovered,
        calculationDateBs,
        depreciationScopeMode,
        input.remarks?.trim() ?? null,
        isFinal,
        branchId,
      ]
    );

    const run = ins.rows[0];
    if (!run) {
      throw new Error("Failed to create depreciation run.");
    }

    const { detailsInserted, skippedAssets } = await insertDepreciationDetailRows(
      client,
      {
        runId: run.id,
        fiscalYearStart: fy,
        quarterNo,
        calculationDateBs,
        depreciationScopeMode,
        calculationMode,
        assets,
        carryForwardContext,
      }
    );

    if (detailsInserted === 0) {
      await client.query("ROLLBACK");
      throw new Error(
        "No depreciation rows were generated. Ensure assets have valid cost (register book value, qty × rate, or legacy old book value), group depreciation rate and method, and depreciation start dates that fall on or before the selected fiscal year end."
      );
    }

    await client.query("COMMIT");
    log.info("createDepreciationRun committed", {
      runId: run.id,
      detailsInserted,
      skippedCount: skippedAssets.length,
    });
    return { run, detailsInserted, skippedAssets };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    log.error("createDepreciationRun failed (rolled back)", err, {
      fiscalYearStart: fy,
      quarterNo,
      branchId,
    });
    throw err;
  } finally {
    client.release();
  }
}

function serverTodayBsNormalized(): string | null {
  try {
    return normalizeBsDateEnglish(bsDateFromJsDate(new Date()).trim());
  } catch {
    return null;
  }
}

/** Server “today” in English BS (`YYYY/MM/DD`), for UI freshness checks. */
export function getServerTodayBsEnglish(): string | null {
  return serverTodayBsNormalized();
}

/** Today’s BS date, capped to the end of the given fiscal year (for as-of runs). */
function todayBsCappedForFiscalYear(fy: number): string | null {
  const todayBs = serverTodayBsNormalized();
  if (!todayBs) return null;
  const fyEndBs = fiscalYearEndBs(fy);
  return compareBsDateString(todayBs, fyEndBs) > 0 ? fyEndBs : todayBs;
}

/**
 * Rebuilds detail lines from the current asset register. For `AS_OF_DATE` runs,
 * `advanceCalculationDateToTodayBs` bumps `calculation_date_bs` to today (BS, capped at FY end)
 * before recomputing so the header and amounts match “through today”.
 */
export async function refreshDepreciationRunDetailsFromAssets(
  runId: number,
  options?: { advanceCalculationDateToTodayBs?: boolean }
): Promise<{
  run: DepreciationRunRow;
  detailsInserted: number;
  skippedAssets: DepreciationSkippedAsset[];
  /** Another as-of run already uses this calculation date; open that run instead. */
  redirectToRunId?: number;
}> {
  const run = await getDepreciationRunById(runId);
  if (!run) {
    throw new Error("Depreciation run not found.");
  }

  const fy = run.fiscal_year_start;
  const q = run.quarter_no;
  if (!Number.isFinite(q) || q < 1 || q > 4) {
    throw new Error("Invalid quarter on depreciation run.");
  }
  let quarterNo = q as 1 | 2 | 3 | 4;

  let calculationDateBs = normalizeBsDateEnglish(
    String(run.calculation_date_bs).trim()
  );
  if (!calculationDateBs) {
    throw new Error("Run has invalid calculation date (BS).");
  }

  const depreciationScopeMode =
    parseDepreciationScopeMode(run.depreciation_scope_mode) ?? "FY_END";
  const calculationMode: DepreciationCalculationMode = "ERP_ACCURATE";
  const branchId = run.branch_id;

  const assets = await loadAssetsForRun(branchId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('hrms_depr_run'),
         ($1::int * 100000) + COALESCE($2::int, -1)
       )`,
      [fy, branchId]
    );

    const priorCarryForward = await loadPriorFyCarryForward(client, fy, branchId);
    const carryForwardContext = resolveDepreciationRunCarryForwardContext(
      fy,
      priorCarryForward
    );
    if (carryForwardContext.mode === "strict") {
      assertEligibleAssetsHavePriorFyCarryForward({
        fiscalYearStart: fy,
        assets,
        priorCarryForward: carryForwardContext.prior,
      });
    }

    if (
      options?.advanceCalculationDateToTodayBs === true &&
      depreciationScopeMode === "AS_OF_DATE"
    ) {
      const stored = normalizeBsDateEnglish(
        String(
          (
            await client.query<{ calculation_date_bs: string }>(
              `SELECT calculation_date_bs FROM hrms_depreciation_runs WHERE id = $1 FOR UPDATE`,
              [runId]
            )
          ).rows[0]?.calculation_date_bs ?? ""
        ).trim()
      );
      if (stored) {
        const targetBs = todayBsCappedForFiscalYear(fy);
        const fyStartBs = fiscalYearStartBs(fy);
        if (targetBs && compareBsDateString(stored, targetBs) < 0) {
          let effectiveTarget = targetBs;
          if (compareBsDateString(effectiveTarget, fyStartBs) < 0) {
            effectiveTarget = fyStartBs;
          }
          const dup = await client.query<{ id: number }>(
            `SELECT id FROM hrms_depreciation_runs
             WHERE fiscal_year_start = $1
               AND COALESCE(branch_id, -1) = COALESCE($2, -1)
               AND depreciation_scope_mode = 'AS_OF_DATE'
               AND calculation_date_bs = $3
               AND id <> $4
             LIMIT 1`,
            [fy, branchId, effectiveTarget, runId]
          );
          if (dup.rows[0]) {
            await client.query("ROLLBACK");
            const otherId = dup.rows[0].id;
            const other = await getDepreciationRunById(otherId);
            if (!other) {
              throw new Error("Conflicting depreciation run not found.");
            }
            return {
              run: other,
              detailsInserted: 0,
              skippedAssets: [],
              redirectToRunId: otherId,
            };
          }
          const monthIdx = nepaliCalendarMonthIndexFromBs(effectiveTarget);
          const newQuarter =
            monthIdx !== null
              ? fiscalQuarterFromNepaliCalendarMonthIndex(monthIdx)
              : quarterNo;
          await client.query(
            `UPDATE hrms_depreciation_runs
             SET calculation_date_bs = $2,
                 quarter_no = $3,
                 calculation_date_ad = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [runId, effectiveTarget, newQuarter]
          );
          calculationDateBs = effectiveTarget;
          quarterNo = newQuarter;
        }
      }
    }

    await client.query(
      `DELETE FROM hrms_depreciation_run_details WHERE depreciation_run_id = $1`,
      [runId]
    );

    const { detailsInserted, skippedAssets } = await insertDepreciationDetailRows(
      client,
      {
        runId,
        fiscalYearStart: fy,
        quarterNo,
        calculationDateBs,
        depreciationScopeMode,
        calculationMode,
        assets,
        carryForwardContext,
      }
    );

    if (detailsInserted === 0) {
      await client.query("ROLLBACK");
      throw new Error(
        "No depreciation rows were generated. Ensure assets have valid cost (register book value, qty × rate, or legacy old book value), group depreciation rate and method, and depreciation start dates that fall on or before the selected fiscal year end."
      );
    }

    await client.query(
      `UPDATE hrms_depreciation_runs SET updated_at = NOW() WHERE id = $1`,
      [runId]
    );

    await client.query("COMMIT");
    log.info("refreshDepreciationRunDetailsFromAssets committed", {
      runId,
      detailsInserted,
      skippedCount: skippedAssets.length,
    });

    const updated = await getDepreciationRunById(runId);
    if (!updated) {
      throw new Error("Depreciation run disappeared after refresh.");
    }
    return { run: updated, detailsInserted, skippedAssets };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    log.error("refreshDepreciationRunDetailsFromAssets failed (rolled back)", err, {
      runId,
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recalculate mutable depreciation reports that currently include the asset.
 * Final FY reports are left untouched to preserve historical audit snapshots.
 */
export async function refreshMutableDepreciationRunsForAsset(
  assetId: number
): Promise<{
  refreshedRunIds: number[];
  skippedFinalizedRunIds: number[];
}> {
  const runs = await query<{ id: number; is_final_for_fy: boolean }>(
    `SELECT DISTINCT r.id, r.is_final_for_fy
     FROM hrms_depreciation_runs r
     INNER JOIN hrms_depreciation_run_details d
       ON d.depreciation_run_id = r.id
     WHERE d.asset_id = $1
     ORDER BY r.id DESC`,
    [assetId]
  );

  const refreshedRunIds: number[] = [];
  const skippedFinalizedRunIds: number[] = [];

  for (const run of runs.rows) {
    if (run.is_final_for_fy) {
      skippedFinalizedRunIds.push(run.id);
      continue;
    }
    await refreshDepreciationRunDetailsFromAssets(run.id, {
      advanceCalculationDateToTodayBs: false,
    });
    refreshedRunIds.push(run.id);
  }

  return { refreshedRunIds, skippedFinalizedRunIds };
}

/** Rebuilds all non-final depreciation runs for a branch from the current register. */
export async function refreshMutableDepreciationRunsForBranch(
  branchId: number | null
): Promise<{
  refreshedRunIds: number[];
  skippedFinalizedRunIds: number[];
}> {
  const runs = await query<{ id: number; is_final_for_fy: boolean }>(
    branchId === null
      ? `SELECT id, is_final_for_fy
         FROM hrms_depreciation_runs
         WHERE branch_id IS NULL
         ORDER BY id DESC`
      : `SELECT id, is_final_for_fy
         FROM hrms_depreciation_runs
         WHERE branch_id = $1
         ORDER BY id DESC`,
    branchId === null ? [] : [branchId]
  );

  const refreshedRunIds: number[] = [];
  const skippedFinalizedRunIds: number[] = [];

  for (const run of runs.rows) {
    if (run.is_final_for_fy) {
      skippedFinalizedRunIds.push(run.id);
      continue;
    }
    await refreshDepreciationRunDetailsFromAssets(run.id, {
      advanceCalculationDateToTodayBs: false,
    });
    refreshedRunIds.push(run.id);
  }

  return { refreshedRunIds, skippedFinalizedRunIds };
}

/** Rebuilds every non-final depreciation run from the current asset register. */
export async function refreshAllMutableDepreciationRuns(): Promise<{
  refreshedRunIds: number[];
  skippedFinalizedRunIds: number[];
}> {
  const runs = await query<{ id: number; is_final_for_fy: boolean }>(
    `SELECT id, is_final_for_fy
     FROM hrms_depreciation_runs
     ORDER BY id DESC`
  );

  const refreshedRunIds: number[] = [];
  const skippedFinalizedRunIds: number[] = [];

  for (const run of runs.rows) {
    if (run.is_final_for_fy) {
      skippedFinalizedRunIds.push(run.id);
      continue;
    }
    await refreshDepreciationRunDetailsFromAssets(run.id, {
      advanceCalculationDateToTodayBs: false,
    });
    refreshedRunIds.push(run.id);
  }

  return { refreshedRunIds, skippedFinalizedRunIds };
}

/**
 * “Add Depreciation Master” minimal form: calculation BS date + Nepali month name.
 * Derives fiscal year, quarter, and books-closed date for eligibility.
 */
export async function createDepreciationRunFromMasterForm(input: {
  calculationDateBs: string;
  nepaliMonth: string;
  depTitle?: string | null;
  remarks?: string | null;
}): Promise<{
  run: DepreciationRunRow;
  detailsInserted: number;
  skippedAssets: DepreciationSkippedAsset[];
}> {
  const calcBs = normalizeBsDateEnglish(input.calculationDateBs.trim());
  if (!calcBs) {
    throw new Error("Calculation date (BS) is required.");
  }

  const fyStart = fiscalYearStartFromBsDate(calcBs);
  if (fyStart === null) {
    throw new Error("Invalid calculation date (BS).");
  }

  const monthIdx = nepaliMonthNameToCalendarIndex(input.nepaliMonth);
  if (monthIdx === null) {
    throw new Error("Select a valid Nepali month.");
  }

  const dateMonthIdx = nepaliCalendarMonthIndexFromBs(calcBs);
  if (dateMonthIdx !== null && dateMonthIdx !== monthIdx) {
    const fromDate = NEPALI_MONTHS_ORDERED_EN[dateMonthIdx] ?? "?";
    const selected = input.nepaliMonth.trim();
    throw new Error(
      `Selected month (${selected}) does not match the calculation date’s Bikram month (${fromDate}).`
    );
  }

  const quarterNo = fiscalQuarterFromNepaliCalendarMonthIndex(monthIdx);
  const qEnd = fiscalQuarterEndBs(fyStart, quarterNo);
  const fiscalProgressBs =
    compareBsDateString(calcBs, qEnd) >= 0 ? calcBs : qEnd;

  return createDepreciationRun({
    fiscalYearStart: fyStart,
    quarterNo,
    fiscalProgressBs,
    remarks: input.remarks,
    depTitle: input.depTitle,
    calculationDateBs: calcBs,
    branchId: null,
    calculationMode: "ERP_ACCURATE",
    depreciationScopeMode: "AS_OF_DATE",
  });
}

/** Create or replace the depreciation run for the fiscal year containing “today” (server BS date). */
export async function ensureDepreciationRunForCurrentFiscalYear(): Promise<{
  run: DepreciationRunRow;
  detailsInserted: number;
  skippedAssets: DepreciationSkippedAsset[];
}> {
  let calcBsRaw: string;
  try {
    calcBsRaw = bsDateFromJsDate(new Date());
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not convert the server date to Bikram Sambat. ${hint}`
    );
  }
  const calcBs = normalizeBsDateEnglish(calcBsRaw.trim());
  if (!calcBs) {
    throw new Error("Could not derive today’s BS date.");
  }
  const monthIdx = nepaliCalendarMonthIndexFromBs(calcBs);
  if (monthIdx === null) {
    throw new Error("Could not derive Nepali month from today’s BS date.");
  }
  const nepaliMonth = NEPALI_MONTHS_ORDERED_EN[monthIdx];
  if (nepaliMonth === undefined) {
    throw new Error("Invalid Nepali month index for today’s date.");
  }
  log.debug("ensureDepreciationRunForCurrentFiscalYear", {
    calculationDateBs: calcBs,
    nepaliMonth,
  });
  return createDepreciationRunFromMasterForm({
    calculationDateBs: calcBs,
    nepaliMonth,
    depTitle: null,
    remarks: null,
  });
}

export async function updateDepreciationRunRemarks(
  id: number,
  remarks: string | null
): Promise<DepreciationRunRow | null> {
  const r = await query<DepreciationRunRow>(
    `UPDATE hrms_depreciation_runs
     SET remarks = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, fiscal_year_start, dep_title, quarter_no, months_covered,
       calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
       status, branch_id, created_at::text, updated_at::text`,
    [id, remarks?.trim() ?? null]
  );
  return r.rows[0] ?? null;
}

async function insertDepreciationRunAudit(
  client: PoolClient,
  input: {
    depreciationRunId: number | null;
    action: "DELETE" | "DELETE_BLOCKED_FINAL" | "VOID";
    actor: DepreciationRunActor;
    overrideUsed: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO hrms_depreciation_run_audit_logs (
        depreciation_run_id,
        action,
        actor_admin_id,
        actor_admin_email,
        is_super_admin,
        override_used,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.depreciationRunId,
        input.action,
        input.actor.adminId,
        input.actor.adminEmail,
        input.actor.isSuperAdmin,
        input.overrideUsed,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "42P01") {
      // Backward-compatible safety net: allow delete/void to proceed on databases
      // where the audit migration has not yet been applied.
      log.warn("Audit log table missing; skipping depreciation run audit insert", {
        action: input.action,
        depreciationRunId: input.depreciationRunId,
      });
      return;
    }
    throw err;
  }
}

export async function deleteDepreciationRun(
  id: number,
  options: { actor: DepreciationRunActor; allowFinalOverride: boolean }
): Promise<{ deleted: boolean; blockedFinal: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runResult = await client.query<DepreciationRunRow>(
      `SELECT id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text
       FROM hrms_depreciation_runs
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    const run = runResult.rows[0];
    if (!run) {
      await client.query("COMMIT");
      return { deleted: false, blockedFinal: false };
    }
    if (run.is_final_for_fy && !options.allowFinalOverride) {
      await insertDepreciationRunAudit(client, {
        depreciationRunId: run.id,
        action: "DELETE_BLOCKED_FINAL",
        actor: options.actor,
        overrideUsed: false,
        metadata: {
          runTitle: run.dep_title,
          fiscalYearStart: run.fiscal_year_start,
          reason: "final_run_requires_super_admin_override",
        },
      });
      await client.query("COMMIT");
      return { deleted: false, blockedFinal: true };
    }

    // Audit must be inserted while the run row still exists: FK on
    // `depreciation_run_id` would reject an insert after DELETE.
    await insertDepreciationRunAudit(client, {
      depreciationRunId: run.id,
      action: "DELETE",
      actor: options.actor,
      overrideUsed: run.is_final_for_fy && options.allowFinalOverride,
      metadata: {
        runTitle: run.dep_title,
        fiscalYearStart: run.fiscal_year_start,
        wasFinalForFy: run.is_final_for_fy,
      },
    });
    await client.query(`DELETE FROM hrms_depreciation_runs WHERE id = $1`, [id]);
    await client.query("COMMIT");
    return { deleted: true, blockedFinal: false };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function voidDepreciationRun(
  id: number,
  actor: DepreciationRunActor
): Promise<DepreciationRunRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query<DepreciationRunRow>(
      `SELECT id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text
       FROM hrms_depreciation_runs
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      await client.query("COMMIT");
      return null;
    }

    const updateResult = await client.query<DepreciationRunRow>(
      `UPDATE hrms_depreciation_runs
       SET status = 'void',
           is_final_for_fy = false,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, depreciation_scope_mode, remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text`,
      [id]
    );
    const updated = updateResult.rows[0] ?? null;
    if (!updated) {
      await client.query("ROLLBACK");
      throw new Error("Failed to void depreciation run.");
    }
    await insertDepreciationRunAudit(client, {
      depreciationRunId: id,
      action: "VOID",
      actor,
      overrideUsed: false,
      metadata: {
        runTitle: existing.dep_title,
        fiscalYearStart: existing.fiscal_year_start,
        priorStatus: existing.status,
        priorFinalForFy: existing.is_final_for_fy,
      },
    });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
