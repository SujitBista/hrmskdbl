"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";

import {
  NEPALI_MONTHS_ORDERED_EN,
  nepaliCalendarMonthIndexFromBs,
  nepaliMonthNameToCalendarIndex,
} from "@hrmskdbl/depreciation-core";
import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";
import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";

const inputClass =
  "w-full rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20";

const fieldLabel =
  "mb-1 block text-sm font-medium leading-5 text-slate-700";

const formCardClass =
  "mt-4 rounded-2xl border border-[rgb(15_81_50_/_0.12)] bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.1),0_2px_10px_-4px_rgba(15,23,42,0.06)] sm:p-8";

const fieldGroupClass =
  "flex flex-col gap-6 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5 sm:gap-7 sm:p-6";

const sectionGroupTitleClass =
  "text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";

const btnSaveClass =
  "inline-flex min-w-[7.5rem] items-center justify-center gap-2 rounded-lg border border-blue-700/20 bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";

/** Secondary action — light outline, brand green; does not compete with solid Save. */
const btnCancelClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--brand-primary)]/35 bg-white px-4 py-2.5 text-sm font-normal text-[var(--brand-primary)] shadow-sm transition hover:bg-[var(--brand-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]/50";

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path strokeLinecap="round" d="M3 8h14M7 3v3M13 3v3" />
    </svg>
  );
}

function SaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V7.414A2 2 0 0017.414 6L14 2.586A2 2 0 0012.586 2H4zm4 2h4v4H8V5zm-1 6h6a1 1 0 011 1v5H7v-5a1 1 0 011-1z" />
    </svg>
  );
}

export function DepreciationNewRunScreen() {
  const formId = useId();
  const router = useRouter();
  const [calculationDateBs, setCalculationDateBs] = useState("");
  const [nepaliMonth, setNepaliMonth] = useState<string>(
    NEPALI_MONTHS_ORDERED_EN[0]!
  );
  const [depTitle, setDepTitle] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** NepaliDatePicker is client-only — avoids SSR / hydration mismatches. */
  const [calcDatePickerReady, setCalcDatePickerReady] = useState(false);

  useEffect(() => {
    setCalcDatePickerReady(true);
  }, []);

  const fyBadge = useMemo(() => {
    const raw = calculationDateBs.trim();
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return null;
    const y = Number.parseInt(raw.slice(0, 4), 10);
    const m = Number.parseInt(raw.slice(5, 7), 10) - 1;
    if (!Number.isFinite(y) || m < 0 || m > 11) return null;
    const fyStart = m >= 3 ? y : y - 1;
    return `FY: ${fyStart}-${fyStart + 1}`;
  }, [calculationDateBs]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const calc = calculationDateBs.trim();
    if (!calc) {
      setError("Calculation date (BS) is required.");
      return;
    }
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(calc)) {
      setError("Use BS date format YYYY/MM/DD.");
      return;
    }

    const dateMonthIdx = nepaliCalendarMonthIndexFromBs(calc);
    const selectedIdx = nepaliMonthNameToCalendarIndex(nepaliMonth);
    if (
      dateMonthIdx !== null &&
      selectedIdx !== null &&
      dateMonthIdx !== selectedIdx
    ) {
      setError(
        `Selected month (${nepaliMonth}) does not match the calculation date’s Bikram month (${NEPALI_MONTHS_ORDERED_EN[dateMonthIdx]}).`
      );
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        calculationDateBs: calc,
        nepaliMonth,
        remarks: remarks.trim() || null,
      };
      if (depTitle.trim()) {
        body.depTitle = depTitle.trim();
      }

      const res = await fetch("/api/admin/depreciation-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        run?: { id: number };
        detailsInserted?: number;
        skippedAssets?: { asset_id: number; asset_name: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not save.");
        return;
      }
      if (json.skippedAssets && json.skippedAssets.length > 0) {
        const lines = json.skippedAssets.map(
          (s) => `#${s.asset_id} ${s.asset_name}: ${s.reason}`
        );
        window.alert(
          `Depreciation run saved (${json.detailsInserted ?? 0} row(s) in the sheet).\n\n` +
            `${json.skippedAssets.length} asset(s) were skipped and will not appear in this run:\n\n` +
            lines.join("\n")
        );
        try {
          sessionStorage.setItem(
            "hrmskdbl_depreciation_skipped",
            JSON.stringify(json.skippedAssets)
          );
        } catch {
          /* ignore */
        }
      }
      const runId = json.run?.id;
      if (runId && Number.isFinite(runId)) {
        router.push(`/admin/dashboard/asset-register/depreciation/${runId}`);
      } else {
        router.push("/admin/dashboard/asset-register/depreciation");
      }
      router.refresh();
    } catch {
      setError("Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-[var(--background)] pb-10">
      <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-5">
        <FixedAssetSectionTabs />

        <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
          <span>Modules</span>
          <span className="px-1 text-slate-400">»</span>
          <span className="text-slate-600">Fixed Assets</span>
        </nav>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Add Depreciation Master
          </h1>
          {fyBadge ? (
            <span className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-600">
              {fyBadge}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Saving stores an <span className="font-medium">as-of-date snapshot</span>{" "}
          for that fiscal year (depreciation through the calculation date, capped at
          fiscal year end). Multiple as-of dates per year are kept; the same date
          saved again replaces only that snapshot.
        </p>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className={formCardClass}
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
            <div className={fieldGroupClass}>
              <p className={sectionGroupTitleClass}>Calculation date &amp; month</p>
              <div className="min-w-0">
                <span id={`${formId}-calc-bs-label`} className={fieldLabel}>
                  CalculationDate
                </span>
                <p
                  id={`${formId}-calc-bs-hint`}
                  className="mt-0.5 text-xs leading-relaxed text-slate-500"
                >
                  Bikram Sambat — calendar in Nepali script; value is stored as
                  English BS (YYYY/MM/DD).
                </p>
                <div
                  className="relative mt-2 w-full rounded-lg focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:ring-offset-0"
                  aria-labelledby={`${formId}-calc-bs-label`}
                  aria-describedby={`${formId}-calc-bs-hint`}
                >
                  {/*
                    Picker first (invisible input); display layer on top with pointer-events-none
                    so the visible date is never covered by a transparent input (previous bug).
                  */}
                  {calcDatePickerReady ? (
                    <>
                      <NepaliDatePicker
                        value={bsDateToPickerValue(calculationDateBs)}
                        onChange={(value) => {
                          const raw =
                            typeof value === "string" ? value : String(value ?? "");
                          setCalculationDateBs(normalizeBsDateEnglish(raw));
                        }}
                        inputClassName="relative z-0 min-h-[44px] w-full cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2.5 text-sm opacity-0 outline-none"
                        className="w-full"
                        options={{
                          calenderLocale: "ne",
                          valueLocale: "en",
                          closeOnSelect: true,
                        }}
                      />
                      <div className="pointer-events-none absolute inset-0 z-10 flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-sm">
                        <span className="min-w-0 truncate font-mono text-sm tabular-nums text-slate-900">
                          {calculationDateBs ? (
                            calculationDateBs
                          ) : (
                            <span className="font-sans text-slate-400">
                              Select date (Bikram Sambat)…
                            </span>
                          )}
                        </span>
                        <CalendarGlyph className="h-5 w-5 shrink-0 text-[var(--brand-primary)]/70" />
                      </div>
                    </>
                  ) : (
                    <div
                      className={`${inputClass} min-h-[44px] border-dashed border-slate-200`}
                    />
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <label className={fieldLabel} htmlFor={`${formId}-month`}>
                  Select Month
                </label>
                <select
                  id={`${formId}-month`}
                  className={`${inputClass} mt-2`}
                  value={nepaliMonth}
                  onChange={(e) => setNepaliMonth(e.target.value)}
                  required
                >
                  {NEPALI_MONTHS_ORDERED_EN.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={fieldGroupClass}>
              <p className={sectionGroupTitleClass}>Run title &amp; notes</p>
              <div className="min-w-0">
                <label className={fieldLabel} htmlFor={`${formId}-dep-title`}>
                  DepTitle
                </label>
                <input
                  id={`${formId}-dep-title`}
                  className={`${inputClass} mt-2`}
                  placeholder='Optional — e.g. "Q1 Depreciation 2082"'
                  value={depTitle}
                  onChange={(e) => setDepTitle(e.target.value)}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  If empty, a default fiscal-year title is used.
                </p>
              </div>

              <div className="min-w-0">
                <label className={fieldLabel} htmlFor={`${formId}-remarks`}>
                  Remarks
                </label>
                <textarea
                  id={`${formId}-remarks`}
                  className={`${inputClass} mt-2 min-h-[7.5rem] resize-y`}
                  rows={4}
                  placeholder="Optional notes"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>
          </div>

          {error ? (
            <p className="mt-7 rounded-lg border border-red-200/90 bg-red-50/90 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col items-stretch gap-2.5 border-t border-slate-200/80 pt-6 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <Link
              href="/admin/dashboard/asset-register/depreciation"
              className={`${btnCancelClass} w-full min-w-0 sm:w-auto sm:min-w-[6.5rem]`}
            >
              Cancel
            </Link>
            <button
              type="submit"
              className={`${btnSaveClass} w-full min-w-0 sm:w-auto`}
              disabled={submitting}
            >
              <SaveIcon className="h-4 w-4" />
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
