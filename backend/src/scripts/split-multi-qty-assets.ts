import "../loadEnv.js";
import { pool } from "../db.js";
import { splitAllExistingMultiQtyAssets } from "../services/assets.js";
import { refreshAllMutableDepreciationRuns } from "../services/depreciationRuns.js";

/**
 * Splits active register rows with purchase_qty >= 2 into one row per unit.
 * Each new row gets qty 1, the same unit rate, and a divided book/old book value.
 * Rebuilds non-final depreciation runs so quarter details include every unit row.
 */
async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  const result = await splitAllExistingMultiQtyAssets();
  console.log(
    `Split complete. Source rows updated: ${result.processedRows}. New unit rows created: ${result.createdRows}. Skipped: ${result.skippedRows}. Depreciation runs refreshed: ${result.refreshedDepreciationRunIds.length}.`
  );

  if (result.processedRows === 0) {
    const refreshed = await refreshAllMutableDepreciationRuns();
    console.log(
      `No multi-qty rows left. Refreshed ${refreshed.refreshedRunIds.length} mutable depreciation run(s) from the current register.`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
