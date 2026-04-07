import { query } from "../db.js";

export type Branch = {
  id: number;
  branch_code: string;
  branch_name: string;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export type ListBranchesParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListBranchesResult = {
  branches: Branch[];
  total: number;
  page: number;
  pageSize: number;
};

export function clampListParams(input: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number } {
  const page =
    Number.isFinite(input.page) && input.page! >= 1
      ? Math.floor(input.page!)
      : 1;
  let pageSize =
    Number.isFinite(input.pageSize) && input.pageSize! >= 1
      ? Math.floor(input.pageSize!)
      : DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE;
  }
  return { page, pageSize };
}

const SELECT_LIST = `SELECT id, branch_code, branch_name, created_at::text`;

function searchCondition(pattern: string): { sql: string; args: string[] } {
  return {
    sql: `(b.branch_code ILIKE $1 OR b.branch_name ILIKE $1)`,
    args: [pattern],
  };
}

export async function listBranches(
  params: ListBranchesParams
): Promise<ListBranchesResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_branches b`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<Branch>(
      `${SELECT_LIST}
       FROM hrms_branches b
       ORDER BY b.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return {
      branches: list.rows,
      total,
      page,
      pageSize,
    };
  }

  const pattern = `%${search}%`;
  const { sql: whereSql, args: whereArgs } = searchCondition(pattern);
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_branches b WHERE ${whereSql}`,
    whereArgs
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<Branch>(
    `${SELECT_LIST}
     FROM hrms_branches b
     WHERE ${whereSql}
     ORDER BY b.created_at DESC
     LIMIT $2 OFFSET $3`,
    [...whereArgs, pageSize, offset]
  );
  return {
    branches: list.rows,
    total,
    page,
    pageSize,
  };
}

export type BranchPayload = {
  branch_code: string;
  branch_name: string;
};

export function parseBranchPayload(body: unknown): BranchPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const branch_code =
    typeof b.branch_code === "string" ? b.branch_code : "";
  const branch_name =
    typeof b.branch_name === "string" ? b.branch_name : "";
  if (!branch_code.trim()) {
    throw new Error("Branch code is required.");
  }
  if (!branch_name.trim()) {
    throw new Error("Branch name is required.");
  }
  return { branch_code, branch_name };
}

export async function createBranch(input: BranchPayload): Promise<Branch> {
  const branch_code = input.branch_code.trim();
  const branch_name = input.branch_name.trim();

  const result = await query<Branch>(
    `INSERT INTO hrms_branches (branch_code, branch_name)
     VALUES ($1, $2)
     RETURNING id, branch_code, branch_name, created_at::text`,
    [branch_code, branch_name]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create branch.");
  }
  return row;
}

export async function updateBranch(
  id: number,
  input: BranchPayload
): Promise<Branch | null> {
  const branch_code = input.branch_code.trim();
  const branch_name = input.branch_name.trim();

  const result = await query<Branch>(
    `UPDATE hrms_branches
     SET branch_code = $1, branch_name = $2
     WHERE id = $3
     RETURNING id, branch_code, branch_name, created_at::text`,
    [branch_code, branch_name, id]
  );
  const row = result.rows[0];
  return row ?? null;
}

export async function deleteBranch(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_branches WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
