import "../loadEnv.js";
import { pool } from "../db.js";
import { splitAllExistingMultiQtyAssets } from "../services/assets.js";

/**
 * Splits active register rows with purchase_qty >= 2 into one row per unit.
 * Each new row gets qty 1, the same unit rate, and a divided book/old book value.
 */
async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }

  const result = await splitAllExistingMultiQtyAssets();
  console.log(
    `Split complete. Source rows updated: ${result.processedRows}. New unit rows created: ${result.createdRows}. Skipped: ${result.skippedRows}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
