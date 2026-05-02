import "../loadEnv.js";
import { pool, query } from "../db.js";

/**
 * Clears all branches for testing Excel import (branches are auto-created on import).
 *
 * Because `hrms_assets` and `hrms_depreciation_runs` reference branches, this script
 * also truncates depreciation runs (and dependent detail/audit rows) and the asset
 * register. Master data (groups, sub-groups, departments) is left intact.
 */
async function clearBranchesData() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  await query("BEGIN");
  try {
    await query(`TRUNCATE TABLE hrms_depreciation_runs CASCADE`);
    await query(`TRUNCATE TABLE hrms_assets RESTART IDENTITY CASCADE`);
    await query(`TRUNCATE TABLE hrms_branches RESTART IDENTITY CASCADE`);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  const [b, a, r] = await Promise.all([
    query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM hrms_branches`),
    query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM hrms_assets`),
    query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM hrms_depreciation_runs`),
  ]);
  console.log(
    `Done. hrms_branches: ${b.rows[0]?.n ?? "0"} rows, hrms_assets: ${a.rows[0]?.n ?? "0"}, hrms_depreciation_runs: ${r.rows[0]?.n ?? "0"}.`
  );
}

clearBranchesData()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
