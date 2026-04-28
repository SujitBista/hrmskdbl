"use client";

import { adminDashboardPageTitle } from "@/lib/admin-dashboard-page-title";
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
  initialPageTitle,
}: {
  email: string;
  children: React.ReactNode;
  /** From server (middleware + layout); matches SSR so hydration agrees with `usePathname()` after nav. */
  initialPageTitle: string;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);
  const [pageTitle, setPageTitle] = useState(initialPageTitle);

  useEffect(() => {
    setPageTitle(adminDashboardPageTitle(pathname));
  }, [pathname]);

  useEffect(() => {
    try {
      setDesktopNavCollapsed(
        window.localStorage.getItem("hrmskdbl_admin_nav_collapsed") === "1"
      );
    } catch {
      setDesktopNavCollapsed(false);
    }
  }, []);

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
    try {
      window.localStorage.setItem(
        "hrmskdbl_admin_nav_collapsed",
        desktopNavCollapsed ? "1" : "0"
      );
    } catch {
      /* ignore storage errors */
    }
  }, [desktopNavCollapsed]);

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
            <button
              type="button"
              className="hidden items-center justify-center rounded-lg border border-emerald-900/15 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-emerald-50 lg:inline-flex"
              aria-label={
                desktopNavCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={desktopNavCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setDesktopNavCollapsed((v) => !v)}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                aria-hidden
              >
                {desktopNavCollapsed ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 5l5 5-5 5M3.5 4.5v11"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 5l-5 5 5 5M16.5 4.5v11"
                  />
                )}
              </svg>
            </button>
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
      <div className="flex w-full flex-1 flex-col lg:min-h-0 lg:flex-row">
        <AdminLeftNav
          mobileOpen={mobileNavOpen}
          desktopCollapsed={desktopNavCollapsed}
          onNavigate={() => setMobileNavOpen(false)}
        />
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">{children}</div>
      </div>
    </div>
  );
}
