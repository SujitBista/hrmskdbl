import "../loadEnv.js";
import { fiscalYearEndBs } from "@hrmskdbl/depreciation-core";
import { pool } from "../db.js";
import { createDepreciationRun } from "../services/depreciationRuns.js";

async function main() {
  const rawFy = process.argv[2];
  const fiscalYearStart = rawFy
    ? Number.parseInt(rawFy.replace(/^--fy=/, ""), 10)
    : 2082;
  if (!Number.isFinite(fiscalYearStart)) {
    throw new Error("Usage: e2e-create-fy-end-draft.ts --fy=2082");
  }
  const fyEndBs = fiscalYearEndBs(fiscalYearStart);
  const result = await createDepreciationRun({
    fiscalYearStart,
    quarterNo: 4,
    fiscalProgressBs: fyEndBs,
    calculationDateBs: fyEndBs,
    depreciationScopeMode: "FY_END",
    depTitle: "Fiscal year closing (FY_END)",
    remarks: "E2E FY_END draft.",
    status: "draft",
  });
  process.stdout.write(
    `${JSON.stringify({
      runId: result.run.id,
      status: result.run.status,
      detailsInserted: result.detailsInserted,
    })}\n`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
