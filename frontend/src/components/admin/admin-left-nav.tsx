"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function UserGroupIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12c-1.314 0-2.438.402-3.341 1.09m6.032 4.036A5.971 5.971 0 0012 18.719m0 0a5.971 5.971 0 00-3.691-1.594M12 12a3 3 0 11-6 0 3 3 0 016 0zm6 3a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function BuildingOfficeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

type Props = {
  mobileOpen: boolean;
  desktopCollapsed: boolean;
  onNavigate: () => void;
};

export function AdminLeftNav({
  mobileOpen,
  desktopCollapsed,
  onNavigate,
}: Props) {
  const pathname = usePathname();
  const subLinkClass =
    "flex items-center rounded-lg py-2 pl-3 pr-3 text-sm font-medium transition hover:bg-emerald-50 hover:text-[var(--brand-primary)]";
  const linkInactive = "text-slate-700";
  const linkActive =
    "bg-emerald-50 text-[var(--brand-primary)] ring-1 ring-emerald-900/10";

  const isBranchPage = pathname === "/admin/dashboard/branch";
  const isDepartmentPage = pathname === "/admin/dashboard/department";
  const isGroupsPage = pathname === "/admin/dashboard/groups";
  const isSubGroupsPage = pathname === "/admin/dashboard/groups/sub-groups";
  const isAssetRegisterPage = pathname === "/admin/dashboard/asset-register";
  const isDepreciationPage = pathname.startsWith(
    "/admin/dashboard/asset-register/depreciation"
  );

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Admin">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <BuildingOfficeIcon className="h-4 w-4 shrink-0 text-emerald-800/70" />
          Branch
        </div>
        <div
          className="ml-1 flex flex-col gap-0.5 border-l border-emerald-900/15 pl-2"
          role="group"
          aria-label="Branch"
        >
          <Link
            href="/admin/dashboard/branch#add-branch"
            className={`${subLinkClass} ${
              isBranchPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Add Branch
          </Link>
          <Link
            href="/admin/dashboard/department#add-department"
            className={`${subLinkClass} ${
              isDepartmentPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Department
          </Link>
        </div>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <UserGroupIcon className="h-4 w-4 shrink-0 text-emerald-800/70" />
          Fixed asset
        </div>
        <div
          className="ml-1 flex flex-col gap-0.5 border-l border-emerald-900/15 pl-2"
          role="group"
          aria-label="Fixed asset"
        >
          <Link
            href="/admin/dashboard/groups#create-group"
            className={`${subLinkClass} ${
              isGroupsPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Asset Groups
          </Link>
          <Link
            href="/admin/dashboard/groups/sub-groups#create-sub-group"
            className={`${subLinkClass} ${
              isSubGroupsPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Asset sub group
          </Link>
          <Link
            href="/admin/dashboard/asset-register#asset-register"
            className={`${subLinkClass} ${
              isAssetRegisterPage && !isDepreciationPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Asset Register
          </Link>
          <Link
            href="/admin/dashboard/asset-register/depreciation"
            className={`${subLinkClass} ${
              isDepreciationPage ? linkActive : linkInactive
            }`}
            onClick={onNavigate}
          >
            Depreciation
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity lg:hidden ${
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!mobileOpen}
        onClick={onNavigate}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-full max-w-[16.5rem] flex-col border-r border-emerald-900/10 bg-white shadow-xl transition-transform duration-300 ease-out lg:static lg:z-auto lg:max-w-none lg:shrink-0 lg:overflow-hidden lg:shadow-none lg:transition-[width,border-color] lg:duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${desktopCollapsed ? "lg:w-0 lg:border-r-transparent" : "lg:w-56"}`}
        aria-hidden={desktopCollapsed && !mobileOpen}
      >
        <div className="border-b border-emerald-900/10 px-4 py-4 lg:hidden">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/70">
            Menu
          </p>
        </div>
        {nav}
      </aside>
    </>
  );
}

export function AdminNavMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-lg border border-emerald-900/15 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-emerald-50 lg:hidden"
      aria-label="Open menu"
    >
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 6h16M4 12h16M4 18h16"
        />
      </svg>
    </button>
  );
}
