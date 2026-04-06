import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-20">
      <div className="max-w-lg text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          HRMS admin
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          Welcome
        </h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-600">
          Sign in with your admin account to open the dashboard. The API runs on
          Express with PostgreSQL.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Admin login
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
