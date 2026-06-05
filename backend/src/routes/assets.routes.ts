import { Router } from "express";
import {
  getAssetAllocationProfileHandler,
  getAssetAllocations,
  getAssetAllocationsExport,
  getAssetDisposalById,
  getAssetDisposals,
  getAssets,
} from "../controllers/assets.controller.js";

export const assetsRouter = Router();

assetsRouter.get("/api/admin/assets", getAssets);
assetsRouter.get(
  "/api/admin/assets/allocations/export",
  getAssetAllocationsExport
);
assetsRouter.get("/api/admin/assets/allocations", getAssetAllocations);
assetsRouter.get("/api/admin/assets/disposals", getAssetDisposals);
assetsRouter.get("/api/admin/assets/:id/disposal", getAssetDisposalById);
assetsRouter.get(
  "/api/admin/assets/:id/allocation-profile",
  getAssetAllocationProfileHandler
);
