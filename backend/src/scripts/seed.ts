import "../loadEnv.js";
import bcrypt from "bcrypt";
import { pool, query } from "../db.js";

async function seed() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment.");
    process.exit(1);
  }

  const existing = await query<{ id: number }>(
    `SELECT id FROM admins WHERE email = $1`,
    [email]
  );
  if (existing.rows[0]) {
    console.log("Admin already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO admins (email, password_hash) VALUES ($1, $2)`,
    [email, passwordHash]
  );
  console.log("Seeded admin:", email);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
