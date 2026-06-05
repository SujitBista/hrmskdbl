import { Router } from "express";
import { getMe, login } from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/api/auth/login", login);
authRouter.get("/api/auth/me", getMe);
