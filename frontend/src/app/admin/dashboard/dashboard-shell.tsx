"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import {
  AdminLeftNav,
  AdminNavMenuButton,
} from "@/components/admin/admin-left-nav";
import { LogoutButton } from "./logout-button";

export function AdminDashboardShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pageTitle =
    pathname === "/admin/dashboard/groups/sub-groups"
      ? "Asset sub group"
      : pathname?.startsWith("/admin/dashboard/groups")
        ? "Asset Groups"
        : "Dashboard";

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      document.body.style.overflow = "";
      return;
    }
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      document.body.style.overflow = mq.matches ? "hidden" : "";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[linear-gradient(180deg,#f4f8f6_0%,#f8fafc_100%)]">
      <header className="border-b border-emerald-900/10 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <AdminNavMenuButton onClick={() => setMobileNavOpen(true)} />
            <SaptakoshiLogo variant="header" />
            <div className="hidden h-10 w-px bg-emerald-900/15 sm:block" aria-hidden />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/70">
                HRMS · Admin
              </p>
              <h1 className="text-lg font-semibold text-slate-900">{pageTitle}</h1>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
            <span className="text-slate-600">{email}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:min-h-0 lg:flex-row">
        <AdminLeftNav
          mobileOpen={mobileNavOpen}
          onNavigate={() => setMobileNavOpen(false)}
        />
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">{children}</div>
      </div>
    </div>
  );
}
