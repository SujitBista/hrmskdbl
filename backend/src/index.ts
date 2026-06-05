import "./loadEnv.js";
import express from "express";
import { createApp } from "./app.js";
import { verifyAdminToken, type AdminJwtPayload } from "./auth/jwt.js";
import { clampListParams } from "./services/branches.js";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  parseDepartmentPayload,
  updateDepartment,
} from "./services/departments.js";
import {
  applyAssetAllocationChange,
  createAssetsFromInput,
  deleteAsset,
  getAssetAllocationProfile,
  importAssetsFromRows,
  exportAllAssetAllocations,
  listAssetAllocations,
  listAssets,
  parseCreateAssetPayload,
  parseImportAssetsPayload,
  updateAsset,
} from "./services/assets.js";
import {
  createDepreciationRunFromMasterForm,
  deleteDepreciationRun,
  ensureDepreciationRunForCurrentFiscalYear,
  getDepreciationRunById,
  listDepreciationRuns,
  listDetailsForRun,
  refreshDepreciationRunDetailsFromAssets,
  updateDepreciationRunRemarks,
  voidDepreciationRun,
  type DepreciationRunActor,
} from "./services/depreciationRuns.js";
import {
  disposeAsset,
  getDisposalByAssetId,
  listDisposedAssets,
  parseDisposeAssetPayload,
} from "./services/assetDisposals.js";
import { performDepreciationFiscalYearRollover } from "./services/depreciationFyRollover.js";
import {
  bsDateFromJsDate,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

function getBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

function depreciationActorFromAdmin(
  payload: AdminJwtPayload
): DepreciationRunActor {
  return {
    adminId: payload.sub,
    adminEmail: payload.email,
    isSuperAdmin: false,
  };
}

app.get("/api/admin/departments", async (req, res) => {
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
    const result = await listDepartments({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list departments." });
  }
});

app.post("/api/admin/departments", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const payload = parseDepartmentPayload(req.body);
    const department = await createDepartment(payload);
    res.status(201).json({ department });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg === "Invalid request body." ||
        msg === "Department name is required."
      ) {
        res.status(400).json({ error: msg });
        return;
      }
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res
        .status(409)
        .json({ error: "A department with this name already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create department." });
  }
});

app.patch("/api/admin/departments/:id", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const idRaw = req.params.id;
    const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
    if (!Number.isFinite(id) || id < 1) {
      res.status(400).json({ error: "Invalid department id." });
      return;
    }

    const payload = parseDepartmentPayload(req.body);
    const department = await updateDepartment(id, payload);
    if (!department) {
      res.status(404).json({ error: "Department not found." });
      return;
    }
    res.json({ department });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg === "Invalid request body." ||
        msg === "Department name is required."
      ) {
        res.status(400).json({ error: msg });
        return;
      }
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res
        .status(409)
        .json({ error: "A department with this name already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update department." });
  }
});

app.delete("/api/admin/departments/:id", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const idRaw = req.params.id;
    const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
    if (!Number.isFinite(id) || id < 1) {
      res.status(400).json({ error: "Invalid department id." });
      return;
    }

    const deleted = await deleteDepartment(id);
    if (!deleted) {
      res.status(404).json({ error: "Department not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete department." });
  }
});

app.post("/api/admin/depreciation-runs/ensure-current", async (req, res) => {
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
    const result = await ensureDepreciationRunForCurrentFiscalYear();
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not ensure depreciation run." });
  }
});

app.post("/api/admin/depreciation-fy-rollover", async (req, res) => {
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
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    let newFiscalYearStart: number | undefined;
    const rawFy = body.newFiscalYearStart;
    if (typeof rawFy === "number" && Number.isFinite(rawFy)) {
      newFiscalYearStart = Math.floor(rawFy);
    } else if (typeof rawFy === "string" && rawFy.trim() !== "") {
      newFiscalYearStart = Number.parseInt(rawFy.trim(), 10);
    }
    if (
      newFiscalYearStart === undefined ||
      !Number.isFinite(newFiscalYearStart) ||
      newFiscalYearStart < 2001
    ) {
      const calcBs = normalizeBsDateEnglish(
        bsDateFromJsDate(new Date()).trim()
      );
      if (!calcBs) {
        res.status(400).json({ error: "Could not derive current fiscal year." });
        return;
      }
      const fy = fiscalYearStartFromBsDate(calcBs);
      if (fy === null) {
        res.status(400).json({ error: "Could not derive current fiscal year." });
        return;
      }
      newFiscalYearStart = fy;
    }
    let branchId: number | null | undefined;
    const rawBr = body.branchId;
    if (rawBr === null || rawBr === undefined || rawBr === "") {
      branchId = null;
    } else if (typeof rawBr === "number" && Number.isFinite(rawBr)) {
      branchId = Math.floor(rawBr);
    } else if (typeof rawBr === "string" && rawBr.trim() !== "") {
      branchId = Number.parseInt(rawBr.trim(), 10);
    }
    const resolvedBranchId =
      branchId !== undefined &&
      branchId !== null &&
      Number.isFinite(branchId) &&
      branchId >= 1
        ? branchId
        : null;
    const result = await performDepreciationFiscalYearRollover({
      newFiscalYearStart: newFiscalYearStart,
      branchId: resolvedBranchId,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not run fiscal year rollover." });
  }
});

app.get("/api/admin/depreciation-runs", async (req, res) => {
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
    const fyRaw = req.query.fiscalYearStart;
    let fiscalYearStart: number | undefined;
    if (typeof fyRaw === "string" && fyRaw.trim() !== "") {
      const n = Number.parseInt(fyRaw, 10);
      if (Number.isFinite(n)) {
        fiscalYearStart = n;
      }
    }
    const runs = await listDepreciationRuns(
      fiscalYearStart !== undefined ? { fiscalYearStart } : {}
    );
    res.json({ runs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list depreciation runs." });
  }
});

app.post("/api/admin/depreciation-runs", async (req, res) => {
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
    const b = req.body as Record<string, unknown>;
    const calcBs = b.calculationDateBs;
    const nepMonth = b.nepaliMonth;
    if (typeof calcBs !== "string" || typeof nepMonth !== "string") {
      res.status(400).json({
        error:
          "calculationDateBs and nepaliMonth are required to create a depreciation run.",
      });
      return;
    }
    const depTitle =
      typeof b.depTitle === "string"
        ? b.depTitle
        : b.depTitle === null
          ? null
          : undefined;
    const remarks =
      typeof b.remarks === "string"
        ? b.remarks
        : b.remarks === null
          ? null
          : undefined;
    const result = await createDepreciationRunFromMasterForm({
      calculationDateBs: calcBs,
      nepaliMonth: nepMonth,
      depTitle,
      remarks: remarks ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create depreciation run." });
  }
});

app.get("/api/admin/depreciation-runs/:id", async (req, res) => {
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
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid run id." });
    return;
  }
  try {
    let run = await getDepreciationRunById(id);
    if (!run) {
      res.status(404).json({ error: "Depreciation run not found." });
      return;
    }
    let detailsResult = await listDetailsForRun(id, { page, pageSize });
    if (detailsResult.total === 0) {
      try {
        const refreshed = await refreshDepreciationRunDetailsFromAssets(id, {
          advanceCalculationDateToTodayBs: false,
        });
        run = refreshed.run;
        detailsResult = await listDetailsForRun(id, { page, pageSize });
      } catch {
        // Keep backward-compatible empty state when auto-refresh cannot rebuild rows.
      }
    }
    res.json({
      run,
      details: detailsResult.rows,
      pagination: {
        page,
        pageSize,
        total: detailsResult.total,
        totalPages: Math.max(1, Math.ceil(detailsResult.total / pageSize)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load depreciation run." });
  }
});

app.patch("/api/admin/depreciation-runs/:id", async (req, res) => {
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
    res.status(400).json({ error: "Invalid run id." });
    return;
  }
  try {
    const b = req.body as Record<string, unknown>;
    if (!("remarks" in b)) {
      res.status(400).json({ error: "remarks is required." });
      return;
    }
    const remarks =
      b.remarks === null || b.remarks === undefined
        ? null
        : typeof b.remarks === "string"
          ? b.remarks
          : null;
    const run = await updateDepreciationRunRemarks(id, remarks);
    if (!run) {
      res.status(404).json({ error: "Depreciation run not found." });
      return;
    }
    res.json({ run });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update depreciation run." });
  }
});

app.delete("/api/admin/depreciation-runs/:id", async (req, res) => {
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
    res.status(400).json({ error: "Invalid run id." });
    return;
  }
  const rawBody = req.body;
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const allowFinalOverride = body.allowFinalOverride === true;
  try {
    const result = await deleteDepreciationRun(id, {
      actor: depreciationActorFromAdmin(admin),
      allowFinalOverride,
    });
    if (result.blockedFinal) {
      res.status(403).json({
        error:
          "This depreciation run is marked final for the fiscal year. Only a super-admin override can delete it.",
      });
      return;
    }
    if (!result.deleted) {
      res.status(404).json({ error: "Depreciation run not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete depreciation run." });
  }
});

app.post("/api/admin/depreciation-runs/:id/void", async (req, res) => {
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
    res.status(400).json({ error: "Invalid run id." });
    return;
  }
  try {
    const run = await voidDepreciationRun(id, depreciationActorFromAdmin(admin));
    if (!run) {
      res.status(404).json({ error: "Depreciation run not found." });
      return;
    }
    res.json({ run });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not void depreciation run." });
  }
});

app.post(
  "/api/admin/depreciation-runs/:id/refresh-details",
  async (req, res) => {
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
      res.status(400).json({ error: "Invalid run id." });
      return;
    }
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const advance = body.advanceCalculationDateToTodayBs === true;
      const result = await refreshDepreciationRunDetailsFromAssets(id, {
        advanceCalculationDateToTodayBs: advance,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error(err);
      res
        .status(500)
        .json({ error: "Could not refresh depreciation run details." });
    }
  }
);

app.get("/api/admin/assets", async (req, res) => {
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
});

app.get("/api/admin/assets/allocations/export", async (req, res) => {
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
});

app.get("/api/admin/assets/allocations", async (req, res) => {
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
});

app.get("/api/admin/assets/disposals", async (req, res) => {
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
});

app.get("/api/admin/assets/:id/disposal", async (req, res) => {
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
});

app.post("/api/admin/assets/:id/disposal", async (req, res) => {
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
});

app.get("/api/admin/assets/:id/allocation-profile", async (req, res) => {
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
});

app.post("/api/admin/assets/:id/allocation-change", async (req, res) => {
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
});

app.post("/api/admin/assets", async (req, res) => {
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
});

app.post("/api/admin/assets/import", async (req, res) => {
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
});

app.patch("/api/admin/assets/:id", async (req, res) => {
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
});

app.delete("/api/admin/assets/:id", async (req, res) => {
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
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
