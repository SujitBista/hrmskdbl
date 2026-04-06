import { query } from "../db.js";

export type Group = {
  id: number;
  name: string;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export type ListGroupsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListGroupsResult = {
  groups: Group[];
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

export async function listGroups(
  params: ListGroupsParams
): Promise<ListGroupsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_groups`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<Group>(
      `SELECT id, name, created_at::text
       FROM hrms_groups
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { groups: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_groups WHERE name ILIKE $1`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<Group>(
    `SELECT id, name, created_at::text
     FROM hrms_groups
     WHERE name ILIKE $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { groups: list.rows, total, page, pageSize };
}

export async function createGroup(input: { name: string }): Promise<Group> {
  const name = input.name.trim();
  const result = await query<Group>(
    `INSERT INTO hrms_groups (name)
     VALUES ($1)
     RETURNING id, name, created_at::text`,
    [name]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create group.");
  }
  return row;
}

export async function updateGroup(
  id: number,
  input: { name: string }
): Promise<Group | null> {
  const name = input.name.trim();
  const result = await query<Group>(
    `UPDATE hrms_groups SET name = $1 WHERE id = $2
     RETURNING id, name, created_at::text`,
    [name, id]
  );
  return result.rows[0] ?? null;
}

export async function deleteGroup(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_groups WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
