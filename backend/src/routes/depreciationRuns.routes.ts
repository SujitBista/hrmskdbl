import { Router } from "express";
import {
  deleteDepreciationRunById,
  getDepreciationFyRolloverStatusHandler,
  getDepreciationRunByIdHandler,
  getDepreciationRuns,
  patchDepreciationRun,
  postDepreciationFyRollover,
  postDepreciationFyRolloverPriorFyFinal,
  postDepreciationRun,
  postDepreciationRunEnsureCurrent,
  postDepreciationRunPost,
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
depreciationRunsRouter.get(
  "/api/admin/depreciation-fy-rollover/status",
  getDepreciationFyRolloverStatusHandler
);
depreciationRunsRouter.post(
  "/api/admin/depreciation-fy-rollover/prior-fy-final",
  postDepreciationFyRolloverPriorFyFinal
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
  "/api/admin/depreciation-runs/:id/post",
  postDepreciationRunPost
);
depreciationRunsRouter.post(
  "/api/admin/depreciation-runs/:id/refresh-details",
  postDepreciationRunRefreshDetails
);
