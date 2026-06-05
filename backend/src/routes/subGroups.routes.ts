import { Router } from "express";
import {
  deleteSubGroupById,
  getSubGroups,
  patchSubGroup,
  postSubGroup,
  postSubGroupsImport,
} from "../controllers/subGroups.controller.js";

export const subGroupsRouter = Router();

subGroupsRouter.get("/api/admin/sub-groups", getSubGroups);
subGroupsRouter.post("/api/admin/sub-groups", postSubGroup);
subGroupsRouter.post("/api/admin/sub-groups/import", postSubGroupsImport);
subGroupsRouter.patch("/api/admin/sub-groups/:id", patchSubGroup);
subGroupsRouter.delete("/api/admin/sub-groups/:id", deleteSubGroupById);
