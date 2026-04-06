import bcrypt from "bcrypt";
import { query } from "../db.js";

export type UserPermissions = {
  perm_view: boolean;
  perm_edit: boolean;
  perm_delete: boolean;
};

export type SystemUser = {
  id: number;
  email: string;
  role: string;
  created_at: string;
} & UserPermissions;

/** View is implied if edit or delete is granted. */
export function normalizePermissions(input: {
  perm_view?: unknown;
  perm_edit?: unknown;
  perm_delete?: unknown;
}): UserPermissions {
  const edit = Boolean(input.perm_edit);
  const del = Boolean(input.perm_delete);
  const view = Boolean(input.perm_view) || edit || del;
  return { perm_view: view, perm_edit: edit, perm_delete: del };
}

/** Placeholder roles until a proper roles module exists. */
export const DUMMY_ROLES = ["employee", "manager", "hr"] as const;

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export type ListUsersParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListUsersResult = {
  users: SystemUser[];
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

export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM users`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<SystemUser>(
      `SELECT id, email, role, perm_view, perm_edit, perm_delete, created_at::text
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { users: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM users
     WHERE email ILIKE $1 OR role ILIKE $1`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<SystemUser>(
    `SELECT id, email, role, perm_view, perm_edit, perm_delete, created_at::text
     FROM users
     WHERE email ILIKE $1 OR role ILIKE $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { users: list.rows, total, page, pageSize };
}

export async function createUser(input: {
  email: string;
  password: string;
  role: string;
  permissions: UserPermissions;
}): Promise<SystemUser> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const p = input.permissions;
  const result = await query<SystemUser>(
    `INSERT INTO users (email, password_hash, role, perm_view, perm_edit, perm_delete)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, role, perm_view, perm_edit, perm_delete, created_at::text`,
    [email, passwordHash, input.role, p.perm_view, p.perm_edit, p.perm_delete]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create user.");
  }
  return row;
}

export async function updateUser(
  id: number,
  input: {
    email: string;
    role: string;
    password?: string;
    permissions?: UserPermissions;
  }
): Promise<SystemUser | null> {
  const email = input.email.trim().toLowerCase();
  if (!(DUMMY_ROLES as readonly string[]).includes(input.role)) {
    throw new Error("Invalid role.");
  }

  const pwd = input.password?.trim() ?? "";
  if (pwd !== "") {
    if (pwd.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const passwordHash = await bcrypt.hash(pwd, 12);
    if (input.permissions) {
      const p = input.permissions;
      const result = await query<SystemUser>(
        `UPDATE users
         SET email = $1, role = $2, password_hash = $3,
             perm_view = $4, perm_edit = $5, perm_delete = $6
         WHERE id = $7
         RETURNING id, email, role, perm_view, perm_edit, perm_delete, created_at::text`,
        [
          email,
          input.role,
          passwordHash,
          p.perm_view,
          p.perm_edit,
          p.perm_delete,
          id,
        ]
      );
      return result.rows[0] ?? null;
    }
    const result = await query<SystemUser>(
      `UPDATE users
       SET email = $1, role = $2, password_hash = $3
       WHERE id = $4
       RETURNING id, email, role, perm_view, perm_edit, perm_delete, created_at::text`,
      [email, input.role, passwordHash, id]
    );
    return result.rows[0] ?? null;
  }

  if (input.permissions) {
    const p = input.permissions;
    const result = await query<SystemUser>(
      `UPDATE users
       SET email = $1, role = $2, perm_view = $3, perm_edit = $4, perm_delete = $5
       WHERE id = $6
       RETURNING id, email, role, perm_view, perm_edit, perm_delete, created_at::text`,
      [email, input.role, p.perm_view, p.perm_edit, p.perm_delete, id]
    );
    return result.rows[0] ?? null;
  }

  const result = await query<SystemUser>(
    `UPDATE users SET email = $1, role = $2 WHERE id = $3
     RETURNING id, email, role, perm_view, perm_edit, perm_delete, created_at::text`,
    [email, input.role, id]
  );
  return result.rows[0] ?? null;
}

export async function deleteUser(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM users WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
