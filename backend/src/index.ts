import "./loadEnv.js";
import cors from "cors";
import express from "express";
import { resolveDbErrorMessage } from "./dbErrors.js";
import {
  signAdminToken,
  signUserToken,
  verifyAdminToken,
  verifyUserToken,
} from "./auth/jwt.js";
import { getAdminByEmail, verifyPassword } from "./services/adminAuth.js";
import {
  clampListParams as clampGroupListParams,
  createGroup,
  deleteGroup,
  listGroups,
  parseGroupPayload,
  updateGroup,
} from "./services/groups.js";
import {
  clampListParams as clampSubGroupListParams,
  createSubGroup,
  deleteSubGroup,
  listSubGroups,
  updateSubGroup,
} from "./services/subGroups.js";
import {
  clampListParams as clampBranchListParams,
  createBranch,
  deleteBranch,
  listBranches,
  parseBranchPayload,
  updateBranch,
} from "./services/branches.js";
import {
  clampListParams as clampDepartmentListParams,
  createDepartment,
  deleteDepartment,
  listDepartments,
  parseDepartmentPayload,
  updateDepartment,
} from "./services/departments.js";
import {
  createAsset,
  deleteAsset,
  listAssets,
  parseCreateAssetPayload,
  updateAsset,
} from "./services/assets.js";
import {
  clampListParams,
  createUser,
  deleteUser,
  DUMMY_ROLES,
  getUserByEmailForAuth,
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
app.use(express.json());

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

app.post("/api/auth/user/login", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!email.trim() || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    const user = await getUserByEmailForAuth(email);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = signUserToken({
      sub: user.id,
      email: user.email,
      role: "user",
      jobRole: user.role,
      perm_view: user.perm_view,
      perm_edit: user.perm_edit,
      perm_delete: user.perm_delete,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        perm_view: user.perm_view,
        perm_edit: user.perm_edit,
        perm_delete: user.perm_delete,
      },
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

    const { page: p, pageSize: ps } = clampGroupListParams({ page, pageSize });
    const result = await listGroups({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list groups." });
  }
});

app.post("/api/admin/groups", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    let payload;
    try {
      payload = parseGroupPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const group = await createGroup(payload);
    res.status(201).json({ group });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      const detail = String((err as { detail?: string }).detail ?? "");
      if (detail.includes("(code)") || detail.includes("hrms_groups_code")) {
        res.status(409).json({ error: "A group with this code already exists." });
        return;
      }
      res.status(409).json({ error: "A group with this name already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not create asset group."),
    });
  }
});

app.patch("/api/admin/groups/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid group id." });
      return;
    }

    let payload;
    try {
      payload = parseGroupPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

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
      const detail = String((err as { detail?: string }).detail ?? "");
      if (detail.includes("(code)") || detail.includes("hrms_groups_code")) {
        res.status(409).json({ error: "A group with this code already exists." });
        return;
      }
      res.status(409).json({ error: "A group with this name already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not update asset group."),
    });
  }
});

app.delete("/api/admin/groups/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid group id." });
      return;
    }

    const deleted = await deleteGroup(id);
    if (!deleted) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
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

    const { page: p, pageSize: ps } = clampSubGroupListParams({
      page,
      pageSize,
    });
    const result = await listSubGroups({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not list sub groups." });
  }
});

app.post("/api/admin/sub-groups", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    const groupIdRaw = req.body?.groupId;
    const groupId =
      typeof groupIdRaw === "number"
        ? groupIdRaw
        : typeof groupIdRaw === "string"
          ? Number.parseInt(groupIdRaw, 10)
          : NaN;
    if (!Number.isFinite(groupId) || groupId < 1) {
      res.status(400).json({ error: "Group is required." });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Name is required." });
      return;
    }

    const subGroup = await createSubGroup({ groupId, name });
    res.status(201).json({ subGroup });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res
        .status(409)
        .json({
          error: "A sub group with this name already exists under that group.",
        });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      res.status(400).json({ error: "Selected group does not exist." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create sub group." });
  }
});

app.patch("/api/admin/sub-groups/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid sub group id." });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Name is required." });
      return;
    }

    let groupId: number | undefined;
    if (req.body?.groupId !== undefined) {
      const groupIdRaw = req.body.groupId;
      const parsed =
        typeof groupIdRaw === "number"
          ? groupIdRaw
          : typeof groupIdRaw === "string"
            ? Number.parseInt(groupIdRaw, 10)
            : NaN;
      if (!Number.isFinite(parsed) || parsed < 1) {
        res.status(400).json({ error: "Invalid group id." });
        return;
      }
      groupId = parsed;
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
      res
        .status(409)
        .json({
          error: "A sub group with this name already exists under that group.",
        });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      res.status(400).json({ error: "Selected group does not exist." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not update sub group." });
  }
});

app.delete("/api/admin/sub-groups/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid sub group id." });
      return;
    }

    const deleted = await deleteSubGroup(id);
    if (!deleted) {
      res.status(404).json({ error: "Sub group not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete sub group." });
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

    const { page: p, pageSize: ps } = clampBranchListParams({
      page,
      pageSize,
    });
    const result = await listBranches({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not list branches."),
    });
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

    let payload;
    try {
      payload = parseBranchPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const branch = await createBranch(payload);
    res.status(201).json({ branch });
  } catch (err) {
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
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not create branch."),
    });
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

    let payload;
    try {
      payload = parseBranchPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const branch = await updateBranch(id, payload);
    if (!branch) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    res.json({ branch });
  } catch (err) {
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
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not update branch."),
    });
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

    const { page: p, pageSize: ps } = clampDepartmentListParams({
      page,
      pageSize,
    });
    const result = await listDepartments({ search, page: p, pageSize: ps });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not list departments."),
    });
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

    let payload;
    try {
      payload = parseDepartmentPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const department = await createDepartment(payload);
    res.status(201).json({ department });
  } catch (err) {
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
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not create department."),
    });
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

    let payload;
    try {
      payload = parseDepartmentPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const department = await updateDepartment(id, payload);
    if (!department) {
      res.status(404).json({ error: "Department not found." });
      return;
    }
    res.json({ department });
  } catch (err) {
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
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not update department."),
    });
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

app.post("/api/admin/assets", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    verifyAdminToken(token);

    let payload;
    try {
      payload = parseCreateAssetPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const asset = await createAsset(payload);
    res.status(201).json({ asset });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === "Branch not found." ||
        err.message === "Asset group not found."
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (
        err.message.includes("sub group") ||
        err.message.includes("Sub group")
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not save asset."),
    });
  }
});

app.patch("/api/admin/assets/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid asset id." });
      return;
    }

    let payload;
    try {
      payload = parseCreateAssetPayload(req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request.";
      res.status(400).json({ error: msg });
      return;
    }

    const asset = await updateAsset(id, payload);
    if (!asset) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.json({ asset });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === "Branch not found." ||
        err.message === "Asset group not found."
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (
        err.message.includes("sub group") ||
        err.message.includes("Sub group")
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    console.error(err);
    res.status(500).json({
      error: resolveDbErrorMessage(err, "Could not update asset."),
    });
  }
});

app.delete("/api/admin/assets/:id", async (req, res) => {
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
      res.status(400).json({ error: "Invalid asset id." });
      return;
    }

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

app.get("/api/auth/user/me", (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    const payload = verifyUserToken(token);
    res.json({
      user: {
        id: payload.sub,
        email: payload.email,
        role: payload.jobRole,
        perm_view: payload.perm_view,
        perm_edit: payload.perm_edit,
        perm_delete: payload.perm_delete,
      },
    });
  } catch {
    res.status(401).json({ error: "Unauthorized." });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
