"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatAdminDateTime } from "@/lib/format-datetime";

export type GroupRow = {
  id: number;
  code: string;
  name: string;
  dep_method: string | null;
  dep_rate: number | null;
  dep_rate_tax: number | null;
  created_at: string;
};

type ListResponse = {
  groups: GroupRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;

const DEPRECIATION_METHODS = [
  "Declining Balance",
  "Straight Line",
] as const;

const editFieldClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

export function GroupsTable({ refreshKey }: { refreshKey: number }) {
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

  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<GroupRow | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editDepMethod, setEditDepMethod] = useState("");
  const [editDepRate, setEditDepRate] = useState("");
  const [editDepRateTax, setEditDepRateTax] = useState("");
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
      setEditCode(editTarget.code);
      setEditName(editTarget.name);
      setEditDepMethod(editTarget.dep_method ?? "");
      setEditDepRate(
        editTarget.dep_rate != null ? String(editTarget.dep_rate) : ""
      );
      setEditDepRateTax(
        editTarget.dep_rate_tax != null ? String(editTarget.dep_rate_tax) : ""
      );
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
      const res = await fetch(`/api/admin/groups?${params.toString()}`);
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load groups.");
        setData(null);
        return;
      }
      setData({
        groups: json.groups ?? [],
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
  const groups = data?.groups ?? [];
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
      const res = await fetch(`/api/admin/groups/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionError(json.error ?? "Could not delete group.");
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
    setEditSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/groups/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editCode,
          name: editName,
          dep_method: editDepMethod === "" ? null : editDepMethod,
          dep_rate: editDepRate.trim() === "" ? null : Number(editDepRate),
          dep_rate_tax:
            editDepRateTax.trim() === "" ? null : Number(editDepRateTax),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error ?? "Could not update group.");
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
      aria-labelledby={`${searchId}-groups-heading`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={`${searchId}-groups-heading`}
            className="text-base font-semibold text-slate-900"
          >
            Asset groups
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Codes, names, and depreciation for each asset group.
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
            placeholder="Code or name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                ID
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Code
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Dep method
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap text-right">
                Dep rate
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap text-right">
                Dep rate tax
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
                  colSpan={8}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {debouncedSearch
                    ? "No asset groups match your search."
                    : "No asset groups yet. Create one using the form above."}
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <tr key={g.id} className="bg-white hover:bg-slate-50/80">
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-600">
                    {g.id}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-slate-900">
                    {g.code}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {g.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {g.dep_method ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                    {g.dep_rate != null ? g.dep_rate : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                    {g.dep_rate_tax != null ? g.dep_rate_tax : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatAdminDateTime(g.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget(g)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(g)}
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
            "No asset groups yet."
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
            Delete asset group?
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Are you sure you want to delete{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget
                ? `${deleteTarget.code} — ${deleteTarget.name}`
                : ""}
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
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setEditTarget(null)}
      >
        <form onSubmit={onEditSubmit}>
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-semibold text-slate-900">
              Edit asset group
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Group ID{" "}
              <span className="font-medium text-slate-800">
                {editTarget?.id ?? "—"}
              </span>
              . Update code, name, and depreciation.
            </p>
          </div>
          <div className="flex flex-col gap-6 px-6 py-5">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">Asset group</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${searchId}-edit-code`}
                    className="block text-sm font-medium text-slate-700"
                  >
                    Group code
                  </label>
                  <input
                    id={`${searchId}-edit-code`}
                    type="text"
                    required
                    autoComplete="off"
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    className={editFieldClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${searchId}-edit-name`}
                    className="block text-sm font-medium text-slate-700"
                  >
                    Group name
                  </label>
                  <input
                    id={`${searchId}-edit-name`}
                    type="text"
                    required
                    autoComplete="off"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={editFieldClass}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">Depreciation</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label
                    htmlFor={`${searchId}-edit-dep-method`}
                    className="block text-sm font-medium text-slate-700"
                  >
                    Depreciation method
                  </label>
                  <select
                    id={`${searchId}-edit-dep-method`}
                    value={editDepMethod}
                    onChange={(e) => setEditDepMethod(e.target.value)}
                    className={editFieldClass}
                  >
                    <option value="">— Select —</option>
                    {DEPRECIATION_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor={`${searchId}-edit-dep-rate`}
                    className="block text-sm font-medium text-slate-700"
                  >
                    Dep rate (%)
                  </label>
                  <input
                    id={`${searchId}-edit-dep-rate`}
                    type="number"
                    min={0}
                    step="any"
                    value={editDepRate}
                    onChange={(e) => setEditDepRate(e.target.value)}
                    className={editFieldClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${searchId}-edit-dep-rate-tax`}
                    className="block text-sm font-medium text-slate-700"
                  >
                    Dep rate tax (%)
                  </label>
                  <input
                    id={`${searchId}-edit-dep-rate-tax`}
                    type="number"
                    min={0}
                    step="any"
                    value={editDepRateTax}
                    onChange={(e) => setEditDepRateTax(e.target.value)}
                    className={editFieldClass}
                  />
                </div>
              </div>
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
              disabled={editSubmitting}
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
