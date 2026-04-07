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
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_sub_groups (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES hrms_groups(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (group_id, name)
    );
  `);
  await query(`
    ALTER TABLE hrms_groups ADD COLUMN IF NOT EXISTS code VARCHAR(64);
  `);
  await query(`
    ALTER TABLE hrms_groups ADD COLUMN IF NOT EXISTS dep_method VARCHAR(128);
  `);
  await query(`
    ALTER TABLE hrms_groups ADD COLUMN IF NOT EXISTS dep_rate NUMERIC(12, 4);
  `);
  await query(`
    ALTER TABLE hrms_groups ADD COLUMN IF NOT EXISTS dep_rate_tax NUMERIC(12, 4);
  `);
  await query(`
    UPDATE hrms_groups SET code = 'G' || id::text
    WHERE code IS NULL OR TRIM(code) = '';
  `);
  await query(`
    ALTER TABLE hrms_groups ALTER COLUMN code SET NOT NULL;
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_groups_code_key ON hrms_groups (code);
  `);
  await query(`
    ALTER TABLE hrms_groups DROP COLUMN IF EXISTS class_name;
  `);
  console.log("Migration complete.");
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
