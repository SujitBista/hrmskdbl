import bcrypt from "bcrypt";
import { query } from "../db.js";

export type SystemUser = {
  id: number;
  email: string;
  role: string;
  created_at: string;
};

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
      `SELECT id, email, role, created_at::text
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
    `SELECT id, email, role, created_at::text
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
}): Promise<SystemUser> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await query<SystemUser>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at::text`,
    [email, passwordHash, input.role]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create user.");
  }
  return row;
}
