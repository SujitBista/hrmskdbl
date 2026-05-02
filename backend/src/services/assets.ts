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

  return {
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
  branchByName.set(normalizeComparableText(branch.branch_name), branch);
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
  const name = branch_name.trim().slice(0, 255);
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
        normalizeComparableText(existing.branch_name) ===
        normalizeComparableText(branch_name)
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
    branchByName.set(normalizeComparableText(b.branch_name), b);
    const codeKey = branchCodeLookupKey(b.branch_code);
    if (!branchByCodeKey.has(codeKey)) {
      branchByCodeKey.set(codeKey, b);
    }
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

async function resolveAssetRefs(
  input: CreateAssetInput,
  db: QueryExecutor = pool
): Promise<{
  branch_code: string;
  group_code: string;
  group_dep_method: string | null;
  group_dep_rate: string | null;
}> {
  const branchRow = await db.query<{ branch_code: string }>(
    `SELECT branch_code FROM hrms_branches WHERE id = $1`,
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
    a.created_at::text
  FROM hrms_assets a
  INNER JOIN hrms_groups g ON g.id = a.group_id
  INNER JOIN hrms_branches b ON b.id = a.branch_id
  LEFT JOIN hrms_sub_groups sg ON sg.id = a.sub_group_id
  LEFT JOIN hrms_departments d ON d.id = a.department_id
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
     WHERE (
       a.asset_name ILIKE $1 OR
       COALESCE(a.asset_code, '') ILIKE $1 OR
       g.name ILIKE $1 OR g.code ILIKE $1 OR
       b.branch_name ILIKE $1 OR b.branch_code ILIKE $1 OR
       COALESCE(sg.name, '') ILIKE $1 OR
       COALESCE(d.name, '') ILIKE $1
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
       COALESCE(d.name, '') ILIKE $1
     )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset]
  );
  return { assets: list.rows, total, page, pageSize };
}
