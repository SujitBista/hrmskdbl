"use client";

import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not sign in.");
        return;
      }
      router.replace("/admin/dashboard/asset-register");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

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
        <form className="space-y-5" onSubmit={onSubmit}>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
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
