import bcrypt from "bcrypt";
import { query } from "../db.js";

export type AdminRow = {
  id: number;
  email: string;
  password_hash: string;
};

export async function getAdminByEmail(
  email: string
): Promise<AdminRow | undefined> {
  const normalized = email.trim().toLowerCase();
  const res = await query<AdminRow>(
    `SELECT id, email, password_hash FROM admins WHERE email = $1`,
    [normalized]
  );
  return res.rows[0];
}

export async function verifyPassword(
  plain: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}
