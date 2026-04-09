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
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_branches (
      id SERIAL PRIMARY KEY,
      branch_code VARCHAR(64) NOT NULL,
      branch_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (branch_code)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_departments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_assets (
      id SERIAL PRIMARY KEY,
      asset_code VARCHAR(256),
      asset_name VARCHAR(255) NOT NULL,
      group_id INTEGER NOT NULL REFERENCES hrms_groups(id) ON DELETE RESTRICT,
      sub_group_id INTEGER REFERENCES hrms_sub_groups(id) ON DELETE SET NULL,
      ownership_type VARCHAR(128) NOT NULL,
      working_status VARCHAR(128) NOT NULL,
      branch_id INTEGER NOT NULL REFERENCES hrms_branches(id) ON DELETE RESTRICT,
      department_id INTEGER REFERENCES hrms_departments(id) ON DELETE SET NULL,
      purchase_date_bs VARCHAR(32) NOT NULL,
      purchase_qty NUMERIC(18, 4),
      unit_rate NUMERIC(18, 4),
      purchase_invoice_no VARCHAR(255),
      lifetime_years INTEGER,
      salvage_value NUMERIC(18, 4),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_assets_asset_code_key
    ON hrms_assets (asset_code)
    WHERE asset_code IS NOT NULL;
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS department_id INTEGER
    REFERENCES hrms_departments(id) ON DELETE SET NULL;
  `);
  await query(`
    DO $migrate$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hrms_assets'
          AND column_name = 'department_name'
      ) THEN
        UPDATE hrms_assets a
        SET department_id = d.id
        FROM hrms_departments d
        WHERE a.department_name IS NOT NULL
          AND TRIM(a.department_name) <> ''
          AND LOWER(TRIM(a.department_name)) = LOWER(TRIM(d.name));
      END IF;
    END
    $migrate$;
  `);
  await query(`
    ALTER TABLE hrms_assets DROP COLUMN IF EXISTS department_name;
  `);
  console.log("Migration complete.");
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
