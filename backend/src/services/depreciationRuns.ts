import { pool, query } from "../db.js";
import {
  bsDateFromJsDate,
  compareBsDateString,
  computeAssetQuarterCumulative,
  fiscalQuarterEndBs,
  fiscalQuarterFromNepaliCalendarMonthIndex,
  fiscalYearStartFromBsDate,
  NEPALI_MONTHS_ORDERED_EN,
  nepaliCalendarMonthIndexFromBs,
  maxEligibleQuarter,
  nepaliMonthNameToCalendarIndex,
  normalizeBsDateEnglish,
  parseDepreciationMethod,
  type DepreciationCalculationMode,
} from "@hrmskdbl/depreciation-core";

export type DepreciationRunRow = {
  id: number;
  fiscal_year_start: number;
  dep_title: string;
  quarter_no: number;
  months_covered: number;
  calculation_date_ad: string;
  calculation_date_bs: string;
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
  fiscal_year: number;
  asset_name: string;
  purchase_date_bs: string;
  purchase_price: string;
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
  balance_amount: string;
  created_at: string;
};

type AssetDepRow = {
  id: number;
  asset_name: string;
  group_name: string;
  group_dep_method: string | null;
  group_dep_rate: string | null;
  sub_group_name: string | null;
  branch_name: string;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
};

const ASSET_SELECT = `
  SELECT a.id,
    a.asset_name,
    g.name AS group_name,
    g.dep_method AS group_dep_method,
    g.dep_rate::text AS group_dep_rate,
    sg.name AS sub_group_name,
    b.branch_name,
    a.purchase_date_bs,
    a.depreciation_start_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
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

function parseDepRatePercent(rate: string | null): number | null {
  if (rate == null || rate === "") return null;
  const n = Number.parseFloat(rate);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function loadAssetsForRun(
  branchId: number | null
): Promise<AssetDepRow[]> {
  if (branchId === null) {
    const r = await query<AssetDepRow>(
      `${ASSET_SELECT} ORDER BY a.id ASC`
    );
    return r.rows;
  }
  const r = await query<AssetDepRow>(
    `${ASSET_SELECT} WHERE a.branch_id = $1 ORDER BY a.id ASC`,
    [branchId]
  );
  return r.rows;
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
        calculation_date_ad::text, calculation_date_bs, remarks, is_final_for_fy,
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
      calculation_date_ad::text, calculation_date_bs, remarks, is_final_for_fy,
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
      calculation_date_ad::text, calculation_date_bs, remarks, is_final_for_fy,
      status, branch_id, created_at::text, updated_at::text
     FROM hrms_depreciation_runs WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function listDetailsForRun(
  runId: number
): Promise<DepreciationRunDetailRow[]> {
  const r = await query<DepreciationRunDetailRow>(
    `SELECT d.id, d.depreciation_run_id, d.asset_id, a.asset_code, d.fiscal_year,
      d.asset_name, a.purchase_date_bs,
      (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::text AS purchase_price,
      d.dep_rate::text, d.dep_days, d.dep_amount::text, d.group_name, d.sub_group_name,
      d.branch_name, d.book_value::text, d.accumulate_dep::text, d.dep_formula,
      d.dep_start_date_bs, d.balance_amount::text, d.created_at::text
     FROM hrms_depreciation_run_details d
     INNER JOIN hrms_assets a ON a.id = d.asset_id
     WHERE d.depreciation_run_id = $1
     ORDER BY d.asset_id ASC`,
    [runId]
  );
  return r.rows;
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
  /** Optional BS date for the run; defaults to server “today” in BS. */
  calculationDateBs?: string | null;
};

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

  const customTitle = input.depTitle?.trim();
  const depTitle =
    customTitle && customTitle.length > 0
      ? customTitle.slice(0, 255)
      : "Fiscal Year Depreciation";
  const monthsCovered = 12;
  const isFinal = true;

  const calculationDateBs = (() => {
    const raw = input.calculationDateBs;
    if (raw != null && String(raw).trim() !== "") {
      return normalizeBsDateEnglish(String(raw).trim());
    }
    return bsDateFromJsDate(new Date());
  })();
  if (!calculationDateBs) {
    throw new Error("Invalid calculation date (BS).");
  }

  const assets = await loadAssetsForRun(branchId);
  const skippedAssets: DepreciationSkippedAsset[] = [];

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

    /** One FY sheet per branch scope; replace so new/changed assets are included. */
    await client.query(
      `DELETE FROM hrms_depreciation_runs
       WHERE fiscal_year_start = $1
         AND COALESCE(branch_id, -1) = COALESCE($2, -1)`,
      [fy, branchId]
    );

    const ins = await client.query<DepreciationRunRow>(
      `INSERT INTO hrms_depreciation_runs (
        fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad, calculation_date_bs, remarks, is_final_for_fy,
        status, branch_id, updated_at
      ) VALUES (
        $1, $2, $3, $4, NOW(), $5, $6, $7, 'posted', $8, NOW()
      )
      RETURNING id, fiscal_year_start, dep_title, quarter_no, months_covered,
        calculation_date_ad::text, calculation_date_bs, remarks, is_final_for_fy,
        status, branch_id, created_at::text, updated_at::text`,
      [
        fy,
        depTitle,
        quarterNo,
        monthsCovered,
        calculationDateBs,
        input.remarks?.trim() ?? null,
        isFinal,
        branchId,
      ]
    );

    const run = ins.rows[0];
    if (!run) {
      throw new Error("Failed to create depreciation run.");
    }

    let detailsInserted = 0;

    for (const a of assets) {
      const purchaseAmount = parsePurchaseAmount(a.purchase_qty, a.unit_rate);
      const depRate = parseDepRatePercent(a.group_dep_rate);
      const method = parseDepreciationMethod(a.group_dep_method);
      const depStartRaw =
        a.depreciation_start_date_bs?.trim() || a.purchase_date_bs;
      const depreciationStartBs = normalizeBsDateEnglish(depStartRaw);

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
            ? "Invalid or missing purchase cost (qty × unit rate must be > 0)."
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

      const computed = computeAssetQuarterCumulative({
        purchaseAmount,
        depreciationStartBs,
        depRatePercent: depRate,
        method,
        calculationMode,
        fiscalYearStart: fy,
        quarter: quarterNo,
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

      await client.query(
        `INSERT INTO hrms_depreciation_run_details (
          depreciation_run_id, asset_id, fiscal_year, asset_name, dep_rate,
          dep_days, dep_amount, group_name, sub_group_name, branch_name,
          book_value, accumulate_dep, dep_formula, dep_start_date_bs,
          balance_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          run.id,
          a.id,
          fy,
          a.asset_name,
          depRate,
          d.depDays,
          d.depAmount,
          a.group_name,
          a.sub_group_name,
          a.branch_name,
          d.bookValue,
          d.accumulateDep,
          d.depFormula,
          depreciationStartBs,
          d.balanceAmount,
        ]
      );
      detailsInserted += 1;
    }

    if (detailsInserted === 0) {
      await client.query("ROLLBACK");
      throw new Error(
        "No depreciation rows were generated. Ensure assets have valid cost (qty × rate), group depreciation rate and method, and depreciation start dates that fall on or before the selected fiscal year end."
      );
    }

    await client.query("COMMIT");
    return { run, detailsInserted, skippedAssets };
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
       calculation_date_ad::text, calculation_date_bs, remarks, is_final_for_fy,
       status, branch_id, created_at::text, updated_at::text`,
    [id, remarks?.trim() ?? null]
  );
  return r.rows[0] ?? null;
}

export async function deleteDepreciationRun(id: number): Promise<boolean> {
  const r = await query(`DELETE FROM hrms_depreciation_runs WHERE id = $1`, [
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}
