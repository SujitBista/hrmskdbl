import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";

export type AdminJwtPayload = {
  sub: number;
  email: string;
  role: "admin";
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
