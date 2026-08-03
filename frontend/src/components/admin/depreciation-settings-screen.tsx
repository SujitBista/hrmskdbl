"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";

import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";
import { DepreciationSectionNav } from "./depreciation-section-nav";

type DepreciationSettingsView = {
  openingFiscalYear: number | null;
  firstSystemDepreciationDateBs: string | null;
  lastExternalDepreciationDateBs: string | null;
  source: "database" | "env" | "none";
  configuredByAdminId: number | null;
  configuredByAdminEmail: string | null;
  configuredAt: string | null;
  editable: boolean;
  lockReason: string | null;
};

type DepreciationSettingsAuditRow = {
  id: number;
  action: "CREATED" | "UPDATED";
  opening_fiscal_year: number;
  previous_opening_fiscal_year: number | null;
  first_system_depreciation_date_bs: string | null;
  previous_first_system_depreciation_date_bs: string | null;
  last_external_depreciation_date_bs: string | null;
  previous_last_external_depreciation_date_bs: string | null;
  configured_by_admin_id: number | null;
  configured_by_admin_email: string;
  configured_at: string;
};

const inputClass =
  "w-full max-w-xs rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand-primary)]/50 focus:ring-2 focus:ring-[var(--brand-primary)]/20";

const btnSaveClass =
  "inline-flex items-center justify-center rounded-lg border border-[rgb(15_81_50_/_0.25)] bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60";

function formatFiscalYearLabel(fyStart: number): string {
  return `${fyStart}-${fyStart + 1}`;
}

function formatSourceLabel(source: DepreciationSettingsView["source"]): string {
  if (source === "database") return "Database";
  if (source === "env") return "Environment fallback";
  return "Not configured";
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DepreciationSettingsScreen() {
  const formId = useId();
  const [settings, setSettings] = useState<DepreciationSettingsView | null>(
    null
  );
  const [auditLogs, setAuditLogs] = useState<DepreciationSettingsAuditRow[]>(
    []
  );
  const [openingFyInput, setOpeningFyInput] = useState("");
  const [firstSystemDateInput, setFirstSystemDateInput] = useState("");
  const [lastExternalDateInput, setLastExternalDateInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/depreciation-settings", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        settings?: DepreciationSettingsView;
        auditLogs?: DepreciationSettingsAuditRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not load depreciation settings.");
        setSettings(null);
        setAuditLogs([]);
        return;
      }
      const nextSettings = json.settings ?? null;
      setSettings(nextSettings);
      setAuditLogs(json.auditLogs ?? []);
      setOpeningFyInput(
        nextSettings?.openingFiscalYear != null
          ? String(nextSettings.openingFiscalYear)
          : ""
      );
      setFirstSystemDateInput(
        nextSettings?.firstSystemDepreciationDateBs ?? ""
      );
      setLastExternalDateInput(
        nextSettings?.lastExternalDepreciationDateBs ?? ""
      );
    } catch {
      setError("Could not load depreciation settings.");
      setSettings(null);
      setAuditLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveMessage(null);
    setError(null);
    const parsed = Number.parseInt(openingFyInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 2000) {
      setError("Opening fiscal year must be an integer ≥ 2000 (e.g. 2083).");
      return;
    }
    const firstSystem = firstSystemDateInput.trim();
    if (!firstSystem) {
      setError(
        "System calculates from date is required (e.g. 2083/04/01 or 2083/06/01)."
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/depreciation-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingFiscalYear: parsed,
          firstSystemDepreciationDateBs: firstSystem,
          lastExternalDepreciationDateBs:
            lastExternalDateInput.trim() === ""
              ? null
              : lastExternalDateInput.trim(),
        }),
      });
      const json = (await res.json()) as {
        settings?: DepreciationSettingsView;
        auditLogs?: DepreciationSettingsAuditRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not save depreciation settings.");
        return;
      }
      setSettings(json.settings ?? null);
      setAuditLogs(json.auditLogs ?? []);
      if (json.settings) {
        setFirstSystemDateInput(
          json.settings.firstSystemDepreciationDateBs ?? ""
        );
        setLastExternalDateInput(
          json.settings.lastExternalDepreciationDateBs ?? ""
        );
      }
      setSaveMessage("Depreciation settings saved.");
    } catch {
      setError("Could not save depreciation settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FixedAssetSectionTabs />
      <DepreciationSectionNav />

      <div className="rounded-2xl border border-[rgb(15_81_50_/_0.12)] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Depreciation Settings
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Opening Fiscal Year is the first fiscal year managed by this
              application.
            </p>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              For a mid-year migration, First System Depreciation Date is the
              first date from which this application calculates depreciation.
              Imported asset book values must represent balances immediately
              before this date.
            </p>
          </div>
          <Link
            href="/admin/dashboard/asset-register/depreciation"
            className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Back to runs
          </Link>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            {error ? (
              <p
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {saveMessage ? (
              <p
                className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
                role="status"
              >
                {saveMessage}
              </p>
            ) : null}

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <form onSubmit={(e) => void onSave(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor={`${formId}-opening-fy`}
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Opening fiscal year (start)
                  </label>
                  <input
                    id={`${formId}-opening-fy`}
                    type="number"
                    min={2000}
                    step={1}
                    className={inputClass}
                    value={openingFyInput}
                    onChange={(e) => setOpeningFyInput(e.target.value)}
                    disabled={!settings?.editable}
                    placeholder="e.g. 2083"
                    required
                  />
                  {openingFyInput.trim() &&
                  Number.isFinite(Number.parseInt(openingFyInput, 10)) ? (
                    <p className="mt-1 text-xs text-slate-500">
                      FY label:{" "}
                      {formatFiscalYearLabel(
                        Number.parseInt(openingFyInput, 10)
                      )}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor={`${formId}-first-system`}
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    System calculates from (BS)
                  </label>
                  <input
                    id={`${formId}-first-system`}
                    type="text"
                    className={inputClass}
                    value={firstSystemDateInput}
                    onChange={(e) => setFirstSystemDateInput(e.target.value)}
                    disabled={!settings?.editable}
                    placeholder="e.g. 2083/04/01 or 2083/06/01"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Use Shrawan 1 for a fiscal-year-boundary go-live, or a later
                    date for mid-year migration.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor={`${formId}-last-external`}
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Depreciation covered up to (BS, optional)
                  </label>
                  <input
                    id={`${formId}-last-external`}
                    type="text"
                    className={inputClass}
                    value={lastExternalDateInput}
                    onChange={(e) => setLastExternalDateInput(e.target.value)}
                    disabled={!settings?.editable}
                    placeholder="Derived as day before system calculates from"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    When set, must be the day immediately before the system
                    calculates from date.
                  </p>
                </div>

                <dl className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Current source</dt>
                    <dd className="font-medium text-slate-800">
                      {settings ? formatSourceLabel(settings.source) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Configured by</dt>
                    <dd className="text-right font-medium text-slate-800">
                      {settings?.configuredByAdminEmail ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Configured at</dt>
                    <dd className="font-medium text-slate-800">
                      {formatTimestamp(settings?.configuredAt ?? null)}
                    </dd>
                  </div>
                </dl>

                {settings?.lockReason ? (
                  <p
                    className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
                    role="note"
                  >
                    {settings.lockReason}
                  </p>
                ) : null}

                {settings?.source === "env" ? (
                  <p className="text-xs text-slate-500">
                    Currently using environment fallbacks (
                    <code className="rounded bg-slate-100 px-1">
                      DEPRECIATION_OPENING_FY
                    </code>
                    {" / "}
                    <code className="rounded bg-slate-100 px-1">
                      DEPRECIATION_FIRST_SYSTEM_DATE_BS
                    </code>
                    ). Save here to store values in the database.
                  </p>
                ) : null}

                <button
                  type="submit"
                  className={btnSaveClass}
                  disabled={saving || !settings?.editable}
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </form>

              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  Audit trail
                </h3>
                {auditLogs.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No changes recorded yet.
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">When</th>
                          <th className="px-3 py-2 font-medium">Action</th>
                          <th className="px-3 py-2 font-medium">Opening FY</th>
                          <th className="px-3 py-2 font-medium">
                            System calculates from
                          </th>
                          <th className="px-3 py-2 font-medium">By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditLogs.map((row) => (
                          <tr key={row.id}>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                              {formatTimestamp(row.configured_at)}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {row.action === "CREATED"
                                ? "Created"
                                : row.previous_opening_fiscal_year != null
                                  ? `Updated (${row.previous_opening_fiscal_year} → ${row.opening_fiscal_year})`
                                  : "Updated"}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {formatFiscalYearLabel(row.opening_fiscal_year)}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {row.first_system_depreciation_date_bs ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.configured_by_admin_email}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
