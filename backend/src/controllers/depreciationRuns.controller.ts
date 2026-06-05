import type { Request, Response } from "express";
import {
  bsDateFromJsDate,
  fiscalYearStartFromBsDate,
  normalizeBsDateEnglish,
} from "@hrmskdbl/depreciation-core";
import {
  requireAdminAuth,
  requireAdminWithPayloadAuth,
} from "../middleware/auth.js";
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
} from "../services/depreciationRuns.js";
import { performDepreciationFiscalYearRollover } from "../services/depreciationFyRollover.js";
import { depreciationActorFromAdmin } from "../utils/depreciationActor.js";

function parseRunId(req: Request): number | null {
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === "string" ? idRaw : "", 10);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id;
}

export async function postDepreciationRunEnsureCurrent(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
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
}

export async function postDepreciationFyRollover(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
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
}

export async function getDepreciationRuns(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
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
}

export async function postDepreciationRun(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
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
}

export async function getDepreciationRunByIdHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
    return;
  }
  const id = parseRunId(req);
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
  if (id === null) {
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
}

export async function patchDepreciationRun(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
    return;
  }
  const id = parseRunId(req);
  if (id === null) {
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
}

export async function deleteDepreciationRunById(
  req: Request,
  res: Response
): Promise<void> {
  const admin = requireAdminWithPayloadAuth(req, res);
  if (!admin) {
    return;
  }
  const id = parseRunId(req);
  if (id === null) {
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
}

export async function postDepreciationRunVoid(
  req: Request,
  res: Response
): Promise<void> {
  const admin = requireAdminWithPayloadAuth(req, res);
  if (!admin) {
    return;
  }
  const id = parseRunId(req);
  if (id === null) {
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
}

export async function postDepreciationRunRefreshDetails(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
    return;
  }
  const id = parseRunId(req);
  if (id === null) {
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
