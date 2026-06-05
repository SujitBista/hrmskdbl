import type { Request } from "express";
import { clampListParams } from "../services/branches.js";

export type AssetStatusFilter = "ACTIVE" | "DISPOSED" | "ALL";

export function parseSearchQuery(req: Request): string {
  const qRaw = req.query.q;
  return typeof qRaw === "string" ? qRaw : "";
}

export function parseListQuery(req: Request): {
  search: string;
  page: number;
  pageSize: number;
} {
  const search = parseSearchQuery(req);
  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.pageSize;
  const page =
    typeof pageRaw === "string" ? Number.parseInt(pageRaw, 10) : NaN;
  const pageSize =
    typeof pageSizeRaw === "string"
      ? Number.parseInt(pageSizeRaw, 10)
      : NaN;
  const { page: p, pageSize: ps } = clampListParams({ page, pageSize });
  return { search, page: p, pageSize: ps };
}

export function parsePositiveIntParam(
  raw: string | string[] | undefined,
  invalidMessage: string
): { ok: true; value: number } | { ok: false; error: string } {
  const id = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    return { ok: false, error: invalidMessage };
  }
  return { ok: true, value: id };
}

export function parseRouteId(
  req: Request,
  invalidMessage: string
): { ok: true; value: number } | { ok: false; error: string } {
  return parsePositiveIntParam(req.params.id, invalidMessage);
}

/** Asset/allocation routes: fiscal year when query is present and >= 2000. */
export function parseFiscalYearStartQuery(
  req: Request
): number | null | undefined {
  const fyRaw = req.query.fiscalYearStart;
  if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
    const n = Number.parseInt(fyRaw.trim(), 10);
    if (Number.isFinite(n) && n >= 2000) {
      return n;
    }
  }
  return undefined;
}

/** Depreciation runs list: any finite fiscal year from query. */
export function parseFiscalYearStartQueryForRuns(
  req: Request
): number | undefined {
  const fyRaw = req.query.fiscalYearStart;
  if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
    const n = Number.parseInt(fyRaw, 10);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

export function parseAssetStatusQuery(
  req: Request
): AssetStatusFilter | undefined {
  const assetStatusRaw = req.query.assetStatus;
  return typeof assetStatusRaw === "string"
    ? (assetStatusRaw as AssetStatusFilter)
    : undefined;
}

export function parseShowDisposedAssetsQuery(req: Request): boolean {
  const showDisposedRaw = req.query.showDisposedAssets;
  return (
    showDisposedRaw === "1" ||
    showDisposedRaw === "true" ||
    showDisposedRaw === "yes"
  );
}

export function parseAssetListFilters(req: Request): {
  search: string;
  page: number;
  pageSize: number;
  assetStatus?: AssetStatusFilter;
  showDisposedAssets: boolean;
} {
  const { search, page, pageSize } = parseListQuery(req);
  return {
    search,
    page,
    pageSize,
    assetStatus: parseAssetStatusQuery(req),
    showDisposedAssets: parseShowDisposedAssetsQuery(req),
  };
}

/** Depreciation run detail pagination (distinct defaults/max from clampListParams). */
export function parseDepreciationRunDetailPagination(req: Request): {
  page: number;
  pageSize: number;
} {
  const pageRaw =
    typeof req.query.page === "string"
      ? Number.parseInt(req.query.page, 10)
      : NaN;
  const pageSizeRaw =
    typeof req.query.pageSize === "string"
      ? Number.parseInt(req.query.pageSize, 10)
      : NaN;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(500, pageSizeRaw)
      : 100;
  return { page, pageSize };
}
