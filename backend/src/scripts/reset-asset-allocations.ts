import "../loadEnv.js";
import { pool, query } from "../db.js";

const MISSING_COLUMN_MSG =
  "Column allocation_date_bs is missing on hrms_asset_allocations. Run: npm run migrate";

/**
 * Wipes `hrms_asset_allocations` and inserts one baseline row per existing asset
 * (register branch name, purchase BS date as allocation date). Assets are unchanged.
 */
async function resetAssetAllocations() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  const col = await query<{ ok: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hrms_asset_allocations'
        AND column_name = 'allocation_date_bs'
    ) AS ok`
  );
  if (!col.rows[0]?.ok) {
    console.error(MISSING_COLUMN_MSG);
    process.exit(1);
  }

  await query("BEGIN");
  try {
    await query(`TRUNCATE TABLE hrms_asset_allocations RESTART IDENTITY`);
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
    `);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  const n = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM hrms_asset_allocations`
  );
  const assets = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM hrms_assets`
  );
  console.log(
    `Reset hrms_asset_allocations: ${n.rows[0]?.c ?? "0"} rows (assets in register: ${assets.rows[0]?.c ?? "0"}).`
  );
}

resetAssetAllocations()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
