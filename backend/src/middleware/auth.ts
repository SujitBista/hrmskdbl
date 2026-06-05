import type { NextFunction, Request, Response } from "express";
import { verifyAdminToken, type AdminJwtPayload } from "../auth/jwt.js";

/** Extracts a Bearer token from the Authorization header. */
export function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminJwtPayload;
}

/**
 * Inline auth guard matching most routes: missing/invalid token → 401.
 * Returns true when the request may proceed.
 */
export function requireAdminAuth(req: Request, res: Response): boolean {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }
  try {
    verifyAdminToken(token);
    return true;
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }
}

/**
 * Inline auth guard for routes that need the admin payload (delete/void/dispose).
 * Returns the payload or undefined after sending 401.
 */
export function requireAdminWithPayloadAuth(
  req: AuthenticatedRequest,
  res: Response
): AdminJwtPayload | undefined {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return undefined;
  }
  try {
    const admin = verifyAdminToken(token);
    req.admin = admin;
    return admin;
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return undefined;
  }
}

/**
 * Lenient auth for branches/departments mutating routes: only checks token presence.
 * Invalid JWT must be verified inside the handler try/catch so it becomes 500, not 401.
 */
export function requireBearerTokenOr401(
  req: Request,
  res: Response
): string | undefined {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized." });
    return undefined;
  }
  return token;
}

/** Express middleware: missing/invalid token → 401. */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (requireAdminAuth(req, res)) {
    next();
  }
}

/** Express middleware: attaches verified admin payload; missing/invalid token → 401. */
export function requireAdminWithPayload(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (requireAdminWithPayloadAuth(req, res)) {
    next();
  }
}
