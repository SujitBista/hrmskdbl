import type { Request, Response } from "express";
import { verifyAdminToken } from "../auth/jwt.js";
import { clampListParams } from "../services/branches.js";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  parseDepartmentPayload,
  updateDepartment,
} from "../services/departments.js";

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export async function getDepartments(
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
    const result = await listDepartments({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list departments." });
  }
}

export async function postDepartment(
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
}

export async function patchDepartment(
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
}

export async function deleteDepartmentById(
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
}
