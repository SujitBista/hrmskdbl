import { defineConfig, devices } from "@playwright/test";

const backendPort = process.env.E2E_BACKEND_PORT ?? process.env.PORT ?? "4010";
const backendUrl =
  process.env.E2E_BACKEND_URL ?? `http://localhost:${backendPort}`;
const frontendUrl =
  process.env.E2E_FRONTEND_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/test-results/html-report" }],
    ["json", { outputFile: "e2e/test-results/results.json" }],
  ],
  outputDir: "e2e/test-results/artifacts",
  globalSetup: "./e2e/global-setup.js",
  use: {
    baseURL: frontendUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev --workspace=backend",
      url: `${backendUrl}/health`,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === "true",
      timeout: 120_000,
      env: {
        E2E_TEST_MODE: "true",
        DEPRECIATION_SERVER_TODAY_BS: "2083/10/15",
        PORT: backendPort,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://hrms:hrms@localhost:5432/hrms",
        JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-in-production-min-32-chars-ok",
        FRONTEND_ORIGIN: frontendUrl,
      },
    },
    {
      command: "npm run dev --workspace=frontend -- --port 3001",
      url: frontendUrl,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === "true",
      timeout: 120_000,
      env: {
        BACKEND_URL: backendUrl,
        JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-in-production-min-32-chars-ok",
      },
    },
  ],
});
