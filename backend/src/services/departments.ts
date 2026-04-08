import { query } from "../db.js";

export type Department = {
  id: number;
  name: string;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export type ListDepartmentsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListDepartmentsResult = {
  departments: Department[];
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

const SELECT_LIST = `SELECT id, name, created_at::text`;

function searchCondition(pattern: string): { sql: string; args: string[] } {
  return {
    sql: `d.name ILIKE $1`,
    args: [pattern],
  };
}

export async function listDepartments(
  params: ListDepartmentsParams
): Promise<ListDepartmentsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_departments d`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<Department>(
      `${SELECT_LIST}
       FROM hrms_departments d
       ORDER BY d.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return {
      departments: list.rows,
      total,
      page,
      pageSize,
    };
  }

  const pattern = `%${search}%`;
  const { sql: whereSql, args: whereArgs } = searchCondition(pattern);
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_departments d WHERE ${whereSql}`,
    whereArgs
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<Department>(
    `${SELECT_LIST}
     FROM hrms_departments d
     WHERE ${whereSql}
     ORDER BY d.created_at DESC
     LIMIT $2 OFFSET $3`,
    [...whereArgs, pageSize, offset]
  );
  return {
    departments: list.rows,
    total,
    page,
    pageSize,
  };
}

export type DepartmentPayload = {
  name: string;
};

export function parseDepartmentPayload(body: unknown): DepartmentPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name : "";
  if (!name.trim()) {
    throw new Error("Department name is required.");
  }
  return { name };
}

export async function createDepartment(
  input: DepartmentPayload
): Promise<Department> {
  const name = input.name.trim();

  const result = await query<Department>(
    `INSERT INTO hrms_departments (name)
     VALUES ($1)
     RETURNING id, name, created_at::text`,
    [name]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create department.");
  }
  return row;
}

export async function updateDepartment(
  id: number,
  input: DepartmentPayload
): Promise<Department | null> {
  const name = input.name.trim();

  const result = await query<Department>(
    `UPDATE hrms_departments
     SET name = $1
     WHERE id = $2
     RETURNING id, name, created_at::text`,
    [name, id]
  );
  const row = result.rows[0];
  return row ?? null;
}

export async function deleteDepartment(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_departments WHERE id = $1`, [
    id,
  ]);
  return (result.rowCount ?? 0) > 0;
}
