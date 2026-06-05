import { Router } from "express";
import {
  deleteBranchById,
  getBranches,
  patchBranch,
  postBranch,
} from "../controllers/branches.controller.js";

export const branchesRouter = Router();

branchesRouter.get("/api/admin/branches", getBranches);
branchesRouter.post("/api/admin/branches", postBranch);
branchesRouter.patch("/api/admin/branches/:id", patchBranch);
branchesRouter.delete("/api/admin/branches/:id", deleteBranchById);

