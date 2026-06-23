import { Router } from "express";
import {
  getDepreciationSettingsHandler,
  putDepreciationSettingsHandler,
} from "../controllers/depreciationSettings.controller.js";

export const depreciationSettingsRouter = Router();

depreciationSettingsRouter.get(
  "/api/admin/depreciation-settings",
  getDepreciationSettingsHandler
);
depreciationSettingsRouter.put(
  "/api/admin/depreciation-settings",
  putDepreciationSettingsHandler
);
