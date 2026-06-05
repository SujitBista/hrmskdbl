import { Router } from "express";
import {
  deleteDepreciationRunById,
  getDepreciationRunByIdHandler,
  getDepreciationRuns,
  patchDepreciationRun,
  postDepreciationFyRollover,
  postDepreciationRun,
  postDepreciationRunEnsureCurrent,
  postDepreciationRunRefreshDetails,
  postDepreciationRunVoid,
} from "../controllers/depreciationRuns.controller.js";

export const depreciationRunsRouter = Router();

depreciationRunsRouter.post(
  "/api/admin/depreciation-runs/ensure-current",
  postDepreciationRunEnsureCurrent
);
depreciationRunsRouter.post(
  "/api/admin/depreciation-fy-rollover",
  postDepreciationFyRollover
);
depreciationRunsRouter.get("/api/admin/depreciation-runs", getDepreciationRuns);
depreciationRunsRouter.post("/api/admin/depreciation-runs", postDepreciationRun);
depreciationRunsRouter.get(
  "/api/admin/depreciation-runs/:id",
  getDepreciationRunByIdHandler
);
depreciationRunsRouter.patch(
  "/api/admin/depreciation-runs/:id",
  patchDepreciationRun
);
depreciationRunsRouter.delete(
  "/api/admin/depreciation-runs/:id",
  deleteDepreciationRunById
);
depreciationRunsRouter.post(
  "/api/admin/depreciation-runs/:id/void",
  postDepreciationRunVoid
);
depreciationRunsRouter.post(
  "/api/admin/depreciation-runs/:id/refresh-details",
  postDepreciationRunRefreshDetails
);
