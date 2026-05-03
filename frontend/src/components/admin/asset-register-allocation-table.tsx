"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";

export type AssetAllocationListRow = {
  remarks: string;
  asset_code: string | null;
  asset_id: number;
  asset_name: string;
  purchase_date_nepali: string;
  dep_start_date_nepali: string;
  qty: string | null;
  purchase_amount: string | null;
  sub_group_name: string | null;
  own_type: string;
  working_status: string;
  branch_name: string;
  allocation_category_name: string;
  allocation_branch_name: string;
  emp_name: string;
  book_qty: string | null;
  purchase_with_additional_amount: string | null;
  accumulate_dep: string | null;
  book_value: string | null;
  group_name: string;
  dep_amount: string | null;
  disposal_dep_amt: string | null;
  this_year_dep: string | null;
  total_dep_amount: string | null;
  closing_book_value: string | null;
  serial_number: string | null;
  dep_fiscal_year: string | null;
  dep_rate: string | null;
  dep_days: string | null;
};

type ListResponse = {
  rows: AssetAllocationListRow[];
  total: number;
  page: number;
  pageSize: number;
};

type ColDef = {
  key: keyof AssetAllocationListRow;
  /** Column header like legacy ERP / screenshot */
  label: string;
  format: "text" | "assetCode" | "qty" | "money" | "id" | "depRate";
};

const DATA_COLUMNS: ColDef[] = [
  { key: "remarks", label: "Remarks", format: "text" },
  { key: "asset_code", label: "AssetCode", format: "assetCode" },
  { key: "asset_id", label: "AssetID", format: "id" },
  { key: "asset_name", label: "AssetName", format: "text" },
  { key: "purchase_date_nepali", label: "PurchaseDate", format: "text" },
  { key: "dep_start_date_nepali", label: "DepStartDate", format: "text" },
  { key: "qty", label: "Qty", format: "qty" },
  { key: "purchase_amount", label: "PurchaseAmount", format: "money" },
  { key: "sub_group_name", label: "SubGroupName", format: "text" },
  { key: "own_type", label: "OwnType", format: "text" },
  { key: "working_status", label: "WorkingStatus", format: "text" },
  { key: "branch_name", label: "BranchName", format: "text" },
  { key: "allocation_category_name", label: "AllocationCategory", format: "text" },
  { key: "allocation_branch_name", label: "AllocationBranch", format: "text" },
  { key: "emp_name", label: "EmpName", format: "text" },
  { key: "book_qty", label: "BookQty", format: "qty" },
  {
    key: "purchase_with_additional_amount",
    label: "PurchaseWithAdditionalAmount",
    format: "money",
  },
  { key: "accumulate_dep", label: "AccumulateDep", format: "money" },
  { key: "book_value", label: "BookValue", format: "money" },
  { key: "group_name", label: "GroupName", format: "text" },
  { key: "dep_amount", label: "DepAmount", format: "money" },
  { key: "disposal_dep_amt", label: "DisposalDepAmt", format: "money" },
  { key: "this_year_dep", label: "ThisYearDep", format: "money" },
  { key: "total_dep_amount", label: "TotalDepAmount", format: "money" },
  { key: "closing_book_value", label: "ClosingBookValue", format: "money" },
  { key: "dep_fiscal_year", label: "DepFiscalYear", format: "text" },
  { key: "dep_rate", label: "DepRate", format: "depRate" },
  { key: "dep_days", label: "DepDays", format: "text" },
  { key: "serial_number", label: "SerialNumber", format: "text" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const SEARCH_DEBOUNCE_MS = 350;

const toolbarBtn =
  "inline-flex h-9 items-center justify-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";

function formatMoneyLike(raw: string | null): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw).trim();
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQtyLike(raw: string | null): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw).trim();
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cellDisplay(
  row: AssetAllocationListRow,
  col: ColDef
): string {
  const v = row[col.key];
  if (v === null || v === undefined) {
    if (col.format === "money" || col.format === "qty") return "—";
    if (col.format === "depRate") return "—";
    return "";
  }
  if (col.format === "id") {
    return String(v);
  }
  if (col.format === "assetCode") {
    const s = String(v).trim();
    if (s === "") return "—";
    return formatAssetCodeForDisplay(s);
  }
  if (col.format === "money") {
    return formatMoneyLike(String(v));
  }
  if (col.format === "qty") {
    return formatQtyLike(String(v));
  }
  if (col.format === "depRate") {
    const s = String(v).trim();
    if (s === "") return "—";
    const n = Number.parseFloat(s);
    if (Number.isFinite(n)) {
      return `${n}%`;
    }
    return `${s}%`;
  }
  const s = String(v).trim();
  return s === "" ? "—" : s;
}

function csvEscape(value: string): string {
  const s = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function AssetRegisterAllocationTable({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const tableId = useId();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

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
      const res = await fetch(
        `/api/admin/assets/allocations?${params.toString()}`
      );
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load allocation list.");
        setData(null);
        return;
      }
      setData({
        rows: json.rows ?? [],
        total: json.total ?? 0,
        page: json.page ?? page,
        pageSize: json.pageSize ?? pageSize,
      });
    } catch {
      setError("Could not load allocation list.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [data?.rows, page, pageSize, debouncedSearch, refreshKey]);

  const rows = data?.rows ?? [];
  const totalPages =
    data && data.total > 0 ? Math.ceil(data.total / data.pageSize) : 1;

  const allPageSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((r) => selectedIds.has(r.asset_id));
  }, [rows, selectedIds]);

  const somePageSelected = useMemo(() => {
    return rows.some((r) => selectedIds.has(r.asset_id));
  }, [rows, selectedIds]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = !allPageSelected && somePageSelected;
  }, [allPageSelected, somePageSelected]);

  function toggleSelectAllPage(): void {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of rows) {
          next.delete(r.asset_id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of rows) {
          next.add(r.asset_id);
        }
        return next;
      });
    }
  }

  function toggleRow(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function resetFilters(): void {
    setSearchInput("");
    setDebouncedSearch("");
    setPage(1);
  }

  function exportCsv(): void {
    const exportRows =
      selectedIds.size > 0 ? rows.filter((r) => selectedIds.has(r.asset_id)) : rows;
    if (exportRows.length === 0) return;

    const headers = [
      "#",
      ...DATA_COLUMNS.map((c) => c.label),
    ];
    const lines = [headers.map(csvEscape).join(",")];
    let baseIndex = (data?.page ?? 1) - 1;
    baseIndex *= data?.pageSize ?? pageSize;
    exportRows.forEach((row, i) => {
      const rowNo =
        selectedIds.size > 0
          ? String(i + 1)
          : String(baseIndex + rows.indexOf(row) + 1);
      const cells = [
        rowNo,
        ...DATA_COLUMNS.map((c) => csvEscape(cellDisplay(row, c))),
      ];
      lines.push(cells.join(","));
    });

    const blob = new Blob(["\ufeff" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asset-allocation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const colCount = 2 + DATA_COLUMNS.length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <h2 className="text-lg font-semibold text-slate-900">Asset Allocation</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Populated automatically when assets are registered or imported. Use
          Export to download the current view. Depreciation columns reflect
          each asset&apos;s latest posted run only.
        </p>
      </div>

      <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={toolbarBtn} onClick={exportCsv}>
            Export
          </button>
          <button
            type="button"
            className={toolbarBtn}
            onClick={() => {
              document.getElementById(`${tableId}-search`)?.focus();
            }}
          >
            Filter
          </button>
          <button type="button" className={toolbarBtn} onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <input
            id={`${tableId}-search`}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 min-w-[12rem] flex-1 rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/30 sm:max-w-md"
            placeholder="Search name, code, branch…"
            aria-label="Search allocation list"
          />
          <label htmlFor={`${tableId}-page-size`} className="sr-only">
            Rows per page
          </label>
          <select
            id={`${tableId}-page-size`}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-9 shrink-0 rounded border border-slate-300 bg-white px-2 text-sm text-slate-800"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-red-600 sm:px-5" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-[1600px] w-full border-collapse text-sm text-slate-900">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
              <th className="w-10 whitespace-nowrap border-r border-slate-200 px-2 py-2 text-center">
                #
              </th>
              <th className="w-10 whitespace-nowrap border-r border-slate-200 px-1 py-2 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-400"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = !allPageSelected && somePageSelected;
                    }
                  }}
                  onChange={toggleSelectAllPage}
                  aria-label="Select all on this page"
                  disabled={loading || rows.length === 0}
                />
              </th>
              {DATA_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="whitespace-nowrap border-r border-slate-200 px-2 py-2 last:border-r-0"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No rows yet. Register or import assets on the Asset Register tab.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const rowNo = (page - 1) * pageSize + idx + 1;
                return (
                  <tr
                    key={row.asset_id}
                    className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60 hover:bg-blue-50/40"
                  >
                    <td className="border-r border-slate-100 px-2 py-1.5 text-center text-xs text-slate-600 tabular-nums">
                      {rowNo}
                    </td>
                    <td className="border-r border-slate-100 px-1 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-400"
                        checked={selectedIds.has(row.asset_id)}
                        onChange={() => toggleRow(row.asset_id)}
                        aria-label={`Select asset ${row.asset_id}`}
                      />
                    </td>
                    {DATA_COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`max-w-[18rem] truncate border-r border-slate-100 px-2 py-1.5 text-xs last:border-r-0 ${
                          c.format === "assetCode" ? "font-mono" : ""
                        }`}
                        title={cellDisplay(row, c)}
                      >
                        {cellDisplay(row, c)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 ? (
        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            Page {data.page} of {totalPages} · {data.total} row
            {data.total === 1 ? "" : "s"}
            {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={toolbarBtn}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className={toolbarBtn}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
