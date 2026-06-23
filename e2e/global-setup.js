const { execSync } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });

module.exports = async function globalSetup() {
  const repoRoot = path.join(__dirname, "..");
  execSync("npm run build --workspace=packages/depreciation-core", {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  execSync("npm run db:migrate", {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  execSync("npm run seed:e2e-fy-transition --workspace=backend", {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
};
