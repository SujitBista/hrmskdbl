"use client";

import Link from "next/link";

function UserPlusIcon({ className }: { className?: string }) {
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
        d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
      />
    </svg>
  );
}

type Props = {
  mobileOpen: boolean;
  onNavigate: () => void;
};

export function AdminLeftNav({ mobileOpen, onNavigate }: Props) {
  const linkClass =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-[var(--brand-primary)]";

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Admin">
      <Link
        href="/admin/dashboard#create-user"
        className={linkClass}
        onClick={onNavigate}
      >
        <UserPlusIcon className="h-5 w-5 shrink-0 text-emerald-800/80" />
        Create user
      </Link>
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
        className={`fixed inset-y-0 left-0 z-50 flex w-full max-w-[16.5rem] flex-col border-r border-emerald-900/10 bg-white shadow-xl transition-transform duration-300 ease-out lg:static lg:z-auto lg:max-w-none lg:w-56 lg:shrink-0 lg:shadow-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
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
