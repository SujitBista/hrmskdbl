"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import NepaliDate from "nepali-date-converter";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";

import { normalizeBsDateEnglish, bsDateToPickerValue } from "@/lib/bs-date-english";
import {
  computeDepreciationSchedule,
  depreciationMethodLabel,
  parseDepreciationMethod,
  type DepreciationMethodCode,
  type DepreciationPeriodMode,
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
  const [calcFromBs, setCalcFromBs] = useState("");
  const [calcToBs, setCalcToBs] = useState("");
  const [rangePickersReady, setRangePickersReady] = useState(false);

  const [periodMode, setPeriodMode] =
    useState<DepreciationPeriodMode>("monthly");
  const [customDays, setCustomDays] = useState(30);

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

  const applyAssetDefaults = useCallback((row: AssetRegisterRow) => {
    const purchaseBs = normalizeBsDateEnglish(row.purchase_date_bs);
    setCalcFromBs(purchaseBs);
    try {
      const p = new NepaliDate(purchaseBs.replace(/\//g, "-"));
      const end = new NepaliDate(p.toJsDate());
      end.setMonth(end.getMonth() + 2);
      setCalcToBs(end.format("YYYY/MM/DD"));
    } catch {
      setCalcToBs(purchaseBs);
    }
  }, []);

  useEffect(() => {
    if (selectedAssetId === "") return;
    const row = assets.find((a) => a.id === selectedAssetId);
    if (row) applyAssetDefaults(row);
  }, [selectedAssetId, assets, applyAssetDefaults]);

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

    const r = computeDepreciationSchedule({
      purchaseAmount,
      purchaseDateBs: normalizeBsDateEnglish(selectedAsset.purchase_date_bs),
      depRatePercent: depRate,
      method: method as DepreciationMethodCode,
      calculationFromBs: calcFromBs,
      calculationToBs: calcToBs,
      periodMode,
      customDaysPerPeriod:
        periodMode === "custom_days" ? customDays : undefined,
    });
    setResult(r);
  }, [selectedAsset, calcFromBs, calcToBs, periodMode, customDays]);

  useEffect(() => {
    if (selectedAsset && calcFromBs && calcToBs) {
      runCalculation();
    }
  }, [
    selectedAsset,
    calcFromBs,
    calcToBs,
    periodMode,
    customDays,
    runCalculation,
  ]);

  useEffect(() => {
    setRangePickersReady(true);
  }, []);

  const methodCode = selectedAsset
    ? parseDepreciationMethod(selectedAsset.group_dep_method)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Book value depreciation schedule
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Carrying value after accumulated depreciation (not market value). Rates
          and method come from the asset group; cost and purchase date from the
          register.
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
            </div>
          ) : null}

          <div>
            <label className={labelClass} htmlFor={`${formId}-from`}>
              Calculation from (BS)
            </label>
            {rangePickersReady ? (
              <NepaliDatePicker
                value={bsDateToPickerValue(calcFromBs)}
                onChange={(value) =>
                  setCalcFromBs(normalizeBsDateEnglish(value))
                }
                className="mt-1 w-full"
              />
            ) : (
              <input
                id={`${formId}-from`}
                type="text"
                className={inputClass}
                readOnly
                value="Loading calendar…"
              />
            )}
          </div>
          <div>
            <label className={labelClass} htmlFor={`${formId}-to`}>
              Calculation to (BS)
            </label>
            {rangePickersReady ? (
              <NepaliDatePicker
                value={bsDateToPickerValue(calcToBs)}
                onChange={(value) =>
                  setCalcToBs(normalizeBsDateEnglish(value))
                }
                className="mt-1 w-full"
              />
            ) : (
              <input
                id={`${formId}-to`}
                type="text"
                className={inputClass}
                readOnly
                value="Loading calendar…"
              />
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor={`${formId}-mode`}>
              Period mode
            </label>
            <select
              id={`${formId}-mode`}
              className={inputClass}
              value={periodMode}
              onChange={(e) =>
                setPeriodMode(e.target.value as DepreciationPeriodMode)
              }
            >
              <option value="monthly">Monthly (BS calendar months)</option>
              <option value="yearly">Yearly (BS years)</option>
              <option value="custom_days">Custom (fixed calendar days)</option>
            </select>
          </div>

          {periodMode === "custom_days" ? (
            <div>
              <label className={labelClass} htmlFor={`${formId}-cd`}>
                Days per period
              </label>
              <input
                id={`${formId}-cd`}
                type="number"
                min={1}
                className={inputClass}
                value={customDays}
                onChange={(e) =>
                  setCustomDays(Number.parseInt(e.target.value, 10) || 1)
                }
              />
            </div>
          ) : null}
        </form>
      </div>

      {methodCode === "STRAIGHT_LINE" ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
          <p className="font-medium">Straight line</p>
          <p className="mt-1">
            Depreciation for each period uses the <strong>original purchase
            amount</strong> as the base (not prior book value).
          </p>
          <p className="mt-2 font-mono text-xs leading-relaxed">
            DepAmount = (PurchaseAmount × DepRate × WorkingDays) ÷ 365<br />
            BookValue = PurchaseAmount − TotalDepAmount
          </p>
        </div>
      ) : null}

      {methodCode === "DECLINING_BALANCE" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Declining balance</p>
          <p className="mt-1">
            Each period&rsquo;s depreciation uses the <strong>opening book value
            </strong> for that period as the base.
          </p>
          <p className="mt-2 font-mono text-xs leading-relaxed">
            DepAmount = (OpeningBookValue × DepRate × WorkingDays) ÷ 365<br />
            BookValue = OpeningBookValue − DepAmount
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
