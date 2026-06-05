import { Router } from "express";
import {
  deleteGroupById,
  getGroups,
  patchGroup,
  postGroup,
} from "../controllers/groups.controller.js";

export const groupsRouter = Router();

groupsRouter.get("/api/admin/groups", getGroups);
groupsRouter.post("/api/admin/groups", postGroup);
groupsRouter.patch("/api/admin/groups/:id", patchGroup);
groupsRouter.delete("/api/admin/groups/:id", deleteGroupById);

