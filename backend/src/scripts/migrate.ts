import { pool, query } from "../db.js";

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(64) NOT NULL,
      perm_view BOOLEAN NOT NULL DEFAULT TRUE,
      perm_edit BOOLEAN NOT NULL DEFAULT FALSE,
      perm_delete BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_view BOOLEAN NOT NULL DEFAULT TRUE;
  `);
  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_edit BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_delete BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("Migration complete.");
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
