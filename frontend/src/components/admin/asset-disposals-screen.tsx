"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DisposalDialog,
} from "@/components/admin/asset-register-assets-table";
import { BulkDisposalDialog } from "@/components/admin/bulk-disposal-dialog";
import type { AssetDisposal, AssetRegisterRow } from "./asset-register-types";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import { formatAdminDateTime } from "@/lib/format-datetime";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";

type AssetListResponse = {
  assets?: AssetRegisterRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

type DisposalListResponse = {
  disposals?: AssetDisposal[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMoneyText(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "-";
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw).trim();
  return formatMoney(n);
}

function formatDepreciationBasis(a: AssetRegisterRow): string {
  const bookValue = Number.parseFloat(a.book_value ?? "");
  if (Number.isFinite(bookValue) && bookValue > 0) {
    return formatMoney(bookValue);
  }
  const qty = Number.parseFloat(a.purchase_qty ?? "");
  const rate = Number.parseFloat(a.unit_rate ?? "");
  if (Number.isFinite(qty) && Number.isFinite(rate) && qty > 0 && rate >= 0) {
    return formatMoney(qty * rate);
  }
  const oldBookValue = Number.parseFloat(a.old_book_value ?? "");
  if (Number.isFinite(oldBookValue) && oldBookValue > 0) {
    return formatMoney(oldBookValue);
  }
  return "-";
}

function disposalGainLossLabel(disposal: AssetDisposal): string {
  const profit = Number.parseFloat(disposal.profit_amount);
  if (Number.isFinite(profit) && profit > 0) {
    return `Profit ${formatMoney(profit)}`;
  }
  const loss = Number.parseFloat(disposal.loss_amount);
  if (Number.isFinite(loss) && loss > 0) {
    return `Loss ${formatMoney(loss)}`;
  }
  return "No gain/loss";
}

function PaginationControls({
  page,
  total,
  loading,
  onPageChange,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onPageChange(Math.max(1, page - 1))}
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
        onClick={() => onPageChange(page + 1)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

export function AssetDisposalsScreen() {
  const [activeSearchInput, setActiveSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activePage, setActivePage] = useState(1);
  const [activeLoading, setActiveLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeRows, setActiveRows] = useState<AssetRegisterRow[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);

  const [disposedSearchInput, setDisposedSearchInput] = useState("");
  const [disposedSearch, setDisposedSearch] = useState("");
  const [disposedPage, setDisposedPage] = useState(1);
  const [disposedLoading, setDisposedLoading] = useState(true);
  const [disposedError, setDisposedError] = useState<string | null>(null);
  const [disposedRows, setDisposedRows] = useState<AssetDisposal[]>([]);
  const [disposedTotal, setDisposedTotal] = useState(0);

  const [disposeTarget, setDisposeTarget] = useState<AssetRegisterRow | null>(
    null
  );
  const [selectedById, setSelectedById] = useState<
    Map<number, AssetRegisterRow>
  >(() => new Map());
  const [bulkDisposeOpen, setBulkDisposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setActiveSearch(activeSearchInput.trim());
      setActivePage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [activeSearchInput]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDisposedSearch(disposedSearchInput.trim());
      setDisposedPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [disposedSearchInput]);

  const loadActiveAssets = useCallback(async () => {
    setActiveLoading(true);
    setActiveError(null);
    try {
      const params = new URLSearchParams({
        page: String(activePage),
        pageSize: String(PAGE_SIZE),
        assetStatus: "ACTIVE",
      });
      if (activeSearch) {
        params.set("q", activeSearch);
      }
      const res = await fetch(`/api/admin/assets?${params.toString()}`);
      const json = (await res.json()) as AssetListResponse;
      if (!res.ok) {
        setActiveRows([]);
        setActiveTotal(0);
        setActiveError(json.error ?? "Could not load active assets.");
        return;
      }
      setActiveRows(json.assets ?? []);
      setActiveTotal(json.total ?? 0);
    } catch {
      setActiveRows([]);
      setActiveTotal(0);
      setActiveError("Could not load active assets.");
    } finally {
      setActiveLoading(false);
    }
  }, [activePage, activeSearch]);

  const loadDisposedAssets = useCallback(async () => {
    setDisposedLoading(true);
    setDisposedError(null);
    try {
      const params = new URLSearchParams({
        page: String(disposedPage),
        pageSize: String(PAGE_SIZE),
      });
      if (disposedSearch) {
        params.set("q", disposedSearch);
      }
      const res = await fetch(`/api/admin/assets/disposals?${params.toString()}`);
      const json = (await res.json()) as DisposalListResponse;
      if (!res.ok) {
        setDisposedRows([]);
        setDisposedTotal(0);
        setDisposedError(json.error ?? "Could not load disposed assets.");
        return;
      }
      setDisposedRows(json.disposals ?? []);
      setDisposedTotal(json.total ?? 0);
    } catch {
      setDisposedRows([]);
      setDisposedTotal(0);
      setDisposedError("Could not load disposed assets.");
    } finally {
      setDisposedLoading(false);
    }
  }, [disposedPage, disposedSearch]);

  useEffect(() => {
    void loadActiveAssets();
  }, [loadActiveAssets, refreshKey]);

  useEffect(() => {
    void loadDisposedAssets();
  }, [loadDisposedAssets, refreshKey]);

  useEffect(() => {
    setSelectedById(new Map());
    setBulkDisposeOpen(false);
  }, [activePage, activeSearch]);

  const allOnPageSelected =
    activeRows.length > 0 && activeRows.every((a) => selectedById.has(a.id));
  const selectedAssets = useMemo(
    () => Array.from(selectedById.values()),
    [selectedById]
  );

  function toggleAssetSelection(asset: AssetRegisterRow) {
    setSelectedById((prev) => {
      const next = new Map(prev);
      if (next.has(asset.id)) {
        next.delete(asset.id);
      } else {
        next.set(asset.id, asset);
      }
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedById((prev) => {
      const next = new Map(prev);
      if (allOnPageSelected) {
        for (const a of activeRows) {
          next.delete(a.id);
        }
      } else {
        for (const a of activeRows) {
          next.set(a.id, a);
        }
      }
      return next;
    });
  }

  function refreshAfterDisposal() {
    setRefreshKey((k) => k + 1);
    setDisposedPage(1);
  }

  function handleBulkDisposed(options?: { refreshOnly?: boolean }) {
    refreshAfterDisposal();
    if (options?.refreshOnly) {
      return;
    }
    setSelectedById(new Map());
    setBulkDisposeOpen(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Dispose an active asset
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Search an active asset and open the disposal form from its row.
              Once posted, the asset is marked disposed and appears in the
              history below.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:max-w-md sm:flex-row sm:items-end">
            {selectedById.size > 0 ? (
              <button
                type="button"
                onClick={() => setBulkDisposeOpen(true)}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-800"
              >
                Bulk Dispose ({selectedById.size})
              </button>
            ) : null}
            <div className="w-full sm:max-w-xs">
            <label
              htmlFor="asset-disposal-active-search"
              className="block text-sm font-medium text-slate-700"
            >
              Search active assets
            </label>
            <input
              id="asset-disposal-active-search"
              type="search"
              value={activeSearchInput}
              onChange={(e) => setActiveSearchInput(e.target.value)}
              placeholder="Code, name, group, branch..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            />
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-3 font-medium">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    disabled={activeRows.length === 0}
                    aria-label="Select all active assets on this page"
                    className="h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
                  />
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Asset ID
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Asset code
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Branch
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Purchase (BS)
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Depreciation base
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : activeError ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-red-600"
                    role="alert"
                  >
                    {activeError}
                  </td>
                </tr>
              ) : activeRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {activeSearch
                      ? "No active assets match your search."
                      : "No active assets available for disposal."}
                  </td>
                </tr>
              ) : (
                activeRows.map((asset) => (
                  <tr key={asset.id} className="bg-white hover:bg-slate-50/80">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedById.has(asset.id)}
                        onChange={() => toggleAssetSelection(asset)}
                        aria-label={`Select ${asset.asset_name}`}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800/30"
                      />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {asset.id}
                    </td>
                    <td className="max-w-[220px] break-all px-4 py-3 font-mono text-xs text-slate-900">
                      {formatAssetCodeForDisplay(asset.asset_code)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {asset.asset_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatBranchOptionLabel({
                        branch_code: asset.branch_code,
                        branch_name: asset.branch_name,
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                      {asset.purchase_date_bs}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatDepreciationBasis(asset)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDisposeTarget(asset)}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                      >
                        Dispose
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            {activeTotal === 0
              ? "No rows."
              : `Showing ${(activePage - 1) * PAGE_SIZE + 1}-${Math.min(
                  activePage * PAGE_SIZE,
                  activeTotal
                )} of ${activeTotal}`}
          </p>
          <PaginationControls
            page={activePage}
            total={activeTotal}
            loading={activeLoading}
            onPageChange={setActivePage}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Disposal history
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Posted disposal records with net book value and gain/loss at the
              disposal date.
            </p>
          </div>
          <div className="w-full sm:max-w-xs">
            <label
              htmlFor="asset-disposal-history-search"
              className="block text-sm font-medium text-slate-700"
            >
              Search disposed assets
            </label>
            <input
              id="asset-disposal-history-search"
              type="search"
              value={disposedSearchInput}
              onChange={(e) => setDisposedSearchInput(e.target.value)}
              placeholder="Code, name, type, reference..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            />
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Asset ID
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Asset code
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date (BS)
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  NBV
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Gain/Loss
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Reference
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Saved
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {disposedLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : disposedError ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-8 text-center text-red-600"
                    role="alert"
                  >
                    {disposedError}
                  </td>
                </tr>
              ) : disposedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    {disposedSearch
                      ? "No disposed assets match your search."
                      : "No disposal records yet."}
                  </td>
                </tr>
              ) : (
                disposedRows.map((disposal) => (
                  <tr key={disposal.id} className="bg-white hover:bg-slate-50/80">
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {disposal.asset_id}
                    </td>
                    <td className="max-w-[220px] break-all px-4 py-3 font-mono text-xs text-slate-900">
                      {formatAssetCodeForDisplay(disposal.asset_code)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {disposal.asset_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-700">
                      {disposal.disposal_date_bs}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {disposal.disposal_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatMoneyText(disposal.disposal_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatMoneyText(disposal.net_book_value_at_disposal)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {disposalGainLossLabel(disposal)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {disposal.reference_no ?? "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {formatAdminDateTime(disposal.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            {disposedTotal === 0
              ? "No rows."
              : `Showing ${(disposedPage - 1) * PAGE_SIZE + 1}-${Math.min(
                  disposedPage * PAGE_SIZE,
                  disposedTotal
                )} of ${disposedTotal}`}
          </p>
          <PaginationControls
            page={disposedPage}
            total={disposedTotal}
            loading={disposedLoading}
            onPageChange={setDisposedPage}
          />
        </div>
      </section>

      <DisposalDialog
        asset={disposeTarget}
        onClose={() => setDisposeTarget(null)}
        onDisposed={refreshAfterDisposal}
      />
      <BulkDisposalDialog
        open={bulkDisposeOpen}
        assets={selectedAssets}
        onClose={() => {
          setBulkDisposeOpen(false);
          setSelectedById(new Map());
        }}
        onDisposed={handleBulkDisposed}
      />
    </div>
  );
}
