import { pool, query } from "../db.js";

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

export type ImportSubGroupRowInput = {
  group_name?: string | null;
  sub_group_name?: string | null;
};

export type ImportSubGroupsPayload = {
  rows: ImportSubGroupRowInput[];
};

export type ImportSubGroupsResult = {
  importedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
};

function normalizeComparableText(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseImportSubGroupsPayload(body: unknown): ImportSubGroupsPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.rows)) {
    throw new Error("rows must be an array.");
  }
  return { rows: b.rows as ImportSubGroupRowInput[] };
}

/**
 * Bulk-creates asset sub groups from spreadsheet rows (GroupName + SubGroupName).
 * Skips blank rows and duplicates already in the DB or repeated in the same file.
 */
export async function importSubGroupsFromRows(
  payload: ImportSubGroupsPayload
): Promise<ImportSubGroupsResult> {
  if (payload.rows.length === 0) {
    throw new Error("No rows provided for import.");
  }

  const groupsResult = await query<{ id: number; name: string }>(
    `SELECT id, name FROM hrms_groups`
  );
  const groupByName = new Map<string, { id: number; name: string }>();
  for (const g of groupsResult.rows) {
    groupByName.set(normalizeComparableText(g.name), g);
  }

  const existingSubs = await query<{ group_id: number; name: string }>(
    `SELECT group_id, name FROM hrms_sub_groups`
  );
  const existingKey = new Set<string>();
  for (const s of existingSubs.rows) {
    existingKey.add(`${s.group_id}|${normalizeComparableText(s.name)}`);
  }

  const pendingKeys = new Set<string>();
  let skippedCount = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const toInsert: Array<{ groupId: number; name: string }> = [];

  for (let idx = 0; idx < payload.rows.length; idx += 1) {
    const row = payload.rows[idx];
    const rowNumber = idx + 1;
    try {
      const groupName =
        typeof row.group_name === "string" ? row.group_name.trim() : "";
      const subName =
        typeof row.sub_group_name === "string" ? row.sub_group_name.trim() : "";
      if (groupName === "" && subName === "") {
        skippedCount += 1;
        continue;
      }
      if (groupName === "") {
        throw new Error("Group name is required.");
      }
      if (subName === "") {
        throw new Error("Sub group name is required.");
      }
      const group = groupByName.get(normalizeComparableText(groupName));
      if (!group) {
        throw new Error(
          `Group not found for "${groupName}". Use a group name that exactly matches an existing asset group.`
        );
      }
      const dedupeKey = `${group.id}|${normalizeComparableText(subName)}`;
      if (existingKey.has(dedupeKey)) {
        skippedCount += 1;
        continue;
      }
      if (pendingKeys.has(dedupeKey)) {
        skippedCount += 1;
        continue;
      }
      pendingKeys.add(dedupeKey);
      toInsert.push({ groupId: group.id, name: subName });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not import this row.";
      errors.push({ row: rowNumber, message });
    }
  }

  if (errors.length > 0) {
    return {
      importedCount: 0,
      skippedCount,
      errors: errors.sort((a, b) => a.row - b.row),
    };
  }

  if (toInsert.length === 0) {
    return { importedCount: 0, skippedCount, errors: [] };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of toInsert) {
      await client.query(
        `INSERT INTO hrms_sub_groups (group_id, name) VALUES ($1, $2)`,
        [item.groupId, item.name]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const message =
      err instanceof Error ? err.message : "Import failed; upload rolled back.";
    return {
      importedCount: 0,
      skippedCount,
      errors: [{ row: 1, message: `Import failed and rolled back: ${message}` }],
    };
  } finally {
    client.release();
  }

  return {
    importedCount: toInsert.length,
    skippedCount,
    errors: [],
  };
}
