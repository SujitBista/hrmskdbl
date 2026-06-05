import type { Request, Response } from "express";
import { verifyAdminToken } from "../auth/jwt.js";
import { clampListParams } from "../services/branches.js";
import {
  createSubGroup,
  deleteSubGroup,
  importSubGroupsFromRows,
  listSubGroups,
  parseImportSubGroupsPayload,
  updateSubGroup,
} from "../services/subGroups.js";

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export async function getSubGroups(req: Request, res: Response): Promise<void> {
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
    const result = await listSubGroups({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list sub groups." });
  }
}

export async function postSubGroup(req: Request, res: Response): Promise<void> {
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
    const groupId = Number(b.groupId);
    const name = typeof b.name === "string" ? b.name : "";
    if (!Number.isFinite(groupId) || groupId < 1) {
      res.status(400).json({ error: "A valid parent group is required." });
      return;
    }
    if (!name.trim()) {
      res.status(400).json({ error: "Sub group name is required." });
      return;
    }
    const subGroup = await createSubGroup({
      groupId: Math.floor(groupId),
      name,
    });
    res.status(201).json({ subGroup });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({
        error: "A sub group with this name already exists under the parent group.",
      });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      res.status(400).json({ error: "Parent group not found." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create sub group." });
  }
}

export async function postSubGroupsImport(
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
    const payload = parseImportSubGroupsPayload(req.body);
    const result = await importSubGroupsFromRows(payload);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    if (message.includes("Invalid request") || message.includes("rows must be")) {
      res.status(400).json({ error: message });
      return;
    }
    if (message.includes("No rows provided")) {
      res.status(400).json({ error: message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not import sub groups." });
  }
}

export async function patchSubGroup(req: Request, res: Response): Promise<void> {
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
    res.status(400).json({ error: "Invalid sub group id." });
    return;
  }
  try {
    const b = req.body as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Sub group name is required." });
      return;
    }
    let groupId: number | undefined;
    if (b.groupId !== undefined && b.groupId !== null) {
      const g = Number(b.groupId);
      if (!Number.isFinite(g) || g < 1) {
        res.status(400).json({ error: "Invalid parent group." });
        return;
      }
      groupId = Math.floor(g);
    }
    const subGroup = await updateSubGroup(id, { name, groupId });
    if (!subGroup) {
      res.status(404).json({ error: "Sub group not found." });
      return;
    }
    res.json({ subGroup });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({
        error: "A sub group with this name already exists under the parent group.",
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update sub group." });
  }
}

export async function deleteSubGroupById(
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
    res.status(400).json({ error: "Invalid sub group id." });
    return;
  }
  try {
    const deleted = await deleteSubGroup(id);
    if (!deleted) {
      res.status(404).json({ error: "Sub group not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      res.status(409).json({
        error:
          "Cannot delete this sub group while assets still reference it.",
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not delete sub group." });
  }
}
