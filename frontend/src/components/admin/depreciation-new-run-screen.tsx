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
  "w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 shadow-sm outline-none ring-blue-500/30 focus:border-blue-500 focus:ring-1";
const labelClass =
  "pt-2 text-right text-sm font-medium leading-tight text-slate-700";

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

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
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
  /** FY_END = through selected fiscal quarter end (existing). AS_OF_DATE = through calculation date (capped to FY end). */
  const [calculationScopeMode, setCalculationScopeMode] = useState<
    "FY_END" | "AS_OF_DATE"
  >("FY_END");
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
        depreciationScopeMode: calculationScopeMode,
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
    <div className="min-h-[calc(100vh-8rem)] bg-slate-100/90 pb-10">
      <div className="mx-auto max-w-4xl px-4 pt-4">
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
          {calculationScopeMode === "FY_END" ? (
            <>
              Saving replaces the <span className="font-medium">full fiscal-year</span>{" "}
              depreciation sheet for that fiscal year and branch scope and
              recalculates <span className="font-medium">all</span> register assets
              (through the selected quarter / fiscal year end).
            </>
          ) : (
            <>
              Saving stores an{" "}
              <span className="font-medium">as-of-date snapshot</span> for that
              fiscal year (depreciation through the calculation date, capped at
              fiscal year end). Multiple as-of dates per year are kept; the same
              date saved again replaces only that snapshot.
            </>
          )}
        </p>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="mt-4 rounded border border-slate-300 bg-white p-6 shadow-sm"
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid grid-cols-[minmax(132px,150px)_1fr] items-start gap-x-3 md:col-span-2">
              <label className={labelClass} htmlFor={`${formId}-scope-mode`}>
                Calculation mode
              </label>
              <div>
                <select
                  id={`${formId}-scope-mode`}
                  className={inputClass}
                  value={calculationScopeMode}
                  onChange={(e) =>
                    setCalculationScopeMode(
                      e.target.value === "AS_OF_DATE" ? "AS_OF_DATE" : "FY_END"
                    )
                  }
                >
                  <option value="FY_END">Full fiscal year (through quarter / FY end)</option>
                  <option value="AS_OF_DATE">As of calculation date</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {calculationScopeMode === "FY_END"
                    ? "Uses the selected month to determine which fiscal quarter is closed — depreciation runs through that quarter’s end (Q4 = full fiscal year end)."
                    : "Depreciation amounts are only through the calculation date (not the full fiscal year)."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(132px,150px)_1fr] items-start gap-x-3">
              <span id={`${formId}-calc-bs-label`} className={labelClass}>
                CalculationDate
              </span>
              <div>
                <p
                  id={`${formId}-calc-bs-hint`}
                  className="text-xs text-slate-500"
                >
                  Bikram Sambat — calendar in Nepali script; value is stored as
                  English BS (YYYY/MM/DD).
                </p>
                <div
                  className="relative mt-1 w-full max-w-md rounded-lg focus-within:ring-2 focus-within:ring-emerald-800/25 focus-within:ring-offset-1"
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
                      <div className="pointer-events-none absolute inset-0 z-10 flex min-h-[44px] items-center justify-between gap-2 rounded-lg border-2 border-emerald-900/15 bg-white px-3 py-2 shadow-sm ring-1 ring-slate-900/5">
                        <span className="min-w-0 truncate font-mono text-sm tabular-nums text-slate-900">
                          {calculationDateBs ? (
                            calculationDateBs
                          ) : (
                            <span className="font-sans text-slate-400">
                              Select date (Bikram Sambat)…
                            </span>
                          )}
                        </span>
                        <CalendarGlyph className="h-5 w-5 shrink-0 text-emerald-800/70" />
                      </div>
                    </>
                  ) : (
                    <div
                      className={`${inputClass} min-h-[44px] rounded-lg border-2 border-dashed border-slate-200`}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(132px,150px)_1fr] items-start gap-x-3">
              <label className={labelClass} htmlFor={`${formId}-dep-title`}>
                DepTitle
              </label>
              <div>
                <input
                  id={`${formId}-dep-title`}
                  className={inputClass}
                  placeholder='Optional — e.g. "Q1 Depreciation 2082"'
                  value={depTitle}
                  onChange={(e) => setDepTitle(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  If empty, a default fiscal-year title is used.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(132px,150px)_1fr] items-start gap-x-3">
              <label className={labelClass} htmlFor={`${formId}-month`}>
                Select Month
              </label>
              <select
                id={`${formId}-month`}
                className={inputClass}
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

            <div className="grid grid-cols-[minmax(132px,150px)_1fr] items-start gap-x-3">
              <label className={`${labelClass} pt-1`} htmlFor={`${formId}-remarks`}>
                Remarks
              </label>
              <textarea
                id={`${formId}-remarks`}
                className={`${inputClass} min-h-[100px] resize-y`}
                rows={4}
                placeholder="Optional notes"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-6">
            <Link
              href="/admin/dashboard/asset-register/depreciation"
              className="inline-flex items-center gap-2 rounded border border-orange-400 bg-orange-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600"
            >
              <XIcon className="h-4 w-4" />
              Cancel
            </Link>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded border border-blue-700 bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
