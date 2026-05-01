"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/dashboard/asset-register", label: "Asset Register" },
  {
    href: "/admin/dashboard/asset-register/allocation",
    label: "Asset allocation",
  },
  {
    href: "/admin/dashboard/asset-register/depreciation",
    label: "Depreciation",
  },
] as const;

/**
 * ERP-style secondary tabs for the fixed-asset area (matches legacy master / detail navigation).
 */
export function FixedAssetSectionTabs() {
  const pathname = usePathname();
  const onDepreciation = pathname.startsWith(
    "/admin/dashboard/asset-register/depreciation"
  );
  const onAllocation = pathname.startsWith(
    "/admin/dashboard/asset-register/allocation"
  );

  return (
    <div className="mb-4 border-b border-slate-300 bg-slate-50/80">
      <nav
        className="flex flex-wrap gap-0"
        aria-label="Fixed asset sections"
      >
        {tabs.map((t) => {
          const active =
            t.href === "/admin/dashboard/asset-register/depreciation"
              ? onDepreciation
              : t.href === "/admin/dashboard/asset-register/allocation"
                ? onAllocation
                : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? "-mb-px border-blue-600 bg-white text-blue-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100/80 hover:text-slate-900"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
