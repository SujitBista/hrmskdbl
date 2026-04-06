import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/admin");
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Admin
            </p>
            <h1 className="text-lg font-semibold text-zinc-900">Dashboard</h1>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <span className="text-zinc-600">{session.email}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h2 className="text-base font-medium text-zinc-900">
            Welcome to your dashboard
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            You are signed in as an administrator. Extend this area with HRMS
            modules, reports, and user management as you build out the product.
          </p>
          <p className="mt-6 text-sm text-zinc-500">
            Need to leave? Use{" "}
            <span className="font-medium text-zinc-700">Sign out</span> in the
            header.
          </p>
        </div>
      </main>
    </div>
  );
}
