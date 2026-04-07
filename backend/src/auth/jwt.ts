import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";

export type AdminJwtPayload = {
  sub: number;
  email: string;
  role: "admin";
};

export type UserJwtPayload = {
  sub: number;
  email: string;
  role: "user";
  /** maker | checker from users.role */
  jobRole: string;
  perm_view: boolean;
  perm_edit: boolean;
  perm_delete: boolean;
};

function requireSecret(): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  return JWT_SECRET;
}

export function signAdminToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, requireSecret(), {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, requireSecret());
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }
  const o = decoded as Record<string, unknown>;
  const subRaw = o.sub;
  const sub =
    typeof subRaw === "number"
      ? subRaw
      : typeof subRaw === "string"
        ? Number(subRaw)
        : NaN;
  const email = o.email;
  const role = o.role;
  if (
    !Number.isFinite(sub) ||
    typeof email !== "string" ||
    role !== "admin"
  ) {
    throw new Error("Invalid token payload");
  }
  return { sub, email, role: "admin" };
}

export function signUserToken(payload: UserJwtPayload): string {
  return jwt.sign(payload, requireSecret(), {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

function asBool(v: unknown): boolean {
  return v === true || v === "true";
}

export function verifyUserToken(token: string): UserJwtPayload {
  const decoded = jwt.verify(token, requireSecret());
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }
  const o = decoded as Record<string, unknown>;
  const subRaw = o.sub;
  const sub =
    typeof subRaw === "number"
      ? subRaw
      : typeof subRaw === "string"
        ? Number(subRaw)
        : NaN;
  const email = o.email;
  const role = o.role;
  const jobRole = o.jobRole;
  if (
    !Number.isFinite(sub) ||
    typeof email !== "string" ||
    role !== "user" ||
    typeof jobRole !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return {
    sub,
    email,
    role: "user",
    jobRole,
    perm_view: asBool(o.perm_view),
    perm_edit: asBool(o.perm_edit),
    perm_delete: asBool(o.perm_delete),
  };
}
