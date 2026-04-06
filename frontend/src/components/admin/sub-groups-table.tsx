"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type SubGroupRow = {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  created_at: string;
};

type GroupOption = { id: number; name: string };

type ListResponse = {
  subGroups: SubGroupRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;

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

export function SubGroupsTable({ refreshKey }: { refreshKey: number }) {
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

  const [deleteTarget, setDeleteTarget] = useState<SubGroupRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<SubGroupRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editGroupId, setEditGroupId] = useState<number | "">("");
  const [editGroups, setEditGroups] = useState<GroupOption[]>([]);
  const [editGroupsLoading, setEditGroupsLoading] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
      setEditName(editTarget.name);
      setEditGroupId(editTarget.group_id);
      setActionError(null);
      el.showModal();
      setEditGroupsLoading(true);
      void (async () => {
        try {
          const params = new URLSearchParams({ page: "1", pageSize: "100" });
          const res = await fetch(`/api/admin/groups?${params.toString()}`);
          const json = (await res.json()) as {
            groups?: GroupOption[];
            error?: string;
          };
          if (res.ok) {
            setEditGroups(json.groups ?? []);
          } else {
            setEditGroups([]);
          }
        } catch {
          setEditGroups([]);
        } finally {
          setEditGroupsLoading(false);
        }
      })();
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
      const res = await fetch(`/api/admin/sub-groups?${params.toString()}`);
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load sub groups.");
        setData(null);
        return;
      }
      setData({
        subGroups: json.subGroups ?? [],
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
  const subGroups = data?.subGroups ?? [];
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
      const res = await fetch(`/api/admin/sub-groups/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionError(json.error ?? "Could not delete sub group.");
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
    if (!editTarget || editGroupId === "") return;
    setEditSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/sub-groups/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          groupId: editGroupId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error ?? "Could not update sub group.");
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
      aria-labelledby={`${searchId}-sub-groups-heading`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={`${searchId}-sub-groups-heading`}
            className="text-base font-semibold text-slate-900"
          >
            Sub groups
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Sub groups listed under their parent group.
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
            placeholder="Sub group or group name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Group
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Sub group name
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
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : subGroups.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {debouncedSearch
                    ? "No sub groups match your search."
                    : "No sub groups yet. Create one using the form above."}
                </td>
              </tr>
            ) : (
              subGroups.map((row) => (
                <tr key={row.id} className="bg-white hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.group_name}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{row.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatCreatedAt(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget(row)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
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
            "No sub groups yet."
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
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
            Delete sub group?
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Are you sure you want to delete{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget?.name}
            </span>{" "}
            under{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget?.group_name}
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
              Edit sub group
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Update the group or sub group name.
            </p>
          </div>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div>
              <label
                htmlFor={`${searchId}-edit-group`}
                className="block text-sm font-medium text-slate-700"
              >
                Group name
              </label>
              <select
                id={`${searchId}-edit-group`}
                required
                disabled={editGroupsLoading || editGroups.length === 0}
                value={editGroupId === "" ? "" : String(editGroupId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setEditGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                {editGroupsLoading ? (
                  <option value="">Loading groups…</option>
                ) : editGroups.length === 0 ? (
                  <option value="">No groups</option>
                ) : (
                  editGroups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${searchId}-edit-name`}
                className="block text-sm font-medium text-slate-700"
              >
                Sub group name
              </label>
              <input
                id={`${searchId}-edit-name`}
                type="text"
                required
                autoComplete="off"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
              />
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
              disabled={
                editSubmitting ||
                editGroupId === "" ||
                editGroupsLoading ||
                editGroups.length === 0
              }
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
