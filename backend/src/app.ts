import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";

/**
 * Express app factory: global middleware and Phase 2A routes.
 * Remaining routes are still registered in `index.ts`.
 */
export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: env.frontendOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: env.jsonBodyLimit }));

  registerRoutes(app);

  return app;
}
