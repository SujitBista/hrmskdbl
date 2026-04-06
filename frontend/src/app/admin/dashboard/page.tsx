import { getSession } from "@/lib/session";
import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/admin");
  }

  return (
    <div className="min-h-full flex-1 bg-[linear-gradient(180deg,#f4f8f6_0%,#f8fafc_100%)]">
      <header className="border-b border-emerald-900/10 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <SaptakoshiLogo variant="header" />
            <div className="hidden h-10 w-px bg-emerald-900/15 sm:block" aria-hidden />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/70">
                HRMS · Admin
              </p>
              <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
            <span className="text-slate-600">{session.email}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-8 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)]">
          <h2 className="text-base font-medium text-slate-900">
            Welcome to your dashboard
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            You are signed in as an administrator. Extend this area with HRMS
            modules, reports, and user management as you build out the product.
          </p>
          <p className="mt-6 text-sm text-slate-500">
            Need to leave? Use{" "}
            <span className="font-medium text-[var(--brand-primary)]">
              Sign out
            </span>{" "}
            in the header.
          </p>
        </div>
      </main>
    </div>
  );
}
