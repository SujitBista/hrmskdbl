import type { Request, Response } from "express";
import { verifyAdminToken } from "../auth/jwt.js";
import {
  clampListParams,
  createBranch,
  deleteBranch,
  listBranches,
  parseBranchPayload,
  updateBranch,
} from "../services/branches.js";

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export async function getBranches(req: Request, res: Response): Promise<void> {
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
    const result = await listBranches({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list branches." });
  }
}

export async function postBranch(req: Request, res: Response): Promise<void> {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const payload = parseBranchPayload(req.body);
    const branch = await createBranch(payload);
    res.status(201).json({ branch });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg === "Invalid request body." ||
        msg === "Branch code is required." ||
        msg === "Branch name is required."
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
        .json({ error: "A branch with this code already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create branch." });
  }
}

export async function patchBranch(req: Request, res: Response): Promise<void> {
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
      res.status(400).json({ error: "Invalid branch id." });
      return;
    }

    const payload = parseBranchPayload(req.body);
    const branch = await updateBranch(id, payload);
    if (!branch) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    res.json({ branch });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg === "Invalid request body." ||
        msg === "Branch code is required." ||
        msg === "Branch name is required."
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
        .json({ error: "A branch with this code already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update branch." });
  }
}

export async function deleteBranchById(
  req: Request,
  res: Response
): Promise<void> {
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
      res.status(400).json({ error: "Invalid branch id." });
      return;
    }

    const deleted = await deleteBranch(id);
    if (!deleted) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete branch." });
  }
}

