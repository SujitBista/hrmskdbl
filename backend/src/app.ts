import cors from "cors";
import express from "express";
import { env } from "./config/env.js";

/**
 * Express app factory: global middleware only.
 * Routes are mounted in later phases; `index.ts` still owns routes during Phase 1.
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

  return app;
}
