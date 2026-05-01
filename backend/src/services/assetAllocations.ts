import { pool, query } from "../db.js";
import { clampListParams } from "./groups.js";
import type pg from "pg";

export const ALLOCATION_TYPES = ["NEW_ALLOCATION", "TRANSFER"] as const;
export const ALLOCATION_STATUSES = ["ACTIVE", "CLOSED"] as const;

export type AllocationType = (typeof ALLOCATION_TYPES)[number];
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

type DbExecutor = Pick<pg.Pool, "query"> | pg.PoolClient;

/** Bikram Sambat YYYY/MM/DD — lexicographic compare matches chronological when fixed width. */
export function compareBsDates(a: string, b: string): number {
  const pa = a.trim().split("/");
  const pb = b.trim().split("/");
  if (pa.length !== 3 || pb.length !== 3) return 0;
  const ya = Number.parseInt(pa[0]!, 10);
  const ma = Number.parseInt(pa[1]!, 10);
  const da = Number.parseInt(pa[2]!, 10);
  const yb = Number.parseInt(pb[0]!, 10);
  const mb = Number.parseInt(pb[1]!, 10);
  const db = Number.parseInt(pb[2]!, 10);
  if (
    [ya, ma, da, yb, mb, db].some(
      (n) => !Number.isFinite(n) || n < 0
    )
  ) {
    return 0;
  }
  if (ya !== yb) return ya < yb ? -1 : 1;
  if (ma !== mb) return ma < mb ? -1 : 1;
  if (da !== db) return da < db ? -1 : 1;
  return 0;
}

export type AssetAllocationListRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  book_value: string | null;
  old_book_value: string | null;
  group_name: string;
  group_code: string;
  sub_group_name: string | null;
  working_status: string;
  allocation_branch_id: number | null;
  allocation_branch_name: string | null;
  allocation_department_id: number | null;
  allocation_department_name: string | null;
  allocation_type: string | null;
  allocation_date_bs: string | null;
};

export type ListAssetAllocationsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListAssetAllocationsResult = {
  rows: AssetAllocationListRow[];
  total: number;
  page: number;
  pageSize: number;
};

const ALLOCATION_LIST_SELECT = `
  SELECT
    a.id,
    a.asset_code,
    a.asset_name,
    a.purchase_date_bs,
    a.depreciation_start_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text,
    a.book_value::text,
    a.old_book_value::text,
    g.name AS group_name,
    g.code AS group_code,
    sg.name AS sub_group_name,
    a.working_status,
    COALESCE(aa.branch_id, a.current_branch_id, a.branch_id) AS allocation_branch_id,
    b_alloc.branch_name AS allocation_branch_name,
    COALESCE(aa.department_id, a.current_department_id, a.department_id) AS allocation_department_id,
    d_alloc.name AS allocation_department_name,
    aa.allocation_type::text AS allocation_type,
    aa.allocation_date_bs AS allocation_date_bs
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_asset_allocations aa
    ON aa.id = a.current_allocation_id
  LEFT JOIN hrms_branches b_alloc ON b_alloc.id = COALESCE(aa.branch_id, a.current_branch_id, a.branch_id)
  LEFT JOIN hrms_departments d_alloc ON d_alloc.id = COALESCE(aa.department_id, a.current_department_id, a.department_id)
`;

export async function listAssetAllocationsView(
  params: ListAssetAllocationsParams
): Promise<ListAssetAllocationsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_assets`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<AssetAllocationListRow>(
      `${ALLOCATION_LIST_SELECT}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { rows: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM hrms_assets a
     INNER JOIN hrms_groups g ON g.id = a.group_id
     LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
     LEFT JOIN hrms_branches b ON b.id = a.branch_id
     LEFT JOIN hrms_asset_allocations aa ON aa.id = a.current_allocation_id
     LEFT JOIN hrms_branches b_alloc ON b_alloc.id = COALESCE(aa.branch_id, a.current_branch_id, a.branch_id)
     LEFT JOIN hrms_departments d_alloc ON d_alloc.id = COALESCE(aa.department_id, a.current_department_id, a.department_id)
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(b_alloc.branch_name, '') ILIKE $1 OR
       COALESCE(d_alloc.name, '') ILIKE $1
     )`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<AssetAllocationListRow>(
    `${ALLOCATION_LIST_SELECT}
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       EXISTS (
         SELECT 1 FROM hrms_branches b2
         WHERE b2.id = a.branch_id
         AND (b2.branch_name ILIKE $1 OR b2.branch_code ILIKE $1)
       ) OR
       COALESCE(b_alloc.branch_name, '') ILIKE $1 OR
       COALESCE(d_alloc.name, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { rows: list.rows, total, page, pageSize };
}

/**
 * After a new asset row exists: one ACTIVE NEW_ALLOCATION (branch and/or department on register).
 * Idempotent if an ACTIVE allocation already exists.
 */
export async function ensureInitialAllocationForNewAsset(
  client: DbExecutor,
  params: {
    assetId: number;
    branchId: number;
    departmentId: number | null;
    purchaseDateBs: string;
  }
): Promise<void> {
  const hasBranch = Number.isFinite(params.branchId) && params.branchId >= 1;
  const hasDept = params.departmentId !== null && params.departmentId >= 1;
  if (!hasBranch && !hasDept) {
    return;
  }
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM hrms_asset_allocations
     WHERE asset_id = $1 AND status = 'ACTIVE'
     LIMIT 1`,
    [params.assetId]
  );
  if (existing.rows[0]) {
    return;
  }

  const branchIdForRow = hasBranch ? params.branchId : null;
  const ins = await client.query<{ id: number }>(
    `INSERT INTO hrms_asset_allocations (
       asset_id, allocation_type, allocation_date_bs, branch_id, department_id, status, updated_at
     ) VALUES ($1, 'NEW_ALLOCATION', $2, $3, $4, 'ACTIVE', NOW())
     RETURNING id`,
    [
      params.assetId,
      params.purchaseDateBs,
      branchIdForRow,
      hasDept ? params.departmentId : null,
    ]
  );
  const allocId = ins.rows[0]?.id;
  if (!allocId) {
    throw new Error("Failed to create initial allocation.");
  }

  await client.query(
    `UPDATE hrms_assets SET
       current_allocation_id = $1,
       current_branch_id = $2,
       current_department_id = $3
     WHERE id = $4`,
    [
      allocId,
      hasBranch ? params.branchId : null,
      hasDept ? params.departmentId : null,
      params.assetId,
    ]
  );
}

export type TransferAllocationInput = {
  allocationDateBs: string;
  branchId: number;
  departmentId: number | null;
};

export function parseTransferAllocationBody(body: unknown): TransferAllocationInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const allocationDateBs =
    typeof b.allocation_date_bs === "string"
      ? b.allocation_date_bs.trim()
      : "";
  const branchId = Number.isFinite(Number(b.branch_id))
    ? Math.floor(Number(b.branch_id))
    : NaN;
  let departmentId: number | null = null;
  if (
    b.department_id !== null &&
    b.department_id !== undefined &&
    b.department_id !== ""
  ) {
    const raw =
      typeof b.department_id === "number"
        ? b.department_id
        : Number(b.department_id);
    if (!Number.isFinite(raw) || raw < 1) {
      throw new Error("Invalid department.");
    }
    departmentId = Math.floor(raw);
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(allocationDateBs)) {
    throw new Error("Allocation date must be YYYY/MM/DD (Bikram Sambat).");
  }
  if (!Number.isFinite(branchId) || branchId < 1) {
    throw new Error("A valid branch is required.");
  }
  return { allocationDateBs, branchId, departmentId };
}

export async function transferAssetAllocation(
  assetId: number,
  input: TransferAllocationInput
): Promise<{ allocationId: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const assetRow = await client.query<{
      id: number;
      working_status: string;
      purchase_date_bs: string;
    }>(
      `SELECT id, working_status, purchase_date_bs
       FROM hrms_assets WHERE id = $1 FOR UPDATE`,
      [assetId]
    );
    const asset = assetRow.rows[0];
    if (!asset) {
      await client.query("ROLLBACK");
      throw new Error("Asset not found.");
    }
    if (asset.working_status.trim() === "Retired") {
      await client.query("ROLLBACK");
      throw new Error("Cannot transfer allocation for a retired asset.");
    }

    if (compareBsDates(input.allocationDateBs, asset.purchase_date_bs) < 0) {
      await client.query("ROLLBACK");
      throw new Error("Allocation date must be on or after the purchase date.");
    }

    const branchOk = await client.query<{ id: number }>(
      `SELECT id FROM hrms_branches WHERE id = $1`,
      [input.branchId]
    );
    if (!branchOk.rows[0]) {
      await client.query("ROLLBACK");
      throw new Error("Branch not found.");
    }
    if (input.departmentId !== null) {
      const depOk = await client.query<{ id: number }>(
        `SELECT id FROM hrms_departments WHERE id = $1`,
        [input.departmentId]
      );
      if (!depOk.rows[0]) {
        await client.query("ROLLBACK");
        throw new Error("Department not found.");
      }
    }

    const active = await client.query<{ id: number }>(
      `SELECT id FROM hrms_asset_allocations
       WHERE asset_id = $1 AND status = 'ACTIVE'
       FOR UPDATE`,
      [assetId]
    );
    const activeId = active.rows[0]?.id;
    if (activeId) {
      await client.query(
        `UPDATE hrms_asset_allocations SET
           status = 'CLOSED',
           closed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1`,
        [activeId]
      );
    }

    const ins = await client.query<{ id: number }>(
      `INSERT INTO hrms_asset_allocations (
         asset_id, allocation_type, allocation_date_bs, branch_id, department_id, status, updated_at
       ) VALUES ($1, 'TRANSFER', $2, $3, $4, 'ACTIVE', NOW())
       RETURNING id`,
      [
        assetId,
        input.allocationDateBs,
        input.branchId,
        input.departmentId,
      ]
    );
    const newId = ins.rows[0]?.id;
    if (!newId) {
      await client.query("ROLLBACK");
      throw new Error("Failed to create allocation.");
    }

    await client.query(
      `UPDATE hrms_assets SET
         current_allocation_id = $1,
         current_branch_id = $2,
         current_department_id = $3
       WHERE id = $4`,
      [newId, input.branchId, input.departmentId, assetId]
    );

    await client.query("COMMIT");
    return { allocationId: newId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const pg = err as {
      code?: string;
      constraint?: string;
      detail?: string;
      message?: string;
    };
    const dupActive =
      pg.code === "23505" &&
      (pg.constraint === "hrms_asset_allocations_one_active_per_asset" ||
        /hrms_asset_allocations_one_active_per_asset/i.test(
          `${pg.message ?? ""} ${pg.detail ?? ""}`
        ));
    if (dupActive) {
      throw new Error(
        "This asset already has an active allocation. Refresh and try again."
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * For assets that have branch and/or department but no ACTIVE allocation row yet.
 * Safe to run multiple times (skips when ACTIVE already exists).
 * Syncs `current_*` on the asset when a new row is inserted.
 */
export async function backfillMissingActiveAllocations(): Promise<{
  created: number;
}> {
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: number;
      branch_id: number;
      department_id: number | null;
      purchase_date_bs: string;
    }>(
      `SELECT a.id, a.branch_id, a.department_id, a.purchase_date_bs
       FROM hrms_assets a
       WHERE NOT EXISTS (
         SELECT 1 FROM hrms_asset_allocations x
         WHERE x.asset_id = a.id AND x.status = 'ACTIVE'
       )`
    );
    for (const r of rows) {
      if (
        (Number.isFinite(r.branch_id) && r.branch_id >= 1) ||
        (r.department_id !== null && r.department_id >= 1)
      ) {
        await ensureInitialAllocationForNewAsset(client, {
          assetId: r.id,
          branchId: r.branch_id,
          departmentId: r.department_id,
          purchaseDateBs: r.purchase_date_bs,
        });
        created += 1;
      }
    }
    await client.query("COMMIT");
    return { created };
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
