/** Typed HTTP error for controllers that map errors to exact status/body. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isPgError(
  err: unknown
): err is { code?: string; message?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export function isPgUniqueViolation(err: unknown): boolean {
  return isPgError(err) && err.code === "23505";
}

export function isPgForeignKeyViolation(err: unknown): boolean {
  return isPgError(err) && err.code === "23503";
}

export function hasErrorMessage(err: unknown, message: string): boolean {
  return err instanceof Error && err.message === message;
}

export function hasAnyErrorMessage(err: unknown, messages: readonly string[]): boolean {
  return err instanceof Error && messages.includes(err.message);
}

export function messageIncludes(err: unknown, fragment: string): boolean {
  return err instanceof Error && err.message.includes(fragment);
}

/** Postgres unique-violation messages matching current route responses. */
export const pgConflictMessages = {
  branch: "A branch with this code already exists.",
  department: "A department with this name already exists.",
  group: "A group with this code or name already exists.",
  subGroup:
    "A sub group with this name already exists under the parent group.",
  groupDelete:
    "Cannot delete this group while assets or other records still reference it.",
  subGroupDelete:
    "Cannot delete this sub group while assets still reference it.",
  subGroupParentNotFound: "Parent group not found.",
} as const;

export function branchUniqueConflictMessage(err: unknown): string | undefined {
  return isPgUniqueViolation(err) ? pgConflictMessages.branch : undefined;
}

export function departmentUniqueConflictMessage(
  err: unknown
): string | undefined {
  return isPgUniqueViolation(err) ? pgConflictMessages.department : undefined;
}

export function groupUniqueConflictMessage(err: unknown): string | undefined {
  return isPgUniqueViolation(err) ? pgConflictMessages.group : undefined;
}

export function subGroupUniqueConflictMessage(err: unknown): string | undefined {
  return isPgUniqueViolation(err) ? pgConflictMessages.subGroup : undefined;
}

export function groupDeleteFkMessage(err: unknown): string | undefined {
  return isPgForeignKeyViolation(err) ? pgConflictMessages.groupDelete : undefined;
}

export function subGroupDeleteFkMessage(err: unknown): string | undefined {
  return isPgForeignKeyViolation(err)
    ? pgConflictMessages.subGroupDelete
    : undefined;
}

export function subGroupParentFkMessage(err: unknown): string | undefined {
  return isPgForeignKeyViolation(err)
    ? pgConflictMessages.subGroupParentNotFound
    : undefined;
}
