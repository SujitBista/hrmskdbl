import { query } from "../db.js";

export type SubGroup = {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export type ListSubGroupsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListSubGroupsResult = {
  subGroups: SubGroup[];
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

export async function listSubGroups(
  params: ListSubGroupsParams
): Promise<ListSubGroupsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  const baseFrom = `FROM hrms_sub_groups sg
     INNER JOIN hrms_groups g ON g.id = sg.group_id`;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n ${baseFrom}`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<SubGroup>(
      `SELECT sg.id, sg.group_id, g.name AS group_name, sg.name, sg.created_at::text
       ${baseFrom}
       ORDER BY sg.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { subGroups: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n ${baseFrom}
     WHERE sg.name ILIKE $1 OR g.name ILIKE $1`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<SubGroup>(
    `SELECT sg.id, sg.group_id, g.name AS group_name, sg.name, sg.created_at::text
     ${baseFrom}
     WHERE sg.name ILIKE $1 OR g.name ILIKE $1
     ORDER BY sg.created_at DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { subGroups: list.rows, total, page, pageSize };
}

export async function createSubGroup(input: {
  groupId: number;
  name: string;
}): Promise<SubGroup> {
  const name = input.name.trim();
  const groupId = input.groupId;
  const result = await query<SubGroup>(
    `WITH ins AS (
       INSERT INTO hrms_sub_groups (group_id, name)
       VALUES ($1, $2)
       RETURNING id, group_id, name, created_at
     )
     SELECT ins.id, ins.group_id, g.name AS group_name, ins.name, ins.created_at::text
     FROM ins
     INNER JOIN hrms_groups g ON g.id = ins.group_id`,
    [groupId, name]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create sub group.");
  }
  return row;
}

export async function updateSubGroup(
  id: number,
  input: { name: string; groupId?: number }
): Promise<SubGroup | null> {
  const name = input.name.trim();
  if (input.groupId !== undefined) {
    const gid = input.groupId;
    const result = await query<SubGroup>(
      `WITH upd AS (
         UPDATE hrms_sub_groups
         SET name = $1, group_id = $2
         WHERE id = $3
         RETURNING id, group_id, name, created_at
       )
       SELECT u.id, u.group_id, g.name AS group_name, u.name, u.created_at::text
       FROM upd u
       INNER JOIN hrms_groups g ON g.id = u.group_id`,
      [name, gid, id]
    );
    return result.rows[0] ?? null;
  }
  const result = await query<SubGroup>(
    `WITH upd AS (
       UPDATE hrms_sub_groups SET name = $1 WHERE id = $2
       RETURNING id, group_id, name, created_at
     )
     SELECT u.id, u.group_id, g.name AS group_name, u.name, u.created_at::text
     FROM upd u
     INNER JOIN hrms_groups g ON g.id = u.group_id`,
    [name, id]
  );
  return result.rows[0] ?? null;
}

export async function deleteSubGroup(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_sub_groups WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
