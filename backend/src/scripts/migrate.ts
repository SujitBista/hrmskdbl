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
    ALTER TABLE hrms_groups DROP COLUMN IF EXISTS dep_rate_tax;
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
      dep_method_snapshot VARCHAR(128),
      dep_rate_snapshot NUMERIC(12, 4),
      purchase_qty NUMERIC(18, 4),
      unit_rate NUMERIC(18, 4),
      purchase_invoice_no VARCHAR(255),
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
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS depreciation_start_date_bs VARCHAR(32);
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS dep_method_snapshot VARCHAR(128);
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS dep_rate_snapshot NUMERIC(12, 4);
  `);
  await query(`
    UPDATE hrms_assets a
    SET dep_method_snapshot = g.dep_method
    FROM hrms_groups g
    WHERE g.id = a.group_id
      AND (a.dep_method_snapshot IS NULL OR TRIM(a.dep_method_snapshot) = '');
  `);
  await query(`
    UPDATE hrms_assets a
    SET dep_rate_snapshot = g.dep_rate
    FROM hrms_groups g
    WHERE g.id = a.group_id
      AND a.dep_rate_snapshot IS NULL;
  `);
  await query(`
    UPDATE hrms_assets
    SET depreciation_start_date_bs = purchase_date_bs
    WHERE depreciation_start_date_bs IS NULL;
  `);
  await query(`
    ALTER TABLE hrms_assets
    ALTER COLUMN depreciation_start_date_bs SET NOT NULL;
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS old_book_value NUMERIC(18, 4);
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS book_value NUMERIC(18, 4);
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD COLUMN IF NOT EXISTS asset_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
  `);
  await query(`
    UPDATE hrms_assets
    SET asset_status = 'ACTIVE'
    WHERE asset_status IS NULL OR TRIM(asset_status) = '';
  `);
  await query(`
    ALTER TABLE hrms_assets
    DROP CONSTRAINT IF EXISTS hrms_assets_asset_status_check;
  `);
  await query(`
    ALTER TABLE hrms_assets
    ADD CONSTRAINT hrms_assets_asset_status_check
    CHECK (asset_status IN ('ACTIVE', 'DISPOSED'));
  `);
  await query(`
    UPDATE hrms_assets
    SET working_status = 'Disposed'
    WHERE asset_status = 'DISPOSED'
      AND working_status <> 'Disposed';
  `);
  await query(`
    ALTER TABLE hrms_assets DROP COLUMN IF EXISTS lifetime_years;
  `);
  await query(`
    ALTER TABLE hrms_assets DROP COLUMN IF EXISTS salvage_value;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_runs (
      id SERIAL PRIMARY KEY,
      fiscal_year_start INTEGER NOT NULL,
      dep_title VARCHAR(255) NOT NULL,
      quarter_no SMALLINT NOT NULL CHECK (quarter_no >= 1 AND quarter_no <= 4),
      months_covered SMALLINT NOT NULL CHECK (months_covered IN (3, 6, 9, 12)),
      calculation_date_ad TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      calculation_date_bs VARCHAR(32) NOT NULL,
      remarks TEXT,
      is_final_for_fy BOOLEAN NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'posted',
      branch_id INTEGER REFERENCES hrms_branches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_run_details (
      id SERIAL PRIMARY KEY,
      depreciation_run_id INTEGER NOT NULL REFERENCES hrms_depreciation_runs(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES hrms_assets(id) ON DELETE RESTRICT,
      fiscal_year INTEGER NOT NULL,
      asset_name VARCHAR(255) NOT NULL,
      dep_rate NUMERIC(12, 4) NOT NULL,
      dep_days INTEGER NOT NULL,
      dep_amount NUMERIC(18, 4) NOT NULL,
      group_name VARCHAR(255) NOT NULL,
      sub_group_name VARCHAR(255),
      branch_name VARCHAR(255) NOT NULL,
      book_value NUMERIC(18, 4) NOT NULL,
      accumulate_dep NUMERIC(18, 4) NOT NULL,
      dep_formula TEXT NOT NULL,
      dep_start_date_bs VARCHAR(32) NOT NULL,
      balance_amount NUMERIC(18, 4) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_depreciation_run_details_run_id
    ON hrms_depreciation_run_details (depreciation_run_id);
  `);
  /** Speeds allocation list + any “latest detail per asset” lateral (filter by asset_id, order by run id). */
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_depreciation_run_details_asset_id_run_id_desc
    ON hrms_depreciation_run_details (asset_id, depreciation_run_id DESC, id DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS hrms_asset_disposals (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES hrms_assets(id) ON DELETE RESTRICT,
      disposal_date_bs VARCHAR(32) NOT NULL,
      disposal_date_ad DATE,
      disposal_type VARCHAR(32) NOT NULL,
      disposal_amount NUMERIC(18, 4) NOT NULL,
      net_book_value_at_disposal NUMERIC(18, 4) NOT NULL,
      accumulated_depreciation_at_disposal NUMERIC(18, 4) NOT NULL,
      profit_amount NUMERIC(18, 4) NOT NULL,
      loss_amount NUMERIC(18, 4) NOT NULL,
      reference_no VARCHAR(255),
      notes TEXT,
      created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (asset_id)
    );
  `);
  await query(`
    ALTER TABLE hrms_asset_disposals
    DROP CONSTRAINT IF EXISTS hrms_asset_disposals_type_check;
  `);
  await query(`
    ALTER TABLE hrms_asset_disposals
    ADD CONSTRAINT hrms_asset_disposals_type_check
    CHECK (disposal_type IN ('SOLD', 'SCRAPPED', 'LOST', 'WRITTEN_OFF', 'DONATED'));
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_asset_disposals_date_bs
    ON hrms_asset_disposals (disposal_date_bs DESC, id DESC);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_asset_disposals_asset_lookup
    ON hrms_asset_disposals (asset_id);
  `);

  await query(`
    ALTER TABLE hrms_depreciation_runs
    ADD COLUMN IF NOT EXISTS depreciation_scope_mode VARCHAR(16) NOT NULL DEFAULT 'FY_END';
  `);
  await query(`
    ALTER TABLE hrms_depreciation_runs
    DROP CONSTRAINT IF EXISTS hrms_depreciation_runs_depreciation_scope_mode_check;
  `);
  await query(`
    ALTER TABLE hrms_depreciation_runs
    ADD CONSTRAINT hrms_depreciation_runs_depreciation_scope_mode_check
    CHECK (depreciation_scope_mode IN ('FY_END', 'AS_OF_DATE'));
  `);
  await query(`DROP INDEX IF EXISTS hrms_depreciation_runs_fy_quarter_branch;`);
  await query(`DROP INDEX IF EXISTS hrms_depreciation_runs_one_final_per_fy_branch;`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_depreciation_runs_fy_end_fy_quarter_branch
    ON hrms_depreciation_runs (fiscal_year_start, quarter_no, COALESCE(branch_id, -1))
    WHERE depreciation_scope_mode = 'FY_END';
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_depreciation_runs_as_of_fy_branch_calc_bs
    ON hrms_depreciation_runs (fiscal_year_start, COALESCE(branch_id, -1), calculation_date_bs)
    WHERE depreciation_scope_mode = 'AS_OF_DATE';
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_depreciation_runs_one_final_per_fy_branch
    ON hrms_depreciation_runs (fiscal_year_start, COALESCE(branch_id, -1))
    WHERE is_final_for_fy = true;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_run_audit_logs (
      id SERIAL PRIMARY KEY,
      depreciation_run_id INTEGER REFERENCES hrms_depreciation_runs(id) ON DELETE SET NULL,
      action VARCHAR(64) NOT NULL,
      actor_admin_id INTEGER,
      actor_admin_email VARCHAR(255) NOT NULL,
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      override_used BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_depreciation_run_audit_logs_run_id
    ON hrms_depreciation_run_audit_logs (depreciation_run_id, created_at DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS hrms_asset_allocations (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES hrms_assets(id) ON DELETE CASCADE,
      remarks TEXT NOT NULL DEFAULT '',
      allocation_category_name VARCHAR(255) NOT NULL DEFAULT '',
      allocation_branch_name VARCHAR(255) NOT NULL DEFAULT '',
      emp_name VARCHAR(255) NOT NULL DEFAULT '',
      serial_number VARCHAR(128),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    ALTER TABLE hrms_asset_allocations
    ADD COLUMN IF NOT EXISTS allocation_date_bs VARCHAR(32) NOT NULL DEFAULT '';
  `);
  await query(`
    ALTER TABLE hrms_asset_allocations
    ADD COLUMN IF NOT EXISTS superseded_asset_code VARCHAR(256) NOT NULL DEFAULT '';
  `);
  /** Legacy tables used asset_id as PK; add surrogate `id` PK for per-row allocation history. */
  await query(`
    DO $alloc_pk$
    DECLARE
      pkname text;
    BEGIN
      SELECT tc.constraint_name INTO pkname
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.table_schema
        AND tc.constraint_name = kcu.constraint_name
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'hrms_asset_allocations'
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = 'asset_id'
      LIMIT 1;

      IF pkname IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'hrms_asset_allocations'
             AND column_name = 'id'
         ) THEN
        ALTER TABLE hrms_asset_allocations ADD COLUMN id SERIAL NOT NULL;
        EXECUTE format('ALTER TABLE hrms_asset_allocations DROP CONSTRAINT %I', pkname);
        ALTER TABLE hrms_asset_allocations
          ADD CONSTRAINT hrms_asset_allocations_pkey PRIMARY KEY (id);
      END IF;
    END
    $alloc_pk$;
  `);
  /** Allow multiple allocation rows per asset (transfer/return history). */
  await query(`
    DO $drop_asset_id_unique$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname AS cname
        FROM pg_constraint c
        INNER JOIN pg_class t ON c.conrelid = t.oid
        INNER JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'hrms_asset_allocations'
          AND c.contype = 'u'
          AND (
            SELECT COUNT(*)::int FROM unnest(c.conkey::smallint[]) AS _u(attnum)
          ) = 1
          AND EXISTS (
            SELECT 1
            FROM pg_attribute a
            WHERE a.attrelid = c.conrelid
              AND a.attnum = c.conkey[1]
              AND a.attname = 'asset_id'
              AND NOT a.attisdropped
          )
      LOOP
        EXECUTE format(
          'ALTER TABLE public.hrms_asset_allocations DROP CONSTRAINT %I',
          r.cname
        );
      END LOOP;
    END
    $drop_asset_id_unique$;
  `);
  await query(`
    ALTER TABLE hrms_asset_allocations
      DROP CONSTRAINT IF EXISTS hrms_asset_allocations_asset_id_key;
  `);
  await query(`
    DROP INDEX IF EXISTS hrms_asset_allocations_asset_id_key;
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_asset_allocations_asset_id_id_desc
    ON hrms_asset_allocations (asset_id, id DESC);
  `);
  await query(`
    INSERT INTO hrms_asset_allocations (
      asset_id,
      remarks,
      allocation_category_name,
      allocation_branch_name,
      emp_name,
      serial_number,
      allocation_date_bs
    )
    SELECT
      a.id,
      '',
      '',
      LEFT(TRIM(b.branch_name), 255),
      '',
      NULL,
      COALESCE(NULLIF(TRIM(a.purchase_date_bs), ''), '')
    FROM hrms_assets a
    INNER JOIN hrms_branches b ON b.id = a.branch_id
    WHERE NOT EXISTS (
      SELECT 1 FROM hrms_asset_allocations x WHERE x.asset_id = a.id
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_fy_rollovers (
      id SERIAL PRIMARY KEY,
      prior_fiscal_year_start INTEGER NOT NULL,
      new_fiscal_year_start INTEGER NOT NULL,
      branch_id INTEGER REFERENCES hrms_branches(id) ON DELETE SET NULL,
      source_final_run_id INTEGER NOT NULL REFERENCES hrms_depreciation_runs(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hrms_depreciation_fy_rollovers_new_fy_branch
    ON hrms_depreciation_fy_rollovers (new_fiscal_year_start, (COALESCE(branch_id, -1)));
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      opening_fiscal_year INTEGER NOT NULL CHECK (opening_fiscal_year >= 2000),
      configured_by_admin_id INTEGER,
      configured_by_admin_email VARCHAR(255) NOT NULL,
      configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS hrms_depreciation_settings_audit_logs (
      id SERIAL PRIMARY KEY,
      action VARCHAR(32) NOT NULL CHECK (action IN ('CREATED', 'UPDATED')),
      opening_fiscal_year INTEGER NOT NULL CHECK (opening_fiscal_year >= 2000),
      previous_opening_fiscal_year INTEGER CHECK (previous_opening_fiscal_year IS NULL OR previous_opening_fiscal_year >= 2000),
      configured_by_admin_id INTEGER,
      configured_by_admin_email VARCHAR(255) NOT NULL,
      configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS hrms_depreciation_settings_audit_logs_created_at
    ON hrms_depreciation_settings_audit_logs (configured_at DESC);
  `);

  console.log("Migration complete.");
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
