import { Router } from "express";
import {
  getE2eServerTodayBs,
  postE2eCreateFyEndRun,
} from "../controllers/e2e.controller.js";

export const e2eRouter = Router();

e2eRouter.post("/api/admin/e2e/depreciation/fy-end", postE2eCreateFyEndRun);
e2eRouter.get("/api/admin/e2e/server-today-bs", getE2eServerTodayBs);
