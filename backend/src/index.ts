import "./loadEnv.js";
import cors from "cors";
import express from "express";
import { signAdminToken, verifyAdminToken } from "./auth/jwt.js";
import { getAdminByEmail, verifyPassword } from "./services/adminAuth.js";

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
