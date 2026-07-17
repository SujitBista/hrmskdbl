"use client";

import AdminLoginForm from "@/components/admin/admin-login-form";
import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-[linear-gradient(165deg,var(--brand-muted)_0%,#f8fafc_45%,#eef4f0_100%)] px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-emerald-900/10 bg-white/95 p-8 shadow-[0_8px_30px_-12px_rgba(15,81,50,0.18)] backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center gap-4 border-b border-emerald-900/10 pb-8">
          <SaptakoshiLogo variant="hero" />
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight text-[var(--brand-primary)]">
              HRMS — Admin
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Sign in with your administrator account.
            </p>
          </div>
        </div>
        <AdminLoginForm />
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link
            href="/"
            className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            Back to home
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-slate-500">
          Saptakoshi Development Bank Limited · Internal use
        </p>
      </div>
    </div>
  );
}
