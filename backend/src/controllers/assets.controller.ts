import type { Request, Response } from "express";
import { verifyAdminToken, type AdminJwtPayload } from "../auth/jwt.js";
import {
  applyAssetAllocationChange,
  createAssetsFromInput,
  exportAllAssetAllocations,
  getAssetAllocationProfile,
  importAssetsFromRows,
  parseCreateAssetPayload,
  parseImportAssetsPayload,
  updateAsset,
  deleteAsset,
  listAssetAllocations,
  listAssets,
} from "../services/assets.js";
import {
  bulkDisposeAssets,
  BulkDisposalValidationError,
  disposeAsset,
  getDisposalByAssetId,
  listDisposedAssets,
  parseBulkDisposeAssetPayload,
  parseDisposeAssetPayload,
} from "../services/assetDisposals.js";
import { clampListParams } from "../services/branches.js";

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export async function getAssets(req: Request, res: Response): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const qRaw = req.query.q;
    const search = typeof qRaw === "string" ? qRaw : "";
    const pageRaw = req.query.page;
    const pageSizeRaw = req.query.pageSize;
    const page =
      typeof pageRaw === "string" ? Number.parseInt(pageRaw, 10) : NaN;
    const pageSize =
      typeof pageSizeRaw === "string"
        ? Number.parseInt(pageSizeRaw, 10)
        : NaN;
    const assetStatusRaw = req.query.assetStatus;
    const assetStatus =
      typeof assetStatusRaw === "string" ? assetStatusRaw : undefined;
    const showDisposedRaw = req.query.showDisposedAssets;
    const showDisposedAssets =
      showDisposedRaw === "1" ||
      showDisposedRaw === "true" ||
      showDisposedRaw === "yes";
    const { page: p, pageSize: ps } = clampListParams({ page, pageSize });
    const result = await listAssets({
      search,
      page: p,
      pageSize: ps,
      assetStatus: assetStatus as "ACTIVE" | "DISPOSED" | "ALL" | undefined,
      showDisposedAssets,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list assets." });
  }
}

export async function getAssetAllocationsExport(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const qRaw = req.query.q;
    const search = typeof qRaw === "string" ? qRaw : "";
    const fyRaw = req.query.fiscalYearStart;
    let depreciationFiscalYearStart: number | null | undefined;
    if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
      const n = Number.parseInt(fyRaw.trim(), 10);
      if (Number.isFinite(n) && n >= 2000) {
        depreciationFiscalYearStart = n;
      }
    }
    const assetStatusRaw = req.query.assetStatus;
    const showDisposedRaw = req.query.showDisposedAssets;
    const result = await exportAllAssetAllocations({
      search,
      depreciationFiscalYearStart,
      assetStatus:
        typeof assetStatusRaw === "string"
          ? (assetStatusRaw as "ACTIVE" | "DISPOSED" | "ALL")
          : undefined,
      showDisposedAssets:
        showDisposedRaw === "1" ||
        showDisposedRaw === "true" ||
        showDisposedRaw === "yes",
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not export asset allocations." });
  }
}

export async function getAssetAllocations(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const qRaw = req.query.q;
    const search = typeof qRaw === "string" ? qRaw : "";
    const pageRaw = req.query.page;
    const pageSizeRaw = req.query.pageSize;
    const page =
      typeof pageRaw === "string" ? Number.parseInt(pageRaw, 10) : NaN;
    const pageSize =
      typeof pageSizeRaw === "string"
        ? Number.parseInt(pageSizeRaw, 10)
        : NaN;
    const { page: p, pageSize: ps } = clampListParams({ page, pageSize });
    const fyRaw = req.query.fiscalYearStart;
    let depreciationFiscalYearStart: number | null | undefined;
    if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
      const n = Number.parseInt(fyRaw.trim(), 10);
      if (Number.isFinite(n) && n >= 2000) {
        depreciationFiscalYearStart = n;
      }
    }
    const assetStatusRaw = req.query.assetStatus;
    const showDisposedRaw = req.query.showDisposedAssets;
    const result = await listAssetAllocations({
      search,
      page: p,
      pageSize: ps,
      depreciationFiscalYearStart,
      assetStatus:
        typeof assetStatusRaw === "string"
          ? (assetStatusRaw as "ACTIVE" | "DISPOSED" | "ALL")
          : undefined,
      showDisposedAssets:
        showDisposedRaw === "1" ||
        showDisposedRaw === "true" ||
        showDisposedRaw === "yes",
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list asset allocations." });
  }
}

export async function getAssetDisposals(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const qRaw = req.query.q;
    const search = typeof qRaw === "string" ? qRaw : "";
    const pageRaw = req.query.page;
    const pageSizeRaw = req.query.pageSize;
    const page =
      typeof pageRaw === "string" ? Number.parseInt(pageRaw, 10) : NaN;
    const pageSize =
      typeof pageSizeRaw === "string"
        ? Number.parseInt(pageSizeRaw, 10)
        : NaN;
    const { page: p, pageSize: ps } = clampListParams({ page, pageSize });
    const result = await listDisposedAssets({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list disposed assets." });
  }
}

export async function getAssetDisposalById(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const disposal = await getDisposalByAssetId(id);
    if (!disposal) {
      res.status(404).json({ error: "Disposal not found." });
      return;
    }
    res.json({ disposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load asset disposal." });
  }
}

export async function getAssetAllocationProfileHandler(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const fyRaw = req.query.fiscalYearStart;
    let depreciationFiscalYearStart: number | null | undefined;
    if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
      const n = Number.parseInt(fyRaw.trim(), 10);
      if (Number.isFinite(n) && n >= 2000) {
        depreciationFiscalYearStart = n;
      }
    }
    const profile = await getAssetAllocationProfile(id, {
      depreciationFiscalYearStart,
    });
    if (!profile) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load asset allocation profile." });
  }
}

export async function postAsset(req: Request, res: Response): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const payload = parseCreateAssetPayload(req.body);
    const assets = await createAssetsFromInput(payload);
    res.status(201).json({
      assets,
      createdCount: assets.length,
      asset: assets[0] ?? null,
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create asset." });
  }
}

export async function postAssetsImport(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const payload = parseImportAssetsPayload(req.body);
    const result = await importAssetsFromRows(payload);
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not import assets." });
  }
}

export async function patchAsset(req: Request, res: Response): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const payload = parseCreateAssetPayload(req.body);
    const asset = await updateAsset(id, payload);
    if (!asset) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.json({ asset });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update asset." });
  }
}

export async function postAssetDisposal(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  let admin: AdminJwtPayload;
  try {
    admin = verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const payload = parseDisposeAssetPayload(req.body, admin.sub);
    const disposal = await disposeAsset(id, payload);
    if (!disposal) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.status(201).json({ disposal });
  } catch (err) {
    if (err instanceof Error) {
      const status = /already disposed/i.test(err.message) ? 409 : 400;
      res.status(status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not dispose asset." });
  }
}

export async function postBulkAssetDisposal(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  let admin: AdminJwtPayload;
  try {
    admin = verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const payload = parseBulkDisposeAssetPayload(req.body, admin.sub);
    const disposals = await bulkDisposeAssets(payload);
    res.status(201).json({ disposals });
  } catch (err) {
    if (err instanceof BulkDisposalValidationError) {
      res.status(400).json({
        error: err.message,
        item_errors: err.itemErrors,
      });
      return;
    }
    if (err instanceof Error) {
      const status = /already disposed/i.test(err.message) ? 409 : 400;
      res.status(status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not dispose assets." });
  }
}

export async function postAssetAllocationChange(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const profile = await applyAssetAllocationChange(id, req.body);
    if (!profile) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.json(profile);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not apply allocation change." });
  }
}

export async function deleteAssetById(
  req: Request,
  res: Response
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  try {
    const deleted = await deleteAsset(id);
    if (!deleted) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not delete asset." });
  }
}
