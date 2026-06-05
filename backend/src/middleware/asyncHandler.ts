import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | unknown>;

/**
 * Wraps async route handlers so rejected promises reach Express error middleware.
 * Controllers in later phases will use this instead of inline try/catch where appropriate.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
