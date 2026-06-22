"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DepreciationRunListRow } from "./depreciation-master-screen";
import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import { normalizeBsDateEnglish } from "@/lib/bs-date-english";
import { compareBsDateString } from "@hrmskdbl/depreciation-core";

function formatFiscalYearLabel(start: number): string {
  const y2 = String(start + 1).slice(-2);
  return `${start}/${y2}`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type DetailRow = {
  id: number;
  depreciation_run_id: number;
  asset_id: number;
  asset_code: string | null;
  asset_status: "ACTIVE" | "DISPOSED";
  disposal_date_bs: string | null;
  asset_name: string;
  fiscal_year: number;
  purchase_date_bs: string;
  actual_purchase_price: string;
  depreciation_cost_basis: string;
  dep_rate: string;
  dep_days: number;
  dep_amount: string;
  group_name: string;
  sub_group_name: string | null;
  branch_name: string;
  book_value: string;
  accumulate_dep: string;
  dep_formula: string;
  dep_start_date_bs: string;
  /** Current authoritative depreciation start date from asset register (live). */
  register_depreciation_start_bs?: string;
  balance_amount: string;
  created_at: string;
};

type DetailsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function formatAmount(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Plain two-decimal string for CSV (no locale thousands separators). */
function formatCsvDecimal(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return typeof value === "string" ? value : "";
  return n.toFixed(2);
}

/** ERP `TotalDepAmount` = depreciation base minus closing WDV (matches register export). */
function formatTotalDepAmount(d: DetailRow): string {
  const basis = Number.parseFloat(d.depreciation_cost_basis);
  const closing = Number.parseFloat(d.balance_amount);
  if (!Number.isFinite(basis) || !Number.isFinite(closing)) return "—";
  return formatAmount(String(basis - closing));
}

function formatCsvTotalDepAmount(d: DetailRow): string {
  const basis = Number.parseFloat(d.depreciation_cost_basis);
  const closing = Number.parseFloat(d.balance_amount);
  if (!Number.isFinite(basis) || !Number.isFinite(closing)) return "";
  return formatCsvDecimal(basis - closing);
}

const DEPRECIATION_HUB =
  "/admin/dashboard/asset-register/depreciation";
const DEPRECIATION_AUTORELOAD_AFTER_ASSET_EDIT_KEY =
  "hrmskdbl_depreciation_autoreload_after_asset_edit";

function snapshotStorageKey(runId: number): string {
  return `hrmskdbl_depreciation_detail_snapshot_${runId}`;
}

function isAsOfDateStale(
  run: DepreciationRunListRow,
  todayBs: string | null
): boolean {
  if ((run.depreciation_scope_mode ?? "FY_END") !== "AS_OF_DATE") {
    return false;
  }
  const saved = normalizeBsDateEnglish(run.calculation_date_bs);
  if (!saved || !todayBs) return false;
  return compareBsDateString(saved, todayBs) < 0;
}

export function DepreciationRunDetailScreen() {
  const router = useRouter();
  const params = useParams();
  const runIdRaw = params.runId;
  const runId =
    typeof runIdRaw === "string"
      ? Number.parseInt(runIdRaw, 10)
      : Array.isArray(runIdRaw)
        ? Number.parseInt(runIdRaw[0] ?? "", 10)
        : NaN;

  const [run, setRun] = useState<DepreciationRunListRow | null>(null);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pagination, setPagination] = useState<DetailsPagination>({
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skippedNotice, setSkippedNotice] = useState<
    { asset_id: number; asset_name: string; reason: string }[] | null
  >(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [todayBs, setTodayBs] = useState<string | null>(null);
  const [snapshotPinned, setSnapshotPinned] = useState(false);
  const autoRecalcAttemptedRef = useRef(false);

  useEffect(() => {
    autoRecalcAttemptedRef.current = false;
  }, [runId]);

  useEffect(() => {
    setPage(1);
  }, [runId]);

  const load = useCallback(async () => {
    if (!Number.isFinite(runId) || runId < 1) {
      setError("Invalid run.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let endLoading = true;
    try {
      const searchParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/admin/depreciation-runs/${runId}?${searchParams.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const json = (await res.json()) as {
        run?: DepreciationRunListRow;
        details?: DetailRow[];
        pagination?: DetailsPagination;
        todayBs?: string | null;
        error?: string;
      };
      if (res.status === 404) {
        // FY runs are replaced on recalculation; old bookmarked IDs disappear.
        endLoading = false;
        router.replace(DEPRECIATION_HUB);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Could not load run.");
        setRun(null);
        setDetails([]);
        setPagination({
          page,
          pageSize,
          total: 0,
          totalPages: 1,
        });
        return;
      }
      setRun(json.run ?? null);
      setDetails(json.details ?? []);
      const serverPagination = json.pagination;
      setPagination({
        page: serverPagination?.page ?? page,
        pageSize: serverPagination?.pageSize ?? pageSize,
        total: serverPagination?.total ?? 0,
        totalPages: Math.max(1, serverPagination?.totalPages ?? 1),
      });
      const tb = json.todayBs;
      setTodayBs(
        typeof tb === "string" && tb.trim()
          ? normalizeBsDateEnglish(tb)
          : null
      );
    } catch {
      setError("Could not load run.");
      setRun(null);
      setDetails([]);
      setPagination({
        page,
        pageSize,
        total: 0,
        totalPages: 1,
      });
    } finally {
      if (endLoading) {
        setLoading(false);
      }
    }
  }, [runId, router, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!Number.isFinite(runId) || runId < 1) return;
    if (typeof window === "undefined") return;

    const maybeReloadAfterEdit = () => {
      const shouldReload =
        sessionStorage.getItem(DEPRECIATION_AUTORELOAD_AFTER_ASSET_EDIT_KEY) ===
        "1";
      if (!shouldReload || refreshBusy) return;
      sessionStorage.removeItem(DEPRECIATION_AUTORELOAD_AFTER_ASSET_EDIT_KEY);
      void load();
    };

    maybeReloadAfterEdit();
    window.addEventListener("focus", maybeReloadAfterEdit);
    return () => {
      window.removeEventListener("focus", maybeReloadAfterEdit);
    };
  }, [runId, load, refreshBusy]);

  useEffect(() => {
    if (!Number.isFinite(runId) || runId < 1) return;
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    let pinned = sessionStorage.getItem(snapshotStorageKey(runId)) === "1";
    if (sp.get("snapshot") === "1" || sp.get("historical") === "1") {
      sessionStorage.setItem(snapshotStorageKey(runId), "1");
      pinned = true;
    }
    setSnapshotPinned(pinned);
  }, [runId]);

  const refreshFromRegister = useCallback(
    async (opts?: { advanceCalculationDateToTodayBs?: boolean }) => {
      if (!Number.isFinite(runId) || runId < 1) return;
      setRefreshBusy(true);
      setRefreshError(null);
      try {
        const advanceCalculationDateToTodayBs =
          opts?.advanceCalculationDateToTodayBs === true;
        const res = await fetch(
          `/api/admin/depreciation-runs/${runId}/refresh-details`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ advanceCalculationDateToTodayBs }),
          }
        );
        const json = (await res.json()) as {
          error?: string;
          redirectToRunId?: number;
          skippedAssets?: {
            asset_id: number;
            asset_name: string;
            reason: string;
          }[];
        };
        if (!res.ok) {
          setRefreshError(json.error ?? "Could not recalculate from register.");
          return;
        }
        if (
          typeof json.redirectToRunId === "number" &&
          Number.isFinite(json.redirectToRunId) &&
          json.redirectToRunId >= 1 &&
          json.redirectToRunId !== runId
        ) {
          router.replace(
            `/admin/dashboard/asset-register/depreciation/${json.redirectToRunId}`
          );
          return;
        }
        if (json.skippedAssets && json.skippedAssets.length > 0) {
          setSkippedNotice(json.skippedAssets);
        }
        await load();
      } catch {
        setRefreshError("Could not recalculate from register.");
      } finally {
        setRefreshBusy(false);
      }
    },
    [runId, load, router]
  );

  const asOfStale =
    run != null && todayBs != null && isAsOfDateStale(run, todayBs);
  const savedBsNormalized =
    run != null ? normalizeBsDateEnglish(run.calculation_date_bs) : "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!run || loading || refreshBusy) return;
    if (!todayBs || !asOfStale || snapshotPinned) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("autorecalc") !== "1") return;
    if (autoRecalcAttemptedRef.current) return;
    autoRecalcAttemptedRef.current = true;
    void refreshFromRegister({ advanceCalculationDateToTodayBs: true });
  }, [
    run,
    loading,
    refreshBusy,
    todayBs,
    asOfStale,
    snapshotPinned,
    refreshFromRegister,
  ]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("hrmskdbl_depreciation_skipped");
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setSkippedNotice(
        parsed as { asset_id: number; asset_name: string; reason: string }[]
      );
      sessionStorage.removeItem("hrmskdbl_depreciation_skipped");
    } catch {
      /* ignore */
    }
  }, []);

  async function exportDetails() {
    if (!run) return;
    setExportBusy(true);
    const modeLine =
      (run.depreciation_scope_mode ?? "FY_END") === "AS_OF_DATE"
        ? `Calculation mode: AS_OF_DATE; through calculation date ${run.calculation_date_bs} (BS) (capped at fiscal year end).`
        : `Calculation mode: FY_END; through fiscal quarter end (Q${run.quarter_no}) / fiscal year end.`;
    const header = [
      "FiscalYear",
      "AssetCode",
      "Group",
      "PurchaseDate",
      "PurchasePrice",
      "DepreciationCostBasis",
      "RegisterDepStartBS",
      "DepCommencementBS",
      "DepRate",
      "DepDays",
      "DepAmount",
      "AccumulateDep",
      "BookValue",
      "TotalDepAmount",
      "ClosingBookValue",
    ].join(",");
    try {
      const exportPageSize = 500;
      const firstRes = await fetch(
        `/api/admin/depreciation-runs/${runId}?page=1&pageSize=${exportPageSize}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        }
      );
      const firstJson = (await firstRes.json()) as {
        details?: DetailRow[];
        pagination?: DetailsPagination;
        error?: string;
      };
      if (!firstRes.ok) {
        setRefreshError(firstJson.error ?? "Could not export details.");
        return;
      }
      const totalPages = Math.max(1, firstJson.pagination?.totalPages ?? 1);
      const allDetails: DetailRow[] = [...(firstJson.details ?? [])];

      for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
        const res = await fetch(
          `/api/admin/depreciation-runs/${runId}?page=${currentPage}&pageSize=${exportPageSize}`,
          {
            cache: "no-store",
            credentials: "same-origin",
          }
        );
        const json = (await res.json()) as { details?: DetailRow[]; error?: string };
        if (!res.ok) {
          setRefreshError(json.error ?? "Could not export details.");
          return;
        }
        allDetails.push(...(json.details ?? []));
      }

      const lines = allDetails.map((d) =>
        [
          formatFiscalYearLabel(d.fiscal_year),
          `"${formatAssetCodeForDisplay(d.asset_code).replace(/"/g, '""')}"`,
          `"${d.group_name.replace(/"/g, '""')}"`,
          d.purchase_date_bs,
          formatCsvDecimal(d.actual_purchase_price),
          formatCsvDecimal(d.depreciation_cost_basis),
          d.register_depreciation_start_bs ?? "",
          d.dep_start_date_bs,
          formatCsvDecimal(d.dep_rate),
          d.dep_days,
          formatCsvDecimal(d.dep_amount),
          formatCsvDecimal(d.accumulate_dep),
          formatCsvDecimal(d.book_value),
          formatCsvTotalDepAmount(d),
          formatCsvDecimal(d.balance_amount),
        ].join(",")
      );
      downloadCsv(
        `depreciation-run-${run.id}-details.csv`,
        [`"${modeLine.replace(/"/g, '""')}"`, header, ...lines].join("\n")
      );
    } catch {
      setRefreshError("Could not export details.");
    } finally {
      setExportBusy(false);
    }
  }

  if (!Number.isFinite(runId) || runId < 1) {
    return <p className="text-sm text-red-600">Invalid depreciation run.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <FixedAssetSectionTabs />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {run ? (
            <h2 className="text-lg font-semibold text-slate-900">
              {(run.depreciation_scope_mode ?? "FY_END") === "AS_OF_DATE" ? (
                <>
                  Depreciation Details (As of{" "}
                  <span className="font-mono text-slate-800">
                    {run.calculation_date_bs}
                  </span>
                  )
                </>
              ) : (
                <>
                  Depreciation Details{" "}
                  <span className="text-slate-600">
                    ({formatFiscalYearLabel(run.fiscal_year_start)})
                  </span>
                </>
              )}
            </h2>
          ) : (
            <h2 className="text-lg font-semibold text-slate-900">Depreciation Details</h2>
          )}
          {run ? (
            <p className="mt-1 text-sm text-slate-600">
              Run #{run.id} · Calculation{" "}
              <span className="font-mono">{run.calculation_date_bs}</span> (BS) ·
              Calculation mode:{" "}
              {(run.depreciation_scope_mode ?? "FY_END") === "AS_OF_DATE"
                ? "As of date (amounts through calculation date)"
                : "Full fiscal year (through quarter / fiscal year end)"}
              {(run.depreciation_scope_mode ?? "FY_END") === "FY_END" ? (
                <>
                  {" "}
                  · Final for FY: {run.is_final_for_fy ? "Yes" : "No"}
                </>
              ) : null}
              <span className="block pt-1 text-slate-500">
                {(run.depreciation_scope_mode ?? "FY_END") === "AS_OF_DATE" ? (
                  <>
                    DepDays = inclusive calendar days from FY Shrawan 1 (or
                    depreciation start, if later) through the calculation date
                    (capped at fiscal year end). Column names follow the ERP assets
                    register: DepAmount / ThisYearDep = fiscal-year depreciation
                    through that date; AccumulateDep = prior accumulated only (before
                    that slice); BookValue = opening WDV after prior dep; TotalDepAmount
                    = prior + this slice; ClosingBookValue = base minus TotalDepAmount.
                  </>
                ) : (
                  <>
                    DepDays = inclusive calendar days from FY Shrawan 1 (or
                    depreciation start, if later) through the selected quarter end.
                    AccumulateDep, BookValue, TotalDepAmount, and ClosingBookValue match
                    the ERP assets register export (e.g. AccumulateDep is opening
                    accumulated, not including the current DepAmount).
                  </>
                )}
              </span>
              <span className="block pt-2 text-slate-500">
                <strong className="font-medium text-slate-600">Register dep. start</strong>{" "}
                is the authoritative depreciation start date from the asset register.
                Recalculation uses this value for depreciation amount, prior
                accumulated (AccumulateDep), opening book value, and closing value.
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            className="self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={!run || pagination.total === 0 || exportBusy}
            onClick={() => {
              void exportDetails();
            }}
          >
            {exportBusy ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {refreshError ? (
        <p className="text-sm text-red-600">{refreshError}</p>
      ) : null}

      {run && asOfStale && snapshotPinned ? (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          role="status"
        >
          <p>
            Historical as-of snapshot: this report is through{" "}
            <span className="font-mono">{savedBsNormalized}</span> (BS).{" "}
            <span className="text-slate-600">
              Recalculate refreshes asset register fields but keeps this as-of
              date.
            </span>
          </p>
        </div>
      ) : null}

      {run && asOfStale && !snapshotPinned ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950"
          role="status"
        >
          <p>
            This report is as of{" "}
            <span className="font-mono">{savedBsNormalized}</span>. It refreshes
            automatically after register date edits.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-transparent px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
              disabled={refreshBusy}
              onClick={() => {
                sessionStorage.setItem(snapshotStorageKey(runId), "1");
                setSnapshotPinned(true);
              }}
            >
              Keep this as-of date (snapshot)
            </button>
          </div>
        </div>
      ) : null}

      {skippedNotice && skippedNotice.length > 0 ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          <p className="font-medium">
            {skippedNotice.length} asset(s) were not included in this run
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {skippedNotice.map((s) => (
              <li key={s.asset_id}>
                <span className="font-mono text-xs">#{s.asset_id}</span>{" "}
                {s.asset_name}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <p className="text-slate-600">
          Showing{" "}
          <span className="font-medium text-slate-800">
            {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}
          </span>{" "}
          -{" "}
          <span className="font-medium text-slate-800">
            {Math.min(pagination.page * pagination.pageSize, pagination.total)}
          </span>{" "}
          of <span className="font-medium text-slate-800">{pagination.total}</span> rows
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-slate-600" htmlFor="dep-details-page-size">
            Rows per page
          </label>
          <select
            id="dep-details-page-size"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
            value={pageSize}
            disabled={loading}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              setPageSize(Number.isFinite(next) ? next : 100);
              setPage(1);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 disabled:opacity-50"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span className="min-w-[86px] text-center text-slate-700">
            Page {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 disabled:opacity-50"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() =>
              setPage((p) => Math.min(pagination.totalPages, p + 1))
            }
          >
            Next
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-emerald-900/10 bg-white shadow-sm">
        <table className="min-w-[2140px] w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <th className="sticky top-0 z-30 w-[320px] min-w-[320px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Asset Code
              </th>
              <th className="sticky top-0 z-30 w-[180px] min-w-[180px] whitespace-nowrap border border-slate-300 border-r-slate-400 bg-slate-100 px-2 py-2">
                Group
              </th>
              <th className="sticky top-0 z-30 w-[280px] min-w-[280px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Asset Name
              </th>
              <th className="sticky top-0 z-30 w-[120px] min-w-[120px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Status
              </th>
              <th className="sticky top-0 z-30 w-[150px] min-w-[150px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                Purchase Price
              </th>
              <th className="sticky top-0 z-30 w-[170px] min-w-[170px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                Depreciation Base
              </th>
              <th className="sticky top-0 z-30 w-[170px] min-w-[170px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                DepAmount (ThisYearDep)
              </th>
              <th className="sticky top-0 z-30 w-[160px] min-w-[160px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                AccumulateDep
              </th>
              <th className="sticky top-0 z-30 w-[150px] min-w-[150px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                BookValue
              </th>
              <th className="sticky top-0 z-30 w-[150px] min-w-[150px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                TotalDepAmount
              </th>
              <th className="sticky top-0 z-30 w-[110px] min-w-[110px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                Dep Rate
              </th>
              <th className="sticky top-0 z-30 w-[100px] min-w-[100px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2 text-right">
                Dep Days
              </th>
              <th className="sticky top-0 z-30 w-[120px] min-w-[120px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Fiscal Year
              </th>
              <th className="sticky top-0 z-30 w-[130px] min-w-[130px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Purchase Date
              </th>
              <th className="sticky top-0 z-30 w-[180px] min-w-[180px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Register dep. start (BS)
              </th>
              <th className="sticky top-0 z-30 w-[190px] min-w-[190px] whitespace-nowrap border border-slate-300 bg-slate-100 px-2 py-2">
                Depreciation Start (BS)
              </th>
              <th className="sticky right-0 top-0 z-40 w-[160px] min-w-[160px] whitespace-nowrap border border-slate-300 bg-white px-2 py-2 text-right shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.28)]">
                ClosingBookValue
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={17}
                  className="border border-slate-300 px-3 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : details.length === 0 ? (
              <tr>
                <td
                  colSpan={17}
                  className="border border-slate-300 px-3 py-8 text-center text-slate-500"
                >
                  No detail rows.
                </td>
              </tr>
            ) : (
              details.map((d) => (
                <tr
                  key={d.id}
                  className="bg-white odd:bg-slate-50/60 hover:bg-emerald-50/40"
                >
                  <td
                    className="w-[320px] min-w-[320px] whitespace-nowrap border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800"
                    title={formatAssetCodeForDisplay(d.asset_code)}
                  >
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {formatAssetCodeForDisplay(d.asset_code)}
                    </span>
                  </td>
                  <td
                    className="w-[180px] min-w-[180px] whitespace-nowrap border border-slate-300 border-r-slate-400 px-2 py-1.5 text-slate-700"
                    title={d.group_name}
                  >
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {d.group_name}
                    </span>
                  </td>
                  <td
                    className="w-[280px] min-w-[280px] whitespace-nowrap border border-slate-300 px-2 py-1.5 text-slate-700"
                    title={d.asset_name}
                  >
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {d.asset_name}
                    </span>
                  </td>
                  <td className="w-[120px] min-w-[120px] whitespace-nowrap border border-slate-300 px-2 py-1.5 text-xs">
                    {d.asset_status === "DISPOSED" ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700 ring-1 ring-red-200">
                        DISPOSED
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        ACTIVE
                      </span>
                    )}
                    {d.disposal_date_bs ? (
                      <div className="mt-1 font-mono text-[11px] text-slate-500">
                        {d.disposal_date_bs}
                      </div>
                    ) : null}
                  </td>
                  <td className="w-[150px] min-w-[150px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.actual_purchase_price)}
                  </td>
                  <td className="w-[170px] min-w-[170px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.depreciation_cost_basis)}
                  </td>
                  <td className="w-[170px] min-w-[170px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.dep_amount)}
                  </td>
                  <td className="w-[160px] min-w-[160px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.accumulate_dep)}
                  </td>
                  <td className="w-[150px] min-w-[150px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.book_value)}
                  </td>
                  <td className="w-[150px] min-w-[150px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatTotalDepAmount(d)}
                  </td>
                  <td className="w-[110px] min-w-[110px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {d.dep_rate}%
                  </td>
                  <td className="w-[100px] min-w-[100px] border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {d.dep_days}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 whitespace-nowrap text-slate-800">
                    {formatFiscalYearLabel(d.fiscal_year)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800">
                    {d.purchase_date_bs}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800">
                    {d.register_depreciation_start_bs ?? "—"}
                  </td>
                  <td
                    className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800"
                    title="Depreciation start date used for this report calculation."
                  >
                    {d.dep_start_date_bs}
                  </td>
                  <td className="sticky right-0 z-20 w-[160px] min-w-[160px] whitespace-nowrap border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-xs tabular-nums font-semibold text-emerald-900 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.28)]">
                    {formatAmount(d.balance_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
