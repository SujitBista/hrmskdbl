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
  created_at: string;
};

type GroupRowDb = {
  id: number;
  code: string;
  name: string;
  dep_method: string | null;
  dep_rate: string | null;
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
       dep_rate::text, created_at::text`;

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
  dep_method: string;
  dep_rate: number;
};

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const code = input.code.trim();
  const name = input.name.trim();
  const dep_method = input.dep_method.trim();

  const result = await query<GroupRowDb>(
    `INSERT INTO hrms_groups (code, name, dep_method, dep_rate)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, name, dep_method, dep_rate::text, created_at::text`,
    [code, name, dep_method, input.dep_rate]
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
  const dep_method = input.dep_method.trim();

  const result = await query<GroupRowDb>(
    `UPDATE hrms_groups
     SET code = $1, name = $2, dep_method = $3, dep_rate = $4
     WHERE id = $5
     RETURNING id, code, name, dep_method, dep_rate::text, created_at::text`,
    [code, name, dep_method, input.dep_rate, id]
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

  const depRaw = b.dep_method;
  if (depRaw === null || depRaw === undefined || depRaw === "") {
    throw new Error("Depreciation method is required.");
  }
  if (typeof depRaw !== "string") {
    throw new Error("Invalid depreciation method.");
  }
  const depMethodTrimmed = depRaw.trim();
  if (depMethodTrimmed === "") {
    throw new Error("Depreciation method is required.");
  }
  if (!DEPRECIATION_METHODS.includes(depMethodTrimmed as DepreciationMethod)) {
    throw new Error("Invalid depreciation method.");
  }
  const dep_method = depMethodTrimmed;

  const dep_rate = parseOptionalRate("Dep rate", b.dep_rate);
  if (dep_rate === null) {
    throw new Error("Dep rate is required.");
  }
  if (dep_rate <= 0) {
    throw new Error("Dep rate must be greater than zero.");
  }

  return {
    code,
    name,
    dep_method,
    dep_rate,
  };
}

/** Normalizes labels from Excel (group name or group code column). */
function normalizeGroupImportLabel(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

export type GroupImportLookupRow = { id: number; name: string };

export function indexGroupsForExcelImport(
  rows: Array<{ id: number; name: string; code: string }>
): {
  byNormalizedName: Map<string, GroupImportLookupRow>;
  byNormalizedCode: Map<string, GroupImportLookupRow>;
} {
  const byNormalizedName = new Map<string, GroupImportLookupRow>();
  const byNormalizedCode = new Map<string, GroupImportLookupRow>();
  for (const g of rows) {
    byNormalizedName.set(normalizeGroupImportLabel(g.name), {
      id: g.id,
      name: g.name,
    });
    byNormalizedCode.set(normalizeGroupImportLabel(g.code), {
      id: g.id,
      name: g.name,
    });
  }
  return { byNormalizedName, byNormalizedCode };
}

/**
 * Resolves a spreadsheet group column to `hrms_groups` by **name**, then **code**,
 * then **longest code-prefix** match (export labels like `VEHICLES` vs DB code `VEH`).
 */
export function resolveGroupLabelForExcelImport(
  label: string,
  maps: ReturnType<typeof indexGroupsForExcelImport>,
  allRows: Array<{ id: number; name: string; code: string }>
): GroupImportLookupRow | null {
  const key = normalizeGroupImportLabel(label);
  if (key === "") {
    return null;
  }
  const direct =
    maps.byNormalizedName.get(key) ?? maps.byNormalizedCode.get(key);
  if (direct) {
    return direct;
  }

  const compact = label.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (compact.length < 2) {
    return null;
  }

  let best: GroupImportLookupRow | null = null;
  let bestLen = 0;
  for (const g of allRows) {
    const c = g.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (c.length < 2) {
      continue;
    }
    if (compact.startsWith(c) && c.length > bestLen) {
      best = { id: g.id, name: g.name };
      bestLen = c.length;
    }
  }
  return best;
}
