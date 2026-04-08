/** Page title for the admin dashboard shell (must match server + first client paint). */
export function adminDashboardPageTitle(pathname: string): string {
  if (pathname === "/admin/dashboard/branch") {
    return "Branch";
  }
  if (pathname === "/admin/dashboard/department") {
    return "Department";
  }
  if (pathname === "/admin/dashboard/asset-register") {
    return "Asset Register";
  }
  if (pathname === "/admin/dashboard/groups/sub-groups") {
    return "Asset sub group";
  }
  if (pathname.startsWith("/admin/dashboard/groups")) {
    return "Asset Groups";
  }
  return "Dashboard";
}
