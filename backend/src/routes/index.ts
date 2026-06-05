import type { Express } from "express";
import { authRouter } from "./auth.routes.js";
import { branchesRouter } from "./branches.routes.js";
import { groupsRouter } from "./groups.routes.js";
import { healthRouter } from "./health.routes.js";
import { subGroupsRouter } from "./subGroups.routes.js";

export function registerRoutes(app: Express): void {
  app.use(healthRouter);
  app.use(authRouter);
  app.use(groupsRouter);
  app.use(subGroupsRouter);
  app.use(branchesRouter);
}
