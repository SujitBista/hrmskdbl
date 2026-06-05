import { Router } from "express";
import {
  deleteDepartmentById,
  getDepartments,
  patchDepartment,
  postDepartment,
} from "../controllers/departments.controller.js";

export const departmentsRouter = Router();

departmentsRouter.get("/api/admin/departments", getDepartments);
departmentsRouter.post("/api/admin/departments", postDepartment);
departmentsRouter.patch("/api/admin/departments/:id", patchDepartment);
departmentsRouter.delete("/api/admin/departments/:id", deleteDepartmentById);
