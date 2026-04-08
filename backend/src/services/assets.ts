import { pool, query } from "../db.js";
import { clampListParams } from "./groups.js";

const ASSET_CODE_PREFIX = "SKDBL";

export type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_name: string | null;
  purchase_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  purchase_invoice_no: string | null;
  lifetime_years: number | null;
  salvage_value: string | null;
  created_at: string;
};

export type CreateAssetInput = {
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_name: string | null;
  purchase_date_bs: string;
  purchase_qty: number | null;
  unit_rate: number | null;
  purchase_invoice_no: string | null;
  lifetime_years: number | null;
  salvage_value: number | null;
};

/** Branch segment: 3-digit numeric style when possible (e.g. 021). */
export function formatBranchCodeSegment(branchCode: string): string {
  const t = branchCode.trim();
  if (/^\d+$/.test(t)) {
    return t.padStart(3, "0");
  }
  return t;
}

/** Builds SKDBL/{branch}/{group}/{YYYY}/{MM}/{DD}/{000001} — asset id is 1…n, padded to 6 digits. */
export function buildAssetCode(params: {
  assetId: number;
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
  const idPart = String(params.assetId).padStart(6, "0");
  return `${ASSET_CODE_PREFIX}/${branch}/${group}/${yy}/${mm}/${dd}/${idPart}`;
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
  const department_name =
    typeof b.department_name === "string" && b.department_name.trim() !== ""
      ? b.department_name.trim()
      : null;
  const purchase_date_bs =
    typeof b.purchase_date_bs === "string" ? b.purchase_date_bs.trim() : "";

  const purchase_qty = parseOptionalNumber(b.purchase_qty);
  const unit_rate = parseOptionalNumber(b.unit_rate);
  const purchase_invoice_no =
    typeof b.purchase_invoice_no === "string" &&
    b.purchase_invoice_no.trim() !== ""
      ? b.purchase_invoice_no.trim()
      : null;
  const lifetime_years = parseOptionalInt(b.lifetime_years);
  const salvage_value = parseOptionalNumber(b.salvage_value);

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

  return {
    asset_name,
    group_id,
    sub_group_id,
    ownership_type,
    working_status,
    branch_id,
    department_name,
    purchase_date_bs,
    purchase_qty,
    unit_rate,
    purchase_invoice_no,
    lifetime_years,
    salvage_value,
  };
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

function parseOptionalInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) {
    throw new Error("Invalid integer value.");
  }
  return Math.floor(n);
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query<{
      id: number;
      created_at: string;
    }>(
      `INSERT INTO hrms_assets (
        asset_name, group_id, sub_group_id, ownership_type, working_status,
        branch_id, department_name, purchase_date_bs, purchase_qty, unit_rate,
        purchase_invoice_no, lifetime_years, salvage_value
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
        input.department_name,
        input.purchase_date_bs,
        input.purchase_qty,
        input.unit_rate,
        input.purchase_invoice_no,
        input.lifetime_years,
        input.salvage_value,
      ]
    );

    const row = insert.rows[0];
    if (!row) {
      throw new Error("Failed to create asset.");
    }

    const asset_code = buildAssetCode({
      assetId: row.id,
      branchCode: branch.branch_code,
      assetGroupCode: grp.code,
      purchaseDateBs: input.purchase_date_bs,
    });

    const updated = await client.query<Asset>(
      `UPDATE hrms_assets SET asset_code = $1 WHERE id = $2
       RETURNING id, asset_code, asset_name, group_id, sub_group_id,
         ownership_type, working_status, branch_id, department_name, purchase_date_bs,
         purchase_qty::text, unit_rate::text, purchase_invoice_no, lifetime_years,
         salvage_value::text, created_at::text`,
      [asset_code, row.id]
    );

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

export type AssetListRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_code: string;
  sub_group_name: string | null;
  branch_code: string;
  branch_name: string;
  ownership_type: string;
  working_status: string;
  department_name: string | null;
  purchase_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  purchase_invoice_no: string | null;
  lifetime_years: number | null;
  salvage_value: string | null;
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
    a.asset_code,
    a.asset_name,
    g.name AS group_name,
    g.code AS group_code,
    sg.name AS sub_group_name,
    b.branch_code,
    b.branch_name,
    a.ownership_type,
    a.working_status,
    a.department_name,
    a.purchase_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text,
    a.purchase_invoice_no,
    a.lifetime_years,
    a.salvage_value::text,
    a.created_at::text
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
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
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1
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
       COALESCE(sg.name, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { assets: list.rows, total, page, pageSize };
}
