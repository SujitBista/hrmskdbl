import "../loadEnv.js";
import { pool, query } from "../db.js";

/**
 * Wipes all fixed-asset register data for a clean reimport:
 * depreciation runs (audit + details), assets, sub-groups, groups, branches, departments.
 * Does not modify `admins` or `users`.
 *
 * Note: This does not restore a point-in-time backup — only empties these tables.
 */
async function clearAllRegisterData() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  await query("BEGIN");
  try {
    await query(`
      TRUNCATE TABLE
        hrms_depreciation_run_audit_logs,
        hrms_depreciation_run_details,
        hrms_depreciation_runs,
        hrms_assets,
        hrms_sub_groups,
        hrms_groups,
        hrms_branches,
        hrms_departments
      RESTART IDENTITY CASCADE
    `);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  const tables = [
    "hrms_assets",
    "hrms_depreciation_runs",
    "hrms_depreciation_run_details",
    "hrms_depreciation_run_audit_logs",
    "hrms_groups",
    "hrms_sub_groups",
    "hrms_branches",
    "hrms_departments",
  ] as const;
  for (const t of tables) {
    const r = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${t}`
    );
    console.log(`${t}: ${r.rows[0]?.n ?? "?"} rows`);
  }
  console.log("Clear complete. Admins and users were not modified.");
}

clearAllRegisterData()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
