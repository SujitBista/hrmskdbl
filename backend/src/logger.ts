/**
 * Lightweight structured logging for the API. Set `LOG_LEVEL` to `debug` | `info` | `warn` | `error`
 * (default `info`). Use `createLogger("scope")` so logs are easy to grep.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLevel(raw: string | undefined): LogLevel {
  const v = (raw ?? "info").toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") {
    return v;
  }
  return "info";
}

const envLevel = parseLevel(process.env.LOG_LEVEL);

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[envLevel];
}

function isoTime(): string {
  return new Date().toISOString();
}

/** Postgres / driver errors often expose `code`, `detail`, `constraint`. */
export function serializeErrorForLog(err: unknown): Record<string, string | undefined> {
  if (err instanceof Error) {
    const base: Record<string, string | undefined> = {
      name: err.name,
      message: err.message,
    };
    if (typeof err === "object" && err !== null && "code" in err) {
      const e = err as {
        code?: string;
        detail?: string;
        constraint?: string;
        table?: string;
      };
      base.code = e.code;
      base.detail = e.detail;
      base.constraint = e.constraint;
      base.table = e.table;
    }
    return base;
  }
  return { message: String(err) };
}

function formatLine(
  scope: string,
  level: LogLevel,
  msg: string,
  meta?: Record<string, unknown>
): string {
  const extra =
    meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `[${isoTime()}] [${scope}] [${level}] ${msg}${extra}`;
}

export function createLogger(scope: string) {
  return {
    debug(msg: string, meta?: Record<string, unknown>) {
      if (!shouldLog("debug")) return;
      console.log(formatLine(scope, "debug", msg, meta));
    },

    info(msg: string, meta?: Record<string, unknown>) {
      if (!shouldLog("info")) return;
      console.log(formatLine(scope, "info", msg, meta));
    },

    warn(msg: string, meta?: Record<string, unknown>) {
      if (!shouldLog("warn")) return;
      console.warn(formatLine(scope, "warn", msg, meta));
    },

    /**
     * Logs `msg` plus serialized error (including PG `code` / `constraint` when present).
     * Prints the stack when `err` is an `Error`.
     */
    error(msg: string, err?: unknown, meta?: Record<string, unknown>) {
      const errFields =
        err !== undefined ? serializeErrorForLog(err) : undefined;
      const merged =
        errFields && Object.keys(errFields).length > 0
          ? { ...meta, err: errFields }
          : meta;
      console.error(formatLine(scope, "error", msg, merged));
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
