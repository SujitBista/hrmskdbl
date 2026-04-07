import { query } from "../db.js";

export const DEPRECIATION_METHODS = [
  "Declining Balance",
  "Straight Line",
] as const;

export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export type Group = {
  id: number;
  code: string;
  name: string;
  dep_method: string | null;
  dep_rate: number | null;
  dep_rate_tax: number | null;
  created_at: string;
};

type GroupRowDb = {
  id: number;
  code: string;
  name: string;
  dep_method: string | null;
  dep_rate: string | null;
  dep_rate_tax: string | null;
  created_at: string;
};

function toNum(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: GroupRowDb): Group {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    dep_method: row.dep_method,
    dep_rate: toNum(row.dep_rate),
    dep_rate_tax: toNum(row.dep_rate_tax),
    created_at: row.created_at,
  };
}

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

const SELECT_LIST = `SELECT id, code, name, dep_method,
       dep_rate::text, dep_rate_tax::text, created_at::text`;

function searchCondition(pattern: string): { sql: string; args: string[] } {
  return {
    sql: `(g.name ILIKE $1 OR g.code ILIKE $1)`,
    args: [pattern],
  };
}

export async function listGroups(
  params: ListGroupsParams
): Promise<ListGroupsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_groups g`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<GroupRowDb>(
      `${SELECT_LIST}
       FROM hrms_groups g
       ORDER BY g.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return {
      groups: list.rows.map(mapRow),
      total,
      page,
      pageSize,
    };
  }

  const pattern = `%${search}%`;
  const { sql: whereSql, args: whereArgs } = searchCondition(pattern);
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_groups g WHERE ${whereSql}`,
    whereArgs
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<GroupRowDb>(
    `${SELECT_LIST}
     FROM hrms_groups g
     WHERE ${whereSql}
     ORDER BY g.created_at DESC
     LIMIT $2 OFFSET $3`,
    [...whereArgs, pageSize, offset]
  );
  return {
    groups: list.rows.map(mapRow),
    total,
    page,
    pageSize,
  };
}

export type CreateGroupInput = {
  code: string;
  name: string;
  dep_method: string | null;
  dep_rate: number | null;
  dep_rate_tax: number | null;
};

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const code = input.code.trim();
  const name = input.name.trim();
  const dep_method =
    input.dep_method === null || input.dep_method.trim() === ""
      ? null
      : input.dep_method.trim();

  const result = await query<GroupRowDb>(
    `INSERT INTO hrms_groups (code, name, dep_method, dep_rate, dep_rate_tax)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, name, dep_method, dep_rate::text, dep_rate_tax::text, created_at::text`,
    [code, name, dep_method, input.dep_rate, input.dep_rate_tax]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create group.");
  }
  return mapRow(row);
}

export type UpdateGroupInput = CreateGroupInput;

export async function updateGroup(
  id: number,
  input: UpdateGroupInput
): Promise<Group | null> {
  const code = input.code.trim();
  const name = input.name.trim();
  const dep_method =
    input.dep_method === null || input.dep_method.trim() === ""
      ? null
      : input.dep_method.trim();

  const result = await query<GroupRowDb>(
    `UPDATE hrms_groups
     SET code = $1, name = $2, dep_method = $3, dep_rate = $4, dep_rate_tax = $5
     WHERE id = $6
     RETURNING id, code, name, dep_method, dep_rate::text, dep_rate_tax::text, created_at::text`,
    [code, name, dep_method, input.dep_rate, input.dep_rate_tax, id]
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function deleteGroup(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_groups WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

function parseOptionalRate(label: string, v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 0) throw new Error(`${label} must be zero or positive.`);
    return v;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`Invalid ${label}.`);
    if (n < 0) throw new Error(`${label} must be zero or positive.`);
    return n;
  }
  throw new Error(`Invalid ${label}.`);
}

export function parseGroupPayload(body: unknown): CreateGroupInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const code = typeof b.code === "string" ? b.code : "";
  const name = typeof b.name === "string" ? b.name : "";
  if (!code.trim()) {
    throw new Error("Group code is required.");
  }
  if (!name.trim()) {
    throw new Error("Group name is required.");
  }

  let dep_method: string | null = null;
  const depRaw = b.dep_method;
  if (depRaw !== null && depRaw !== undefined && depRaw !== "") {
    if (typeof depRaw !== "string") {
      throw new Error("Invalid depreciation method.");
    }
    const t = depRaw.trim();
    if (t !== "") {
      if (!DEPRECIATION_METHODS.includes(t as DepreciationMethod)) {
        throw new Error("Invalid depreciation method.");
      }
      dep_method = t;
    }
  }

  const dep_rate = parseOptionalRate("Dep rate", b.dep_rate);
  const dep_rate_tax = parseOptionalRate("Dep rate tax", b.dep_rate_tax);

  return {
    code,
    name,
    dep_method,
    dep_rate,
    dep_rate_tax,
  };
}
