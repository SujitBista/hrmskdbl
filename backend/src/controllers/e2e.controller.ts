import type { Request, Response } from "express";
import { fiscalYearEndBs } from "@hrmskdbl/depreciation-core";
import { requireAdminAuth, requireAdminWithPayloadAuth } from "../middleware/auth.js";
import { createDepreciationRun } from "../services/depreciationRuns.js";
import { depreciationActorFromAdmin } from "../utils/depreciationActor.js";

function assertE2eTestMode(res: Response): boolean {
  if (process.env.E2E_TEST_MODE !== "true") {
    res.status(404).json({ error: "Not found." });
    return false;
  }
  return true;
}

/** E2E helper: create a draft FY_END run for an explicit fiscal year. */
export async function postE2eCreateFyEndRun(
  req: Request,
  res: Response
): Promise<void> {
  if (!assertE2eTestMode(res)) {
    return;
  }
  const admin = requireAdminWithPayloadAuth(req, res);
  if (!admin) {
    return;
  }
  try {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const rawFy = body.fiscalYearStart;
    const fiscalYearStart =
      typeof rawFy === "number"
        ? Math.floor(rawFy)
        : typeof rawFy === "string"
          ? Number.parseInt(rawFy.trim(), 10)
          : NaN;
    if (!Number.isFinite(fiscalYearStart) || fiscalYearStart < 2000) {
      res.status(400).json({ error: "fiscalYearStart is required." });
      return;
    }
    let branchId: number | null = null;
    const rawBr = body.branchId;
    if (rawBr !== null && rawBr !== undefined && rawBr !== "") {
      const parsed =
        typeof rawBr === "number"
          ? Math.floor(rawBr)
          : Number.parseInt(String(rawBr).trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        res.status(400).json({ error: "Invalid branchId." });
        return;
      }
      branchId = parsed;
    }
    const fyEndBs = fiscalYearEndBs(fiscalYearStart);
    const result = await createDepreciationRun({
      fiscalYearStart,
      quarterNo: 4,
      fiscalProgressBs: fyEndBs,
      calculationDateBs: fyEndBs,
      depreciationScopeMode: "FY_END",
      branchId,
      depTitle: "Fiscal year closing (FY_END)",
      remarks: "E2E FY_END draft for fiscal year closing.",
      status: "draft",
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create FY_END run." });
  }
}

/** E2E helper: read effective server BS date (including override). */
export async function getE2eServerTodayBs(
  req: Request,
  res: Response
): Promise<void> {
  if (!assertE2eTestMode(res)) {
    return;
  }
  if (!requireAdminAuth(req, res)) {
    return;
  }
  const { getServerTodayBsEnglish } = await import("../services/depreciationRuns.js");
  res.json({ todayBs: getServerTodayBsEnglish() });
}
