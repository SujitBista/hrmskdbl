import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import type { UserSession } from "@/lib/user-session";
import { UserLogoutButton } from "./user-logout-button";

export function UserDashboardShell({
  session,
  children,
}: {
  session: UserSession;
  children: React.ReactNode;
}) {
  const roleLabel =
    session.jobRole === "maker"
      ? "Maker"
      : session.jobRole === "checker"
        ? "Checker"
        : session.jobRole;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[linear-gradient(180deg,#f4f8f6_0%,#f8fafc_100%)]">
      <header className="border-b border-emerald-900/10 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-4">
            <SaptakoshiLogo variant="header" />
            <div className="hidden h-10 w-px bg-emerald-900/15 sm:block" aria-hidden />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/70">
                HRMS · My dashboard
              </p>
              <h1 className="text-lg font-semibold text-slate-900">
                Welcome, {session.email}
              </h1>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium capitalize text-emerald-900">
              {roleLabel}
            </span>
            <span className="text-slate-600">{session.email}</span>
            <UserLogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
        {children}
      </main>
    </div>
  );
}
