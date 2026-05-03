import "./loadEnv.js";
import cors from "cors";
import express from "express";
import {
  signAdminToken,
  verifyAdminToken,
  type AdminJwtPayload,
} from "./auth/jwt.js";
import { getAdminByEmail, verifyPassword } from "./services/adminAuth.js";
import {
  createBranch,
  deleteBranch,
  listBranches,
  parseBranchPayload,
  updateBranch,
} from "./services/branches.js";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  parseDepartmentPayload,
  updateDepartment,
} from "./services/departments.js";
import {
  createAsset,
  deleteAsset,
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
  createGroup,
  deleteGroup,
  listGroups,
  parseGroupPayload,
  updateGroup,
} from "./services/groups.js";
import {
  createSubGroup,
  deleteSubGroup,
  importSubGroupsFromRows,
  listSubGroups,
  parseImportSubGroupsPayload,
  updateSubGroup,
} from "./services/subGroups.js";
import {
  clampListParams,
  createUser,
  deleteUser,
  DUMMY_ROLES,
  listUsers,
  normalizePermissions,
  updateUser,
} from "./services/users.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    const admin = await getAdminByEmail(email);
    if (!admin) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const valid = await verifyPassword(password, admin.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = signAdminToken({
      sub: admin.id,
      email: admin.email,
      role: "admin",
    });

    res.json({
      token,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed." });
  }
});

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

app.get("/api/admin/roles", (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);
    res.json({ roles: [...DUMMY_ROLES] });
  } catch {
    res.status(401).json({ error: "Unauthorized." });
  }
});

app.get("/api/admin/users", async (req, res) => {
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
    const result = await listUsers({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list users." });
  }
});

app.post("/api/admin/users", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const role = typeof req.body?.role === "string" ? req.body.role : "";

    if (!email.trim() || !password || !role) {
      res
        .status(400)
        .json({ error: "Email, password, and role are required." });
      return;
    }

    if (password.length < 8) {
      res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
      return;
    }

    if (!(DUMMY_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role." });
      return;
    }

    const permissions = normalizePermissions({
      perm_view: req.body?.perm_view,
      perm_edit: req.body?.perm_edit,
      perm_delete: req.body?.perm_delete,
    });

    const user = await createUser({ email, password, role, permissions });
    res.status(201).json({ user });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({ error: "A user with this email already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create user." });
  }
});

app.patch("/api/admin/users/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid user id." });
      return;
    }

    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const role = typeof req.body?.role === "string" ? req.body.role : "";
    const passwordRaw = req.body?.password;
    const password =
      typeof passwordRaw === "string" && passwordRaw.trim() !== ""
        ? passwordRaw
        : undefined;

    if (!email.trim() || !role) {
      res.status(400).json({ error: "Email and role are required." });
      return;
    }

    if (!(DUMMY_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role." });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const hasPermKeys =
      body &&
      ("perm_view" in body ||
        "perm_edit" in body ||
        "perm_delete" in body);
    const permissions = hasPermKeys
      ? normalizePermissions({
          perm_view: body?.perm_view,
          perm_edit: body?.perm_edit,
          perm_delete: body?.perm_delete,
        })
      : undefined;

    const user = await updateUser(id, { email, role, password, permissions });
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ user });
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid role.") {
      res.status(400).json({ error: "Invalid role." });
      return;
    }
    if (err instanceof Error && err.message.includes("Password must")) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({ error: "A user with this email already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update user." });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid user id." });
      return;
    }

    const deleted = await deleteUser(id);
    if (!deleted) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete user." });
  }
});

app.get("/api/admin/branches", async (req, res) => {
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
});

app.post("/api/admin/branches", async (req, res) => {
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
});

app.patch("/api/admin/branches/:id", async (req, res) => {
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
});

app.delete("/api/admin/branches/:id", async (req, res) => {
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
});

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
    const { page: p, pageSize: ps } = clampListParams({ page, pageSize });
    const result = await listAssets({ search, page: p, pageSize: ps });
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
    const result = await exportAllAssetAllocations({ search });
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
    const result = await listAssetAllocations({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list asset allocations." });
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
    const asset = await createAsset(payload);
    res.status(201).json({ asset });
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
    console.error(err);
    res.status(500).json({ error: "Could not delete asset." });
  }
});

app.get("/api/admin/groups", async (req, res) => {
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
});

app.post("/api/admin/groups", async (req, res) => {
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
});

app.patch("/api/admin/groups/:id", async (req, res) => {
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
});

app.delete("/api/admin/groups/:id", async (req, res) => {
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
});

app.get("/api/admin/sub-groups", async (req, res) => {
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
});

app.post("/api/admin/sub-groups", async (req, res) => {
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
});

app.post("/api/admin/sub-groups/import", async (req, res) => {
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
});

app.patch("/api/admin/sub-groups/:id", async (req, res) => {
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
});

app.delete("/api/admin/sub-groups/:id", async (req, res) => {
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
});

app.get("/api/auth/me", (req, res) => {
  try {
    const header = req.headers.authorization;
    const token =
      header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    const payload = verifyAdminToken(token);
    res.json({ admin: { id: payload.sub, email: payload.email } });
  } catch {
    res.status(401).json({ error: "Unauthorized." });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
