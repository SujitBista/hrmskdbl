"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import {
  isLegacyMultiUnitQty,
  perUnitBookValue,
  perUnitPurchaseAmount,
  perUnitQtyDisplay,
  perUnitRateDisplay,
} from "@/lib/asset-register-per-unit";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";
import { formatAdminDateTime } from "@/lib/format-datetime";
import { AssetRegisterEditDialog } from "./asset-register-edit-dialog";
import type { AssetDisposal, AssetRegisterRow } from "./asset-register-types";
import { normalizeBsDateEnglish } from "@/lib/bs-date-english";

type ListResponse = {
  assets: AssetRegisterRow[];
  total: number;
  page: number;
  pageSize: number;
};

type GroupOption = { id: number; name: string; code?: string };
type SubGroupRow = {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
};
type BranchOption = {
  id: number;
  branch_code: string;
  branch_name: string;
};

type DepartmentOption = { id: number; name: string };

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;
const COL_COUNT = 19;
const DISPOSAL_TYPES = [
  "SOLD",
  "SCRAPPED",
  "LOST",
  "WRITTEN_OFF",
  "DONATED",
] as const;

function formatPurchaseAmount(
  qty: string | null,
  rate: string | null
): string {
  const amount = perUnitPurchaseAmount(qty, rate);
  if (amount == null) return "—";
  return formatMoney(amount);
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMoneyText(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw).trim();
  return formatMoney(n);
}

function gainLossLabel(a: AssetRegisterRow): string {
  const profit = Number.parseFloat(a.profit_amount ?? "");
  if (Number.isFinite(profit) && profit > 0) {
    return `Profit ${formatMoney(profit)}`;
  }
  const loss = Number.parseFloat(a.loss_amount ?? "");
  if (Number.isFinite(loss) && loss > 0) {
    return `Loss ${formatMoney(loss)}`;
  }
  return a.asset_status === "DISPOSED" ? "No gain/loss" : "—";
}

export function DisposalDialog({
  asset,
  onClose,
  onDisposed,
}: {
  asset: AssetRegisterRow | null;
  onClose: () => void;
  onDisposed: () => void;
}) {
  const [disposalDateBs, setDisposalDateBs] = useState("");
  const [disposalType, setDisposalType] =
    useState<(typeof DISPOSAL_TYPES)[number]>("SOLD");
  const [disposalAmount, setDisposalAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AssetDisposal | null>(null);

  useEffect(() => {
    if (!asset) {
      setSaved(null);
      setError(null);
      return;
    }
    setDisposalDateBs("");
    setDisposalType("SOLD");
    setDisposalAmount("");
    setReferenceNo("");
    setNotes("");
    setError(null);
    setSaved(null);
  }, [asset]);

  if (!asset) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!asset) return;
    setSubmitting(true);
    setError(null);
    const dateNorm = normalizeBsDateEnglish(disposalDateBs);
    if (!dateNorm) {
      setError("Disposal date is required.");
      setSubmitting(false);
      return;
    }
    const amount = Number(disposalAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Disposal amount must be zero or greater.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`/api/admin/assets/${asset.id}/disposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disposal_date_bs: dateNorm,
          disposal_type: disposalType,
          disposal_amount: amount,
          reference_no: referenceNo.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        disposal?: AssetDisposal;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not dispose asset.");
        return;
      }
      setSaved(json.disposal ?? null);
      onDisposed();
    } catch {
      setError("Could not dispose asset.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      open
      className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={(e) => void submit(e)} className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Dispose Asset
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {asset.asset_name}{" "}
              <span className="font-mono text-xs">
                {formatAssetCodeForDisplay(asset.asset_code)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
          >
            Close
          </button>
        </div>

        {saved ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <p className="font-medium">Disposal saved.</p>
            <p className="mt-1">
              NBV {formatMoneyText(saved.net_book_value_at_disposal)} · Profit{" "}
              {formatMoneyText(saved.profit_amount)} · Loss{" "}
              {formatMoneyText(saved.loss_amount)}
            </p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Disposal Date (BS)</span>
            <input
              value={disposalDateBs}
              onChange={(e) => setDisposalDateBs(e.target.value)}
              placeholder="YYYY/MM/DD"
              disabled={submitting || saved != null}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Disposal Type</span>
            <select
              value={disposalType}
              onChange={(e) =>
                setDisposalType(e.target.value as (typeof DISPOSAL_TYPES)[number])
              }
              disabled={submitting || saved != null}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
            >
              {DISPOSAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Disposal Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={disposalAmount}
              onChange={(e) => setDisposalAmount(e.target.value)}
              disabled={submitting || saved != null}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Reference No</span>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              disabled={submitting || saved != null}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting || saved != null}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
            />
          </label>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            {saved ? "Done" : "Cancel"}
          </button>
          {!saved ? (
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Disposing…" : "Dispose Asset"}
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}

/** Same basis order as depreciation runs: register book value → purchase → legacy old book. */
function formatDepreciationBasis(a: AssetRegisterRow): string {
  const amount = perUnitBookValue({
    purchaseQty: a.purchase_qty,
    bookValue: a.book_value,
    oldBookValue: a.old_book_value,
    unitRate: a.unit_rate,
  });
  if (amount == null) return "—";
  return formatMoney(amount);
}

export function AssetRegisterAssetsTable({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const tableId = useId();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [assetStatusFilter, setAssetStatusFilter] = useState<
    "ACTIVE" | "DISPOSED" | "ALL"
  >("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [subGroups, setSubGroups] = useState<SubGroupRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<AssetRegisterRow | null>(
    null
  );
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetRegisterRow | null>(null);
  const [disposeTarget, setDisposeTarget] = useState<AssetRegisterRow | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadLookups() {
      setLookupsLoading(true);
      try {
        const [gRes, sgRes, bRes, dRes] = await Promise.all([
          fetch(`/api/admin/groups?page=1&pageSize=100`),
          fetch(`/api/admin/sub-groups?page=1&pageSize=100`),
          fetch(`/api/admin/branches?page=1&pageSize=100`),
          fetch(`/api/admin/departments?page=1&pageSize=100`),
        ]);
        const gJson = (await gRes.json()) as {
          groups?: GroupOption[];
          error?: string;
        };
        const sgJson = (await sgRes.json()) as {
          subGroups?: SubGroupRow[];
          error?: string;
        };
        const bJson = (await bRes.json()) as {
          branches?: BranchOption[];
          error?: string;
        };
        const dJson = (await dRes.json()) as {
          departments?: DepartmentOption[];
          error?: string;
        };
        if (!cancelled) {
          setGroups(gRes.ok ? (gJson.groups ?? []) : []);
          setSubGroups(sgRes.ok ? (sgJson.subGroups ?? []) : []);
          setBranches(bRes.ok ? (bJson.branches ?? []) : []);
          setDepartments(dRes.ok ? (dJson.departments ?? []) : []);
        }
      } catch {
        if (!cancelled) {
          setGroups([]);
          setSubGroups([]);
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
      params.set("assetStatus", assetStatusFilter);
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
  }, [page, pageSize, debouncedSearch, assetStatusFilter]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/assets/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.status === 204) {
        setDeleteTarget(null);
        await load();
        return;
      }
      const json = (await res.json()) as { error?: string };
      setActionError(json.error ?? "Could not delete asset.");
    } catch {
      setActionError("Something went wrong.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

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
        <div className="flex w-full flex-col gap-3 sm:max-w-xl sm:flex-row sm:items-end">
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
          <div className="w-full sm:max-w-[12rem]">
            <label
              htmlFor={`${tableId}-asset-status`}
              className="block text-sm font-medium text-slate-700"
            >
              Asset filter
            </label>
            <select
              id={`${tableId}-asset-status`}
              value={assetStatusFilter}
              onChange={(e) => {
                setAssetStatusFilter(
                  e.target.value as "ACTIVE" | "DISPOSED" | "ALL"
                );
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            >
              <option value="ALL">All Assets</option>
              <option value="ACTIVE">Active Assets</option>
              <option value="DISPOSED">Disposed Assets</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1400px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap tabular-nums"
              >
                Asset Id
              </th>
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
                Working status
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Department
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Purchase (BS)
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap"
                title="Used for depreciation schedules"
              >
                Dep. start (BS)
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
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap text-right"
              >
                Purchase amount
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap text-right"
                title="Carrying amount used for depreciation (register book value when set, else purchase amount)"
              >
                Depreciation base
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap"
                title="From asset group"
              >
                Dep. method
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Disposal gain/loss
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Saved
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
              assets.map((a) => {
                return (
                  <tr key={a.id} className="bg-white hover:bg-slate-50/80">
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                      {a.id}
                    </td>
                    <td className="max-w-[200px] px-4 py-3 font-mono text-xs text-slate-900 break-all">
                      {formatAssetCodeForDisplay(a.asset_code)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {a.asset_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {a.group_code
                        ? `${a.group_code} — ${a.group_name}`
                        : a.group_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {a.sub_group_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatBranchOptionLabel({
                        branch_code: a.branch_code,
                        branch_name: a.branch_name,
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {a.ownership_type}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {a.asset_status === "DISPOSED" ? (
                        <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                          {a.working_status}
                        </span>
                      ) : (
                        a.working_status
                      )}
                      {a.disposal_date_bs ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {a.disposal_type?.replace(/_/g, " ")} ·{" "}
                          {a.disposal_date_bs}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {a.department_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                      {a.purchase_date_bs}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                      {a.depreciation_start_date_bs ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      <div>{perUnitQtyDisplay(a.purchase_qty)}</div>
                      {isLegacyMultiUnitQty(a.purchase_qty) ? (
                        <div className="text-xs text-amber-700">
                          stored qty {a.purchase_qty}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {perUnitRateDisplay(a.purchase_qty, a.unit_rate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatPurchaseAmount(a.purchase_qty, a.unit_rate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatDepreciationBasis(a)}
                    </td>
                    <td className="max-w-[140px] px-4 py-3 whitespace-normal text-slate-700">
                      {a.group_dep_method?.trim() ? a.group_dep_method : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {gainLossLabel(a)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {formatAdminDateTime(a.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditTarget(a)}
                          disabled={a.asset_status === "DISPOSED"}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        {a.asset_status === "ACTIVE" ? (
                          <button
                            type="button"
                            onClick={() => setDisposeTarget(a)}
                            className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                          >
                            Dispose
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(a)}
                          disabled={a.asset_status === "DISPOSED"}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
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

      <dialog
        ref={deleteDialogRef}
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setDeleteTarget(null)}
      >
        <div className="p-6">
          <h3 className="text-base font-semibold text-slate-900">
            Delete asset?
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Are you sure you want to delete{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget
                ? deleteTarget.asset_name
                : ""}
            </span>
            {deleteTarget?.asset_code ? (
              <>
                {" "}
                <span className="font-mono text-xs text-slate-700">
                  ({formatAssetCodeForDisplay(deleteTarget.asset_code)})
                </span>
              </>
            ) : null}
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

      <AssetRegisterEditDialog
        asset={editTarget}
        groups={groups}
        subGroups={subGroups}
        branches={branches}
        departments={departments}
        lookupsBusy={lookupsLoading}
        onClose={() => setEditTarget(null)}
        onSaved={() => void load()}
      />
      <DisposalDialog
        asset={disposeTarget}
        onClose={() => setDisposeTarget(null)}
        onDisposed={() => void load()}
      />
    </section>
  );
}
