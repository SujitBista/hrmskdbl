import { Router } from "express";
import {
  deleteAssetById,
  getAssetAllocationProfileHandler,
  getAssetAllocations,
  getAssetAllocationsExport,
  getAssetDisposalById,
  getAssetDisposals,
  getAssets,
  patchAsset,
  postAsset,
  postAssetsImport,
} from "../controllers/assets.controller.js";

export const assetsRouter = Router();

assetsRouter.get("/api/admin/assets", getAssets);
assetsRouter.post("/api/admin/assets", postAsset);
assetsRouter.post("/api/admin/assets/import", postAssetsImport);
assetsRouter.patch("/api/admin/assets/:id", patchAsset);
assetsRouter.delete("/api/admin/assets/:id", deleteAssetById);
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
