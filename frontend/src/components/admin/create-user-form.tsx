"use client";

import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import {
  getDefaultPermissions,
  normalizePermissionsInput,
  type UserPermissions,
} from "@/lib/user-permissions";

type Props = {
  onCreated?: () => void;
};

export function CreateUserForm({ onCreated }: Props) {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [perms, setPerms] = useState<UserPermissions>(() =>
    getDefaultPermissions()
  );
  const [roles, setRoles] = useState<string[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const res = await fetch("/api/admin/roles");
      const data = (await res.json()) as { roles?: string[] };
      if (res.ok && data.roles?.length) {
        setRoles(data.roles);
        setRole((r) => r || data.roles![0]!);
      }
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          role,
          ...normalizePermissionsInput(perms),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create user.");
        return;
      }
      setSuccess("User created successfully.");
      setEmail("");
      setPassword("");
      setPerms(getDefaultPermissions());
      if (roles[0]) {
        setRole(roles[0]);
      }
      onCreated?.();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="create-user"
      className="scroll-mt-24 rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${formId}-heading`}
    >
      <h2
        id={`${formId}-heading`}
        className="text-base font-semibold text-slate-900"
      >
        Create user
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Add a system user, assign a role, and set what they can do with records.
      </p>
      <form className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
        <div>
          <label
            htmlFor={`${formId}-email`}
            className="block text-sm font-medium text-slate-700"
          >
            Email
          </label>
          <input
            id={`${formId}-email`}
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
        <div>
          <label
            htmlFor={`${formId}-password`}
            className="block text-sm font-medium text-slate-700"
          >
            Temporary password
          </label>
          <input
            id={`${formId}-password`}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <div>
          <label
            htmlFor={`${formId}-role`}
            className="block text-sm font-medium text-slate-700"
          >
            Role
          </label>
          <select
            id={`${formId}-role`}
            required
            disabled={loadingRoles || roles.length === 0}
            value={role}
            onChange={(ev) => setRole(ev.target.value)}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:opacity-60"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Placeholder roles until role management is added.
          </p>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-800">
            Record permissions
          </legend>
          <p className="mb-3 text-xs text-slate-500">
            Edit and delete require view. Turning off view clears edit and delete.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={perms.perm_view}
                onChange={(ev) => {
                  const on = ev.target.checked;
                  setPerms(
                    on
                      ? normalizePermissionsInput({
                          ...perms,
                          perm_view: true,
                        })
                      : { perm_view: false, perm_edit: false, perm_delete: false }
                  );
                }}
                className="size-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
              />
              View records
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={perms.perm_edit}
                onChange={(ev) =>
                  setPerms(
                    normalizePermissionsInput({
                      ...perms,
                      perm_edit: ev.target.checked,
                    })
                  )
                }
                className="size-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
              />
              Create / update records
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={perms.perm_delete}
                onChange={(ev) =>
                  setPerms(
                    normalizePermissionsInput({
                      ...perms,
                      perm_delete: ev.target.checked,
                    })
                  )
                }
                className="size-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
              />
              Delete records
            </label>
          </div>
        </fieldset>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="text-sm text-emerald-800" role="status">
            {success}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || loadingRoles}
          className="w-full max-w-lg rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create user"}
        </button>
      </form>
    </section>
  );
}
