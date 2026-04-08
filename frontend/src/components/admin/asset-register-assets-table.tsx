"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatAdminDateTime } from "@/lib/format-datetime";

export type AssetRegisterRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  group_code: string;
  sub_group_name: string | null;
  branch_code: string;
  branch_name: string;
  ownership_type: string;
  working_status: string;
  department_name: string | null;
  purchase_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  purchase_invoice_no: string | null;
  lifetime_years: number | null;
  salvage_value: string | null;
  created_at: string;
};

type ListResponse = {
  assets: AssetRegisterRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;
const COL_COUNT = 12;

export function AssetRegisterAssetsTable({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const tableId = useId();
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
      const res = await fetch(`/api/admin/assets?${params.toString()}`);
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load assets.");
        setData(null);
        return;
      }
      setData({
        assets: json.assets ?? [],
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

  const assets = data?.assets ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${tableId}-assets-heading`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={`${tableId}-assets-heading`}
            className="text-base font-semibold text-slate-900"
          >
            Registered assets
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Recently saved fixed assets from this register (newest first).
          </p>
        </div>
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor={`${tableId}-search`}
            className="block text-sm font-medium text-slate-700"
          >
            Search
          </label>
          <input
            id={`${tableId}-search`}
            type="search"
            placeholder="Code, name, group, branch…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap"
              >
                Asset code
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Group
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Sub-group
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Branch
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Ownership
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Department
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Purchase (BS)
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap text-right"
              >
                Qty
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap text-right"
              >
                Unit rate
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Saved
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : assets.length === 0 ? (
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {debouncedSearch
                    ? "No assets match your search."
                    : "No assets yet. Save one using the form above."}
                </td>
              </tr>
            ) : (
              assets.map((a) => (
                <tr key={a.id} className="bg-white hover:bg-slate-50/80">
                  <td className="max-w-[200px] px-4 py-3 font-mono text-xs text-slate-900 break-all">
                    {a.asset_code ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {a.asset_name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.group_code ? `${a.group_code} — ${a.group_name}` : a.group_name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.sub_group_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.branch_code} — {a.branch_name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.ownership_type}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.working_status}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {a.department_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                    {a.purchase_date_bs}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                    {a.purchase_qty ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                    {a.unit_rate ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatAdminDateTime(a.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          {total === 0
            ? "No rows."
            : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="whitespace-nowrap">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
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
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm tabular-nums text-slate-600">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
