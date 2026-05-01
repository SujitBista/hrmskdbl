import "../loadEnv.js";
import { pool } from "../db.js";
import { backfillMissingActiveAllocations } from "../services/assetAllocations.js";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }
  const { created } = await backfillMissingActiveAllocations();
  console.log(`Backfill complete. Created ${created} active allocation(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
