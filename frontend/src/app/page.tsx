import { SaptakoshiLogo } from "@/components/saptakoshi-logo";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-[linear-gradient(165deg,var(--brand-muted)_0%,#f8fafc_45%,#eef4f0_100%)] px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-900/10 bg-white/95 p-10 text-center shadow-[0_8px_30px_-12px_rgba(15,81,50,0.18)] backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <SaptakoshiLogo variant="hero" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--brand-primary)]">
              HRMS · Saptakoshi Development Bank
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Internal HRMS for administrators.
            </p>
          </div>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-lg bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)]"
        >
          Sign in
        </Link>
        <p className="mt-10 text-xs text-slate-500">
          Saptakoshi Development Bank Limited · Internal use
        </p>
      </div>
    </div>
  );
}
