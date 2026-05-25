"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/dashboard/asset-register", label: "Asset Register" },
  {
    href: "/admin/dashboard/asset-register/allocations",
    label: "Allocation list",
  },
  {
    href: "/admin/dashboard/asset-register/disposals",
    label: "Asset Disposal",
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
  const onAllocations = pathname.startsWith(
    "/admin/dashboard/asset-register/allocations"
  );
  const onDisposals = pathname.startsWith(
    "/admin/dashboard/asset-register/disposals"
  );

  return (
    <div className="mb-4 border-b border-slate-300 bg-slate-50/80">
      <nav
        className="flex flex-wrap gap-0"
        aria-label="Fixed asset sections"
      >
        {tabs.map((t) => {
          let active = false;
          if (t.href === "/admin/dashboard/asset-register/depreciation") {
            active = onDepreciation;
          } else if (t.href === "/admin/dashboard/asset-register/allocations") {
            active = onAllocations;
          } else if (t.href === "/admin/dashboard/asset-register/disposals") {
            active = onDisposals;
          } else {
            active = pathname === t.href;
          }
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
