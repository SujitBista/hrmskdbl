import { pool, query } from "../db.js";
import {
  clampListParams,
  indexGroupsForExcelImport,
  resolveGroupLabelForExcelImport,
} from "./groups.js";
import { refreshMutableDepreciationRunsForAsset } from "./depreciationRuns.js";
import type pg from "pg";

const ASSET_CODE_PREFIX = "SKDBL";
const MAX_AUTO_ASSET_CODE_RETRIES = 10;

export type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_id: number | null;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  /** Carrying amount on the register; preferred basis for depreciation runs when set. */
  book_value: string | null;
  old_book_value: string | null;
  purchase_invoice_no: string | null;
  created_at: string;
};

/** Mirrors allocation / ERP export columns stored beside the asset register. */
export type AssetAllocationUpsert = {
  remarks: string;
  allocation_category_name: string;
  allocation_branch_name: string;
  emp_name: string;
  serial_number: string | null;
  /**
   * Nepali BS date `YYYY/MM/DD` (English digits). When omitted (partial PATCH),
   * `allocation_date_bs` in the database is left unchanged.
   */
  allocation_date_bs?: string;
};

export type CreateAssetInput = {
  asset_name: string;
  group_id: number;
  sub_group_id: number | null;
  ownership_type: string;
  working_status: string;
  branch_id: number;
  department_id: number | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: number | null;
  unit_rate: number | null;
  purchase_invoice_no: string | null;
  /**
   * Carrying amount (WDV) from legacy data; when set, depreciation uses this as
   * cost basis instead of purchase amount.
   */
  book_value: number | null;
  /**
   * When set (any allocation field in JSON), replaces allocation row on update.
   * When omitted on update, allocation is left unchanged. On create, defaults apply when omitted.
   */
  allocation?: AssetAllocationUpsert;
};

export type ImportAssetRowInput = {
  asset_code?: string | null;
  asset_name?: string | null;
  group_name?: string | null;
  sub_group_name?: string | null;
  ownership_type?: string | null;
  working_status?: string | null;
  branch_name?: string | null;
  department_name?: string | null;
  purchase_date_bs?: string | null;
  depreciation_start_date_bs?: string | null;
  purchase_qty?: number | string | null;
  purchase_amount?: number | string | null;
  /** Current book / written-down value from import (maps to `hrms_assets.book_value`). */
  book_value?: number | string | null;
  purchase_invoice_no?: string | null;
  allocation_remarks?: string | null;
  allocation_category_name?: string | null;
  allocation_branch_name?: string | null;
  allocation_emp_name?: string | null;
  allocation_serial_number?: string | null;
  allocation_date_bs?: string | null;
};

export type ImportAssetsPayload = {
  rows: ImportAssetRowInput[];
};

export type ImportAssetsResult = {
  importedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
};

/**
 * Branch segment for asset codes: strips wrapping `()`, `[]`, `{}` and `BC:` (any
 * case), then uses the numeric part only (zero-padded to 3 digits when short).
 * Non-BC branch codes that are not all-digits are returned without brackets.
 */
export function formatBranchCodeSegment(branchCode: string): string {
  let t = branchCode
    .trim()
    .replace(/[()[\]{}]/g, "")
    .trim();
  if (/^BC\s*:/i.test(t)) {
    const rest = t.replace(/^BC\s*:\s*/i, "").trim();
    const m = rest.match(/\d+/);
    if (m) {
      return m[0]!.padStart(3, "0");
    }
    return rest.length > 0 ? rest : t;
  }
  if (/^\d+$/.test(t)) {
    return t.padStart(3, "0");
  }
  return t;
}

/** Normalized key for matching `hrms_branches.branch_code` to an SKDBL path segment. */
function branchCodeLookupKey(branchCode: string): string {
  return formatBranchCodeSegment(branchCode).toLowerCase();
}

/**
 * Reads the branch segment from a full asset code `SKDBL/{branch}/...`.
 * Returns the same normalized form used in `buildAssetCode`, or null if not parseable.
 */
export function parseBranchSegmentFromSkdblAssetCode(assetCode: string): string | null {
  const trimmed = assetCode.trim();
  if (trimmed === "") {
    return null;
  }
  const parts = trimmed.split("/").map((p) => p.trim());
  if (parts.length < 3) {
    return null;
  }
  if ((parts[0] ?? "").toUpperCase() !== ASSET_CODE_PREFIX) {
    return null;
  }
  const seg = parts[1] ?? "";
  if (seg === "") {
    return null;
  }
  return formatBranchCodeSegment(seg);
}

/** `BranchName` may include a hint like `Main office (BC:001)` or `[BC:001]`. */
function extractBcHintFromBranchName(branchName: string): string | null {
  const paren = branchName.match(/\(\s*BC\s*:\s*([^)]+?)\s*\)/i);
  if (paren?.[1]) {
    return paren[1].trim();
  }
  const square = branchName.match(/\[\s*BC\s*:\s*([^\]]+?)\s*\]/i);
  if (square?.[1]) {
    return square[1].trim();
  }
  return null;
}

/** Removes `(BC:…)` / `[BC:…]` hints for branch-name-only matching. */
function stripBcHintFromBranchName(branchName: string): string {
  return branchName
    .replace(/\(\s*BC\s*:[^)]+\)/gi, "")
    .replace(/\[\s*BC\s*:[^\]]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stored `branch_name` on import-created rows: `… (BC:{branch_code})`. */
function appendBcHintToBranchNameForImport(
  displayName: string,
  branchCode: string
): string {
  const code = branchCode.trim().slice(0, 64);
  const base = stripBcHintFromBranchName(displayName.trim()).trim();
  const suffix = code !== "" ? ` (BC:${code})` : "";
  const fallbackLabel = code !== "" ? `Branch ${code}` : "Branch";
  let label = base !== "" ? base : fallbackLabel;
  if (suffix === "") {
    return label.slice(0, 255);
  }
  const maxLabelLen = Math.max(0, 255 - suffix.length);
  label = label.slice(0, maxLabelLen);
  return `${label}${suffix}`;
}

/**
 * Builds SKDBL/{branch}/{group}/{YYYY}/{MM}/{DD}/{######}.
 * The last segment is always `hrms_assets.id` (SERIAL primary key), zero-padded to 6 digits.
 */
export function buildAssetCode(params: {
  /** Primary key `hrms_assets.id` — must match the row this code is stored on. */
  hrmsAssetId: number;
  branchCode: string;
  assetGroupCode: string;
  purchaseDateBs: string;
}): string {
  const branch = formatBranchCodeSegment(params.branchCode);
  const group = params.assetGroupCode.trim().toUpperCase();
  const parts = params.purchaseDateBs.trim().split("/").map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  const [y, m, d] = parts;
  const yNum = Number.parseInt(y!, 10);
  const mNum = Number.parseInt(m!, 10);
  const dNum = Number.parseInt(d!, 10);
  if (
    !Number.isFinite(yNum) ||
    !Number.isFinite(mNum) ||
    !Number.isFinite(dNum)
  ) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  const yy = String(yNum);
  const mm = String(mNum).padStart(2, "0");
  const dd = String(dNum).padStart(2, "0");
  const idPart = String(params.hrmsAssetId).padStart(6, "0");
  return `${ASSET_CODE_PREFIX}/${branch}/${group}/${yy}/${mm}/${dd}/${idPart}`;
}

function isAssetCodeUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const e = err as { code?: string; message?: string };
  return (
    e.code === "23505" &&
    (/hrms_assets_asset_code|asset_code/i.test(e.message ?? "") ||
      /duplicate key/i.test(e.message ?? ""))
  );
}

function buildAssetCodeRetryCandidate(baseCode: string, attempt: number): string {
  if (attempt <= 0) {
    return baseCode;
  }
  const suffix = `-${attempt}`;
  const maxBaseLength = 256 - suffix.length;
  if (baseCode.length <= maxBaseLength) {
    return `${baseCode}${suffix}`;
  }
  return `${baseCode.slice(0, Math.max(0, maxBaseLength))}${suffix}`;
}

const ALLOCATION_BODY_KEYS = [
  "allocation_remarks",
  "allocation_category_name",
  "allocation_branch_name",
  "allocation_emp_name",
  "allocation_serial_number",
  "allocation_date_bs",
] as const;

function parseOptionalAllocationFromBody(
  b: Record<string, unknown>
): AssetAllocationUpsert | undefined {
  if (!ALLOCATION_BODY_KEYS.some((k) => b[k] !== undefined)) {
    return undefined;
  }
  const str = (v: unknown, max: number): string => {
    if (v === null || v === undefined) {
      return "";
    }
    const t = typeof v === "string" ? v : String(v);
    return t.trim().slice(0, max);
  };
  const serialRaw =
    b.allocation_serial_number === null || b.allocation_serial_number === undefined
      ? ""
      : typeof b.allocation_serial_number === "string"
        ? b.allocation_serial_number.trim()
        : String(b.allocation_serial_number).trim();
  const out: AssetAllocationUpsert = {
    remarks: str(b.allocation_remarks, 4000),
    allocation_category_name: str(b.allocation_category_name, 255),
    allocation_branch_name: str(b.allocation_branch_name, 255),
    emp_name: str(b.allocation_emp_name, 255),
    serial_number: serialRaw === "" ? null : serialRaw.slice(0, 128),
  };
  if (Object.prototype.hasOwnProperty.call(b, "allocation_date_bs")) {
    out.allocation_date_bs = str(b.allocation_date_bs, 32);
  }
  return out;
}

function allocationFromImportRow(row: ImportAssetRowInput): AssetAllocationUpsert {
  const t = (v: unknown, max: number): string => {
    if (v === null || v === undefined) {
      return "";
    }
    const s = typeof v === "string" ? v.trim() : String(v).trim();
    return s.slice(0, max);
  };
  const serialRaw = t(row.allocation_serial_number, 256);
  return {
    remarks: t(row.allocation_remarks, 4000),
    allocation_category_name: t(row.allocation_category_name, 255),
    allocation_branch_name: t(row.allocation_branch_name, 255),
    emp_name: t(row.allocation_emp_name, 255),
    serial_number: serialRaw === "" ? null : serialRaw.slice(0, 128),
    allocation_date_bs: t(row.allocation_date_bs ?? "", 32),
  };
}

export function parseCreateAssetPayload(body: unknown): CreateAssetInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;

  const asset_name =
    typeof b.asset_name === "string" ? b.asset_name.trim() : "";
  const group_id = Number.isFinite(Number(b.group_id))
    ? Math.floor(Number(b.group_id))
    : NaN;
  const sub_group_id =
    b.sub_group_id === null || b.sub_group_id === undefined
      ? null
      : Number.isFinite(Number(b.sub_group_id))
        ? Math.floor(Number(b.sub_group_id))
        : NaN;
  const ownership_type =
    typeof b.ownership_type === "string" ? b.ownership_type.trim() : "";
  const working_status =
    typeof b.working_status === "string" ? b.working_status.trim() : "";
  const branch_id = Number.isFinite(Number(b.branch_id))
    ? Math.floor(Number(b.branch_id))
    : NaN;
  let department_id: number | null = null;
  if (b.department_id !== null && b.department_id !== undefined && b.department_id !== "") {
    const raw =
      typeof b.department_id === "number"
        ? b.department_id
        : Number(b.department_id);
    if (!Number.isFinite(raw) || raw < 1) {
      throw new Error("Invalid department.");
    }
    department_id = Math.floor(raw);
  }
  const purchase_date_bs =
    typeof b.purchase_date_bs === "string" ? b.purchase_date_bs.trim() : "";
  const depreciation_start_date_bs =
    typeof b.depreciation_start_date_bs === "string"
      ? b.depreciation_start_date_bs.trim()
      : "";

  const purchase_qty = parseOptionalNumber(b.purchase_qty);
  const unit_rate = parseOptionalNumber(b.unit_rate);
  const purchase_invoice_no =
    typeof b.purchase_invoice_no === "string" &&
    b.purchase_invoice_no.trim() !== ""
      ? b.purchase_invoice_no.trim()
      : null;

  let book_value: number | null = null;
  if (b.book_value !== null && b.book_value !== undefined && b.book_value !== "") {
    book_value = parseOptionalNumber(b.book_value);
    if (book_value !== null && book_value <= 0) {
      throw new Error("Book value must be positive when set.");
    }
  }

  if (!asset_name) {
    throw new Error("Asset name is required.");
  }
  if (!Number.isFinite(group_id) || group_id < 1) {
    throw new Error("A valid asset group is required.");
  }
  if (sub_group_id !== null && (!Number.isFinite(sub_group_id) || sub_group_id < 1)) {
    throw new Error("A valid asset sub group is required when provided.");
  }
  if (!ownership_type) {
    throw new Error("Ownership type is required.");
  }
  if (!working_status) {
    throw new Error("Working status is required.");
  }
  if (!Number.isFinite(branch_id) || branch_id < 1) {
    throw new Error("A valid branch is required.");
  }
  if (!purchase_date_bs) {
    throw new Error("Purchase date is required.");
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(purchase_date_bs)) {
    throw new Error("Purchase date must be YYYY/MM/DD (Bikram Sambat).");
  }
  if (!depreciation_start_date_bs) {
    throw new Error("Depreciation start date is required.");
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(depreciation_start_date_bs)) {
    throw new Error(
      "Depreciation start date must be YYYY/MM/DD (Bikram Sambat)."
    );
  }

  const allocation = parseOptionalAllocationFromBody(b);
  const out: CreateAssetInput = {
    asset_name,
    group_id,
    sub_group_id,
    ownership_type,
    working_status,
    branch_id,
    department_id,
    purchase_date_bs,
    depreciation_start_date_bs,
    purchase_qty,
    unit_rate,
    purchase_invoice_no,
    book_value,
  };
  if (allocation !== undefined) {
    out.allocation = allocation;
  }
  return out;
}

function resolveAssetCodeForRow(
  input: CreateAssetInput,
  hrmsAssetId: number,
  refs: { branch_code: string; group_code: string }
): string {
  return buildAssetCode({
    hrmsAssetId,
    branchCode: refs.branch_code,
    assetGroupCode: refs.group_code,
    purchaseDateBs: input.purchase_date_bs,
  });
}

function parseOptionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error("Invalid numeric value.");
  }
  return n;
}

function normalizeComparableText(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeBsDateInput(v: unknown): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (raw === "") {
    return "";
  }
  const nfkc = raw.normalize("NFKC");
  const englishDigits = nfkc.replace(/[०-९]/g, (d) =>
    String("०१२३४५६७८९".indexOf(d))
  );
  return englishDigits
    .replace(/[-.]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

function parseDateBsOrThrow(v: unknown, fieldName: string): string {
  const text = normalizeBsDateInput(v);
  const match = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) {
    const raw = typeof v === "string" ? v.trim() : String(v ?? "").trim();
    const rawPart = raw !== "" ? ` (received: "${raw}")` : "";
    throw new Error(
      `${fieldName} must be YYYY/MM/DD (Bikram Sambat).${rawPart}`
    );
  }
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (!/^\d{4}$/.test(year ?? "")) {
    throw new Error(`${fieldName} must be YYYY/MM/DD (Bikram Sambat).`);
  }
  const mNum = Number.parseInt(month!, 10);
  const dNum = Number.parseInt(day!, 10);
  if (!Number.isFinite(mNum) || !Number.isFinite(dNum) || mNum < 1 || mNum > 12 || dNum < 1 || dNum > 32) {
    throw new Error(`${fieldName} must be YYYY/MM/DD (Bikram Sambat).`);
  }
  return `${year}/${String(mNum).padStart(2, "0")}/${String(dNum).padStart(2, "0")}`;
}

function parseNumberish(v: unknown): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type ImportBranchRow = {
  id: number;
  branch_name: string;
  branch_code: string;
};

function registerBranchInImportMaps(
  branch: ImportBranchRow,
  branchByName: Map<string, ImportBranchRow>,
  branchByCodeKey: Map<string, ImportBranchRow>
): void {
  const fullKey = normalizeComparableText(branch.branch_name);
  branchByName.set(fullKey, branch);
  const stripped = stripBcHintFromBranchName(branch.branch_name).trim();
  const strippedKey =
    stripped !== "" ? normalizeComparableText(stripped) : "";
  if (strippedKey !== "" && strippedKey !== fullKey) {
    if (!branchByName.has(strippedKey)) {
      branchByName.set(strippedKey, branch);
    }
  }
  const ck = branchCodeLookupKey(branch.branch_code);
  if (!branchByCodeKey.has(ck)) {
    branchByCodeKey.set(ck, branch);
  }
}

async function insertImportBranchRow(
  branch_code: string,
  branch_name: string
): Promise<ImportBranchRow> {
  const code = branch_code.trim().slice(0, 64);
  const name = appendBcHintToBranchNameForImport(branch_name, code).trim().slice(0, 255);
  if (code === "" || name === "") {
    throw new Error("Cannot auto-create branch: branch code and name are required.");
  }
  const ins = await query<ImportBranchRow>(
    `INSERT INTO hrms_branches (branch_code, branch_name)
     VALUES ($1, $2)
     ON CONFLICT (branch_code) DO NOTHING
     RETURNING id, branch_name, branch_code`,
    [code, name]
  );
  if (ins.rows[0]) {
    return ins.rows[0];
  }
  const sel = await query<ImportBranchRow>(
    `SELECT id, branch_name, branch_code FROM hrms_branches WHERE branch_code = $1`,
    [code]
  );
  const row = sel.rows[0];
  if (!row) {
    throw new Error("Could not create or load branch.");
  }
  return row;
}

function slugBranchCodeFromName(name: string): string {
  const base = normalizeComparableText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 48);
  return base.length > 0 ? base : "BRANCH";
}

/**
 * Creates a missing `hrms_branches` row from Excel import context so users do not
 * have to pre-register branches before importing assets.
 */
async function ensureBranchRowFromImportExcel(params: {
  hasSkdblBranchSegment: boolean;
  segmentFromCode: string | null;
  bcHint: string | null;
  branchNameRaw: string;
  branchByName: Map<string, ImportBranchRow>;
  branchByCodeKey: Map<string, ImportBranchRow>;
}): Promise<ImportBranchRow> {
  const {
    hasSkdblBranchSegment,
    segmentFromCode,
    bcHint,
    branchNameRaw,
    branchByName,
    branchByCodeKey,
  } = params;

  const fromCode =
    hasSkdblBranchSegment &&
    segmentFromCode !== null &&
    segmentFromCode !== "";
  const fromBc = bcHint !== null && bcHint !== "";

  if (fromCode || fromBc) {
    const branch_code = (
      fromCode && segmentFromCode ? segmentFromCode : formatBranchCodeSegment(bcHint!)
    ).slice(0, 64);
    const stripped =
      branchNameRaw !== "" ? stripBcHintFromBranchName(branchNameRaw).trim() : "";
    const branch_name = (
      stripped !== ""
        ? stripped
        : branchNameRaw.trim() !== ""
          ? branchNameRaw.trim()
          : `Branch ${branch_code}`
    ).slice(0, 255);
    const row = await insertImportBranchRow(branch_code, branch_name);
    registerBranchInImportMaps(row, branchByName, branchByCodeKey);
    return row;
  }

  if (branchNameRaw.trim() !== "") {
    const branch_name = branchNameRaw.trim().slice(0, 255);
    const base = slugBranchCodeFromName(branch_name);
    for (let i = 0; i < 50; i += 1) {
      const candidate = (i === 0 ? base : `${base}-${i + 1}`).slice(0, 64);
      const key = branchCodeLookupKey(candidate);
      const existing = branchByCodeKey.get(key);
      if (!existing) {
        const row = await insertImportBranchRow(candidate, branch_name);
        registerBranchInImportMaps(row, branchByName, branchByCodeKey);
        return row;
      }
      if (
        normalizeComparableText(
          stripBcHintFromBranchName(existing.branch_name)
        ) === normalizeComparableText(stripBcHintFromBranchName(branch_name))
      ) {
        return existing;
      }
    }
    throw new Error(
      "Could not allocate a unique branch code from BranchName. Try adding (BC:yourCode) to BranchName."
    );
  }

  throw new Error(
    "Branch could not be determined. Add BranchName, (BC:code) on BranchName, or an SKDBL AssetCode so a branch can be created or matched."
  );
}

export function parseImportAssetsPayload(body: unknown): ImportAssetsPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.rows)) {
    throw new Error("rows must be an array.");
  }
  return { rows: b.rows as ImportAssetRowInput[] };
}

export async function importAssetsFromRows(
  payload: ImportAssetsPayload
): Promise<ImportAssetsResult> {
  if (payload.rows.length === 0) {
    throw new Error("No rows provided for import.");
  }

  const groupsResult = await query<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM hrms_groups`
  );
  const subGroupsResult = await query<{ id: number; group_id: number; name: string }>(
    `SELECT id, group_id, name FROM hrms_sub_groups`
  );
  const branchesResult = await query<{
    id: number;
    branch_name: string;
    branch_code: string;
  }>(`SELECT id, branch_name, branch_code FROM hrms_branches`);
  const departmentsResult = await query<{ id: number; name: string }>(
    `SELECT id, name FROM hrms_departments`
  );
  const existingAssetCodesResult = await query<{ asset_code: string }>(
    `SELECT asset_code FROM hrms_assets WHERE asset_code IS NOT NULL`
  );

  const groupMaps = indexGroupsForExcelImport(groupsResult.rows);

  const branchByName = new Map<
    string,
    { id: number; branch_name: string; branch_code: string }
  >();
  const branchByCodeKey = new Map<
    string,
    { id: number; branch_name: string; branch_code: string }
  >();
  for (const b of branchesResult.rows) {
    registerBranchInImportMaps(b, branchByName, branchByCodeKey);
  }

  const departmentByName = new Map<string, { id: number; name: string }>();
  for (const d of departmentsResult.rows) {
    departmentByName.set(normalizeComparableText(d.name), d);
  }

  const subGroupByGroupName = new Map<
    number,
    Map<string, { id: number; group_id: number; name: string }>
  >();
  const existingAssetCodes = new Set(
    existingAssetCodesResult.rows
      .map((r) => r.asset_code?.trim())
      .filter((code): code is string => Boolean(code))
  );
  const uploadAssetCodes = new Set<string>();
  for (const sg of subGroupsResult.rows) {
    const key = sg.group_id;
    const existing = subGroupByGroupName.get(key);
    if (existing) {
      existing.set(normalizeComparableText(sg.name), sg);
      continue;
    }
    subGroupByGroupName.set(
      key,
      new Map([[normalizeComparableText(sg.name), sg]])
    );
  }

  let importedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const validatedInputs: Array<{ row: number; input: CreateAssetInput }> = [];

  for (let idx = 0; idx < payload.rows.length; idx += 1) {
    const row = payload.rows[idx];
    const rowNumber = idx + 1;
    try {
      const sourceAssetCode =
        typeof row.asset_code === "string" ? row.asset_code.trim() : "";
      if (sourceAssetCode !== "") {
        if (uploadAssetCodes.has(sourceAssetCode)) {
          throw new Error(
            `Duplicate AssetCode "${sourceAssetCode}" appears more than once in this file.`
          );
        }
        if (existingAssetCodes.has(sourceAssetCode)) {
          throw new Error(
            `AssetCode "${sourceAssetCode}" already exists. This file (or asset) was already imported.`
          );
        }
        uploadAssetCodes.add(sourceAssetCode);
      }

      const assetName = typeof row.asset_name === "string" ? row.asset_name.trim() : "";
      if (assetName === "") {
        skippedCount += 1;
        continue;
      }

      const groupName = typeof row.group_name === "string" ? row.group_name.trim() : "";
      if (groupName === "") {
        throw new Error("Group name is required.");
      }
      const group = resolveGroupLabelForExcelImport(
        groupName,
        groupMaps,
        groupsResult.rows
      );
      if (!group) {
        throw new Error(
          `Group not found for "${groupName}". Use a group name or code that matches an existing asset group.`
        );
      }

      const branchNameRaw =
        typeof row.branch_name === "string" ? row.branch_name.trim() : "";

      const segmentFromCode =
        sourceAssetCode !== ""
          ? parseBranchSegmentFromSkdblAssetCode(sourceAssetCode)
          : null;
      const hasSkdblBranchSegment =
        segmentFromCode !== null && segmentFromCode !== "";

      if (branchNameRaw === "" && !hasSkdblBranchSegment) {
        throw new Error(
          "BranchName is required unless AssetCode is in SKDBL/… form so the branch can be read from the code."
        );
      }

      const bcHint =
        branchNameRaw !== "" ? extractBcHintFromBranchName(branchNameRaw) : null;

      let branch: { id: number; branch_name: string; branch_code: string } | undefined;

      if (hasSkdblBranchSegment) {
        branch = branchByCodeKey.get(segmentFromCode.toLowerCase());
      }
      if (!branch && bcHint !== null && bcHint !== "") {
        branch = branchByCodeKey.get(branchCodeLookupKey(bcHint));
      }
      if (!branch && branchNameRaw !== "") {
        branch = branchByName.get(normalizeComparableText(branchNameRaw));
      }
      if (!branch && branchNameRaw !== "") {
        const stripped = stripBcHintFromBranchName(branchNameRaw);
        if (stripped !== "" && stripped !== branchNameRaw) {
          branch = branchByName.get(normalizeComparableText(stripped));
        }
      }

      if (!branch) {
        branch = await ensureBranchRowFromImportExcel({
          hasSkdblBranchSegment,
          segmentFromCode,
          bcHint,
          branchNameRaw,
          branchByName,
          branchByCodeKey,
        });
      }

      let subGroupId: number | null = null;
      const subGroupName =
        typeof row.sub_group_name === "string" ? row.sub_group_name.trim() : "";
      if (subGroupName !== "") {
        const groupMap = subGroupByGroupName.get(group.id);
        const matched = groupMap?.get(normalizeComparableText(subGroupName));
        if (!matched) {
          throw new Error(
            `Sub group not found under "${group.name}": ${subGroupName}`
          );
        }
        subGroupId = matched.id;
      }

      let departmentId: number | null = null;
      const departmentName =
        typeof row.department_name === "string" ? row.department_name.trim() : "";
      if (departmentName !== "") {
        const department = departmentByName.get(
          normalizeComparableText(departmentName)
        );
        if (department) {
          departmentId = department.id;
        }
      }

      const purchaseDateBs = parseDateBsOrThrow(row.purchase_date_bs, "Purchase date");
      const depStartRaw = normalizeBsDateInput(row.depreciation_start_date_bs);
      const depreciationStartDateBs =
        depStartRaw === ""
          ? purchaseDateBs
          : parseDateBsOrThrow(row.depreciation_start_date_bs, "Depreciation start date");

      const ownershipTypeRaw =
        typeof row.ownership_type === "string" ? row.ownership_type.trim() : "";
      const ownershipType = ownershipTypeRaw === "" ? "Owner" : ownershipTypeRaw;

      const workingStatusRaw =
        typeof row.working_status === "string" ? row.working_status.trim() : "";
      const workingStatusMap: Record<string, string> = {
        INUSE: "In use",
        IN_USE: "In use",
      };
      const workingStatus =
        workingStatusRaw === ""
          ? "In use"
          : workingStatusMap[workingStatusRaw.toUpperCase()] ?? workingStatusRaw;

      const qty = parseNumberish(row.purchase_qty);
      const purchaseAmount = parseNumberish(row.purchase_amount);
      const unitRate =
        purchaseAmount !== null && qty !== null && qty > 0
          ? purchaseAmount / qty
          : purchaseAmount;

      const purchaseInvoiceNo =
        typeof row.purchase_invoice_no === "string" && row.purchase_invoice_no.trim() !== ""
          ? row.purchase_invoice_no.trim()
          : null;

      const bookVal = parseNumberish(row.book_value);
      const book_value =
        bookVal !== null && bookVal > 0 ? bookVal : null;

      const input: CreateAssetInput = {
        asset_name: assetName,
        group_id: group.id,
        sub_group_id: subGroupId,
        ownership_type: ownershipType,
        working_status: workingStatus,
        branch_id: branch.id,
        department_id: departmentId,
        purchase_date_bs: purchaseDateBs,
        depreciation_start_date_bs: depreciationStartDateBs,
        purchase_qty: qty,
        unit_rate: unitRate,
        purchase_invoice_no: purchaseInvoiceNo,
        book_value,
        allocation: allocationFromImportRow(row),
      };
      validatedInputs.push({ row: rowNumber, input });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not import this row.";
      errors.push({ row: rowNumber, message });
    }
  }

  if (errors.length > 0) {
    return {
      importedCount: 0,
      skippedCount,
      errors: errors.sort((a, b) => a.row - b.row),
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of validatedInputs) {
      await createAsset(item.input, client);
      importedCount += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    const message =
      err instanceof Error ? err.message : "Import failed; upload rolled back.";
    return {
      importedCount: 0,
      skippedCount,
      errors: [{ row: 1, message: `Import failed and rolled back: ${message}` }],
    };
  } finally {
    client.release();
  }

  return {
    importedCount,
    skippedCount,
    errors: [],
  };
}

type QueryExecutor = Pick<pg.Pool, "query"> | pg.PoolClient;

async function upsertAssetAllocation(
  db: QueryExecutor,
  assetId: number,
  registerBranchDisplayName: string,
  fields: AssetAllocationUpsert
): Promise<void> {
  const reg =
    registerBranchDisplayName.trim() === ""
      ? "Branch"
      : registerBranchDisplayName.trim().slice(0, 255);
  const allocBranch =
    fields.allocation_branch_name.trim() !== ""
      ? fields.allocation_branch_name.trim().slice(0, 255)
      : reg;
  const baseVals: unknown[] = [
    assetId,
    fields.remarks.trim().slice(0, 4000),
    fields.allocation_category_name.trim().slice(0, 255),
    allocBranch,
    fields.emp_name.trim().slice(0, 255),
    fields.serial_number,
  ];
  if (fields.allocation_date_bs !== undefined) {
    const dateBs = fields.allocation_date_bs.trim().slice(0, 32);
    await db.query(
      `INSERT INTO hrms_asset_allocations (
      asset_id, remarks, allocation_category_name, allocation_branch_name, emp_name, serial_number, allocation_date_bs
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (asset_id) DO UPDATE SET
      remarks = EXCLUDED.remarks,
      allocation_category_name = EXCLUDED.allocation_category_name,
      allocation_branch_name = EXCLUDED.allocation_branch_name,
      emp_name = EXCLUDED.emp_name,
      serial_number = EXCLUDED.serial_number,
      allocation_date_bs = EXCLUDED.allocation_date_bs,
      updated_at = NOW()`,
      [...baseVals, dateBs]
    );
  } else {
    await db.query(
      `INSERT INTO hrms_asset_allocations (
      asset_id, remarks, allocation_category_name, allocation_branch_name, emp_name, serial_number
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (asset_id) DO UPDATE SET
      remarks = EXCLUDED.remarks,
      allocation_category_name = EXCLUDED.allocation_category_name,
      allocation_branch_name = EXCLUDED.allocation_branch_name,
      emp_name = EXCLUDED.emp_name,
      serial_number = EXCLUDED.serial_number,
      updated_at = NOW()`,
      baseVals
    );
  }
}

async function resolveAssetRefs(
  input: CreateAssetInput,
  db: QueryExecutor = pool
): Promise<{
  branch_code: string;
  branch_name: string;
  group_code: string;
  group_dep_method: string | null;
  group_dep_rate: string | null;
}> {
  const branchRow = await db.query<{ branch_code: string; branch_name: string }>(
    `SELECT branch_code, branch_name FROM hrms_branches WHERE id = $1`,
    [input.branch_id]
  );
  const branch = branchRow.rows[0];
  if (!branch) {
    throw new Error("Branch not found.");
  }

  const groupRow = await db.query<{
    code: string;
    dep_method: string | null;
    dep_rate: string | null;
  }>(
    `SELECT code, dep_method, dep_rate::text AS dep_rate FROM hrms_groups WHERE id = $1`,
    [input.group_id]
  );
  const grp = groupRow.rows[0];
  if (!grp) {
    throw new Error("Asset group not found.");
  }

  const subCount = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hrms_sub_groups WHERE group_id = $1`,
    [input.group_id]
  );
  const nSub = Number(subCount.rows[0]?.n ?? 0);
  if (nSub > 0 && input.sub_group_id === null) {
    throw new Error("Select an asset sub group for this asset group.");
  }
  if (nSub === 0 && input.sub_group_id !== null) {
    throw new Error("This asset group has no sub groups.");
  }

  if (input.sub_group_id !== null) {
    const sg = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_sub_groups
       WHERE id = $1 AND group_id = $2`,
      [input.sub_group_id, input.group_id]
    );
    if (Number(sg.rows[0]?.n ?? 0) === 0) {
      throw new Error("Asset sub group does not belong to the selected group.");
    }
  }

  return {
    branch_code: branch.branch_code,
    branch_name: branch.branch_name,
    group_code: grp.code,
    group_dep_method: grp.dep_method,
    group_dep_rate: grp.dep_rate,
  };
}

async function assertDepartmentExists(
  department_id: number | null,
  db: QueryExecutor = pool
): Promise<void> {
  if (department_id === null) {
    return;
  }
  const r = await db.query<{ id: number }>(
    `SELECT id FROM hrms_departments WHERE id = $1`,
    [department_id]
  );
  if (!r.rows[0]) {
    throw new Error("Department not found.");
  }
}

async function createAssetWithClient(
  input: CreateAssetInput,
  client: pg.PoolClient
): Promise<Asset> {
  await assertDepartmentExists(input.department_id, client);
  const refs = await resolveAssetRefs(input, client);

    const insert = await client.query<{
      id: number;
      created_at: string;
    }>(
      `INSERT INTO hrms_assets (
        asset_name, group_id, sub_group_id, ownership_type, working_status,
        branch_id, department_id, purchase_date_bs, depreciation_start_date_bs,
        purchase_qty, unit_rate, purchase_invoice_no, old_book_value, book_value,
        dep_method_snapshot, dep_rate_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, created_at::text`,
      [
        input.asset_name,
        input.group_id,
        input.sub_group_id,
        input.ownership_type,
        input.working_status,
        input.branch_id,
        input.department_id,
        input.purchase_date_bs,
        input.depreciation_start_date_bs,
        input.purchase_qty,
        input.unit_rate,
        input.purchase_invoice_no,
        null,
        input.book_value,
        refs.group_dep_method,
        refs.group_dep_rate,
      ]
    );

    const row = insert.rows[0];
    if (!row) {
      throw new Error("Failed to create asset.");
    }

    const baseAssetCode = resolveAssetCodeForRow(input, row.id, refs);

    let updated: { rows: Asset[] } | null = null;
    for (let attempt = 0; attempt <= MAX_AUTO_ASSET_CODE_RETRIES; attempt += 1) {
      const candidateCode = buildAssetCodeRetryCandidate(baseAssetCode, attempt);
      try {
        updated = await client.query<Asset>(
          `UPDATE hrms_assets AS a SET asset_code = $1 WHERE a.id = $2
           RETURNING a.id, a.asset_code, a.asset_name, a.group_id, a.sub_group_id,
             a.ownership_type, a.working_status, a.branch_id, a.department_id,
             (SELECT d.name FROM hrms_departments d WHERE d.id = a.department_id) AS department_name,
             a.purchase_date_bs,
             a.depreciation_start_date_bs,
             a.purchase_qty::text, a.unit_rate::text, a.book_value::text, a.old_book_value::text, a.purchase_invoice_no,
             a.created_at::text`,
          [candidateCode, row.id]
        );
        break;
      } catch (err) {
        if (isAssetCodeUniqueViolation(err) && attempt < MAX_AUTO_ASSET_CODE_RETRIES) {
          continue;
        }
        throw err;
      }
    }

    if (!updated) {
      throw new Error("Could not generate a unique asset code. Please retry.");
    }

  const out = updated.rows[0];
  if (!out) {
    throw new Error("Failed to load asset after save.");
  }

  const registerBranch =
    stripBcHintFromBranchName(refs.branch_name).trim() ||
    refs.branch_name.trim();
  const allocationDefaults: AssetAllocationUpsert = {
    remarks: "",
    allocation_category_name: "",
    allocation_branch_name: "",
    emp_name: "",
    serial_number: null,
    allocation_date_bs: "",
  };
  await upsertAssetAllocation(
    client,
    out.id,
    registerBranch,
    input.allocation ?? allocationDefaults
  );

  return out;
}

export async function createAsset(
  input: CreateAssetInput,
  existingClient?: pg.PoolClient
): Promise<Asset> {
  if (existingClient) {
    return createAssetWithClient(input, existingClient);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await createAssetWithClient(input, client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAsset(
  id: number,
  input: CreateAssetInput
): Promise<Asset | null> {
  const existing = await query<{
    id: number;
    depreciation_start_date_bs: string;
    book_value: string | null;
  }>(
    `SELECT id, depreciation_start_date_bs, book_value::text
     FROM hrms_assets
     WHERE id = $1`,
    [id]
  );
  const prev = existing.rows[0];
  if (!prev) {
    return null;
  }

  await assertDepartmentExists(input.department_id);
  const refs = await resolveAssetRefs(input);
  const baseAssetCode = resolveAssetCodeForRow(input, id, refs);
  let result: { rows: Asset[] } | null = null;

  for (let attempt = 0; attempt <= MAX_AUTO_ASSET_CODE_RETRIES; attempt += 1) {
    const candidateCode = buildAssetCodeRetryCandidate(baseAssetCode, attempt);
    try {
      result = await query<Asset>(
        `UPDATE hrms_assets AS a SET
          asset_code = $1,
          asset_name = $2,
          group_id = $3,
          sub_group_id = $4,
          ownership_type = $5,
          working_status = $6,
          branch_id = $7,
          department_id = $8,
          purchase_date_bs = $9,
          depreciation_start_date_bs = $10,
          purchase_qty = $11,
          unit_rate = $12,
          purchase_invoice_no = $13,
          old_book_value = $14,
          book_value = $15
        WHERE a.id = $16
        RETURNING a.id, a.asset_code, a.asset_name, a.group_id, a.sub_group_id,
          a.ownership_type, a.working_status, a.branch_id, a.department_id,
          (SELECT d.name FROM hrms_departments d WHERE d.id = a.department_id) AS department_name,
          a.purchase_date_bs,
          a.depreciation_start_date_bs,
          a.purchase_qty::text, a.unit_rate::text, a.book_value::text, a.old_book_value::text, a.purchase_invoice_no,
          a.created_at::text`,
        [
          candidateCode,
          input.asset_name,
          input.group_id,
          input.sub_group_id,
          input.ownership_type,
          input.working_status,
          input.branch_id,
          input.department_id,
          input.purchase_date_bs,
          input.depreciation_start_date_bs,
          input.purchase_qty,
          input.unit_rate,
          input.purchase_invoice_no,
          null,
          input.book_value,
          id,
        ]
      );
      break;
    } catch (err) {
      if (isAssetCodeUniqueViolation(err) && attempt < MAX_AUTO_ASSET_CODE_RETRIES) {
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    throw new Error("Could not generate a unique asset code. Please retry.");
  }
  const updated = result.rows[0] ?? null;
  if (!updated) {
    return null;
  }

  const prevParsed =
    prev.book_value != null && prev.book_value !== ""
      ? Number.parseFloat(prev.book_value)
      : NaN;
  const prevNorm =
    Number.isFinite(prevParsed) && prevParsed > 0 ? prevParsed : null;
  const nextNorm =
    input.book_value !== null &&
    input.book_value !== undefined &&
    Number.isFinite(input.book_value) &&
    input.book_value > 0
      ? input.book_value
      : null;
  const bookChanged =
    prevNorm === null && nextNorm === null
      ? false
      : prevNorm === null ||
        nextNorm === null ||
        Math.abs(prevNorm - nextNorm) > 0.0001;

  if (
    prev.depreciation_start_date_bs !== input.depreciation_start_date_bs ||
    bookChanged
  ) {
    await refreshMutableDepreciationRunsForAsset(id);
  }

  if (input.allocation !== undefined) {
    const bRow = await query<{ branch_name: string }>(
      `SELECT branch_name FROM hrms_branches WHERE id = $1`,
      [input.branch_id]
    );
    const nm = bRow.rows[0]?.branch_name ?? "";
    const registerBranch =
      stripBcHintFromBranchName(nm).trim() || nm.trim() || "Branch";
    await upsertAssetAllocation(pool, id, registerBranch, input.allocation);
  }

  return updated;
}

export async function deleteAsset(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM hrms_assets WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export type AssetListRow = {
  id: number;
  group_id: number;
  sub_group_id: number | null;
  branch_id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_code: string;
  /** From `hrms_groups.dep_method` (Straight Line / Declining Balance). */
  group_dep_method: string | null;
  /** From `hrms_groups.dep_rate` (%). */
  group_dep_rate: string | null;
  sub_group_name: string | null;
  branch_code: string;
  branch_name: string;
  ownership_type: string;
  working_status: string;
  department_id: number | null;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  book_value: string | null;
  old_book_value: string | null;
  purchase_invoice_no: string | null;
  created_at: string;
  allocation_remarks: string;
  allocation_category_name: string;
  allocation_branch_name: string;
  allocation_emp_name: string;
  allocation_serial_number: string | null;
};

export type AssetAllocationListRow = {
  asset_code: string | null;
  asset_id: number;
  asset_name: string;
  purchase_date_nepali: string;
  dep_start_date_nepali: string;
  qty: string | null;
  purchase_amount: string | null;
  sub_group_name: string | null;
  own_type: string;
  working_status: string;
  branch_name: string;
  allocation_branch_name: string;
  book_qty: string | null;
  /** Same basis as depreciation run detail `depreciation_cost_basis`. */
  purchase_with_additional_amount: string | null;
  accumulate_dep: string | null;
  book_value: string | null;
  group_name: string;
  dep_amount: string | null;
  this_year_dep: string | null;
  /** Same as depreciation UI: cost basis minus closing WDV (not accumulate_dep + dep_amount). */
  total_dep_amount: string | null;
  closing_book_value: string | null;
  /** Latest posted depreciation detail row per asset (matches run detail screen for that posting). */
  dep_fiscal_year: string | null;
  dep_rate: string | null;
  dep_days: string | null;
};

export type ListAssetsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListAssetsResult = {
  assets: AssetListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListAssetAllocationsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListAssetAllocationsResult = {
  rows: AssetAllocationListRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Hard cap for one-shot CSV export (avoids unbounded memory on the server). */
const ALLOCATION_EXPORT_MAX_ROWS = 100_000;

export type ExportAssetAllocationsResult = {
  rows: AssetAllocationListRow[];
  /** True when at least one more row existed beyond {@link ALLOCATION_EXPORT_MAX_ROWS}. */
  truncated: boolean;
};

/** Single-asset allocation profile + current allocation row (one row per asset in DB). */
export type AssetAllocationProfileApiProfile = {
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  purchase_date_bs: string;
  working_status: string;
  group_name: string;
  purchase_amount: string | null;
  dep_method: string | null;
  asset_user: string | null;
  branch_name: string;
  department_name: string | null;
  branch_id: number;
  department_id: number | null;
  /** Nepali BS `YYYY/MM/DD` when set on the allocation row. */
  allocation_date_bs: string;
};

export type AssetAllocationHistoryRow = {
  allocation_id: number;
  purchase_date_bs: string;
  allocation_date_display: string;
  fiscal_year: string | null;
  allocation_type: string;
  old_asset_code: string | null;
  asset_user: string | null;
  responsible_unit_name: string | null;
  branch_name: string;
  department_name: string | null;
};

export type AssetAllocationProfileApiResponse = {
  profile: AssetAllocationProfileApiProfile;
  history: AssetAllocationHistoryRow[];
};

type AssetAllocationProfileDbRow = {
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  purchase_date_bs: string;
  working_status: string;
  group_name: string;
  group_dep_method: string | null;
  dep_method_snapshot: string | null;
  purchase_amount: string | null;
  branch_id: number;
  department_id: number | null;
  branch_name: string;
  department_name: string | null;
  allocation_category_name: string;
  allocation_branch_name: string;
  emp_name: string;
  allocation_date_bs: string;
  allocation_created_at: string | null;
  allocation_updated_at: string | null;
  dep_fiscal_year: string | null;
};

function formatProfileAllocationDate(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso).slice(0, 10);
  }
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kathmandu",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function resolveDepMethodForProfile(
  snapshot: string | null,
  groupMethod: string | null
): string | null {
  const s = snapshot?.trim() ?? "";
  if (s !== "") {
    return s;
  }
  const g = groupMethod?.trim() ?? "";
  return g !== "" ? g : null;
}

const ASSET_ALLOCATION_PROFILE_SELECT = `
  SELECT
    a.id AS asset_id,
    a.asset_code,
    a.asset_name,
    a.purchase_date_bs,
    a.working_status,
    g.name AS group_name,
    g.dep_method AS group_dep_method,
    NULLIF(TRIM(a.dep_method_snapshot), '') AS dep_method_snapshot,
    (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::text AS purchase_amount,
    a.branch_id,
    a.department_id,
    b.branch_name,
    d.name AS department_name,
    COALESCE(NULLIF(TRIM(al.allocation_category_name), ''), '') AS allocation_category_name,
    COALESCE(
      NULLIF(TRIM(al.allocation_branch_name), ''),
      LEFT(TRIM(b.branch_name), 255)
    ) AS allocation_branch_name,
    COALESCE(NULLIF(TRIM(al.emp_name), ''), '') AS emp_name,
    COALESCE(NULLIF(TRIM(al.allocation_date_bs), ''), '') AS allocation_date_bs,
    al.created_at::text AS allocation_created_at,
    al.updated_at::text AS allocation_updated_at,
    ld.fiscal_year::text AS dep_fiscal_year
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_departments d ON d.id = a.department_id
  LEFT JOIN hrms_asset_allocations al ON al.asset_id = a.id
  LEFT JOIN LATERAL (
    SELECT
      d2.fiscal_year
    FROM hrms_depreciation_run_details d2
    WHERE d2.asset_id = a.id
    ORDER BY d2.depreciation_run_id DESC, d2.id DESC
    LIMIT 1
  ) ld ON true
  WHERE a.id = $1
`;

/** Same as {@link ASSET_ALLOCATION_PROFILE_SELECT} when `allocation_date_bs` is not migrated yet. */
const ASSET_ALLOCATION_PROFILE_SELECT_LEGACY = `
  SELECT
    a.id AS asset_id,
    a.asset_code,
    a.asset_name,
    a.purchase_date_bs,
    a.working_status,
    g.name AS group_name,
    g.dep_method AS group_dep_method,
    NULLIF(TRIM(a.dep_method_snapshot), '') AS dep_method_snapshot,
    (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::text AS purchase_amount,
    a.branch_id,
    a.department_id,
    b.branch_name,
    d.name AS department_name,
    COALESCE(NULLIF(TRIM(al.allocation_category_name), ''), '') AS allocation_category_name,
    COALESCE(
      NULLIF(TRIM(al.allocation_branch_name), ''),
      LEFT(TRIM(b.branch_name), 255)
    ) AS allocation_branch_name,
    COALESCE(NULLIF(TRIM(al.emp_name), ''), '') AS emp_name,
    ''::text AS allocation_date_bs,
    al.created_at::text AS allocation_created_at,
    al.updated_at::text AS allocation_updated_at,
    ld.fiscal_year::text AS dep_fiscal_year
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_departments d ON d.id = a.department_id
  LEFT JOIN hrms_asset_allocations al ON al.asset_id = a.id
  LEFT JOIN LATERAL (
    SELECT
      d2.fiscal_year
    FROM hrms_depreciation_run_details d2
    WHERE d2.asset_id = a.id
    ORDER BY d2.depreciation_run_id DESC, d2.id DESC
    LIMIT 1
  ) ld ON true
  WHERE a.id = $1
`;

let assetAllocationProfileSelectMode: "auto" | "full" | "legacy" = "auto";

function isPgUndefinedColumnForAllocDate(err: unknown): boolean {
  const code =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  return code === "42703" && /allocation_date_bs/i.test(msg);
}

export async function hrmsAssetAllocationsHasAllocationDateBsColumn(): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hrms_asset_allocations'
        AND column_name = 'allocation_date_bs'
    ) AS ok`
  );
  return r.rows[0]?.ok === true;
}

export async function getAssetAllocationProfile(
  assetId: number
): Promise<AssetAllocationProfileApiResponse | null> {
  if (!Number.isFinite(assetId) || assetId < 1) {
    return null;
  }

  if (assetAllocationProfileSelectMode === "legacy") {
    if (await hrmsAssetAllocationsHasAllocationDateBsColumn()) {
      assetAllocationProfileSelectMode = "full";
    }
  }

  const pickSql = (): string => {
    if (assetAllocationProfileSelectMode === "legacy") {
      return ASSET_ALLOCATION_PROFILE_SELECT_LEGACY;
    }
    if (assetAllocationProfileSelectMode === "full") {
      return ASSET_ALLOCATION_PROFILE_SELECT;
    }
    return ASSET_ALLOCATION_PROFILE_SELECT;
  };

  let result: { rows: AssetAllocationProfileDbRow[] };
  try {
    result = await query<AssetAllocationProfileDbRow>(pickSql(), [assetId]);
    if (assetAllocationProfileSelectMode === "auto") {
      assetAllocationProfileSelectMode = "full";
    }
  } catch (err) {
    if (
      assetAllocationProfileSelectMode === "auto" &&
      isPgUndefinedColumnForAllocDate(err)
    ) {
      assetAllocationProfileSelectMode = "legacy";
      result = await query<AssetAllocationProfileDbRow>(
        ASSET_ALLOCATION_PROFILE_SELECT_LEGACY,
        [assetId]
      );
    } else {
      throw err;
    }
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const depMethod = resolveDepMethodForProfile(
    row.dep_method_snapshot,
    row.group_dep_method
  );
  const branch = row.branch_name.trim();
  const allocBranch = row.allocation_branch_name.trim();
  const responsibleUnit =
    allocBranch !== "" && allocBranch !== branch ? allocBranch : null;

  const assetUser = row.emp_name.trim() === "" ? null : row.emp_name.trim();
  const allocationType =
    row.allocation_category_name.trim() === ""
      ? "New Allocation"
      : row.allocation_category_name.trim();

  const allocationWhen =
    row.allocation_updated_at ?? row.allocation_created_at ?? null;
  const dateBsTrim = row.allocation_date_bs.trim();
  const allocationDateLabel =
    dateBsTrim !== ""
      ? dateBsTrim
      : formatProfileAllocationDate(allocationWhen);

  const profile: AssetAllocationProfileApiProfile = {
    asset_id: row.asset_id,
    asset_code: row.asset_code,
    asset_name: row.asset_name,
    purchase_date_bs: row.purchase_date_bs,
    working_status: row.working_status,
    group_name: row.group_name,
    purchase_amount: row.purchase_amount,
    dep_method: depMethod,
    asset_user: assetUser,
    branch_name: row.branch_name,
    department_name: row.department_name,
    branch_id: row.branch_id,
    department_id: row.department_id,
    allocation_date_bs: dateBsTrim,
  };

  const historyRow: AssetAllocationHistoryRow = {
    allocation_id: row.asset_id,
    purchase_date_bs: row.purchase_date_bs,
    allocation_date_display: allocationDateLabel,
    fiscal_year:
      row.dep_fiscal_year != null && String(row.dep_fiscal_year).trim() !== ""
        ? String(row.dep_fiscal_year).trim()
        : null,
    allocation_type: allocationType,
    old_asset_code: null,
    asset_user: assetUser,
    responsible_unit_name: responsibleUnit,
    branch_name: row.branch_name,
    department_name: row.department_name,
  };

  return { profile, history: [historyRow] };
}

export function parseApplyAssetAllocationChangeBody(body: unknown): {
  allocation_type: "Transfer" | "Return";
  allocation_date_bs: string;
  branch_id: number;
  department_id: number | null;
} {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const typeRaw =
    typeof b.allocation_type === "string" ? b.allocation_type.trim() : "";
  if (typeRaw !== "Transfer" && typeRaw !== "Return") {
    throw new Error("allocation_type must be Transfer or Return.");
  }
  const rawDate =
    typeof b.allocation_date_bs === "string" ? b.allocation_date_bs.trim() : "";
  const allocation_date_bs = rawDate.replace(/-/g, "/").slice(0, 32);
  if (allocation_date_bs === "") {
    throw new Error("allocation_date_bs is required.");
  }
  const branch_id = Number.isFinite(Number(b.branch_id))
    ? Math.floor(Number(b.branch_id))
    : NaN;
  if (!Number.isFinite(branch_id) || branch_id < 1) {
    throw new Error("Invalid branch_id.");
  }
  let department_id: number | null = null;
  if (
    b.department_id !== null &&
    b.department_id !== undefined &&
    b.department_id !== ""
  ) {
    const raw =
      typeof b.department_id === "number"
        ? b.department_id
        : Number(b.department_id);
    if (!Number.isFinite(raw) || raw < 1) {
      throw new Error("Invalid department_id.");
    }
    department_id = Math.floor(raw);
  }
  return {
    allocation_type: typeRaw,
    allocation_date_bs,
    branch_id,
    department_id,
  };
}

/**
 * Updates register branch/department and the allocation row (type, BS date, branch label).
 * Preserves remarks, employee name, and serial on the allocation row.
 */
export async function applyAssetAllocationChange(
  assetId: number,
  body: unknown
): Promise<AssetAllocationProfileApiResponse | null> {
  if (!Number.isFinite(assetId) || assetId < 1) {
    return null;
  }
  const input = parseApplyAssetAllocationChangeBody(body);
  const exists = await query<{ id: number }>(
    `SELECT id FROM hrms_assets WHERE id = $1`,
    [assetId]
  );
  if (!exists.rows[0]) {
    return null;
  }
  if (!(await hrmsAssetAllocationsHasAllocationDateBsColumn())) {
    throw new Error(
      "Database is missing column allocation_date_bs on hrms_asset_allocations. From the backend folder run: npm run migrate"
    );
  }
  await assertDepartmentExists(input.department_id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bRow = await client.query<{ branch_name: string }>(
      `SELECT branch_name FROM hrms_branches WHERE id = $1`,
      [input.branch_id]
    );
    const br = bRow.rows[0];
    if (!br) {
      throw new Error("Branch not found.");
    }
    const branchName = br.branch_name.trim();
    await client.query(
      `UPDATE hrms_assets SET branch_id = $1, department_id = $2 WHERE id = $3`,
      [input.branch_id, input.department_id, assetId]
    );
    const curAlloc = await client.query<{
      remarks: string;
      emp_name: string;
      serial_number: string | null;
    }>(
      `SELECT remarks, emp_name, serial_number FROM hrms_asset_allocations WHERE asset_id = $1`,
      [assetId]
    );
    const cur = curAlloc.rows[0];
    const fields: AssetAllocationUpsert = {
      remarks: cur?.remarks ?? "",
      allocation_category_name: input.allocation_type,
      allocation_branch_name: branchName.slice(0, 255),
      emp_name: cur?.emp_name ?? "",
      serial_number: cur?.serial_number ?? null,
      allocation_date_bs: input.allocation_date_bs,
    };
    const registerBranch =
      stripBcHintFromBranchName(branchName).trim() ||
      branchName ||
      "Branch";
    await upsertAssetAllocation(client, assetId, registerBranch, fields);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  await refreshMutableDepreciationRunsForAsset(assetId);
  return getAssetAllocationProfile(assetId);
}

const ASSET_LIST_SELECT = `
  SELECT a.id,
    a.group_id,
    a.sub_group_id,
    a.branch_id,
    a.asset_code,
    a.asset_name,
    g.name AS group_name,
    g.code AS group_code,
    g.dep_method AS group_dep_method,
    g.dep_rate::text AS group_dep_rate,
    sg.name AS sub_group_name,
    b.branch_code,
    b.branch_name,
    a.ownership_type,
    a.working_status,
    a.department_id,
    d.name AS department_name,
    a.purchase_date_bs,
    a.depreciation_start_date_bs,
    a.purchase_qty::text,
    a.unit_rate::text,
    a.book_value::text,
    a.old_book_value::text,
    a.purchase_invoice_no,
    a.created_at::text,
    COALESCE(aloc.remarks, '') AS allocation_remarks,
    COALESCE(aloc.allocation_category_name, '') AS allocation_category_name,
    COALESCE(aloc.allocation_branch_name, '') AS allocation_branch_name,
    COALESCE(aloc.emp_name, '') AS allocation_emp_name,
    aloc.serial_number AS allocation_serial_number
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_departments d ON d.id = a.department_id
  LEFT JOIN hrms_asset_allocations aloc ON aloc.asset_id = a.id
`;

const ASSET_ALLOCATION_LIST_SELECT = `
  SELECT
    a.asset_code,
    a.id AS asset_id,
    a.asset_name,
    a.purchase_date_bs AS purchase_date_nepali,
    COALESCE(ld.dep_start_date_bs, a.depreciation_start_date_bs) AS dep_start_date_nepali,
    a.purchase_qty::text AS qty,
    (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::text AS purchase_amount,
    sg.name AS sub_group_name,
    a.ownership_type AS own_type,
    a.working_status,
    b.branch_name,
    COALESCE(
      NULLIF(TRIM(al.allocation_branch_name), ''),
      LEFT(TRIM(b.branch_name), 255)
    ) AS allocation_branch_name,
    a.purchase_qty::text AS book_qty,
    (CASE
      WHEN COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0) > 0
      THEN (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::numeric
      WHEN a.old_book_value IS NOT NULL AND a.old_book_value > 0
      THEN a.old_book_value
      WHEN a.book_value IS NOT NULL AND a.book_value > 0
      THEN a.book_value
      ELSE COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0)
    END)::text AS purchase_with_additional_amount,
    ld.accumulate_dep::text AS accumulate_dep,
    COALESCE(ld.book_value::text, a.book_value::text) AS book_value,
    g.name AS group_name,
    ld.dep_amount::text AS dep_amount,
    ld.dep_amount::text AS this_year_dep,
    CASE
      WHEN ld.balance_amount IS NULL THEN NULL
      ELSE (
        (CASE
          WHEN COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0) > 0
          THEN (COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0))::numeric
          WHEN a.old_book_value IS NOT NULL AND a.old_book_value > 0
          THEN a.old_book_value
          WHEN a.book_value IS NOT NULL AND a.book_value > 0
          THEN a.book_value
          ELSE COALESCE(a.purchase_qty, 0) * COALESCE(a.unit_rate, 0)
        END) - ld.balance_amount
      )::text
    END AS total_dep_amount,
    ld.balance_amount::text AS closing_book_value,
    ld.fiscal_year::text AS dep_fiscal_year,
    ld.dep_rate::text AS dep_rate,
    ld.dep_days::text AS dep_days
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_asset_allocations al ON al.asset_id = a.id
  LEFT JOIN LATERAL (
    SELECT
      d.dep_amount,
      d.accumulate_dep,
      d.balance_amount,
      d.book_value,
      d.dep_start_date_bs,
      d.dep_rate,
      d.dep_days,
      d.fiscal_year
    FROM hrms_depreciation_run_details d
    WHERE d.asset_id = a.id
    ORDER BY d.depreciation_run_id DESC, d.id DESC
    LIMIT 1
  ) ld ON true
`;

export async function listAssets(
  params: ListAssetsParams
): Promise<ListAssetsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_assets`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<AssetListRow>(
      `${ASSET_LIST_SELECT}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { assets: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM hrms_assets a
     INNER JOIN hrms_groups g ON g.id = a.group_id
     INNER JOIN hrms_branches b ON b.id = a.branch_id
     LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
     LEFT JOIN hrms_departments d ON d.id = a.department_id
     LEFT JOIN hrms_asset_allocations aloc ON aloc.asset_id = a.id
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(d.name, '') ILIKE $1 OR
       COALESCE(aloc.remarks, '') ILIKE $1 OR
       COALESCE(aloc.allocation_category_name, '') ILIKE $1 OR
       COALESCE(aloc.allocation_branch_name, '') ILIKE $1 OR
       COALESCE(aloc.emp_name, '') ILIKE $1 OR
       COALESCE(aloc.serial_number, '') ILIKE $1
     )`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<AssetListRow>(
    `${ASSET_LIST_SELECT}
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(d.name, '') ILIKE $1 OR
       COALESCE(aloc.remarks, '') ILIKE $1 OR
       COALESCE(aloc.allocation_category_name, '') ILIKE $1 OR
       COALESCE(aloc.allocation_branch_name, '') ILIKE $1 OR
       COALESCE(aloc.emp_name, '') ILIKE $1 OR
       COALESCE(aloc.serial_number, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { assets: list.rows, total, page, pageSize };
}

export async function listAssetAllocations(
  params: ListAssetAllocationsParams
): Promise<ListAssetAllocationsResult> {
  const { page, pageSize } = clampListParams(params);
  const search = params.search?.trim() ?? "";
  const offset = (page - 1) * pageSize;

  if (search === "") {
    const countResult = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM hrms_assets`
    );
    const total = Number(countResult.rows[0]?.n ?? 0);
    const list = await query<AssetAllocationListRow>(
      `${ASSET_ALLOCATION_LIST_SELECT}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    return { rows: list.rows, total, page, pageSize };
  }

  const pattern = `%${search}%`;
  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM hrms_assets a
     INNER JOIN hrms_groups g ON g.id = a.group_id
     INNER JOIN hrms_branches b ON b.id = a.branch_id
     LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
     LEFT JOIN hrms_asset_allocations al ON al.asset_id = a.id
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(al.remarks, '') ILIKE $1 OR
       COALESCE(al.allocation_category_name, '') ILIKE $1 OR
       COALESCE(al.allocation_branch_name, '') ILIKE $1 OR
       COALESCE(al.emp_name, '') ILIKE $1 OR
       COALESCE(al.serial_number, '') ILIKE $1
     )`,
    [pattern]
  );
  const total = Number(countResult.rows[0]?.n ?? 0);
  const list = await query<AssetAllocationListRow>(
    `${ASSET_ALLOCATION_LIST_SELECT}
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(al.remarks, '') ILIKE $1 OR
       COALESCE(al.allocation_category_name, '') ILIKE $1 OR
       COALESCE(al.allocation_branch_name, '') ILIKE $1 OR
       COALESCE(al.emp_name, '') ILIKE $1 OR
       COALESCE(al.serial_number, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { rows: list.rows, total, page, pageSize };
}

/**
 * Full allocation grid for export: one query, same filters as {@link listAssetAllocations},
 * ordered like the UI. Rows beyond {@link ALLOCATION_EXPORT_MAX_ROWS} are omitted and
 * `truncated` is set.
 */
export async function exportAllAssetAllocations(params: {
  search?: string;
}): Promise<ExportAssetAllocationsResult> {
  const search = params.search?.trim() ?? "";
  const cap = ALLOCATION_EXPORT_MAX_ROWS + 1;

  if (search === "") {
    const list = await query<AssetAllocationListRow>(
      `${ASSET_ALLOCATION_LIST_SELECT}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1`,
      [cap]
    );
    const truncated = list.rows.length > ALLOCATION_EXPORT_MAX_ROWS;
    const rows = truncated
      ? list.rows.slice(0, ALLOCATION_EXPORT_MAX_ROWS)
      : list.rows;
    return { rows, truncated };
  }

  const pattern = `%${search}%`;
  const list = await query<AssetAllocationListRow>(
    `${ASSET_ALLOCATION_LIST_SELECT}
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(al.remarks, '') ILIKE $1 OR
       COALESCE(al.allocation_category_name, '') ILIKE $1 OR
       COALESCE(al.allocation_branch_name, '') ILIKE $1 OR
       COALESCE(al.emp_name, '') ILIKE $1 OR
       COALESCE(al.serial_number, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2`,
    [pattern, cap]
  );
  const truncated = list.rows.length > ALLOCATION_EXPORT_MAX_ROWS;
  const rows = truncated
    ? list.rows.slice(0, ALLOCATION_EXPORT_MAX_ROWS)
    : list.rows;
  return { rows, truncated };
}
