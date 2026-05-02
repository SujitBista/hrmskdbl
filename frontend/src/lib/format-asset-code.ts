const ASSET_CODE_PREFIX = "SKDBL";

/** Mirrors backend `formatBranchCodeSegment` for display of stored asset codes. */
export function formatBranchCodeSegment(branchCode: string): string {
  let t = branchCode
    .trim()
    .replace(/[()[\]{}]/g, "")
    .trim();
  if (/^BC\s*:/i.test(t)) {
    const rest = t.replace(/^BC\s*:\s*/i, "").trim();
    const m = rest.match(/\d+/);
    if (m) {
      return m[0]!.padStart(3, "0");
    }
    return rest.length > 0 ? rest : t;
  }
  if (/^\d+$/.test(t)) {
    return t.padStart(3, "0");
  }
  return t;
}

/**
 * Reads the branch segment from `SKDBL/{branch}/…` asset codes (same rules as
 * the server). Used for import validation and branch auto-creation from Excel.
 */
export function parseBranchSegmentFromSkdblAssetCode(
  assetCode: string
): string | null {
  const trimmed = assetCode.trim();
  if (trimmed === "") {
    return null;
  }
  const parts = trimmed.split("/").map((p) => p.trim());
  if (parts.length < 3) {
    return null;
  }
  if ((parts[0] ?? "").toUpperCase() !== ASSET_CODE_PREFIX) {
    return null;
  }
  const seg = parts[1] ?? "";
  if (seg === "") {
    return null;
  }
  return formatBranchCodeSegment(seg);
}

/** Normalizes the branch segment in a full SKDBL/... path for UI display. */
export function formatAssetCodeForDisplay(assetCode: string | null | undefined): string {
  if (assetCode == null || assetCode === "") {
    return "—";
  }
  const parts = assetCode.split("/").map((p) => p.trim());
  if (parts.length >= 2 && parts[0] === "SKDBL") {
    parts[1] = formatBranchCodeSegment(parts[1] ?? "");
  }
  return parts.join("/");
}
