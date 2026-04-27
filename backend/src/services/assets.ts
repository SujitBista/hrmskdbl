import { pool, query } from "../db.js";
import { clampListParams } from "./groups.js";
import { refreshMutableDepreciationRunsForAsset } from "./depreciationRuns.js";

const ASSET_CODE_PREFIX = "SKDBL";
const MAX_AUTO_ASSET_CODE_RETRIES = 10;

export type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_id: number | null;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  old_book_value: string | null;
  purchase_invoice_no: string | null;
  created_at: string;
};

export type CreateAssetInput = {
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_id: number | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: number | null;
  unit_rate: number | null;
  /** Optional; when positive, depreciation runs use this as cost basis instead of qty × unit rate. */
  old_book_value: number | null;
  purchase_invoice_no: string | null;
  /** Legacy / manual code; omit or null to auto-generate SKDBL/… */
  asset_code: string | null;
};

/**
 * Branch segment for asset codes: strips wrapping `()`, `[]`, `{}` and `BC:` (any
 * case), then uses the numeric part only (zero-padded to 3 digits when short).
 * Non-BC branch codes that are not all-digits are returned without brackets.
 */
export function formatBranchCodeSegment(branchCode: string): string {
  let t = branchCode
    .trim()
    .replace(/[()[\]{}]/g, "")
    .trim();
  if (/^BC\s*:/i.test(t)) {
    const rest = t.replace(/^BC\s*:\s*/i, "").trim();
    const m = rest.match(/\d+/);
    if (m) {
      return m[0]!.padStart(3, "0");
    }
    return rest.length > 0 ? rest : t;
  }
  if (/^\d+$/.test(t)) {
    return t.padStart(3, "0");
  }
  return t;
}

/**
 * Builds SKDBL/{branch}/{group}/{YYYY}/{MM}/{DD}/{######}.
 * The last segment is always `hrms_assets.id` (SERIAL primary key), zero-padded to 6 digits.
 */
export function buildAssetCode(params: {
  /** Primary key `hrms_assets.id` — must match the row this code is stored on. */
  hrmsAssetId: number;
  branchCode: string;
  assetGroupCode: string;
  purchaseDateBs: string;
}): string {
  const branch = formatBranchCodeSegment(params.branchCode);
  const group = params.assetGroupCode.trim().toUpperCase();
  const parts = params.purchaseDateBs.trim().split("/").map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  const [y, m, d] = parts;
  const yNum = Number.parseInt(y!, 10);
  const mNum = Number.parseInt(m!, 10);
  const dNum = Number.parseInt(d!, 10);
  if (
    !Number.isFinite(yNum) ||
    !Number.isFinite(mNum) ||
    !Number.isFinite(dNum)
  ) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  const yy = String(yNum);
  const mm = String(mNum).padStart(2, "0");
  const dd = String(dNum).padStart(2, "0");
  const idPart = String(params.hrmsAssetId).padStart(6, "0");
  return `${ASSET_CODE_PREFIX}/${branch}/${group}/${yy}/${mm}/${dd}/${idPart}`;
}

function isAssetCodeUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const e = err as { code?: string; message?: string };
  return (
    e.code === "23505" &&
    (/hrms_assets_asset_code|asset_code/i.test(e.message ?? "") ||
      /duplicate key/i.test(e.message ?? ""))
  );
}

function buildAssetCodeRetryCandidate(baseCode: string, attempt: number): string {
  if (attempt <= 0) {
    return baseCode;
  }
  const suffix = `-${attempt}`;
  const maxBaseLength = 256 - suffix.length;
  if (baseCode.length <= maxBaseLength) {
    return `${baseCode}${suffix}`;
  }
  return `${baseCode.slice(0, Math.max(0, maxBaseLength))}${suffix}`;
}

export function parseCreateAssetPayload(body: unknown): CreateAssetInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;

  const asset_name =
    typeof b.asset_name === "string" ? b.asset_name.trim() : "";
  const group_id = Number.isFinite(Number(b.group_id))
    ? Math.floor(Number(b.group_id))
    : NaN;
  const sub_group_id =
    b.sub_group_id === null || b.sub_group_id === undefined
      ? null
      : Number.isFinite(Number(b.sub_group_id))
        ? Math.floor(Number(b.sub_group_id))
        : NaN;
  const ownership_type =
    typeof b.ownership_type === "string" ? b.ownership_type.trim() : "";
  const working_status =
    typeof b.working_status === "string" ? b.working_status.trim() : "";
  const branch_id = Number.isFinite(Number(b.branch_id))
    ? Math.floor(Number(b.branch_id))
    : NaN;
  let department_id: number | null = null;
  if (b.department_id !== null && b.department_id !== undefined && b.department_id !== "") {
    const raw =
      typeof b.department_id === "number"
        ? b.department_id
        : Number(b.department_id);
    if (!Number.isFinite(raw) || raw < 1) {
      throw new Error("Invalid department.");
    }
    department_id = Math.floor(raw);
  }
  const purchase_date_bs =
    typeof b.purchase_date_bs === "string" ? b.purchase_date_bs.trim() : "";
  const depreciation_start_date_bs =
    typeof b.depreciation_start_date_bs === "string"
      ? b.depreciation_start_date_bs.trim()
      : "";

  const purchase_qty = parseOptionalNumber(b.purchase_qty);
  const unit_rate = parseOptionalNumber(b.unit_rate);
  let old_book_value: number | null = null;
  if (
    b.old_book_value !== null &&
    b.old_book_value !== undefined &&
    b.old_book_value !== ""
  ) {
    const parsedOb = parseOptionalNumber(b.old_book_value);
    if (parsedOb === null) {
      throw new Error("Invalid old book value.");
    }
    if (parsedOb < 0) {
      throw new Error("Old book value cannot be negative.");
    }
    old_book_value = parsedOb === 0 ? null : parsedOb;
  }
  const purchase_invoice_no =
    typeof b.purchase_invoice_no === "string" &&
    b.purchase_invoice_no.trim() !== ""
      ? b.purchase_invoice_no.trim()
      : null;

  let asset_code: string | null = null;
  if (b.asset_code !== null && b.asset_code !== undefined && b.asset_code !== "") {
    if (typeof b.asset_code !== "string") {
      throw new Error("Invalid asset code.");
    }
    const t = b.asset_code.trim();
    if (t !== "") {
      if (t.length > 256) {
        throw new Error("Asset code must be at most 256 characters.");
      }
      asset_code = t;
    }
  }

  if (!asset_name) {
    throw new Error("Asset name is required.");
  }
  if (!Number.isFinite(group_id) || group_id < 1) {
    throw new Error("A valid asset group is required.");
  }
  if (sub_group_id !== null && (!Number.isFinite(sub_group_id) || sub_group_id < 1)) {
    throw new Error("A valid asset sub group is required when provided.");
  }
  if (!ownership_type) {
    throw new Error("Ownership type is required.");
  }
  if (!working_status) {
    throw new Error("Working status is required.");
  }
  if (!Number.isFinite(branch_id) || branch_id < 1) {
    throw new Error("A valid branch is required.");
  }
  if (!purchase_date_bs) {
    throw new Error("Purchase date is required.");
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(purchase_date_bs)) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  if (!depreciation_start_date_bs) {
    throw new Error("Depreciation start date is required.");
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(depreciation_start_date_bs)) {
    throw new Error(
      "Depreciation start date must be YYYY/MM/DD (Bikram Sambat)."
    );
  }

  return {
    asset_name,
    group_id,
    sub_group_id,
    ownership_type,
    working_status,
    branch_id,
    department_id,
    purchase_date_bs,
    depreciation_start_date_bs,
    purchase_qty,
    unit_rate,
    old_book_value,
    purchase_invoice_no,
    asset_code,
  };
}

function resolveAssetCodeForRow(
  input: CreateAssetInput,
  hrmsAssetId: number,
  refs: { branch_code: string; group_code: string }
): string {
  if (input.asset_code != null) {
    return input.asset_code;
  }
  return buildAssetCode({
    hrmsAssetId,
    branchCode: refs.branch_code,
    assetGroupCode: refs.group_code,
    purchaseDateBs: input.purchase_date_bs,
  });
}

function parseOptionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error("Invalid numeric value.");
  }
  return n;
}

async function resolveAssetRefs(
  input: CreateAssetInput
): Promise<{ branch_code: string; group_code: string }> {
  const branchRow = await query<{ branch_code: string }>(
    `SELECT branch_code FROM hrms_branches WHERE id = $1`,
    [input.branch_id]
  );
  const branch = branchRow.rows[0];
  if (!branch) {
    throw new Error("Branch not found.");
  }

  const groupRow = await query<{ code: string }>(
    `SELECT code FROM hrms_groups WHERE id = $1`,
    [input.group_id]
  );
  const grp = groupRow.rows[0];
  if (!grp) {
    throw new Error("Asset group not found.");
  }

  const subCount = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_sub_groups WHERE group_id = $1`,
    [input.group_id]
  );
  const nSub = Number(subCount.rows[0]?.n ?? 0);
  if (nSub > 0 && input.sub_group_id === null) {
    throw new Error("Select an asset sub group for this asset group.");
  }
  if (nSub === 0 && input.sub_group_id !== null) {
    throw new Error("This asset group has no sub groups.");
  }

  if (input.sub_group_id !== null) {
    const sg = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_sub_groups
       WHERE id = $1 AND group_id = $2`,
      [input.sub_group_id, input.group_id]
    );
    if (Number(sg.rows[0]?.n ?? 0) === 0) {
      throw new Error("Asset sub group does not belong to the selected group.");
    }
  }

  return { branch_code: branch.branch_code, group_code: grp.code };
}

async function assertDepartmentExists(
  department_id: number | null
): Promise<void> {
  if (department_id === null) {
    return;
  }
  const r = await query<{ id: number }>(
    `SELECT id FROM hrms_departments WHERE id = $1`,
    [department_id]
  );
  if (!r.rows[0]) {
    throw new Error("Department not found.");
  }
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  await assertDepartmentExists(input.department_id);
  const refs = await resolveAssetRefs(input);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query<{
      id: number;
      created_at: string;
    }>(
      `INSERT INTO hrms_assets (
        asset_name, group_id, sub_group_id, ownership_type, working_status,
        branch_id, department_id, purchase_date_bs, depreciation_start_date_bs,
        purchase_qty, unit_rate, purchase_invoice_no, old_book_value
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, created_at::text`,
      [
        input.asset_name,
        input.group_id,
        input.sub_group_id,
        input.ownership_type,
        input.working_status,
        input.branch_id,
        input.department_id,
        input.purchase_date_bs,
        input.depreciation_start_date_bs,
        input.purchase_qty,
        input.unit_rate,
        input.purchase_invoice_no,
        input.old_book_value,
      ]
    );

    const row = insert.rows[0];
    if (!row) {
      throw new Error("Failed to create asset.");
    }

    const baseAssetCode = resolveAssetCodeForRow(input, row.id, refs);
    const isAutoGenerated = input.asset_code == null;

    let updated: { rows: Asset[] } | null = null;
    for (let attempt = 0; attempt <= MAX_AUTO_ASSET_CODE_RETRIES; attempt += 1) {
      const candidateCode = isAutoGenerated
        ? buildAssetCodeRetryCandidate(baseAssetCode, attempt)
        : baseAssetCode;
      try {
        updated = await client.query<Asset>(
          `UPDATE hrms_assets AS a SET asset_code = $1 WHERE a.id = $2
           RETURNING a.id, a.asset_code, a.asset_name, a.group_id, a.sub_group_id,
             a.ownership_type, a.working_status, a.branch_id, a.department_id,
             (SELECT d.name FROM hrms_departments d WHERE d.id = a.department_id) AS department_name,
             a.purchase_date_bs,
             a.depreciation_start_date_bs,
             a.purchase_qty::text, a.unit_rate::text, a.old_book_value::text, a.purchase_invoice_no,
             a.created_at::text`,
          [candidateCode, row.id]
        );
        break;
      } catch (err) {
        if (
          isAutoGenerated &&
          isAssetCodeUniqueViolation(err) &&
          attempt < MAX_AUTO_ASSET_CODE_RETRIES
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!updated) {
      throw new Error("Could not generate a unique asset code. Please retry.");
    }

    await client.query("COMMIT");

    const out = updated.rows[0];
    if (!out) {
      throw new Error("Failed to load asset after save.");
    }
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAsset(
  id: number,
  input: CreateAssetInput
): Promise<Asset | null> {
  const existing = await query<{ id: number; depreciation_start_date_bs: string }>(
    `SELECT id, depreciation_start_date_bs
     FROM hrms_assets
     WHERE id = $1`,
    [id]
  );
  const prev = existing.rows[0];
  if (!prev) {
    return null;
  }

  await assertDepartmentExists(input.department_id);
  const refs = await resolveAssetRefs(input);
  const baseAssetCode = resolveAssetCodeForRow(input, id, refs);
  const isAutoGenerated = input.asset_code == null;
  let result: { rows: Asset[] } | null = null;

  for (let attempt = 0; attempt <= MAX_AUTO_ASSET_CODE_RETRIES; attempt += 1) {
    const candidateCode = isAutoGenerated
      ? buildAssetCodeRetryCandidate(baseAssetCode, attempt)
      : baseAssetCode;
    try {
      result = await query<Asset>(
        `UPDATE hrms_assets AS a SET
          asset_code = $1,
          asset_name = $2,
          group_id = $3,
          sub_group_id = $4,
          ownership_type = $5,
          working_status = $6,
          branch_id = $7,
          department_id = $8,
          purchase_date_bs = $9,
          depreciation_start_date_bs = $10,
          purchase_qty = $11,
          unit_rate = $12,
          purchase_invoice_no = $13,
          old_book_value = $14
        WHERE a.id = $15
        RETURNING a.id, a.asset_code, a.asset_name, a.group_id, a.sub_group_id,
          a.ownership_type, a.working_status, a.branch_id, a.department_id,
          (SELECT d.name FROM hrms_departments d WHERE d.id = a.department_id) AS department_name,
          a.purchase_date_bs,
          a.depreciation_start_date_bs,
          a.purchase_qty::text, a.unit_rate::text, a.old_book_value::text, a.purchase_invoice_no,
          a.created_at::text`,
        [
          candidateCode,
          input.asset_name,
          input.group_id,
          input.sub_group_id,
          input.ownership_type,
          input.working_status,
          input.branch_id,
          input.department_id,
          input.purchase_date_bs,
          input.depreciation_start_date_bs,
          input.purchase_qty,
          input.unit_rate,
          input.purchase_invoice_no,
          input.old_book_value,
          id,
        ]
      );
      break;
    } catch (err) {
      if (
        isAutoGenerated &&
        isAssetCodeUniqueViolation(err) &&
        attempt < MAX_AUTO_ASSET_CODE_RETRIES
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    throw new Error("Could not generate a unique asset code. Please retry.");
  }
  const updated = result.rows[0] ?? null;
  if (!updated) {
    return null;
  }

  if (prev.depreciation_start_date_bs !== input.depreciation_start_date_bs) {
    await refreshMutableDepreciationRunsForAsset(id);
  }

  return updated;
}

export async function deleteAsset(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_assets WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export type AssetListRow = {
  id: number;
  group_id: number;
  sub_group_id: number | null;
  branch_id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_code: string;
  /** From `hrms_groups.dep_method` (Straight Line / Declining Balance). */
  group_dep_method: string | null;
  /** From `hrms_groups.dep_rate` (%). */
  group_dep_rate: string | null;
  sub_group_name: string | null;
  branch_code: string;
  branch_name: string;
  ownership_type: string;
  working_status: string;
  department_id: number | null;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  old_book_value: string | null;
  purchase_invoice_no: string | null;
  created_at: string;
};

export type ListAssetsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListAssetsResult = {
  assets: AssetListRow[];
  total: number;
  page: number;
  pageSize: number;
};

const ASSET_LIST_SELECT = `
  SELECT a.id,
    a.group_id,
    a.sub_group_id,
    a.branch_id,
    a.asset_code,
    a.asset_name,
    g.name AS group_name,
    g.code AS group_code,
    g.dep_method AS group_dep_method,
    g.dep_rate::text AS group_dep_rate,
    sg.name AS sub_group_name,
    b.branch_code,
    b.branch_name,
    a.ownership_type,
    a.working_status,
    a.department_id,
    d.name AS department_name,
    a.purchase_date_bs,
    a.depreciation_start_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text,
    a.old_book_value::text,
    a.purchase_invoice_no,
    a.created_at::text
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_departments d ON d.id = a.department_id
`;

export async function listAssets(
  params: ListAssetsParams
): Promise<ListAssetsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_assets`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<AssetListRow>(
      `${ASSET_LIST_SELECT}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { assets: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM hrms_assets a
     INNER JOIN hrms_groups g ON g.id = a.group_id
     INNER JOIN hrms_branches b ON b.id = a.branch_id
     LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
     LEFT JOIN hrms_departments d ON d.id = a.department_id
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(d.name, '') ILIKE $1
     )`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<AssetListRow>(
    `${ASSET_LIST_SELECT}
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(d.name, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { assets: list.rows, total, page, pageSize };
}
