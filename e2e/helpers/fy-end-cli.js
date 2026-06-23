const { execSync } = require("node:child_process");
const path = require("node:path");

function createFyEndDraftViaCli(fiscalYearStart) {
  const repoRoot = path.resolve(__dirname, "../..");
  require("dotenv").config({ path: path.join(repoRoot, "backend/.env") });
  const output = execSync(
    `npm run e2e:create-fy-end-draft --workspace=backend -- --fy=${fiscalYearStart}`,
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    }
  );
  const line = output
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) {
    throw new Error("FY_END CLI helper returned no output.");
  }
  return JSON.parse(line);
}

module.exports = { createFyEndDraftViaCli };
