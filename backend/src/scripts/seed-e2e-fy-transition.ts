import "../loadEnv.js";
import bcrypt from "bcrypt";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../db.js";
import { createAssetsFromInput } from "../services/assets.js";
import { upsertDepreciationSettings } from "../services/depreciationSettings.js";

export const E2E_FY_OPENING_FY = 2082;
export const E2E_FY_PURCHASE_DATE_BS = "2071/08/28";
export const E2E_FY_DEP_START_BS = "2082/04/01";
export const E2E_FY_GROSS_COST = 200_000;
export const E2E_FY_IMPORTED_WDV = 85_000;
export const E2E_FY_IMPLIED_PRIOR_ACCUM =
  E2E_FY_GROSS_COST - E2E_FY_IMPORTED_WDV;
export const E2E_FY_DEP_RATE_PERCENT = 15;

const BRANCH_CODE = "E2E-FY-BR";
const GROUP_CODE = "E2E-FY-G";
const GROUP_NAME = "E2E FY Transition Group";
const DEPARTMENT_NAME = "E2E FY Transition Dept";
const ASSET_NAME = "E2E Migrated Server Rack";

export type E2eFyTransitionFixture = {
  openingFiscalYear: number;
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

async function ensureAdmin(): Promise<{ id: number; email: string }> {
  const email = (
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "e2e-admin@hrms.test"
  );
  const password = process.env.ADMIN_PASSWORD ?? "e2e-test-password";

  const existing = await query<{ id: number }>(
    `SELECT id FROM admins WHERE email = $1`,
    [email]
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, email };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const inserted = await query<{ id: number }>(
    `INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, passwordHash]
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Failed to seed admin user.");
  }
  return { id: row.id, email };
}

async function resetDepreciationState(): Promise<void> {
  await query(`TRUNCATE TABLE hrms_depreciation_runs CASCADE`);
  await query(`TRUNCATE TABLE hrms_depreciation_fy_rollovers`);
  await query(`DELETE FROM hrms_depreciation_settings_audit_logs`);
  await query(`DELETE FROM hrms_depreciation_settings`);
}

async function ensureBranch(): Promise<number> {
  const existing = await query<{ id: number }>(
    `SELECT id FROM hrms_branches WHERE branch_code = $1`,
    [BRANCH_CODE]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO hrms_branches (branch_code, branch_name)
     VALUES ($1, $2) RETURNING id`,
    [BRANCH_CODE, "E2E FY Transition Branch"]
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Failed to create E2E branch.");
  return row.id;
}

async function ensureGroup(): Promise<number> {
  const existing = await query<{ id: number }>(
    `SELECT id FROM hrms_groups WHERE code = $1`,
    [GROUP_CODE]
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE hrms_groups
       SET name = $2, dep_method = $3, dep_rate = $4
       WHERE id = $1`,
      [
        existing.rows[0].id,
        GROUP_NAME,
        "Straight Line",
        E2E_FY_DEP_RATE_PERCENT,
      ]
    );
    return existing.rows[0].id;
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO hrms_groups (name, code, dep_method, dep_rate)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [GROUP_NAME, GROUP_CODE, "Straight Line", E2E_FY_DEP_RATE_PERCENT]
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Failed to create E2E group.");
  return row.id;
}

async function ensureDepartment(): Promise<number> {
  const existing = await query<{ id: number }>(
    `SELECT id FROM hrms_departments WHERE name = $1`,
    [DEPARTMENT_NAME]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO hrms_departments (name) VALUES ($1) RETURNING id`,
    [DEPARTMENT_NAME]
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Failed to create E2E department.");
  return row.id;
}

async function recreateMigratedAsset(input: {
  branchId: number;
  groupId: number;
  departmentId: number;
}): Promise<{ id: number; asset_code: string }> {
  await query(
    `DELETE FROM hrms_assets
     WHERE asset_name = $1
        OR asset_code LIKE 'E2E-FY-%'`,
    [ASSET_NAME]
  );

  const assets = await createAssetsFromInput({
    asset_name: ASSET_NAME,
    group_id: input.groupId,
    sub_group_id: null,
    ownership_type: "Owner",
    working_status: "In Use",
    branch_id: input.branchId,
    department_id: input.departmentId,
    purchase_date_bs: E2E_FY_PURCHASE_DATE_BS,
    depreciation_start_date_bs: E2E_FY_DEP_START_BS,
    purchase_qty: 1,
    unit_rate: E2E_FY_GROSS_COST,
    purchase_invoice_no: "E2E-FY-INV-001",
    book_value: E2E_FY_IMPORTED_WDV,
  });

  const asset = assets[0];
  if (!asset) {
    throw new Error("Failed to create migrated E2E asset.");
  }

  await query(
    `UPDATE hrms_assets SET asset_code = $1 WHERE id = $2`,
    [`E2E-FY-MIG-${asset.id}`, asset.id]
  );

  return { id: asset.id, asset_code: `E2E-FY-MIG-${asset.id}` };
}

function writeFixtureFile(fixture: E2eFyTransitionFixture): void {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  const outDir = path.join(repoRoot, "e2e", "fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "fy-transition.json");
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log("Wrote fixture:", outPath);
}

export async function seedE2eFyTransitionData(): Promise<E2eFyTransitionFixture> {
  const admin = await ensureAdmin();
  await resetDepreciationState();

  const branchId = await ensureBranch();
  const groupId = await ensureGroup();
  const departmentId = await ensureDepartment();
  const asset = await recreateMigratedAsset({
    branchId,
    groupId,
    departmentId,
  });

  await upsertDepreciationSettings({
    openingFiscalYear: E2E_FY_OPENING_FY,
    actor: {
      adminId: admin.id,
      adminEmail: admin.email,
      isSuperAdmin: true,
    },
  });

  const fixture: E2eFyTransitionFixture = {
    openingFiscalYear: E2E_FY_OPENING_FY,
    branchId,
    groupId,
    departmentId,
    assetId: asset.id,
    assetCode: asset.asset_code,
    purchaseDateBs: E2E_FY_PURCHASE_DATE_BS,
    depreciationStartDateBs: E2E_FY_DEP_START_BS,
    grossCost: E2E_FY_GROSS_COST,
    importedWdv: E2E_FY_IMPORTED_WDV,
    impliedPriorAccum: E2E_FY_IMPLIED_PRIOR_ACCUM,
    depRatePercent: E2E_FY_DEP_RATE_PERCENT,
  };

  writeFixtureFile(fixture);
  return fixture;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Set DATABASE_URL in the environment.");
    process.exit(1);
  }
  const fixture = await seedE2eFyTransitionData();
  console.log("Seeded E2E FY transition fixture:", JSON.stringify(fixture));
}

const isDirectRun =
  process.argv[1] != null &&
  process.argv[1].endsWith("seed-e2e-fy-transition.ts");

if (isDirectRun) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => pool.end());
}
