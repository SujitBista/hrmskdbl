import type { Request, Response } from "express";
import { requireAdminAuth, requireAdminWithPayloadAuth } from "../middleware/auth.js";
import {
  getDepreciationSettingsView,
  listDepreciationSettingsAuditLogs,
  upsertDepreciationSettings,
} from "../services/depreciationSettings.js";
import { depreciationActorFromAdmin } from "../utils/depreciationActor.js";

export async function getDepreciationSettingsHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminAuth(req, res)) {
    return;
  }
  try {
    const [settings, auditLogs] = await Promise.all([
      getDepreciationSettingsView(),
      listDepreciationSettingsAuditLogs(50),
    ]);
    res.json({ settings, auditLogs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load depreciation settings." });
  }
}

export async function putDepreciationSettingsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const admin = requireAdminWithPayloadAuth(req, res);
  if (!admin) {
    return;
  }
  try {
    const body = req.body as {
      openingFiscalYear?: unknown;
      firstSystemDepreciationDateBs?: unknown;
      lastExternalDepreciationDateBs?: unknown;
    };
    if (body?.openingFiscalYear === undefined || body.openingFiscalYear === null) {
      res.status(400).json({ error: "openingFiscalYear is required." });
      return;
    }
    const settings = await upsertDepreciationSettings({
      openingFiscalYear: body.openingFiscalYear as number | string,
      firstSystemDepreciationDateBs:
        body.firstSystemDepreciationDateBs == null
          ? undefined
          : String(body.firstSystemDepreciationDateBs),
      lastExternalDepreciationDateBs:
        body.lastExternalDepreciationDateBs == null
          ? undefined
          : String(body.lastExternalDepreciationDateBs),
      actor: depreciationActorFromAdmin(admin),
    });
    const auditLogs = await listDepreciationSettingsAuditLogs(50);
    res.json({ settings, auditLogs });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not save depreciation settings." });
  }
}
