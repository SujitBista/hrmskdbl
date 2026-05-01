"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";

type AllocationRow = {
  id: number;
  asset_code: string | null;
  asset_name: string;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: string | null;
  unit_rate: string | null;
  book_value: string | null;
  old_book_value: string | null;
  group_name: string;
  group_code: string;
  sub_group_name: string | null;
  working_status: string;
  allocation_branch_id: number | null;
  allocation_branch_name: string | null;
  allocation_department_id: number | null;
  allocation_department_name: string | null;
  allocation_type: string | null;
  allocation_date_bs: string | null;
};

type ListResponse = {
  rows: AllocationRow[];
  total: number;
  page: number;
  pageSize: number;
};

type BranchOption = {
  id: number;
  branch_code: string;
  branch_name: string;
};

type DepartmentOption = { id: number; name: string };

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;
const COL_COUNT = 14;

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Same basis order as asset register table. */
function formatDepreciationBasis(a: AllocationRow): string {
  const bvRaw = a.book_value;
  if (bvRaw != null && bvRaw !== "") {
    const bv = Number.parseFloat(bvRaw);
    if (Number.isFinite(bv) && bv > 0) return formatMoney(bv);
  }
  const q = a.purchase_qty != null ? Number.parseFloat(a.purchase_qty) : NaN;
  const r = a.unit_rate != null ? Number.parseFloat(a.unit_rate) : NaN;
  if (Number.isFinite(q) && Number.isFinite(r) && q > 0 && r >= 0) {
    return formatMoney(q * r);
  }
  if (a.old_book_value != null && a.old_book_value !== "") {
    const ob = Number.parseFloat(a.old_book_value);
    if (Number.isFinite(ob) && ob > 0) return formatMoney(ob);
  }
  return "—";
}

function formatGroupSubgroup(a: AllocationRow): string {
  const g = `${a.group_name} (${a.group_code})`;
  return a.sub_group_name ? `${g} / ${a.sub_group_name}` : g;
}

function formatAllocationTypeLabel(raw: string | null): string {
  if (raw == null || raw === "") return "—";
  if (raw === "NEW_ALLOCATION") return "New allocation";
  if (raw === "TRANSFER") return "Transfer";
  return raw;
}

export function AssetAllocationScreen() {
  const tableId = useId();
  const transferDialogRef = useRef<HTMLDialogElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [transferTarget, setTransferTarget] = useState<AllocationRow | null>(
    null
  );
  const [allocationDateBs, setAllocationDateBs] = useState("");
  const [allocationDatePickerReady, setAllocationDatePickerReady] =
    useState(false);
  const [transferBranchId, setTransferBranchId] = useState<number | "">("");
  const [transferDepartmentId, setTransferDepartmentId] = useState<
    number | ""
  >("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadLookups() {
      setLookupsLoading(true);
      try {
        const [bRes, dRes] = await Promise.all([
          fetch(`/api/admin/branches?page=1&pageSize=100`),
          fetch(`/api/admin/departments?page=1&pageSize=100`),
        ]);
        const bJson = (await bRes.json()) as {
          branches?: BranchOption[];
          error?: string;
        };
        const dJson = (await dRes.json()) as {
          departments?: DepartmentOption[];
          error?: string;
        };
        if (!cancelled) {
          setBranches(bRes.ok ? (bJson.branches ?? []) : []);
          setDepartments(dRes.ok ? (dJson.departments ?? []) : []);
        }
      } catch {
        if (!cancelled) {
          setBranches([]);
          setDepartments([]);
        }
      } finally {
        if (!cancelled) setLookupsLoading(false);
      }
    }
    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAllocationDatePickerReady(true);
  }, []);

  useEffect(() => {
    const el = transferDialogRef.current;
    if (!el) return;
    if (transferTarget) {
      setTransferError(null);
      setAllocationDateBs(transferTarget.purchase_date_bs);
      const bid = transferTarget.allocation_branch_id;
      setTransferBranchId(
        bid != null && branches.some((b) => b.id === bid)
          ? bid
          : branches[0]?.id ?? ""
      );
      const did = transferTarget.allocation_department_id;
      setTransferDepartmentId(
        did != null && departments.some((d) => d.id === did) ? did : ""
      );
      el.showModal();
    } else {
      el.close();
    }
  }, [transferTarget, branches, departments]);

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
        `/api/admin/asset-allocations?${params.toString()}`
      );
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load allocations.");
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
      setError("Could not load allocations.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTarget) return;
    setTransferError(null);
    if (transferBranchId === "") {
      setTransferError("Select a branch.");
      return;
    }
    const dateNorm = normalizeBsDateEnglish(allocationDateBs.trim());
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateNorm)) {
      setTransferError("Allocation date must be YYYY/MM/DD (Bikram Sambat).");
      return;
    }
    setTransferSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/assets/${transferTarget.id}/allocation-transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocation_date_bs: dateNorm,
            branch_id: transferBranchId,
            department_id:
              transferDepartmentId === "" ? null : transferDepartmentId,
          }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTransferError(json.error ?? "Could not save transfer.");
        return;
      }
      setTransferTarget(null);
      void load();
    } catch {
      setTransferError("Something went wrong. Try again.");
    } finally {
      setTransferSubmitting(false);
    }
  }

  const totalPages =
    data != null && data.total > 0
      ? Math.max(1, Math.ceil(data.total / data.pageSize))
      : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Asset allocation
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Current branch and department from the active allocation (same view as
          the legacy register). Use Add new on a row to record a transfer
          without changing depreciation or book value.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Search
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Code, name, group, branch…"
            className={inputClass}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:w-40">
          Page size
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className={inputClass}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error != null && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table
          id={tableId}
          className="min-w-[1200px] w-full border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-3 py-2.5">Asset code</th>
              <th className="px-3 py-2.5">Asset ID</th>
              <th className="px-3 py-2.5">Asset name</th>
              <th className="px-3 py-2.5">Purchase date</th>
              <th className="px-3 py-2.5">Dep start</th>
              <th className="px-3 py-2.5 text-right">Qty</th>
              <th className="px-3 py-2.5 text-right">Purchase amount</th>
              <th className="px-3 py-2.5">Group / subgroup</th>
              <th className="px-3 py-2.5">Working status</th>
              <th className="px-3 py-2.5">Branch</th>
              <th className="px-3 py-2.5">Department</th>
              <th className="px-3 py-2.5">Allocation type</th>
              <th className="px-3 py-2.5">Allocation date</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={COL_COUNT + 1}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : data != null && data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={COL_COUNT + 1}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  No assets found.
                </td>
              </tr>
            ) : (
              data?.rows.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-800">
                    {a.asset_code
                      ? formatAssetCodeForDisplay(a.asset_code)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">
                    {a.id}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{a.asset_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {a.purchase_date_bs}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {a.depreciation_start_date_bs}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {a.purchase_qty ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {formatDepreciationBasis(a)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatGroupSubgroup(a)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{a.working_status}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {a.allocation_branch_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {a.allocation_department_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatAllocationTypeLabel(a.allocation_type)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {a.allocation_date_bs ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-800/20 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 shadow-sm hover:bg-emerald-50 disabled:opacity-50"
                      disabled={
                        lookupsLoading ||
                        a.working_status.trim() === "Retired"
                      }
                      onClick={() => setTransferTarget(a)}
                    >
                      Add new
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data != null && data.total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-600">
          <p>
            Showing {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="tabular-nums">
              Page {data.page} / {totalPages}
            </span>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <dialog
        ref={transferDialogRef}
        className="w-[min(100%,28rem)] rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
        onClose={() => setTransferTarget(null)}
      >
        <form onSubmit={submitTransfer} className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              New allocation (transfer)
            </h3>
            {transferTarget != null && (
              <p className="mt-1 text-sm text-slate-600">
                Asset:{" "}
                <span className="font-medium text-slate-800">
                  {transferTarget.asset_name}
                </span>{" "}
                (ID {transferTarget.id})
              </p>
            )}
          </div>

          <fieldset className="space-y-3 border-0 p-0">
            <legend className="sr-only">Transfer details</legend>
            <label className="block text-sm font-medium text-slate-700">
              Allocation type
              <input
                type="text"
                readOnly
                value="Transfer"
                className={`${inputClass} bg-slate-50 text-slate-600`}
              />
            </label>
            <div>
              <span className="text-sm font-medium text-slate-700">
                Allocation date (Bikram Sambat)
              </span>
              <p className="mt-0.5 text-xs text-slate-500">
                Must be on or after the asset purchase date.
              </p>
              <div className="relative mt-1 w-full max-w-md">
                <div className="pointer-events-none absolute inset-0 z-0 flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm tabular-nums">
                  {allocationDateBs ? (
                    allocationDateBs
                  ) : (
                    <span className="text-slate-400">Click to select date</span>
                  )}
                </div>
                {allocationDatePickerReady ? (
                  <NepaliDatePicker
                    value={bsDateToPickerValue(allocationDateBs)}
                    onChange={(value) =>
                      setAllocationDateBs(normalizeBsDateEnglish(value))
                    }
                    inputClassName={`${inputClass.replace("mt-1 ", "")} relative z-10 cursor-pointer border-transparent bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent`}
                    className="w-full"
                    options={{
                      calenderLocale: "ne",
                      valueLocale: "en",
                      closeOnSelect: true,
                    }}
                  />
                ) : (
                  <div className={`${inputClass} relative z-10 bg-transparent`}>
                    …
                  </div>
                )}
              </div>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Branch
              <select
                required
                value={transferBranchId === "" ? "" : String(transferBranchId)}
                onChange={(e) =>
                  setTransferBranchId(
                    e.target.value === ""
                      ? ""
                      : Number.parseInt(e.target.value, 10)
                  )
                }
                className={inputClass}
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Department (optional)
              <select
                value={
                  transferDepartmentId === ""
                    ? ""
                    : String(transferDepartmentId)
                }
                onChange={(e) =>
                  setTransferDepartmentId(
                    e.target.value === ""
                      ? ""
                      : Number.parseInt(e.target.value, 10)
                  )
                }
                className={inputClass}
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {transferError != null && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {transferError}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => transferDialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={transferSubmitting || transferTarget == null}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-900 disabled:opacity-50"
            >
              {transferSubmitting ? "Saving…" : "Save transfer"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
