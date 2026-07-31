"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

export type DepreciationFyRolloverStatusView = {
  currentBsDate: string | null;
  currentFiscalYearStart: number;
  priorFiscalYearStart: number;
  status: "blocked" | "pending" | "completed" | "not_required";
  priorFyFinalRunId: number | null;
  priorFyFinalRunStatus: string | null;
  priorFyFinalRunTitle?: string | null;
  blockers: string[];
  rolloverAllowed: boolean;
  blockingReason: string | null;
  sourceFinalRunId?: number | null;
  completedAt?: string | null;
  completedByAdminId?: number | null;
  completedByAdminEmail?: string | null;
  depreciationOpeningFiscalYearStart?: number | null;
  depreciationOpeningFyHelpText?: string | null;
  migrationSettings?: {
    openingFiscalYearStart: number | null;
    firstSystemDepreciationDateBs: string | null;
    lastExternalDepreciationDateBs: string | null;
    source: "database" | "env" | "none";
    configuredByAdminId: number | null;
    configuredByAdminEmail: string | null;
    configuredAt: string | null;
    editable: boolean;
    lockReason: string | null;
  };
};

export type DepreciationFyRolloverActionResult = {
  status: "applied" | "already_applied" | "skipped_no_prior_year";
  newFiscalYearStart: number;
  priorFiscalYearStart: number;
  branchId: number | null;
  sourceFinalRunId: number | null;
};

type Props = {
  status: DepreciationFyRolloverStatusView | null;
  loading: boolean;
  error: string | null;
  createFyEndLoading: boolean;
  rolloverLoading: boolean;
  priorFyRunHref: string | null;
  onCreatePriorFyEnd: () => Promise<void>;
  onRefreshStatusBeforeConfirm: () => Promise<DepreciationFyRolloverStatusView | null>;
  onRunRollover: () => Promise<DepreciationFyRolloverActionResult>;
};

const cardBase = "rounded-xl border px-4 py-4 shadow-sm";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/25 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center justify-center rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/25 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

function formatFiscalYearLabel(start: number): string {
  return `FY ${start}/${String(start + 1).slice(-2)}`;
}

function formatRunStatus(status: string | null): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "review_pending":
      return "Review pending";
    case "posted":
      return "Posted";
    case "void":
      return "Voided";
    case "not_applicable":
      return "Not applicable";
    case null:
      return "Missing";
    default:
      return status;
  }
}

function formatPriorFyEndRunLabel(status: DepreciationFyRolloverStatusView): string {
  if (
    status.status === "not_required" ||
    status.priorFyFinalRunStatus === "not_applicable"
  ) {
    return "Not applicable";
  }
  return status.priorFyFinalRunId ? `#${status.priorFyFinalRunId}` : "Not created";
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function deriveUiState(status: DepreciationFyRolloverStatusView | null): {
  label: string;
  tone: string;
  description: string;
} {
  if (!status) {
    return {
      label: "Failed",
      tone: "border-red-200 bg-red-50 text-red-900",
      description: "Rollover status could not be loaded.",
    };
  }
  if (status.migrationSettings?.source === "none") {
    return {
      label: "Not configured",
      tone: "border-amber-200 bg-amber-50 text-amber-950",
      description:
        "Depreciation migration settings are missing, so the application cannot confirm rollover readiness yet.",
    };
  }
  if (status.status === "completed") {
    return {
      label: "Already completed",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      description:
        "Closing written-down values from the previous FY are already established as this FY's opening balances.",
    };
  }
  if (status.status === "not_required") {
    return {
      label: "Not required",
      tone: "border-slate-200 bg-slate-50 text-slate-900",
      description:
        "This is the opening fiscal year. Imported opening balances are authoritative.",
    };
  }
  if (status.status === "pending") {
    return {
      label: "Ready for rollover",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      description:
        "The prior FY_END depreciation is posted and the backend reports that rollover can be applied.",
    };
  }
  if (
    status.priorFyFinalRunId === null ||
    status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_REQUIRED")
  ) {
    return {
      label: "Previous FY_END missing",
      tone: "border-red-200 bg-red-50 text-red-900",
      description:
        "The previous fiscal year does not yet have a posted FY_END depreciation run to carry forward.",
    };
  }
  if (
    status.priorFyFinalRunStatus === "draft" ||
    status.priorFyFinalRunStatus === "review_pending" ||
    status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_NOT_POSTED")
  ) {
    return {
      label: "Previous FY_END not posted",
      tone: "border-red-200 bg-red-50 text-red-900",
      description:
        "The previous FY_END run exists but must be reviewed and posted before rollover is allowed.",
    };
  }
  return {
    label: "Blocked",
    tone: "border-red-200 bg-red-50 text-red-900",
    description:
      status.blockingReason ??
      "The backend is blocking rollover until the previous fiscal year is ready.",
  };
}

export function DepreciationFyRolloverPanel({
  status,
  loading,
  error,
  createFyEndLoading,
  rolloverLoading,
  priorFyRunHref,
  onCreatePriorFyEnd,
  onRefreshStatusBeforeConfirm,
  onRunRollover,
}: Props) {
  const formId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const state = useMemo(() => deriveUiState(status), [status]);
  const canCreateFyEnd =
    status != null &&
    status.status === "blocked" &&
    status.priorFyFinalRunId === null &&
    status.migrationSettings?.source !== "none";
  const canReviewFyEnd =
    Boolean(status?.priorFyFinalRunId) && Boolean(priorFyRunHref) && status?.status !== "completed";
  const canAttemptRollover = Boolean(status?.rolloverAllowed && status?.status === "pending");
  const allowanceLabel =
    status?.status === "completed"
      ? "Completed"
      : status?.status === "not_required"
        ? "Not required"
        : status?.migrationSettings?.source === "none"
          ? "Not configured"
          : status?.rolloverAllowed
            ? "Allowed"
            : "Blocked";

  async function handleOpenConfirmation() {
    setActionError(null);
    setActionMessage(null);
    const latest = await onRefreshStatusBeforeConfirm();
    if (!latest) {
      setActionError("Rollover status could not be refreshed. Please try again.");
      return;
    }
    if (!latest.rolloverAllowed || latest.status !== "pending") {
      setActionError(
        latest.blockingReason ??
          "Rollover is no longer ready. Review the latest server status before retrying."
      );
      return;
    }
    setConfirmChecked(false);
    setConfirmOpen(true);
  }

  async function handleConfirmRollover() {
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await onRunRollover();
      setConfirmOpen(false);
      setConfirmChecked(false);
      setActionMessage(
        result.status === "already_applied"
          ? "Rollover was already applied earlier. The panel has been refreshed to the completed state."
          : "Rollover completed. Previous FY closing WDV is now the new FY opening WDV."
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Fiscal year rollover failed."
      );
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${formId}-title`}>
      <div>
        <h2 id={`${formId}-title`} className="text-lg font-semibold text-slate-900">
          Fiscal Year Rollover
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Detects Shrawan 1 fiscal-year transitions using the backend BS date logic, but
          rollover remains a manual, audited admin action.
        </p>
      </div>

      {loading ? (
        <div className={`${cardBase} border-slate-200 bg-white`}>
          <p className="text-sm text-slate-600" role="status" aria-live="polite">
            Loading rollover status…
          </p>
        </div>
      ) : error ? (
        <div className={`${cardBase} border-red-200 bg-red-50`}>
          <p className="text-sm font-medium text-red-900">Failed</p>
          <p className="mt-1 text-sm text-red-800" role="alert">
            {error}
          </p>
        </div>
      ) : status ? (
        <div className={`${cardBase} ${state.tone}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold">{state.label}</p>
              <p className="mt-1 text-sm">{state.description}</p>
            </div>
            <div className="shrink-0 rounded-full border border-current/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              {allowanceLabel}
            </div>
          </div>

          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="font-medium text-slate-700">Current BS date</dt>
              <dd className="mt-1 text-slate-900">{status.currentBsDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Current fiscal year</dt>
              <dd className="mt-1 text-slate-900">
                {formatFiscalYearLabel(status.currentFiscalYearStart)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Previous fiscal year</dt>
              <dd className="mt-1 text-slate-900">
                {formatFiscalYearLabel(status.priorFiscalYearStart)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Previous FY_END run</dt>
              <dd className="mt-1 text-slate-900">
                {formatPriorFyEndRunLabel(status)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Previous FY_END status</dt>
              <dd className="mt-1 text-slate-900">
                {status.status === "not_required" ||
                status.priorFyFinalRunStatus === "not_applicable"
                  ? "Not applicable"
                  : formatRunStatus(status.priorFyFinalRunStatus)}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Rollover status</dt>
              <dd className="mt-1 text-slate-900">{state.label}</dd>
            </div>
          </dl>

          {status.blockingReason ? (
            <p className="mt-4 rounded-lg border border-current/15 bg-white/60 px-3 py-2 text-sm">
              <span className="font-medium">Blocking reason:</span> {status.blockingReason}
            </p>
          ) : null}

          {status.migrationSettings ? (
            <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white/70 px-3 py-3 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="font-medium text-slate-700">Opening fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings.openingFiscalYearStart != null
                    ? formatFiscalYearLabel(status.migrationSettings.openingFiscalYearStart)
                    : "Not configured"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">System calculates from</dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings.firstSystemDepreciationDateBs ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Depreciation covered up to</dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings.lastExternalDepreciationDateBs ?? "—"}
                </dd>
              </div>
            </dl>
          ) : null}

          {status.migrationSettings ? (
            <details className="mt-4 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <summary className="cursor-pointer font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/25 focus-visible:ring-offset-1">
                Technical details
              </summary>
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-700">Settings source</dt>
                  <dd className="mt-1 text-slate-900">
                    {status.migrationSettings.source === "database"
                      ? "Database"
                      : status.migrationSettings.source === "env"
                        ? "Environment fallback"
                        : "Not configured"}
                  </dd>
                </div>
                {status.migrationSettings.configuredByAdminEmail ? (
                  <div>
                    <dt className="font-medium text-slate-700">Configured by</dt>
                    <dd className="mt-1 text-slate-900">
                      {status.migrationSettings.configuredByAdminEmail}
                    </dd>
                  </div>
                ) : null}
                {status.migrationSettings.configuredAt ? (
                  <div>
                    <dt className="font-medium text-slate-700">Configured at</dt>
                    <dd className="mt-1 text-slate-900">
                      {formatTimestamp(status.migrationSettings.configuredAt)}
                    </dd>
                  </div>
                ) : null}
                {status.migrationSettings.lockReason ? (
                  <div className="md:col-span-2">
                    <dt className="font-medium text-slate-700">Lock reason</dt>
                    <dd className="mt-1 text-slate-900">
                      {status.migrationSettings.lockReason}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </details>
          ) : null}

          {status.status === "completed" ? (
            <dl className="mt-4 grid gap-3 rounded-lg border border-emerald-200 bg-white/70 px-3 py-3 text-sm md:grid-cols-3">
              <div>
                <dt className="font-medium text-slate-700">Completed at</dt>
                <dd className="mt-1 text-slate-900">{formatTimestamp(status.completedAt)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Completed by</dt>
                <dd className="mt-1 text-slate-900">
                  {status.completedByAdminEmail ?? "Audit record unavailable"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Source final run</dt>
                <dd className="mt-1 text-slate-900">
                  {status.sourceFinalRunId ? `#${status.sourceFinalRunId}` : "—"}
                </dd>
              </div>
            </dl>
          ) : null}

          {status.depreciationOpeningFyHelpText ? (
            <p className="mt-4 text-xs text-slate-600">{status.depreciationOpeningFyHelpText}</p>
          ) : null}

          {(status.status === "blocked" || status.status === "pending") && (
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-800">
              <li>Create the previous FY_END run if it does not exist.</li>
              <li>Review the FY_END details and post the run.</li>
              <li>Return here and confirm rollover to establish official opening balances.</li>
            </ol>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {canCreateFyEnd ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={createFyEndLoading}
                onClick={() => void onCreatePriorFyEnd()}
              >
                {createFyEndLoading ? "Creating…" : "Create previous FY_END run"}
              </button>
            ) : null}
            {canReviewFyEnd && priorFyRunHref ? (
              <Link href={priorFyRunHref} className={btnSecondary}>
                Review previous FY_END run
              </Link>
            ) : null}
            {canAttemptRollover ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={rolloverLoading}
                onClick={() => void handleOpenConfirmation()}
              >
                {rolloverLoading
                  ? "Rollover in progress…"
                  : `Roll over to ${formatFiscalYearLabel(status.currentFiscalYearStart)}`}
              </button>
            ) : null}
          </div>

          {actionMessage ? (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
              {actionMessage}
            </p>
          ) : null}
          {actionError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}

      {confirmOpen && status ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal
          aria-labelledby={`${formId}-confirm-title`}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 id={`${formId}-confirm-title`} className="text-base font-semibold text-slate-900">
              Confirm fiscal year rollover
            </h3>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-700">Source fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {formatFiscalYearLabel(status.priorFiscalYearStart)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Target fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {formatFiscalYearLabel(status.currentFiscalYearStart)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Previous FY_END run</dt>
                <dd className="mt-1 text-slate-900">
                  {status.priorFyFinalRunId ? `#${status.priorFyFinalRunId}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Audit</dt>
                <dd className="mt-1 text-slate-900">This action is audited.</dd>
              </div>
            </dl>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>This creates official opening balances for the new fiscal year.</li>
              <li>Previous FY closing WDV becomes next-FY opening WDV.</li>
              <li>Do not continue until the previous FY_END run has been reviewed and posted.</li>
            </ul>
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                disabled={rolloverLoading}
              />
              <span>
                I confirm that the previous FY_END run is final and that this audited action
                should establish opening balances for{" "}
                {formatFiscalYearLabel(status.currentFiscalYearStart)}.
              </span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnSecondary}
                disabled={rolloverLoading}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmChecked(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={rolloverLoading || !confirmChecked}
                onClick={() => void handleConfirmRollover()}
              >
                {rolloverLoading ? "Rollover in progress…" : "Confirm rollover"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
