/**
 * Maps Postgres / pg client errors to safe, actionable API messages.
 */
export function resolveDbErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== "object" || err === null) {
    return fallback;
  }
  const e = err as { code?: string; message?: string };
  const code = e.code;
  const msg = e.message ?? "";

  if (code === "42703" || /column .* does not exist/i.test(msg)) {
    return "Database schema is out of date. In the backend directory run: npm run migrate";
  }
  if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
    return "Database tables are missing. In the backend directory run: npm run migrate";
  }
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    /connect ECONNREFUSED/i.test(msg)
  ) {
    return "Could not connect to the database. Check DATABASE_URL and that Postgres is running.";
  }
  if (code === "28P01") {
    return "Database authentication failed. Check DATABASE_URL.";
  }
  if (code === "3D000") {
    return "Database does not exist. Create it or fix DATABASE_URL.";
  }

  return fallback;
}
