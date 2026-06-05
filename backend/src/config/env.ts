/**
 * Centralized environment-backed configuration for the HTTP server.
 * Loaded after `loadEnv.ts` runs in the entry point.
 */
export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  jsonBodyLimit: "10mb" as const,
} as const;
