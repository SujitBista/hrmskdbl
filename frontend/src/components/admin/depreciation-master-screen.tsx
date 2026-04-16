"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";

export type DepreciationRunListRow = {
  id: number;
  fiscal_year_start: number;
  dep_title: string;
  quarter_no: number;
  months_covered: number;
  calculation_date_ad: string;
  calculation_date_bs: string;
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
  const [runs, setRuns] = useState<DepreciationRunListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editRemarks, setEditRemarks] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    } catch {
      setError("Could not load runs.");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId]
  );

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.id - a.id),
    [runs]
  );

  function exportList() {
    const header = [
      "DepID",
      "FiscalYear",
      "DepTitle",
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
        r.calculation_date_ad,
        r.calculation_date_bs,
        `"${(r.remarks ?? "").replace(/"/g, '""')}"`,
        r.is_final_for_fy ? "True" : "False",
      ].join(",")
    );
    downloadCsv(`depreciation-runs-${Date.now()}.csv`, [header, ...lines].join("\n"));
  }

  async function onDelete() {
    if (!selected) return;
    if (
      !window.confirm(
        `Delete depreciation run #${selected.id} (${selected.dep_title} ${formatFiscalYearLabel(selected.fiscal_year_start)})? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/depreciation-runs/${selected.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        window.alert(j.error ?? "Delete failed.");
        return;
      }
      setSelectedId(null);
      await load();
    } catch {
      window.alert("Delete failed.");
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Depreciation Master List
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Fiscal-year depreciation runs by fiscal year (Shrawan–Ashadh). Select a
            row and use Details.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/dashboard/asset-register/depreciation"
            className={`${btnPrimary} inline-flex items-center gap-1.5`}
          >
            <PlusIcon className="h-4 w-4" />
            Add New
          </Link>
          <button
            type="button"
            className={btnClass}
            disabled={!selected}
            onClick={openEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className={btnClass}
            disabled={!selected}
            onClick={onDelete}
          >
            Delete
          </button>
          <Link
            href={selected ? `/admin/dashboard/asset-register/depreciation/${selected.id}` : "#"}
            className={`${btnClass} ${!selected ? "pointer-events-none opacity-50" : ""}`}
            aria-disabled={!selected}
            onClick={(e) => {
              if (!selected) e.preventDefault();
            }}
          >
            Details
          </Link>
          <button type="button" className={btnClass} onClick={exportList}>
            Export
          </button>
          <Link href="/admin/dashboard/asset-register/depreciation/preview" className={btnClass}>
            Schedule preview
          </Link>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

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
            {loading ? (
              <tr>
                <td colSpan={7} className="border border-slate-300 px-3 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-slate-300 px-3 py-8 text-center text-slate-500">
                  No depreciation runs yet. Use Add New to post a quarter run.
                </td>
              </tr>
            ) : (
              sortedRuns.map((r) => (
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
