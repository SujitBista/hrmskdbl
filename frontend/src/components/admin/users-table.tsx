"use client";

import { useCallback, useEffect, useId, useState } from "react";

export type SystemUserRow = {
  id: number;
  email: string;
  role: string;
  created_at: string;
};

type ListResponse = {
  users: SystemUserRow[];
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

export function UsersTable({ refreshKey }: { refreshKey: number }) {
  const searchId = useId();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

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
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Role
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
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
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatCreatedAt(u.created_at)}
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
    </section>
  );
}
