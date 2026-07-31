"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import {
  DepreciationFyRolloverPanel,
  type DepreciationFyRolloverActionResult,
  type DepreciationFyRolloverStatusView,
} from "./depreciation-fy-rollover-panel";
import {
  buildEmptyRunsSupportingText,
  getQuickAsOfTodayEligibility,
} from "./depreciation-quick-ensure-eligibility";
import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";
import { DepreciationSectionNav } from "./depreciation-section-nav";

const SKIPPED_STORAGE_KEY = "hrmskdbl_depreciation_skipped";

export type DepreciationRunListRow = {
  id: number;
  fiscal_year_start: number;
  dep_title: string;
  quarter_no: number;
  months_covered: number;
  calculation_date_ad: string;
  calculation_date_bs: string;
  depreciation_scope_mode: "FY_END" | "AS_OF_DATE";
  remarks: string | null;
  is_final_for_fy: boolean;
  status: string;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
};

const btnClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "rounded-lg border border-emerald-900/20 bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50";

/** Shared height and flex layout for master-list toolbar controls */
const toolbarBtnBase =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/25 focus-visible:ring-offset-1 disabled:cursor-not-allowed";

const toolbarAddNew = `${toolbarBtnBase} border border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50`;

const toolbarQuick = `${toolbarBtnBase} border border-blue-600 bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50`;

const toolbarExport = `${toolbarBtnBase} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50`;

const toolbarRowAction = `${toolbarBtnBase} border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-300 disabled:border-slate-100 disabled:bg-slate-50/80 disabled:text-slate-400 disabled:shadow-none disabled:opacity-60`;

const toolbarDeleteEnabled = `${toolbarBtnBase} border border-red-300 bg-white text-red-700 hover:bg-red-50 hover:border-red-400 disabled:opacity-50`;

const toolbarDeleteDisabled = `${toolbarBtnBase} border border-slate-200 bg-slate-50 text-slate-400 shadow-none`;

function formatFiscalYearLabel(start: number): string {
  return `${start}-${start + 1}`;
}

/** DD/MM/YYYY for calculation run date (Gregorian). */
function formatAdDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function FilterHeaderIcon({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="sr-only">Filter {label}</span>
      <svg
        className="h-3.5 w-3.5 shrink-0 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path d="M3 4a1 1 0 011-1h12a1 1 0 01.78 1.63l-4.5 5.62V15a1 1 0 01-.4.8l-2 1.5A1 1 0 018 16.5v-4.25L3.22 5.63A1 1 0 013 4z" />
      </svg>
    </span>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
      <path
        fillRule="evenodd"
        d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7 S1.732 14.057 .458 10z M14 10a4 4 0 11-8 0 4 4 0 018 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
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

export function DepreciationMasterScreen() {
  const formId = useId();
  const router = useRouter();
  const [runs, setRuns] = useState<DepreciationRunListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editRemarks, setEditRemarks] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [quickEnsureLoading, setQuickEnsureLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [fyRolloverStatus, setFyRolloverStatus] =
    useState<DepreciationFyRolloverStatusView | null>(null);
  const [fyRolloverLoading, setFyRolloverLoading] = useState(true);
  const [fyRolloverError, setFyRolloverError] = useState<string | null>(null);
  const [createFyEndLoading, setCreateFyEndLoading] = useState(false);
  const [rolloverLoading, setRolloverLoading] = useState(false);

  const loadFyRolloverStatus = useCallback(async () => {
    setFyRolloverLoading(true);
    setFyRolloverError(null);
    try {
      const res = await fetch("/api/admin/depreciation-fy-rollover/status", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        currentBsDate?: string | null;
        currentFiscalYearStart?: number;
        priorFiscalYearStart?: number;
        status?: "blocked" | "pending" | "completed" | "not_required";
        priorFyFinalRunId?: number | null;
        priorFyFinalRunStatus?: string | null;
        priorFyFinalRunTitle?: string | null;
        blockers?: string[];
        rolloverAllowed?: boolean;
        blockingReason?: string | null;
        sourceFinalRunId?: number | null;
        completedAt?: string | null;
        completedByAdminId?: number | null;
        completedByAdminEmail?: string | null;
        depreciationOpeningFiscalYearStart?: number | null;
        depreciationOpeningFyHelpText?: string | null;
        migrationSettings?: DepreciationFyRolloverStatusView["migrationSettings"];
        error?: string;
      };
      if (!res.ok) {
        setFyRolloverStatus(null);
        setFyRolloverError(json.error ?? "Could not load FY rollover status.");
        return null;
      }
      if (
        typeof json.currentFiscalYearStart === "number" &&
        typeof json.priorFiscalYearStart === "number" &&
        json.status
      ) {
        const nextStatus: DepreciationFyRolloverStatusView = {
          currentBsDate: json.currentBsDate ?? null,
          currentFiscalYearStart: json.currentFiscalYearStart,
          priorFiscalYearStart: json.priorFiscalYearStart,
          status: json.status,
          priorFyFinalRunId: json.priorFyFinalRunId ?? null,
          priorFyFinalRunStatus: json.priorFyFinalRunStatus ?? null,
          priorFyFinalRunTitle: json.priorFyFinalRunTitle ?? null,
          blockers: json.blockers ?? [],
          rolloverAllowed: json.rolloverAllowed === true,
          blockingReason: json.blockingReason ?? null,
          sourceFinalRunId: json.sourceFinalRunId ?? null,
          completedAt: json.completedAt ?? null,
          completedByAdminId: json.completedByAdminId ?? null,
          completedByAdminEmail: json.completedByAdminEmail ?? null,
          depreciationOpeningFiscalYearStart:
            json.depreciationOpeningFiscalYearStart ?? null,
          depreciationOpeningFyHelpText: json.depreciationOpeningFyHelpText ?? null,
          migrationSettings: json.migrationSettings,
        };
        setFyRolloverStatus(nextStatus);
        return nextStatus;
      }
      setFyRolloverStatus(null);
      setFyRolloverError("Could not load FY rollover status.");
      return null;
    } catch {
      setFyRolloverStatus(null);
      setFyRolloverError("Could not load FY rollover status.");
      return null;
    } finally {
      setFyRolloverLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/depreciation-runs");
      const json = (await res.json()) as {
        runs?: DepreciationRunListRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not load runs.");
        setRuns([]);
        return;
      }
      setRuns(json.runs ?? []);
      await loadFyRolloverStatus();
    } catch {
      setError("Could not load runs.");
      setRuns([]);
      await loadFyRolloverStatus();
    } finally {
      setLoading(false);
    }
  }, [loadFyRolloverStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function onCreatePriorFyEnd() {
    setCreateFyEndLoading(true);
    try {
      const res = await fetch("/api/admin/depreciation-fy-rollover/prior-fy-final", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        run?: { id: number };
        error?: string;
      };
      if (!res.ok) {
        window.alert(json.error ?? "Could not create year-end depreciation draft.");
        return;
      }
      const runId = json.run?.id;
      await load();
      if (runId && Number.isFinite(runId)) {
        router.push(`/admin/dashboard/asset-register/depreciation/${runId}`);
      }
    } catch {
      window.alert("Could not reach the server to create year-end depreciation.");
    } finally {
      setCreateFyEndLoading(false);
    }
  }

  async function onRunFyRollover(): Promise<DepreciationFyRolloverActionResult> {
    setRolloverLoading(true);
    try {
      const res = await fetch("/api/admin/depreciation-fy-rollover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        status?: "applied" | "already_applied" | "skipped_no_prior_year";
        newFiscalYearStart?: number;
        priorFiscalYearStart?: number;
        branchId?: number | null;
        sourceFinalRunId?: number | null;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Fiscal year rollover failed.");
      }
      if (
        !json.status ||
        typeof json.newFiscalYearStart !== "number" ||
        typeof json.priorFiscalYearStart !== "number"
      ) {
        throw new Error("Fiscal year rollover completed but returned an invalid response.");
      }
      await load();
      return {
        status: json.status,
        newFiscalYearStart: json.newFiscalYearStart,
        priorFiscalYearStart: json.priorFiscalYearStart,
        branchId: json.branchId ?? null,
        sourceFinalRunId: json.sourceFinalRunId ?? null,
      };
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Could not reach the server to run fiscal year rollover."
      );
    } finally {
      setRolloverLoading(false);
    }
  }

  async function onQuickEnsureCurrentFy() {
    setQuickEnsureLoading(true);
    try {
      const res = await fetch("/api/admin/depreciation-runs/ensure-current", {
        method: "POST",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        run?: { id: number };
        detailsInserted?: number;
        skippedAssets?: {
          asset_id: number;
          asset_name: string;
          reason: string;
        }[];
        error?: string;
      };
      if (!res.ok) {
        window.alert(json.error ?? "Could not run depreciation for the current fiscal year.");
        return;
      }
      const runId = json.run?.id;
      if (!runId || !Number.isFinite(runId)) {
        window.alert("Depreciation was calculated but no run id was returned.");
        return;
      }
      if (json.skippedAssets && json.skippedAssets.length > 0) {
        const lines = json.skippedAssets.map(
          (s) => `#${s.asset_id} ${s.asset_name}: ${s.reason}`
        );
        window.alert(
          `Depreciation for the current fiscal year was calculated (${json.detailsInserted ?? 0} row(s)).\n\n` +
            `${json.skippedAssets.length} asset(s) were skipped:\n\n` +
            lines.join("\n")
        );
        try {
          sessionStorage.setItem(
            SKIPPED_STORAGE_KEY,
            JSON.stringify(json.skippedAssets)
          );
        } catch {
          /* ignore */
        }
      }
      router.push(`/admin/dashboard/asset-register/depreciation/${runId}`);
      router.refresh();
    } catch {
      window.alert("Could not reach the server to calculate depreciation.");
    } finally {
      setQuickEnsureLoading(false);
    }
  }

  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId]
  );

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.id - a.id),
    [runs]
  );

  const hasRuns = runs.length > 0;
  const showEmptyState = !loading && !error && !hasRuns;
  const quickEligibility = useMemo(
    () =>
      getQuickAsOfTodayEligibility(fyRolloverStatus, {
        statusLoading: fyRolloverLoading,
      }),
    [fyRolloverStatus, fyRolloverLoading]
  );
  const emptySupportingText = useMemo(
    () => buildEmptyRunsSupportingText(fyRolloverStatus),
    [fyRolloverStatus]
  );
  const createRunHref = "/admin/dashboard/asset-register/depreciation/new";
  const createRunLabel = showEmptyState ? "Create depreciation run" : "Add New";
  const quickLabel = showEmptyState
    ? quickEnsureLoading
      ? "Calculating…"
      : "Calculate as of today"
    : quickEnsureLoading
      ? "Running…"
      : "Quick: as of today";
  const quickDisabled =
    quickEnsureLoading || !quickEligibility.enabled;

  function exportList() {
    const header = [
      "DepID",
      "FiscalYear",
      "DepTitle",
      "ScopeMode",
      "CalculationDateAD",
      "CalculationDateNepali",
      "Remarks",
      "IsFinalForFY",
    ].join(",");
    const lines = runs.map((r) =>
      [
        r.id,
        formatFiscalYearLabel(r.fiscal_year_start),
        `"${r.dep_title.replace(/"/g, '""')}"`,
        r.depreciation_scope_mode ?? "FY_END",
        r.calculation_date_ad,
        r.calculation_date_bs,
        `"${(r.remarks ?? "").replace(/"/g, '""')}"`,
        r.is_final_for_fy ? "True" : "False",
      ].join(",")
    );
    downloadCsv(`depreciation-runs-${Date.now()}.csv`, [header, ...lines].join("\n"));
  }

  async function onDeleteConfirmed() {
    if (!selected) return;
    if (selected.is_final_for_fy) {
      window.alert("Final fiscal year runs cannot be deleted directly.");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/depreciation-runs/${selected.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        window.alert(j.error ?? "Delete failed.");
        return;
      }
      setDeleteConfirmOpen(false);
      setSelectedId(null);
      await load();
    } catch {
      window.alert("Delete failed.");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function onRecalculateSelected() {
    if (!selected) return;
    setRecalcLoading(true);
    try {
      const res = await fetch(
        `/api/admin/depreciation-runs/${selected.id}/refresh-details`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ advanceCalculationDateToTodayBs: false }),
        }
      );
      const json = (await res.json()) as { error?: string; redirectToRunId?: number };
      if (!res.ok) {
        window.alert(json.error ?? "Could not recalculate this depreciation run.");
        return;
      }
      if (json.redirectToRunId && Number.isFinite(json.redirectToRunId)) {
        setSelectedId(json.redirectToRunId);
      }
      await load();
    } catch {
      window.alert("Could not recalculate this depreciation run.");
    } finally {
      setRecalcLoading(false);
    }
  }

  async function onVoidSelected() {
    if (!selected) return;
    if (
      !window.confirm(
        `Void depreciation run #${selected.id} (${selected.dep_title})? This keeps the record for audit and marks it as void.`
      )
    ) {
      return;
    }
    setVoidLoading(true);
    try {
      const res = await fetch(`/api/admin/depreciation-runs/${selected.id}/void`, {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        window.alert(json.error ?? "Could not void this depreciation run.");
        return;
      }
      await load();
    } catch {
      window.alert("Could not void this depreciation run.");
    } finally {
      setVoidLoading(false);
    }
  }

  function openEdit() {
    if (!selected) return;
    setEditRemarks(selected.remarks ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/depreciation-runs/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarks: editRemarks.trim() || null }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditError(json.error ?? "Could not save.");
        return;
      }
      setEditOpen(false);
      await load();
    } catch {
      setEditError("Could not save.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FixedAssetSectionTabs />
      <DepreciationSectionNav />

      <DepreciationFyRolloverPanel
        status={fyRolloverStatus}
        loading={fyRolloverLoading}
        error={fyRolloverError}
        createFyEndLoading={createFyEndLoading}
        rolloverLoading={rolloverLoading}
        priorFyRunHref={
          fyRolloverStatus?.priorFyFinalRunId
            ? `/admin/dashboard/asset-register/depreciation/${fyRolloverStatus.priorFyFinalRunId}`
            : null
        }
        onCreatePriorFyEnd={onCreatePriorFyEnd}
        onRefreshStatusBeforeConfirm={loadFyRolloverStatus}
        onRunRollover={onRunFyRollover}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Depreciation Master List
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {showEmptyState ? (
              <>
                Fiscal-year depreciation runs (Shrawan–Ashadh). Create the first
                as-of-date run when you are ready to start system-owned
                calculations.
              </>
            ) : (
              <>
                Fiscal-year depreciation runs (Shrawan–Ashadh), each stored as an
                as-of-date snapshot through the calculation date (capped at fiscal
                year end). Use{" "}
                <span className="font-medium">Add New</span> to post a run, or{" "}
                <span className="font-medium">Quick: as of today</span> for
                today’s BS date without opening the form. Select a row for
                Details.
              </>
            )}
          </p>
        </div>

        <div
          className="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:min-w-0 sm:items-end"
          role="toolbar"
          aria-label="Depreciation run actions"
        >
          <div className="flex w-full flex-wrap items-center gap-2 sm:justify-end">
            <Link href={createRunHref} className={toolbarAddNew}>
              <PlusIcon className="h-4 w-4 shrink-0" />
              {createRunLabel}
            </Link>
            <button
              type="button"
              className={toolbarQuick}
              disabled={quickDisabled}
              onClick={() => void onQuickEnsureCurrentFy()}
              title={
                quickEligibility.reason ??
                "Runs depreciation for the current fiscal year as of today’s BS date (AS_OF_DATE mode)"
              }
              aria-disabled={quickDisabled}
            >
              <BoltIcon className="h-4 w-4 shrink-0" />
              {quickLabel}
            </button>
            {hasRuns ? (
              <button type="button" className={toolbarExport} onClick={exportList}>
                <DownloadIcon className="h-4 w-4 shrink-0" />
                Export
              </button>
            ) : null}
          </div>

          {quickDisabled && quickEligibility.reason && !quickEnsureLoading ? (
            <p className="max-w-md text-right text-xs text-slate-600" role="note">
              {quickEligibility.reason}
            </p>
          ) : null}

          {hasRuns ? (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5 sm:justify-end">
              <Link
                href={
                  selected
                    ? `/admin/dashboard/asset-register/depreciation/${selected.id}`
                    : "#"
                }
                className={`${toolbarRowAction} ${
                  !selected
                    ? "pointer-events-none border-slate-100 bg-slate-50/80 text-slate-400 opacity-60 shadow-none hover:border-slate-100 hover:bg-slate-50/80"
                    : ""
                }`}
                aria-disabled={!selected}
                onClick={(e) => {
                  if (!selected) e.preventDefault();
                }}
              >
                <EyeIcon className="h-4 w-4 shrink-0" />
                Details
              </Link>
              <button
                type="button"
                className={toolbarRowAction}
                disabled={!selected}
                onClick={openEdit}
              >
                <PencilIcon className="h-4 w-4 shrink-0" />
                Edit
              </button>
              <button
                type="button"
                className={
                  !selected || selected.is_final_for_fy || deleteLoading
                    ? toolbarDeleteDisabled
                    : toolbarDeleteEnabled
                }
                disabled={!selected || selected.is_final_for_fy || deleteLoading}
                onClick={() => setDeleteConfirmOpen(true)}
                title={
                  selected?.is_final_for_fy
                    ? "Final fiscal year runs cannot be deleted directly."
                    : undefined
                }
              >
                <TrashIcon className="h-4 w-4 shrink-0" />
                {deleteLoading ? "Deleting…" : "Delete"}
              </button>
              {selected?.is_final_for_fy ? (
                <>
                  <button
                    type="button"
                    className={toolbarRowAction}
                    disabled={recalcLoading}
                    onClick={() => void onRecalculateSelected()}
                  >
                    {recalcLoading ? "Recalculating…" : "Recalculate"}
                  </button>
                  <button
                    type="button"
                    className={toolbarRowAction}
                    disabled={voidLoading}
                    onClick={() => void onVoidSelected()}
                    title="Admin only"
                  >
                    {voidLoading ? "Voiding…" : "Void (admin only)"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div
          className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600 shadow-sm"
          role="status"
          aria-live="polite"
        >
          Loading depreciation runs…
        </div>
      ) : null}

      {showEmptyState ? (
        <div
          className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center shadow-sm sm:px-8"
          data-testid="depreciation-runs-empty-state"
        >
          <h3 className="text-base font-semibold text-slate-900">
            No depreciation runs yet
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            {emptySupportingText}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link href={createRunHref} className={toolbarAddNew}>
              <PlusIcon className="h-4 w-4 shrink-0" />
              Create depreciation run
            </Link>
            <button
              type="button"
              className={toolbarQuick}
              disabled={quickDisabled}
              onClick={() => void onQuickEnsureCurrentFy()}
              title={
                quickEligibility.reason ??
                "Calculate depreciation as of today’s BS date"
              }
              aria-disabled={quickDisabled}
            >
              <BoltIcon className="h-4 w-4 shrink-0" />
              {quickEnsureLoading ? "Calculating…" : "Calculate as of today"}
            </button>
          </div>
          {quickDisabled && quickEligibility.reason && !quickEnsureLoading ? (
            <p className="mx-auto mt-3 max-w-lg text-xs text-slate-600" role="note">
              {quickEligibility.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && hasRuns ? (
      <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white shadow-sm">
        <table className="min-w-[880px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-gradient-to-b from-slate-100 to-slate-50/95 text-xs font-semibold text-slate-700">
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>DepID</span>
                  <FilterHeaderIcon label="DepID" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>FiscalYear</span>
                  <FilterHeaderIcon label="FiscalYear" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>DepTitle</span>
                  <FilterHeaderIcon label="DepTitle" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>Scope</span>
                  <FilterHeaderIcon label="Scope" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>CalculationDate</span>
                  <FilterHeaderIcon label="CalculationDate" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>CalculationDateNepali</span>
                  <FilterHeaderIcon label="CalculationDateNepali" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>Remarks</span>
                  <FilterHeaderIcon label="Remarks" />
                </span>
              </th>
              <th className="border border-slate-300 px-2 py-2">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  <span>Is Final For FY</span>
                  <FilterHeaderIcon label="Is Final For FY" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
              {sortedRuns.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer transition hover:bg-blue-50/60 ${
                    selectedId === r.id ? "bg-blue-50/90" : "bg-white"
                  }`}
                  onClick={() => setSelectedId(r.id)}
                  onDoubleClick={() => {
                    window.location.href = `/admin/dashboard/asset-register/depreciation/${r.id}`;
                  }}
                >
                  <td className="border border-slate-300 px-2 py-1.5 font-mono tabular-nums text-slate-900">
                    {r.id}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 tabular-nums text-slate-900">
                    {formatFiscalYearLabel(r.fiscal_year_start)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    <Link
                      href={`/admin/dashboard/asset-register/depreciation/${r.id}`}
                      className="font-medium text-blue-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.dep_title}
                    </Link>
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-slate-800">
                    {r.depreciation_scope_mode === "AS_OF_DATE"
                      ? "As of date"
                      : "FY end"}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs tabular-nums text-slate-800">
                    {formatAdDate(r.calculation_date_ad)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs tabular-nums text-slate-800">
                    {r.calculation_date_bs}
                  </td>
                  <td className="max-w-[220px] truncate border border-slate-300 px-2 py-1.5 text-slate-700">
                    {r.remarks ?? ""}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-slate-900">
                    {r.is_final_for_fy ? "True" : "False"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      ) : null}

      {editOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal
          aria-labelledby={`${formId}-edit-title`}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 id={`${formId}-edit-title`} className="text-base font-semibold text-slate-900">
              Edit remarks — run #{selected?.id}
            </h3>
            <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor={`${formId}-remarks`}>
              Remarks
            </label>
            <textarea
              id={`${formId}-remarks`}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
              rows={4}
              value={editRemarks}
              onChange={(e) => setEditRemarks(e.target.value)}
            />
            {editError ? (
              <p className="mt-2 text-sm text-red-600">{editError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnClass}
                onClick={() => setEditOpen(false)}
                disabled={editSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void saveEdit()}
                disabled={editSaving}
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen && selected && !selected.is_final_for_fy ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal
          aria-labelledby={`${formId}-delete-title`}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 id={`${formId}-delete-title`} className="text-base font-semibold text-slate-900">
              Delete depreciation run #{selected.id}?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {selected.dep_title} ({formatFiscalYearLabel(selected.fiscal_year_start)}) will be
              permanently deleted. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnClass}
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void onDeleteConfirmed()}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Deleting…" : "Confirm delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
