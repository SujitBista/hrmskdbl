import { nepaliToEnglishNumber } from "nepali-number";

/**
 * Normalizes a BS date string to `YYYY/MM/DD` with Arabic numerals (English BS).
 * Accepts values from the Nepali datepicker (`-` separator) or Nepali digits.
 */
export function normalizeBsDateEnglish(raw: string): string {
  /** NFKC maps fullwidth digits/slashes (e.g. ２０８２／１２／０３) to ASCII so we split/pad correctly. */
  const t = raw.trim().normalize("NFKC");
  if (!t) return "";
  const ascii = nepaliToEnglishNumber(t);
  const withSlashes = ascii.replace(/-/g, "/");
  const parts = withSlashes.split("/").map((p) => p.trim());
  if (parts.length !== 3) return withSlashes;
  const y = Number.parseInt(parts[0]!, 10);
  const m = Number.parseInt(parts[1]!, 10);
  const d = Number.parseInt(parts[2]!, 10);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return withSlashes;
  }
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

/** The picker library expects hyphen separators in the `value` prop. */
export function bsDateToPickerValue(stored: string): string {
  return stored.replace(/\//g, "-");
}
