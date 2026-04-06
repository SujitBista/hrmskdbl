/**
 * Formats an ISO timestamp for admin tables. Uses fixed locale and IANA timezone
 * so server-rendered HTML matches the client (avoids hydration mismatches from
 * `toLocaleString(undefined, …)`).
 */
export function formatAdminDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kathmandu",
  });
}
