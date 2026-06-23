"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/admin/dashboard/asset-register/depreciation",
    label: "Runs",
    match: (pathname: string) =>
      pathname === "/admin/dashboard/asset-register/depreciation" ||
      pathname.startsWith("/admin/dashboard/asset-register/depreciation/new") ||
      /^\/admin\/dashboard\/asset-register\/depreciation\/\d+$/.test(pathname),
  },
  {
    href: "/admin/dashboard/asset-register/depreciation/settings",
    label: "Settings",
    match: (pathname: string) =>
      pathname === "/admin/dashboard/asset-register/depreciation/settings",
  },
] as const;

export function DepreciationSectionNav() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1"
      aria-label="Depreciation sections"
    >
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-[var(--brand-primary)] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
