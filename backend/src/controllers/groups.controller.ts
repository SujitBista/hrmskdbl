import type { Request, Response } from "express";
import { verifyAdminToken } from "../auth/jwt.js";
import {
  createGroup,
  deleteGroup,
  listGroups,
  parseGroupPayload,
  updateGroup,
} from "../services/groups.js";
import { clampListParams } from "../services/branches.js";

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export async function getGroups(req: Request, res: Response): Promise<void> {
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
    const result = await listGroups({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list groups." });
  }
}

export async function postGroup(req: Request, res: Response): Promise<void> {
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
    const payload = parseGroupPayload(req.body);
    const group = await createGroup(payload);
    res.status(201).json({ group });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({
        error: "A group with this code or name already exists.",
      });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create group." });
  }
}

export async function patchGroup(req: Request, res: Response): Promise<void> {
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
    res.status(400).json({ error: "Invalid group id." });
    return;
  }
  try {
    const payload = parseGroupPayload(req.body);
    const group = await updateGroup(id, payload);
    if (!group) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
    res.json({ group });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({
        error: "A group with this code or name already exists.",
      });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update group." });
  }
}

export async function deleteGroupById(
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
    res.status(400).json({ error: "Invalid group id." });
    return;
  }
  try {
    const deleted = await deleteGroup(id);
    if (!deleted) {
      res.status(404).json({ error: "Group not found." });
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
          "Cannot delete this group while assets or other records still reference it.",
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not delete group." });
  }
}

