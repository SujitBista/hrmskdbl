import type { Request, Response } from "express";
import { signAdminToken, verifyAdminToken } from "../auth/jwt.js";
import { getAdminByEmail, verifyPassword } from "../services/adminAuth.js";

export async function login(req: Request, res: Response): Promise<void> {
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
}

export function getMe(req: Request, res: Response): void {
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
}
