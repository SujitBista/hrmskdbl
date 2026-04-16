"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { FixedAssetSectionTabs } from "./fixed-asset-section-tabs";

import { normalizeBsDateEnglish } from "@/lib/bs-date-english";
import {
  computeOneYearDepreciationSchedule,
  depreciationMethodLabel,
  parseDepreciationMethod,
  type DepreciationCalculationMode,
  type DepreciationMethodCode,
  type DepreciationScheduleResult,
} from "@/lib/depreciation-schedule";
import { DepreciationScheduleGrid } from "./depreciation-schedule-grid";
import {
  parsePurchaseAmount,
  parseDepRatePercent,
} from "@/lib/asset-depreciation";
import type { AssetRegisterRow } from "./asset-register-types";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

const labelClass = "block text-sm font-medium text-slate-700";

type ListResponse = {
  assets: AssetRegisterRow[];
  total: number;
};

export function DepreciationScheduleScreen() {
  const formId = useId();
  const [assets, setAssets] = useState<AssetRegisterRow[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState<number | "">("");
  const [calculationMode, setCalculationMode] =
    useState<DepreciationCalculationMode>("ERP_ACCURATE");

  const [result, setResult] = useState<DepreciationScheduleResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setAssetsLoading(true);
      setAssetsError(null);
      try {
        const res = await fetch(`/api/admin/assets?page=1&pageSize=200`);
        const json = (await res.json()) as ListResponse & { error?: string };
        if (!res.ok) {
          if (!cancelled) {
            setAssetsError(json.error ?? "Could not load assets.");
            setAssets([]);
          }
          return;
        }
        if (!cancelled) setAssets(json.assets ?? []);
      } catch {
        if (!cancelled) {
          setAssetsError("Could not load assets.");
          setAssets([]);
        }
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

  /** Depreciation schedules use the register depreciation start date (falls back to purchase for legacy rows). */
  const scheduleStartDateBs = useMemo(() => {
    if (!selectedAsset) return "";
    const raw =
      selectedAsset.depreciation_start_date_bs?.trim() ||
      selectedAsset.purchase_date_bs;
    return normalizeBsDateEnglish(raw);
  }, [selectedAsset]);

  const runCalculation = useCallback(() => {
    if (!selectedAsset) {
      setResult(null);
      return;
    }
    const purchaseAmount = parsePurchaseAmount(
      selectedAsset.purchase_qty,
      selectedAsset.unit_rate
    );
    const depRate = parseDepRatePercent(selectedAsset.group_dep_rate);
    const method = parseDepreciationMethod(selectedAsset.group_dep_method);

    if (
      purchaseAmount === null ||
      depRate === null ||
      method === null ||
      purchaseAmount <= 0 ||
      depRate <= 0
    ) {
      setResult({
        ok: false,
        errors: [
          "Selected asset must have a positive purchase amount (qty × rate) and a positive group depreciation rate.",
        ],
      });
      return;
    }

    const r = computeOneYearDepreciationSchedule({
      purchaseAmount,
      purchaseDateBs: scheduleStartDateBs,
      depRatePercent: depRate,
      method: method as DepreciationMethodCode,
      calculationMode,
    });
    setResult(r);
  }, [selectedAsset, calculationMode, scheduleStartDateBs]);

  useEffect(() => {
    if (selectedAsset) {
      runCalculation();
    }
  }, [selectedAsset, calculationMode, scheduleStartDateBs, runCalculation]);

  const methodCode = selectedAsset
    ? parseDepreciationMethod(selectedAsset.group_dep_method)
    : null;

  const formulaCard = useMemo(() => {
    if (!methodCode) return null;
    const isErp = calculationMode === "ERP_ACCURATE";
    const daysLabel = isErp
      ? "WorkingDays: actual calendar days in each BS month slice"
      : "FixedDays: 30 per month (spreadsheet style)";

    if (methodCode === "STRAIGHT_LINE") {
      return {
        title: "Straight line",
        tint: "blue" as const,
        body: "The schedule always covers 12 projected monthly periods from the depreciation start date through the end of the 12th BS month, even if the asset is newer than one year. Each period uses the original purchase amount as the depreciation base.",
        lines: [
          `DepAmount = (PurchaseAmount × DepRate × ${isErp ? "WorkingDays" : "FixedDays"}) ÷ 365`,
          "BookValue = PurchaseAmount − TotalDepreciation (cumulative)",
          daysLabel + ".",
        ],
      };
    }
    return {
      title: "Declining balance",
      tint: "amber" as const,
      body: "Twelve projected monthly periods from the depreciation start date through the end of the 12th BS month. Each period uses that row’s opening book value as the base.",
      lines: [
        `DepAmount = (OpeningBookValue × DepRate × ${isErp ? "WorkingDays" : "FixedDays"}) ÷ 365`,
        "BookValue = OpeningBookValue − DepAmount",
        daysLabel + ".",
      ],
    };
  }, [methodCode, calculationMode]);

  return (
    <div className="flex flex-col gap-6">
      <FixedAssetSectionTabs />
      <div>
        <Link
          href="/admin/dashboard/asset-register/depreciation"
          className="text-sm font-medium text-emerald-800 hover:underline"
        >
          ← Depreciation master list
        </Link>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">
          Book value depreciation schedule (preview)
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          First-year projected depreciation from the register depreciation start
          date (12 BS months). Rates and method come from the asset group; cost
          and dates from the register.
        </p>
      </div>

      <div className="rounded-xl border border-emerald-900/10 bg-white p-4 shadow-sm">
        <form id={formId} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass} htmlFor={`${formId}-asset`}>
              Asset (register)
            </label>
            <select
              id={`${formId}-asset`}
              className={inputClass}
              value={selectedAssetId === "" ? "" : String(selectedAssetId)}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedAssetId(v === "" ? "" : Number(v));
              }}
              disabled={assetsLoading}
            >
              <option value="">
                {assetsLoading ? "Loading…" : "Select an asset"}
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAssetCodeForDisplay(a.asset_code)} {a.asset_name} —{" "}
                  {a.group_code}
                </option>
              ))}
            </select>
            {assetsError ? (
              <p className="mt-1 text-sm text-red-600">{assetsError}</p>
            ) : null}
          </div>

          {selectedAsset ? (
            <div className="sm:col-span-2 lg:col-span-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p>
                <span className="font-medium text-slate-800">Group:</span>{" "}
                {selectedAsset.group_name} ({selectedAsset.group_code})
              </p>
              <p className="mt-0.5">
                <span className="font-medium text-slate-800">Method (auto):</span>{" "}
                {methodCode
                  ? depreciationMethodLabel(methodCode)
                  : "—"}{" "}
                ·{" "}
                <span className="font-medium text-slate-800">Dep rate:</span>{" "}
                {selectedAsset.group_dep_rate ?? "—"}%
              </p>
              <p className="mt-0.5 font-mono text-slate-800">
                <span className="font-sans font-medium">Purchase date (BS):</span>{" "}
                {normalizeBsDateEnglish(selectedAsset.purchase_date_bs) || "—"}
              </p>
              <p className="mt-0.5 font-mono text-slate-800">
                <span className="font-sans font-medium">
                  Depreciation start (BS):
                </span>{" "}
                {scheduleStartDateBs || "—"}
              </p>
            </div>
          ) : null}

          <div>
            <label className={labelClass} htmlFor={`${formId}-calc-mode`}>
              Calculation mode
            </label>
            <select
              id={`${formId}-calc-mode`}
              className={inputClass}
              value={calculationMode}
              onChange={(e) =>
                setCalculationMode(
                  e.target.value as DepreciationCalculationMode
                )
              }
            >
              <option value="ERP_ACCURATE">
                ERP Accurate (actual days, opening book value)
              </option>
              <option value="EXCEL_FIXED">
                Excel Fixed (30-day monthly / fixed yearly style)
              </option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {calculationMode === "ERP_ACCURATE"
                ? "Uses actual days per BS month slice."
                : "Uses 30 days per month for each row, like many spreadsheets."}
            </p>
          </div>
        </form>
      </div>

      {formulaCard && formulaCard.tint === "blue" ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
          <p className="font-medium">{formulaCard.title}</p>
          <p className="mt-1">{formulaCard.body}</p>
          <p className="mt-2 font-mono text-xs leading-relaxed">
            {formulaCard.lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {formulaCard && formulaCard.tint === "amber" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">{formulaCard.title}</p>
          <p className="mt-1">{formulaCard.body}</p>
          <p className="mt-2 font-mono text-xs leading-relaxed">
            {formulaCard.lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {selectedAsset && !methodCode ? (
        <p className="text-sm text-amber-800">
          This asset&rsquo;s group does not have a recognized depreciation
          method. Update the asset group to Straight Line or Declining Balance.
        </p>
      ) : null}

      <DepreciationScheduleGrid result={result} />
    </div>
  );
}
