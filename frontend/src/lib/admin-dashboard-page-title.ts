/** Page title for the admin dashboard shell (must match server + first client paint). */
export function adminDashboardPageTitle(pathname: string): string {
  if (pathname === "/admin/dashboard/branch") {
    return "Branch";
  }
  if (pathname === "/admin/dashboard/department") {
    return "Department";
  }
  if (pathname === "/admin/dashboard/asset-register/depreciation/settings") {
    return "Depreciation settings";
  }
  if (pathname === "/admin/dashboard/asset-register/depreciation/new") {
    return "Add depreciation run";
  }
  if (/^\/admin\/dashboard\/asset-register\/depreciation\/\d+$/.test(pathname)) {
    return "Depreciation details";
  }
  if (pathname === "/admin/dashboard/asset-register/depreciation") {
    return "Depreciation";
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
