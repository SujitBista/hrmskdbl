import { readFileSync } from "node:fs";
import path from "node:path";

export type E2eFyTransitionFixture = {
  openingFiscalYear: number;
  firstSystemDepreciationDateBs?: string;
  branchId: number;
  groupId: number;
  departmentId: number;
  assetId: number;
  assetCode: string;
  purchaseDateBs: string;
  depreciationStartDateBs: string;
  grossCost: number;
  importedWdv: number;
  impliedPriorAccum: number;
  depRatePercent: number;
};

export function loadFyTransitionFixture(): E2eFyTransitionFixture {
  const fixturePath = path.join(__dirname, "..", "fixtures", "fy-transition.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as E2eFyTransitionFixture;
}

export const E2E_ADMIN_EMAIL =
  process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "admin@saptakoshi.com";
export const E2E_ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "Hrms@2026!";

export const E2E_BACKEND_URL =
  process.env.E2E_BACKEND_URL ??
  `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4010"}`;
