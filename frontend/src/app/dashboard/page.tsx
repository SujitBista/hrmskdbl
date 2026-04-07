import { getUserSession } from "@/lib/user-session";
import { redirect } from "next/navigation";

function permLabel(ok: boolean) {
  return ok ? "Yes" : "No";
}

export default async function UserDashboardPage() {
  const session = await getUserSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-emerald-900/10 bg-white/95 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Your account
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This dashboard is tied to your sign-in. Only you see this page for
          your email address.
        </p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{session.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Role
            </dt>
            <dd className="mt-1 text-sm capitalize text-slate-900">
              {session.jobRole}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-emerald-900/10 bg-white/95 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Permissions
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          These match what an administrator set when your user was created.
        </p>
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
          <li className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-700">View</span>
            <span className="font-medium text-slate-900">
              {permLabel(session.perm_view)}
            </span>
          </li>
          <li className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-700">Edit</span>
            <span className="font-medium text-slate-900">
              {permLabel(session.perm_edit)}
            </span>
          </li>
          <li className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-700">Delete</span>
            <span className="font-medium text-slate-900">
              {permLabel(session.perm_delete)}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
