"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { DepreciationRunListRow } from "./depreciation-master-screen";
import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";

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
  fiscal_year: number;
  purchase_date_bs: string;
  purchase_price: string;
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
  balance_amount: string;
  created_at: string;
};

function formatAmount(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const DEPRECIATION_HUB =
  "/admin/dashboard/asset-register/depreciation";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skippedNotice, setSkippedNotice] = useState<
    { asset_id: number; asset_name: string; reason: string }[] | null
  >(null);

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
      const res = await fetch(`/api/admin/depreciation-runs/${runId}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const json = (await res.json()) as {
        run?: DepreciationRunListRow;
        details?: DetailRow[];
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
        return;
      }
      setRun(json.run ?? null);
      setDetails(json.details ?? []);
    } catch {
      setError("Could not load run.");
      setRun(null);
      setDetails([]);
    } finally {
      if (endLoading) {
        setLoading(false);
      }
    }
  }, [runId, router]);

  useEffect(() => {
    void load();
  }, [load]);

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

  function exportDetails() {
    if (!run) return;
    const header = [
      "FiscalYear",
      "AssetCode",
      "Group",
      "PurchaseDate",
      "PurchasePrice",
      "DepStartDate",
      "DepRate",
      "ThisYearDepAmount",
      "AccumulatedDep",
      "BookValue",
    ].join(",");
    const lines = details.map((d) =>
      [
        formatFiscalYearLabel(d.fiscal_year),
        `"${formatAssetCodeForDisplay(d.asset_code).replace(/"/g, '""')}"`,
        `"${d.group_name.replace(/"/g, '""')}"`,
        d.purchase_date_bs,
        d.purchase_price,
        d.dep_start_date_bs,
        d.dep_rate,
        d.dep_amount,
        d.accumulate_dep,
        d.book_value,
      ].join(",")
    );
    downloadCsv(
      `depreciation-run-${run.id}-details.csv`,
      [header, ...lines].join("\n")
    );
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
              Depreciation Details{" "}
              <span className="text-slate-600">
                ({formatFiscalYearLabel(run.fiscal_year_start)})
              </span>
            </h2>
          ) : (
            <h2 className="text-lg font-semibold text-slate-900">Depreciation Details</h2>
          )}
          {run ? (
            <p className="mt-1 text-sm text-slate-600">
              Run #{run.id} · Calculation{" "}
              <span className="font-mono">{run.calculation_date_bs}</span> (BS) ·
              Final for FY: {run.is_final_for_fy ? "Yes" : "No"}
              <span className="block pt-1 text-slate-500">
                DepDays = inclusive calendar days from FY Shrawan 1 (or
                depreciation start, if later) through fiscal year end. This Year
                Dep Amount = current fiscal-year depreciation only;
                AccumulatedDep = lifetime depreciation through fiscal year end.
              </span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={!run || details.length === 0}
          onClick={exportDetails}
        >
          Export
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

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

      <div className="overflow-x-auto rounded-xl border border-emerald-900/10 bg-white shadow-sm">
        <table className="min-w-[1300px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <th className="border border-slate-300 px-2 py-2">Fiscal Year</th>
              <th className="border border-slate-300 px-2 py-2">Asset Code</th>
              <th className="border border-slate-300 px-2 py-2">Group</th>
              <th className="border border-slate-300 px-2 py-2">Purchase Date</th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Purchase Price
              </th>
              <th className="border border-slate-300 px-2 py-2">Dep Start Date</th>
              <th className="border border-slate-300 px-2 py-2 text-right">Dep Rate</th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                This Year Dep Amount
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                AccumulatedDep
              </th>
              <th className="border border-slate-300 px-2 py-2 text-right">
                Book Value
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={10}
                  className="border border-slate-300 px-3 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : details.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="border border-slate-300 px-3 py-8 text-center text-slate-500"
                >
                  No detail rows.
                </td>
              </tr>
            ) : (
              details.map((d) => (
                <tr key={d.id} className="bg-white odd:bg-slate-50/60">
                  <td className="border border-slate-300 px-2 py-1.5 whitespace-nowrap text-slate-800">
                    {formatFiscalYearLabel(d.fiscal_year)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800">
                    {formatAssetCodeForDisplay(d.asset_code)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-slate-700">
                    {d.group_name}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800">
                    {d.purchase_date_bs}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.purchase_price)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800">
                    {d.dep_start_date_bs}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {d.dep_rate}%
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.dep_amount)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-800">
                    {formatAmount(d.accumulate_dep)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-xs tabular-nums font-semibold text-emerald-900">
                    {formatAmount(d.book_value)}
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
