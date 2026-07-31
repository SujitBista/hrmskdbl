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
      return "Draft — needs review";
    case "review_pending":
      return "Review pending";
    case "posted":
      return "Posted";
    case "void":
      return "Voided";
    case "not_applicable":
      return "Not applicable";
    case null:
      return "Not created yet";
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
  return status.priorFyFinalRunId ? `#${status.priorFyFinalRunId}` : "Not created yet";
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Plain-language reason for first-time admins (prefers known blocker codes). */
export function userFacingRolloverReason(
  status: Pick<
    DepreciationFyRolloverStatusView,
    "blockers" | "blockingReason" | "priorFyFinalRunId" | "priorFyFinalRunStatus" | "migrationSettings"
  > | null
): string | null {
  if (!status) return null;
  if (status.migrationSettings?.source === "none") {
    return "Open Depreciation → Settings and set the opening fiscal year before continuing.";
  }
  if (status.blockers.includes("DEPRECIATION_SETTINGS_NOT_CONFIGURED")) {
    return "Open Depreciation → Settings and set the opening fiscal year before continuing.";
  }
  if (
    status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_REQUIRED") &&
    status.priorFyFinalRunId == null
  ) {
    return "Create year-end depreciation for the previous fiscal year, review it, and post it before setting opening balances.";
  }
  if (
    status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_NOT_POSTED") ||
    status.priorFyFinalRunStatus === "draft" ||
    status.priorFyFinalRunStatus === "review_pending"
  ) {
    return "Open the previous year-end depreciation run, review the amounts, and post it. Then return here to set opening balances.";
  }
  if (status.blockingReason) {
    return status.blockingReason
      .replace(/FY_END/g, "year-end")
      .replace(/prior fiscal year final/gi, "previous year-end")
      .replace(/rollover/gi, "opening-balance setup");
  }
  return null;
}

function deriveUiState(status: DepreciationFyRolloverStatusView | null): {
  label: string;
  tone: string;
  description: string;
} {
  if (!status) {
    return {
      label: "Could not load",
      tone: "border-red-200 bg-red-50 text-red-900",
      description: "Status could not be loaded. Refresh the page and try again.",
    };
  }
  if (status.migrationSettings?.source === "none") {
    return {
      label: "Settings needed first",
      tone: "border-amber-200 bg-amber-50 text-amber-950",
      description:
        "Set the opening fiscal year under Depreciation → Settings, then come back here.",
    };
  }
  if (status.status === "completed") {
    return {
      label: "Opening balances are set",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      description:
        "Closing values from the previous fiscal year are now the opening book values for this year. You can run depreciation for the current year.",
    };
  }
  if (status.status === "not_required") {
    return {
      label: "Not needed this year",
      tone: "border-slate-200 bg-slate-50 text-slate-900",
      description:
        "This is your first system fiscal year. Opening balances already come from migration — no year-end carry-forward is required.",
    };
  }
  if (status.status === "pending") {
    return {
      label: "Ready to set opening balances",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      description:
        "Previous year-end depreciation is posted. Confirm below to copy those closing values into this year’s opening book values.",
    };
  }
  if (status.priorFyFinalRunId === null) {
    return {
      label: "Year-end depreciation missing",
      tone: "border-red-200 bg-red-50 text-red-900",
      description:
        "The previous fiscal year still needs a posted year-end depreciation run before opening balances can be set.",
    };
  }
  if (status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_REQUIRED")) {
    return {
      label: "Year-end depreciation not usable",
      tone: "border-red-200 bg-red-50 text-red-900",
      description:
        userFacingRolloverReason(status) ??
        "The previous year-end depreciation is not posted. Create or post a valid year-end run before setting opening balances.",
    };
  }
  if (
    status.priorFyFinalRunStatus === "draft" ||
    status.priorFyFinalRunStatus === "review_pending" ||
    status.blockers.includes("PRIOR_FY_FINAL_DEPRECIATION_NOT_POSTED")
  ) {
    return {
      label: "Year-end depreciation not posted",
      tone: "border-red-200 bg-red-50 text-red-900",
      description:
        "A year-end run exists but is still a draft. Review the amounts and post it, then return here.",
    };
  }
  return {
    label: "Action needed",
    tone: "border-red-200 bg-red-50 text-red-900",
    description:
      userFacingRolloverReason(status) ??
      "Finish previous year-end depreciation before setting opening balances for the new fiscal year.",
  };
}

function currentGuideStep(
  status: DepreciationFyRolloverStatusView
): 1 | 2 | 3 | null {
  if (status.status !== "blocked" && status.status !== "pending") return null;
  if (status.priorFyFinalRunId == null) return 1;
  if (
    status.priorFyFinalRunStatus === "draft" ||
    status.priorFyFinalRunStatus === "review_pending" ||
    status.status === "blocked"
  ) {
    return 2;
  }
  return 3;
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
  const facingReason = useMemo(
    () => (status ? userFacingRolloverReason(status) : null),
    [status]
  );
  const guideStep = status ? currentGuideStep(status) : null;
  const canCreateFyEnd =
    status != null &&
    status.status === "blocked" &&
    status.priorFyFinalRunId === null &&
    status.migrationSettings?.source !== "none";
  const canReviewFyEnd =
    Boolean(status?.priorFyFinalRunId) &&
    Boolean(priorFyRunHref) &&
    status?.status !== "completed";
  const canAttemptRollover = Boolean(
    status?.rolloverAllowed && status?.status === "pending"
  );
  const showMigrationSummary =
    status?.migrationSettings != null &&
    status.status !== "completed" &&
    status.status !== "not_required";
  const allowanceLabel =
    status?.status === "completed"
      ? "Done"
      : status?.status === "not_required"
        ? "Not needed"
        : status?.migrationSettings?.source === "none"
          ? "Settings needed"
          : status?.rolloverAllowed
            ? "Ready"
            : "Action needed";

  async function handleOpenConfirmation() {
    setActionError(null);
    setActionMessage(null);
    const latest = await onRefreshStatusBeforeConfirm();
    if (!latest) {
      setActionError("Could not refresh status. Please try again.");
      return;
    }
    if (!latest.rolloverAllowed || latest.status !== "pending") {
      setActionError(
        userFacingRolloverReason(latest) ??
          latest.blockingReason ??
          "Opening balances are no longer ready to set. Check the status above and try again."
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
          ? "Opening balances were already set earlier. This panel now shows the completed state."
          : "Opening balances are set. Closing values from the previous year are now this year’s opening book values."
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not set opening balances."
      );
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${formId}-title`}>
      <div>
        <h2 id={`${formId}-title`} className="text-lg font-semibold text-slate-900">
          Opening balances (new fiscal year)
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          After year-end depreciation is posted, use this to set opening book values for
          the new fiscal year (starts Shrawan 1). This is a manual, audited step.
        </p>
      </div>

      {loading ? (
        <div className={`${cardBase} border-slate-200 bg-white`}>
          <p className="text-sm text-slate-600" role="status" aria-live="polite">
            Loading status…
          </p>
        </div>
      ) : error ? (
        <div className={`${cardBase} border-red-200 bg-red-50`}>
          <p className="text-sm font-medium text-red-900">Could not load</p>
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
              <dt className="font-medium text-slate-700">Today’s date (BS)</dt>
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
            {status.status !== "not_required" && status.status !== "completed" ? (
              <>
                <div>
                  <dt className="font-medium text-slate-700">
                    Previous year-end depreciation
                  </dt>
                  <dd className="mt-1 text-slate-900">
                    {formatPriorFyEndRunLabel(status)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-700">Year-end run status</dt>
                  <dd className="mt-1 text-slate-900">
                    {status.priorFyFinalRunStatus === "not_applicable"
                      ? "Not applicable"
                      : formatRunStatus(status.priorFyFinalRunStatus)}
                  </dd>
                </div>
              </>
            ) : null}
            {status.status === "completed" ? (
              <div>
                <dt className="font-medium text-slate-700">Source year-end run</dt>
                <dd className="mt-1 text-slate-900">
                  {status.sourceFinalRunId
                    ? `#${status.sourceFinalRunId}`
                    : formatPriorFyEndRunLabel(status)}
                </dd>
              </div>
            ) : null}
          </dl>

          {facingReason &&
          status.status !== "completed" &&
          status.status !== "not_required" &&
          status.status !== "pending" ? (
            <p className="mt-4 rounded-lg border border-current/15 bg-white/60 px-3 py-2 text-sm">
              <span className="font-medium">What to do:</span> {facingReason}
            </p>
          ) : null}

          {guideStep != null ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white/70 px-3 py-3 text-sm text-slate-800">
              <p className="font-medium text-slate-900">How to finish (3 steps)</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li className={guideStep === 1 ? "font-semibold text-slate-900" : undefined}>
                  Create year-end depreciation for{" "}
                  {formatFiscalYearLabel(status.priorFiscalYearStart)}
                  {guideStep === 1 ? " ← you are here" : null}
                </li>
                <li className={guideStep === 2 ? "font-semibold text-slate-900" : undefined}>
                  Review the amounts and post that run
                  {guideStep === 2 ? " ← you are here" : null}
                </li>
                <li className={guideStep === 3 ? "font-semibold text-slate-900" : undefined}>
                  Return here and set opening balances for{" "}
                  {formatFiscalYearLabel(status.currentFiscalYearStart)}
                  {guideStep === 3 ? " ← you are here" : null}
                </li>
              </ol>
            </div>
          ) : null}

          {status.status === "completed" ? (
            <dl className="mt-4 grid gap-3 rounded-lg border border-emerald-200 bg-white/70 px-3 py-3 text-sm md:grid-cols-3">
              <div>
                <dt className="font-medium text-slate-700">Completed at</dt>
                <dd className="mt-1 text-slate-900">
                  {formatTimestamp(status.completedAt)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Completed by</dt>
                <dd className="mt-1 text-slate-900">
                  {status.completedByAdminEmail ?? "Audit record unavailable"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">What next</dt>
                <dd className="mt-1 text-slate-900">
                  Use “Quick: as of today” (or Add New) for{" "}
                  {formatFiscalYearLabel(status.currentFiscalYearStart)}.
                </dd>
              </div>
            </dl>
          ) : null}

          {status.status === "not_required" ? (
            <p className="mt-4 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-800">
              You can create depreciation runs for{" "}
              {formatFiscalYearLabel(status.currentFiscalYearStart)} when you are ready.
            </p>
          ) : null}

          {showMigrationSummary ? (
            <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white/70 px-3 py-3 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="font-medium text-slate-700">System opening fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings!.openingFiscalYearStart != null
                    ? formatFiscalYearLabel(
                        status.migrationSettings!.openingFiscalYearStart
                      )
                    : "Not configured"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">
                  System calculates from (BS)
                </dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings!.firstSystemDepreciationDateBs ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">
                  External depreciation through (BS)
                </dt>
                <dd className="mt-1 text-slate-900">
                  {status.migrationSettings!.lastExternalDepreciationDateBs ?? "—"}
                </dd>
              </div>
            </dl>
          ) : null}

          {status.migrationSettings ? (
            <details className="mt-4 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <summary className="cursor-pointer font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/25 focus-visible:ring-offset-1">
                More details
              </summary>
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                {status.depreciationOpeningFyHelpText ? (
                  <div className="md:col-span-2">
                    <dt className="font-medium text-slate-700">Opening year note</dt>
                    <dd className="mt-1 text-slate-900">
                      {status.depreciationOpeningFyHelpText}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium text-slate-700">Settings source</dt>
                  <dd className="mt-1 text-slate-900">
                    {status.migrationSettings.source === "database"
                      ? "Saved in Settings"
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
                    <dt className="font-medium text-slate-700">Why settings are locked</dt>
                    <dd className="mt-1 text-slate-900">
                      {status.migrationSettings.lockReason}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </details>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {canCreateFyEnd ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={createFyEndLoading}
                onClick={() => void onCreatePriorFyEnd()}
              >
                {createFyEndLoading
                  ? "Creating…"
                  : `Create year-end depreciation for ${formatFiscalYearLabel(status.priorFiscalYearStart)}`}
              </button>
            ) : null}
            {canReviewFyEnd && priorFyRunHref ? (
              <Link
                href={priorFyRunHref}
                className={canAttemptRollover ? btnSecondary : btnPrimary}
              >
                {status.priorFyFinalRunStatus === "posted"
                  ? "Review year-end depreciation"
                  : "Review & post year-end depreciation"}
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
                  ? "Setting opening balances…"
                  : `Set opening balances for ${formatFiscalYearLabel(status.currentFiscalYearStart)}`}
              </button>
            ) : null}
          </div>

          {actionMessage ? (
            <p
              className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              role="status"
            >
              {actionMessage}
            </p>
          ) : null}
          {actionError ? (
            <p
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
              role="alert"
            >
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
            <h3
              id={`${formId}-confirm-title`}
              className="text-base font-semibold text-slate-900"
            >
              Set opening balances for{" "}
              {formatFiscalYearLabel(status.currentFiscalYearStart)}?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This copies closing book values from the previous year-end depreciation into
              each asset’s opening book value for the new fiscal year. The action is
              audited.
            </p>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-700">From fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {formatFiscalYearLabel(status.priorFiscalYearStart)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Into fiscal year</dt>
                <dd className="mt-1 text-slate-900">
                  {formatFiscalYearLabel(status.currentFiscalYearStart)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Year-end depreciation run</dt>
                <dd className="mt-1 text-slate-900">
                  {status.priorFyFinalRunId ? `#${status.priorFyFinalRunId}` : "—"}
                </dd>
              </div>
            </dl>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Only do this after you have reviewed and posted year-end depreciation.</li>
              <li>
                Closing values become opening book values for{" "}
                {formatFiscalYearLabel(status.currentFiscalYearStart)}.
              </li>
              <li>You can then calculate depreciation for the new fiscal year.</li>
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
                I confirm the previous year-end depreciation is final and that opening
                balances should be set for{" "}
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
                {rolloverLoading
                  ? "Setting opening balances…"
                  : "Confirm opening balances"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
