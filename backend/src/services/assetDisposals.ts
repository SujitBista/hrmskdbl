import type { PoolClient } from "pg";
import { query, withTransaction } from "../db.js";
import {
  compareBsDateString,
  computeAssetQuarterCumulative,
  depreciationCommencementFromRegister,
  fiscalQuarterFromNepaliCalendarMonthIndex,
  fiscalYearStartFromBsDate,
  nepaliCalendarMonthIndexFromBs,
  normalizeBsDateEnglish,
  isNoDepreciationMethod,
  parseDepreciationMethod,
} from "@hrmskdbl/depreciation-core";
import {
  grossDepreciableAmountForRun,
  registerImpliedPriorAccumulatedDep,
  refreshMutableDepreciationRunsForAsset,
} from "./depreciationRuns.js";

export const DISPOSAL_TYPES = [
  "SOLD",
  "SCRAPPED",
  "LOST",
  "WRITTEN_OFF",
  "DONATED",
] as const;

export type AssetDisposalType = (typeof DISPOSAL_TYPES)[number];
export type AssetStatus = "ACTIVE" | "DISPOSED";

export type DisposeAssetInput = {
  disposal_date_bs: string;
  disposal_type: AssetDisposalType;
  disposal_amount: number;
  reference_no: string | null;
  notes: string | null;
  created_by: number | null;
};

export type BulkDisposeItemInput = {
  asset_id: number;
  disposal_amount: number;
};

export type BulkDisposeAssetInput = {
  disposal_date_bs: string;
  disposal_type: AssetDisposalType;
  reference_no: string | null;
  notes: string | null;
  created_by: number | null;
  items: BulkDisposeItemInput[];
};

export type BulkDisposalItemError = {
  asset_id: number;
  error: string;
};

export class BulkDisposalValidationError extends Error {
  readonly itemErrors: BulkDisposalItemError[];

  constructor(itemErrors: BulkDisposalItemError[]) {
    super("Bulk disposal validation failed.");
    this.name = "BulkDisposalValidationError";
    this.itemErrors = itemErrors;
  }
}

export type AssetDisposalRow = {
  id: number;
  asset_id: number;
  asset_code: string | null;
  asset_name: string;
  disposal_date_bs: string;
  disposal_date_ad: string | null;
  disposal_type: AssetDisposalType;
  disposal_amount: string;
  net_book_value_at_disposal: string;
  accumulated_depreciation_at_disposal: string;
  profit_amount: string;
  loss_amount: string;
  reference_no: string | null;
  notes: string | null;
  created_by: number | null;
  approved_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ListDisposedAssetsParams = {
  search?: string;
  page: number;
  pageSize: number;
};

export type ListDisposedAssetsResult = {
  disposals: AssetDisposalRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type DisposalAssetDepRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  asset_status: AssetStatus;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  book_value: string | null;
  old_book_value: string | null;
  asset_dep_method: string | null;
  asset_dep_rate: string | null;
  group_dep_method: string | null;
  group_dep_rate: string | null;
};

export function parseDisposeAssetPayload(
  body: unknown,
  createdBy: number | null
): DisposeAssetInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const disposalDateBs = normalizeBsDateEnglish(
    typeof b.disposal_date_bs === "string" ? b.disposal_date_bs.trim() : ""
  );
  if (!disposalDateBs || !/^\d{4}\/\d{2}\/\d{2}$/.test(disposalDateBs)) {
    throw new Error("Disposal date must be YYYY/MM/DD (Bikram Sambat).");
  }

  const typeRaw =
    typeof b.disposal_type === "string"
      ? b.disposal_type.trim().toUpperCase()
      : "";
  if (!DISPOSAL_TYPES.includes(typeRaw as AssetDisposalType)) {
    throw new Error("Select a valid disposal type.");
  }

  const amountRaw = b.disposal_amount;
  const disposalAmount =
    typeof amountRaw === "number" ? amountRaw : Number(String(amountRaw ?? ""));
  if (!Number.isFinite(disposalAmount)) {
    throw new Error("Disposal amount is required.");
  }
  if (disposalAmount < 0) {
    throw new Error("Disposal amount cannot be negative.");
  }

  const referenceNo =
    typeof b.reference_no === "string" && b.reference_no.trim() !== ""
      ? b.reference_no.trim().slice(0, 255)
      : null;
  const notes =
    typeof b.notes === "string" && b.notes.trim() !== ""
      ? b.notes.trim()
      : null;

  return {
    disposal_date_bs: disposalDateBs,
    disposal_type: typeRaw as AssetDisposalType,
    disposal_amount: roundMoney(disposalAmount),
    reference_no: referenceNo,
    notes,
    created_by: createdBy,
  };
}

function parseBulkDisposeCommonFields(
  body: Record<string, unknown>,
  createdBy: number | null
): Omit<BulkDisposeAssetInput, "items"> {
  const disposalDateBs = normalizeBsDateEnglish(
    typeof body.disposal_date_bs === "string" ? body.disposal_date_bs.trim() : ""
  );
  if (!disposalDateBs || !/^\d{4}\/\d{2}\/\d{2}$/.test(disposalDateBs)) {
    throw new Error("Disposal date must be YYYY/MM/DD (Bikram Sambat).");
  }

  const typeRaw =
    typeof body.disposal_type === "string"
      ? body.disposal_type.trim().toUpperCase()
      : "";
  if (!DISPOSAL_TYPES.includes(typeRaw as AssetDisposalType)) {
    throw new Error("Select a valid disposal type.");
  }

  const referenceNo =
    typeof body.reference_no === "string" && body.reference_no.trim() !== ""
      ? body.reference_no.trim().slice(0, 255)
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null;

  return {
    disposal_date_bs: disposalDateBs,
    disposal_type: typeRaw as AssetDisposalType,
    reference_no: referenceNo,
    notes,
    created_by: createdBy,
  };
}

export function parseBulkDisposeAssetPayload(
  body: unknown,
  createdBy: number | null
): BulkDisposeAssetInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const b = body as Record<string, unknown>;
  const common = parseBulkDisposeCommonFields(b, createdBy);

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new Error("At least one asset is required.");
  }

  const items: BulkDisposeItemInput[] = [];
  const seenAssetIds = new Set<number>();

  for (const rawItem of b.items) {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error("Each disposal item must be an object.");
    }
    const item = rawItem as Record<string, unknown>;
    const assetIdRaw = item.asset_id;
    const assetId =
      typeof assetIdRaw === "number"
        ? assetIdRaw
        : Number.parseInt(String(assetIdRaw ?? ""), 10);
    if (!Number.isFinite(assetId) || assetId < 1) {
      throw new Error("Each item must have a valid asset_id.");
    }
    if (seenAssetIds.has(assetId)) {
      throw new Error("Duplicate asset_id values are not allowed.");
    }
    seenAssetIds.add(assetId);

    const amountRaw = item.disposal_amount;
    const disposalAmount =
      typeof amountRaw === "number"
        ? amountRaw
        : Number(String(amountRaw ?? ""));
    if (!Number.isFinite(disposalAmount)) {
      throw new Error(`Disposal amount is required for asset ${assetId}.`);
    }
    if (disposalAmount < 0) {
      throw new Error(`Disposal amount cannot be negative for asset ${assetId}.`);
    }

    items.push({
      asset_id: assetId,
      disposal_amount: roundMoney(disposalAmount),
    });
  }

  return { ...common, items };
}

export function calculateDisposalGainLoss(params: {
  disposalAmount: number;
  netBookValue: number;
}): { profitAmount: number; lossAmount: number } {
  const disposal = roundMoney(params.disposalAmount);
  const nbv = roundMoney(params.netBookValue);
  if (disposal > nbv) {
    return { profitAmount: roundMoney(disposal - nbv), lossAmount: 0 };
  }
  if (disposal < nbv) {
    return { profitAmount: 0, lossAmount: roundMoney(nbv - disposal) };
  }
  return { profitAmount: 0, lossAmount: 0 };
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseDepRatePercent(rate: string | null): number | null {
  if (rate == null || rate.trim() === "") return null;
  const n = Number.parseFloat(rate);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function disposalSelectSql(): string {
  return `
    SELECT
      d.id,
      d.asset_id,
      a.asset_code,
      a.asset_name,
      d.disposal_date_bs,
      d.disposal_date_ad::text,
      d.disposal_type,
      d.disposal_amount::text,
      d.net_book_value_at_disposal::text,
      d.accumulated_depreciation_at_disposal::text,
      d.profit_amount::text,
      d.loss_amount::text,
      d.reference_no,
      d.notes,
      d.created_by,
      d.approved_by,
      d.created_at::text,
      d.updated_at::text
    FROM hrms_asset_disposals d
    INNER JOIN hrms_assets a ON a.id = d.asset_id
  `;
}

async function loadAssetForDisposal(
  client: PoolClient,
  assetId: number
): Promise<DisposalAssetDepRow | null> {
  const r = await client.query<DisposalAssetDepRow>(
    `SELECT
       a.id,
       a.asset_code,
       a.asset_name,
       a.asset_status,
       a.purchase_date_bs,
       a.depreciation_start_date_bs,
       a.purchase_qty::text,
       a.unit_rate::text,
       a.book_value::text,
       a.old_book_value::text,
       a.dep_method_snapshot AS asset_dep_method,
       a.dep_rate_snapshot::text AS asset_dep_rate,
       g.dep_method AS group_dep_method,
       g.dep_rate::text AS group_dep_rate
     FROM hrms_assets a
     INNER JOIN hrms_groups g ON g.id = a.group_id
     WHERE a.id = $1
     FOR UPDATE`,
    [assetId]
  );
  return r.rows[0] ?? null;
}

export function assertDisposalDateIsValidForAsset(params: {
  disposalDateBs: string;
  purchaseDateBs: string;
  depreciationStartDateBs: string;
}): void {
  if (compareBsDateString(params.disposalDateBs, params.purchaseDateBs) < 0) {
    throw new Error("Disposal date cannot be before purchase date.");
  }
  if (
    compareBsDateString(params.disposalDateBs, params.depreciationStartDateBs) <
    0
  ) {
    throw new Error("Disposal date cannot be before depreciation start date.");
  }
}

export function assertAssetCanBeDisposed(params: {
  assetStatus: AssetStatus;
  hasExistingDisposal: boolean;
}): void {
  if (params.assetStatus === "DISPOSED" || params.hasExistingDisposal) {
    throw new Error("Asset is already disposed.");
  }
}

export function calculateAssetDisposalAmounts(
  asset: DisposalAssetDepRow,
  disposalDateBs: string,
  disposalAmount: number
): {
  netBookValueAtDisposal: number;
  accumulatedDepreciationAtDisposal: number;
  profitAmount: number;
  lossAmount: number;
} {
  const purchaseAmount = grossDepreciableAmountForRun(
    asset.book_value,
    asset.purchase_qty,
    asset.unit_rate,
    asset.old_book_value
  );
  if (purchaseAmount === null || purchaseAmount <= 0) {
    throw new Error("Asset has no valid depreciable cost.");
  }

  const rawMethod = asset.asset_dep_method ?? asset.group_dep_method;
  if (isNoDepreciationMethod(rawMethod)) {
    const registerBv =
      asset.book_value != null && asset.book_value !== ""
        ? Number.parseFloat(asset.book_value)
        : NaN;
    const netBookValueAtDisposal = roundMoney(
      Number.isFinite(registerBv) && registerBv > 0 ? registerBv : purchaseAmount
    );
    const { profitAmount, lossAmount } = calculateDisposalGainLoss({
      disposalAmount,
      netBookValue: netBookValueAtDisposal,
    });
    return {
      netBookValueAtDisposal,
      accumulatedDepreciationAtDisposal: 0,
      profitAmount,
      lossAmount,
    };
  }

  const depRate = parseDepRatePercent(asset.asset_dep_rate ?? asset.group_dep_rate);
  if (depRate === null || depRate <= 0) {
    throw new Error("Asset has no valid depreciation rate.");
  }
  const method = parseDepreciationMethod(
    asset.asset_dep_method ?? asset.group_dep_method
  );
  if (method === null) {
    throw new Error("Asset has no valid depreciation method.");
  }

  const depreciationStartBs = depreciationCommencementFromRegister(
    asset.purchase_date_bs,
    asset.depreciation_start_date_bs
  );
  if (!depreciationStartBs) {
    throw new Error("Asset has no valid depreciation start date.");
  }

  const fy = fiscalYearStartFromBsDate(disposalDateBs);
  if (fy === null) {
    throw new Error("Invalid disposal date.");
  }
  const monthIdx = nepaliCalendarMonthIndexFromBs(disposalDateBs);
  const quarterNo =
    monthIdx === null ? 4 : fiscalQuarterFromNepaliCalendarMonthIndex(monthIdx);
  const registerPriorAccum = registerImpliedPriorAccumulatedDep(
    purchaseAmount,
    asset.book_value
  );
  const computed = computeAssetQuarterCumulative({
    purchaseAmount,
    depreciationStartBs,
    depRatePercent: depRate,
    method,
    fiscalYearStart: fy,
    quarter: quarterNo,
    depreciationScopeMode: "AS_OF_DATE",
    asOfDateBs: disposalDateBs,
    registerPriorAccumulatedDep: registerPriorAccum,
  });
  if (!computed.ok) {
    throw new Error(computed.errors.join("; "));
  }

  const netBookValueAtDisposal = roundMoney(computed.detail.balanceAmount);
  const accumulatedDepreciationAtDisposal = roundMoney(
    computed.detail.accumulateDep + computed.detail.depAmount
  );
  const { profitAmount, lossAmount } = calculateDisposalGainLoss({
    disposalAmount,
    netBookValue: netBookValueAtDisposal,
  });
  return {
    netBookValueAtDisposal,
    accumulatedDepreciationAtDisposal,
    profitAmount,
    lossAmount,
  };
}

export async function disposeAsset(
  assetId: number,
  input: DisposeAssetInput
): Promise<AssetDisposalRow | null> {
  if (!Number.isFinite(assetId) || assetId < 1) {
    return null;
  }

  const disposal = await withTransaction(async (client) => {
    return disposeAssetInTransaction(client, assetId, input);
  });
  if (disposal) {
    try {
      await refreshMutableDepreciationRunsForAsset(assetId);
    } catch {
      // Disposal is already committed; future runs read the DISPOSED status directly.
    }
  }
  return disposal;
}

async function disposeAssetInTransaction(
  client: PoolClient,
  assetId: number,
  input: DisposeAssetInput,
  preloadedAsset?: DisposalAssetDepRow | null
): Promise<AssetDisposalRow | null> {
  const asset =
    preloadedAsset === undefined
      ? await loadAssetForDisposal(client, assetId)
      : preloadedAsset;
  if (!asset) {
    return null;
  }
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM hrms_asset_disposals WHERE asset_id = $1 LIMIT 1`,
    [assetId]
  );
  assertAssetCanBeDisposed({
    assetStatus: asset.asset_status,
    hasExistingDisposal: Boolean(existing.rows[0]),
  });

  assertDisposalDateIsValidForAsset({
    disposalDateBs: input.disposal_date_bs,
    purchaseDateBs: asset.purchase_date_bs,
    depreciationStartDateBs: asset.depreciation_start_date_bs,
  });

  const amounts = calculateAssetDisposalAmounts(
    asset,
    input.disposal_date_bs,
    input.disposal_amount
  );

  const inserted = await client.query<AssetDisposalRow>(
    `WITH inserted AS (
       INSERT INTO hrms_asset_disposals (
         asset_id,
         disposal_date_bs,
         disposal_date_ad,
         disposal_type,
         disposal_amount,
         net_book_value_at_disposal,
         accumulated_depreciation_at_disposal,
         profit_amount,
         loss_amount,
         reference_no,
         notes,
         created_by,
         updated_at
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING
         id,
         asset_id,
         disposal_date_bs,
         disposal_date_ad,
         disposal_type,
         disposal_amount,
         net_book_value_at_disposal,
         accumulated_depreciation_at_disposal,
         profit_amount,
         loss_amount,
         reference_no,
         notes,
         created_by,
         approved_by,
         created_at,
         updated_at
     )
     SELECT
       i.id,
       i.asset_id,
       a.asset_code,
       a.asset_name,
       i.disposal_date_bs,
       i.disposal_date_ad::text,
       i.disposal_type,
       i.disposal_amount::text,
       i.net_book_value_at_disposal::text,
       i.accumulated_depreciation_at_disposal::text,
       i.profit_amount::text,
       i.loss_amount::text,
       i.reference_no,
       i.notes,
       i.created_by,
       i.approved_by,
       i.created_at::text,
       i.updated_at::text
     FROM inserted i
     INNER JOIN hrms_assets a ON a.id = i.asset_id`,
    [
      assetId,
      input.disposal_date_bs,
      input.disposal_type,
      input.disposal_amount,
      amounts.netBookValueAtDisposal,
      amounts.accumulatedDepreciationAtDisposal,
      amounts.profitAmount,
      amounts.lossAmount,
      input.reference_no,
      input.notes,
      input.created_by,
    ]
  );

  await client.query(
    `UPDATE hrms_assets
     SET asset_status = 'DISPOSED',
         working_status = 'Disposed'
     WHERE id = $1`,
    [assetId]
  );

  const disposal = inserted.rows[0];
  if (!disposal) {
    throw new Error("Failed to save disposal.");
  }
  return disposal;
}

export async function bulkDisposeAssets(
  input: BulkDisposeAssetInput
): Promise<AssetDisposalRow[]> {
  const { disposals, assetIds } = await withTransaction(async (client) => {
    const itemErrors: BulkDisposalItemError[] = [];
    const assetsById = new Map<number, DisposalAssetDepRow>();

    for (const item of input.items) {
      try {
        const asset = await loadAssetForDisposal(client, item.asset_id);
        if (!asset) {
          itemErrors.push({
            asset_id: item.asset_id,
            error: "Asset not found.",
          });
          continue;
        }
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM hrms_asset_disposals WHERE asset_id = $1 LIMIT 1`,
          [item.asset_id]
        );
        assertAssetCanBeDisposed({
          assetStatus: asset.asset_status,
          hasExistingDisposal: Boolean(existing.rows[0]),
        });
        assertDisposalDateIsValidForAsset({
          disposalDateBs: input.disposal_date_bs,
          purchaseDateBs: asset.purchase_date_bs,
          depreciationStartDateBs: asset.depreciation_start_date_bs,
        });
        calculateAssetDisposalAmounts(
          asset,
          input.disposal_date_bs,
          item.disposal_amount
        );
        assetsById.set(item.asset_id, asset);
      } catch (err) {
        itemErrors.push({
          asset_id: item.asset_id,
          error: err instanceof Error ? err.message : "Validation failed.",
        });
      }
    }

    if (itemErrors.length > 0) {
      throw new BulkDisposalValidationError(itemErrors);
    }

    const disposals: AssetDisposalRow[] = [];
    for (const item of input.items) {
      const asset = assetsById.get(item.asset_id);
      if (!asset) {
        throw new Error(`Asset ${item.asset_id} not found.`);
      }
      const itemInput: DisposeAssetInput = {
        disposal_date_bs: input.disposal_date_bs,
        disposal_type: input.disposal_type,
        disposal_amount: item.disposal_amount,
        reference_no: input.reference_no,
        notes: input.notes,
        created_by: input.created_by,
      };
      const disposal = await disposeAssetInTransaction(
        client,
        item.asset_id,
        itemInput,
        asset
      );
      if (!disposal) {
        throw new Error(`Asset ${item.asset_id} not found.`);
      }
      disposals.push(disposal);
    }

    return {
      disposals,
      assetIds: input.items.map((item) => item.asset_id),
    };
  });

  for (const assetId of assetIds) {
    try {
      await refreshMutableDepreciationRunsForAsset(assetId);
    } catch {
      // Disposal is already committed; future runs read the DISPOSED status directly.
    }
  }

  return disposals;
}

export async function getDisposalByAssetId(
  assetId: number
): Promise<AssetDisposalRow | null> {
  if (!Number.isFinite(assetId) || assetId < 1) {
    return null;
  }
  const r = await query<AssetDisposalRow>(
    `${disposalSelectSql()}
     WHERE d.asset_id = $1
     LIMIT 1`,
    [assetId]
  );
  return r.rows[0] ?? null;
}

export async function listDisposedAssets(
  params: ListDisposedAssetsParams
): Promise<ListDisposedAssetsResult> {
  const search = params.search?.trim() ?? "";
  const page = params.page;
  const pageSize = params.pageSize;
  const offset = (page - 1) * pageSize;
  const where =
    search === ""
      ? ""
      : `WHERE (
          a.asset_name ILIKE $1 OR
          COALESCE(a.asset_code, '') ILIKE $1 OR
          d.disposal_type ILIKE $1 OR
          COALESCE(d.reference_no, '') ILIKE $1
        )`;
  const countParams = search === "" ? [] : [`%${search}%`];
  const listParams =
    search === "" ? [pageSize, offset] : [`%${search}%`, pageSize, offset];
  const limitIdx = search === "" ? 1 : 2;
  const offsetIdx = search === "" ? 2 : 3;

  const countResult = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM hrms_asset_disposals d
     INNER JOIN hrms_assets a ON a.id = d.asset_id
     ${where}`,
    countParams
  );
  const list = await query<AssetDisposalRow>(
    `${disposalSelectSql()}
     ${where}
     ORDER BY d.disposal_date_bs DESC, d.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams
  );
  return {
    disposals: list.rows,
    total: Number(countResult.rows[0]?.n ?? 0),
    page,
    pageSize,
  };
}
