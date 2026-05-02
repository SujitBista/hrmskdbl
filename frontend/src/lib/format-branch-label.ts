const BC_HINT_IN_NAME = /\(\s*BC\s*:/i;
const BC_HINT_BRACKET_IN_NAME = /\[\s*BC\s*:/i;

/**
 * Label for branch dropdowns / tables: if `branch_name` already carries a
 * `(BC:…)` / `[BC:…]` hint (e.g. from import), show the name only so the code
 * is not duplicated as `code — name (BC:code)`.
 */
export function formatBranchOptionLabel(b: {
  branch_code: string;
  branch_name: string;
}): string {
  const name = (b.branch_name ?? "").trim();
  const code = (b.branch_code ?? "").trim();
  if (BC_HINT_IN_NAME.test(name) || BC_HINT_BRACKET_IN_NAME.test(name)) {
    return name;
  }
  if (code !== "" && name !== "") {
    return `${code} — ${name}`;
  }
  return name || code || "—";
}
