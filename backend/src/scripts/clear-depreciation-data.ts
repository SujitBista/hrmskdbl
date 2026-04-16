import "../loadEnv.js";
import { pool, query } from "../db.js";

/**
 * Removes all depreciation runs and line-item details (master + grid rows).
 * Does not change asset register or other modules.
 */
async function clearDepreciationData() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  await query(`TRUNCATE TABLE hrms_depreciation_runs CASCADE`);
  console.log("Cleared hrms_depreciation_runs (and dependent detail rows).");
}

clearDepreciationData()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
