import "../loadEnv.js";
import { pool, query } from "../db.js";

/**
 * Removes all asset register rows and dependent rows (e.g. depreciation details).
 * Keeps master data like groups/branches/departments intact.
 */
async function clearAssetsData() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  await query("BEGIN");
  try {
    await query(`TRUNCATE TABLE hrms_assets RESTART IDENTITY CASCADE`);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  const count = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_assets`
  );
  console.log(`Cleared hrms_assets. Remaining rows: ${count.rows[0]?.n ?? "0"}.`);
}

clearAssetsData()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
