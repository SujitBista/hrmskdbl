"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  normalizePermissionsInput,
  type UserPermissions,
} from "@/lib/user-permissions";

export type SystemUserRow = {
  id: number;
  email: string;
  role: string;
  created_at: string;
  perm_view?: boolean;
  perm_edit?: boolean;
  perm_delete?: boolean;
};

type ListResponse = {
  users: SystemUserRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;

function rowPermissions(u: SystemUserRow): UserPermissions {
  return normalizePermissionsInput({
    perm_view: u.perm_view,
    perm_edit: u.perm_edit,
    perm_delete: u.perm_delete,
  });
}

function PermissionBadges({ perms }: { perms: UserPermissions }) {
  const items: { key: keyof UserPermissions; label: string }[] = [
    { key: "perm_view", label: "View" },
    { key: "perm_edit", label: "Edit" },
    { key: "perm_delete", label: "Delete" },
  ];
  const active = items.filter((i) => perms[i.key]);
  if (active.length === 0) {
    return (
      <span className="text-xs text-slate-400">None</span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {active.map((i) => (
        <span
          key={i.key}
          className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-900/10"
        >
          {i.label}
        </span>
      ))}
    </span>
  );
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function UsersTable({ refreshKey }: { refreshKey: number }) {
  const searchId = useId();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

  const [roles, setRoles] = useState<string[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<SystemUserRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<SystemUserRow | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPerms, setEditPerms] = useState<UserPermissions>(() =>
    normalizePermissionsInput({})
  );
  const [editPassword, setEditPassword] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const res = await fetch("/api/admin/roles");
      const json = (await res.json()) as { roles?: string[] };
      if (res.ok && json.roles?.length) {
        setRoles(json.roles);
      }
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    const el = deleteDialogRef.current;
    if (!el) return;
    if (deleteTarget) {
      setActionError(null);
      el.showModal();
    } else {
      el.close();
    }
  }, [deleteTarget]);

  useEffect(() => {
    const el = editDialogRef.current;
    if (!el) return;
    if (editTarget) {
      setEditEmail(editTarget.email);
      setEditRole(editTarget.role);
      setEditPerms(rowPermissions(editTarget));
      setEditPassword("");
      setActionError(null);
      el.showModal();
    } else {
      el.close();
    }
  }, [editTarget]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load users.");
        setData(null);
        return;
      }
      setData({
        users: json.users ?? [],
        total: json.total ?? 0,
        page: json.page ?? page,
        pageSize: json.pageSize ?? pageSize,
      });
    } catch {
      setError("Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const total = data?.total ?? 0;
  const users = data?.users ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  useEffect(() => {
    if (page > totalPages && totalPages >= 1) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${deleteTarget.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionError(json.error ?? "Could not delete user.");
        return;
      }
      setDeleteTarget(null);
      await load();
    } catch {
      setActionError("Something went wrong.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function onEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    const pwd = editPassword.trim();
    if (pwd && pwd.length < 8) {
      setActionError("Password must be at least 8 characters.");
      return;
    }
    setEditSubmitting(true);
    setActionError(null);
    try {
      const body: {
        email: string;
        role: string;
        password?: string;
      } & UserPermissions = {
        email: editEmail,
        role: editRole,
        ...normalizePermissionsInput(editPerms),
      };
      if (pwd) {
        body.password = pwd;
      }
      const res = await fetch(`/api/admin/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error ?? "Could not update user.");
        return;
      }
      setEditTarget(null);
      await load();
    } catch {
      setActionError("Something went wrong.");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${searchId}-users-heading`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={`${searchId}-users-heading`}
            className="text-base font-semibold text-slate-900"
          >
            Users
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            System accounts created from this admin area.
          </p>
        </div>
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor={`${searchId}-search`}
            className="block text-sm font-medium text-slate-700"
          >
            Search
          </label>
          <input
            id={`${searchId}-search`}
            type="search"
            placeholder="Email or role…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Role
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Record access
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Created
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium whitespace-nowrap"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {debouncedSearch
                    ? "No users match your search."
                    : "No users yet. Create one using the form above."}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="bg-white hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.email}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {u.role}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    <PermissionBadges perms={rowPermissions(u)} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatCreatedAt(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget(u)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(u)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          {total === 0 ? (
            "No users yet."
          ) : (
            <>
              Showing{" "}
              <span className="font-medium text-slate-800">
                {from}–{to}
              </span>{" "}
              of <span className="font-medium text-slate-800">{total}</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page{" "}
              <span className="font-medium text-slate-900">{safePage}</span> of{" "}
              <span className="font-medium text-slate-900">{totalPages}</span>
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages || loading || total === 0}
              onClick={() =>
                setPage((p) => Math.min(totalPages, p + 1))
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <dialog
        ref={deleteDialogRef}
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setDeleteTarget(null)}
      >
        <div className="p-6">
          <h3 className="text-base font-semibold text-slate-900">
            Delete user?
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Are you sure you want to delete{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget?.email}
            </span>
            ? This cannot be undone.
          </p>
          {actionError && deleteTarget ? (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteSubmitting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={editDialogRef}
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setEditTarget(null)}
      >
        <form onSubmit={onEditSubmit}>
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-semibold text-slate-900">
              Edit user
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Update email, role, record permissions, or set a new password.
            </p>
          </div>
          <div className="flex flex-col gap-4 px-6 py-5">
            <fieldset className="rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                Record permissions
              </legend>
              <p className="mb-3 text-xs text-slate-500">
                Edit and delete require view. Turning off view clears edit and
                delete.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editPerms.perm_view}
                    onChange={(ev) => {
                      const on = ev.target.checked;
                      setEditPerms(
                        on
                          ? normalizePermissionsInput({
                              ...editPerms,
                              perm_view: true,
                            })
                          : {
                              perm_view: false,
                              perm_edit: false,
                              perm_delete: false,
                            }
                      );
                    }}
                    className="size-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
                  />
                  View records
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editPerms.perm_edit}
                    onChange={(ev) =>
                      setEditPerms(
                        normalizePermissionsInput({
                          ...editPerms,
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
                    checked={editPerms.perm_delete}
                    onChange={(ev) =>
                      setEditPerms(
                        normalizePermissionsInput({
                          ...editPerms,
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
            <div>
              <label
                htmlFor={`${searchId}-edit-email`}
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id={`${searchId}-edit-email`}
                type="email"
                required
                autoComplete="off"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
              />
            </div>
            <div>
              <label
                htmlFor={`${searchId}-edit-role`}
                className="block text-sm font-medium text-slate-700"
              >
                Role
              </label>
              <select
                id={`${searchId}-edit-role`}
                required
                disabled={loadingRoles || roles.length === 0}
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:opacity-60"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${searchId}-edit-password`}
                className="block text-sm font-medium text-slate-700"
              >
                New password
              </label>
              <input
                id={`${searchId}-edit-password`}
                type="password"
                autoComplete="new-password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                minLength={editPassword.trim() ? 8 : undefined}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
              />
              <p className="mt-1 text-xs text-slate-500">
                Optional. At least 8 characters if set.
              </p>
            </div>
            {actionError && editTarget ? (
              <p className="text-sm text-red-600" role="alert">
                {actionError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              disabled={editSubmitting}
              onClick={() => setEditTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSubmitting || loadingRoles}
              className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
