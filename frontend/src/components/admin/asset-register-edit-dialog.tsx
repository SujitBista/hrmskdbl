"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  NepaliDatePicker,
  type NepaliDatePickerValue,
} from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";

import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";
import {
  isLegacyMultiUnitQty,
  perUnitBookValue,
  perUnitPurchaseAmount,
  perUnitQtyDisplay,
} from "@/lib/asset-register-per-unit";
import type { AssetRegisterRow } from "./asset-register-types";

type GroupOption = { id: number; name: string; code?: string };
type SubGroupRow = {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
};
type BranchOption = {
  id: number;
  branch_code: string;
  branch_name: string;
};

type DepartmentOption = { id: number; name: string };
const DEPRECIATION_AUTORELOAD_AFTER_ASSET_EDIT_KEY =
  "hrmskdbl_depreciation_autoreload_after_asset_edit";

const OWNERSHIP_TYPES = ["Owner", "Lease"] as const;

const WORKING_STATUSES = [
  "In use",
  "Idle",
  "Under repair",
  "Retired",
  "Disposed",
] as const;

const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

export function AssetRegisterEditDialog({
  asset,
  groups,
  subGroups,
  branches,
  departments,
  lookupsBusy,
  onClose,
  onSaved,
}: {
  asset: AssetRegisterRow | null;
  groups: GroupOption[];
  subGroups: SubGroupRow[];
  branches: BranchOption[];
  departments: DepartmentOption[];
  lookupsBusy: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();

  const [assetName, setAssetName] = useState("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [subGroupId, setSubGroupId] = useState<number | "">("");
  const [ownershipType, setOwnershipType] = useState("");
  const [workingStatus, setWorkingStatus] = useState("");
  const [branchId, setBranchId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [purchaseDateBs, setPurchaseDateBs] = useState("");
  const [depreciationStartDateBs, setDepreciationStartDateBs] = useState("");
  const [purchaseDatePickerReady, setPurchaseDatePickerReady] =
    useState(false);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [unitRate, setUnitRate] = useState("");
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState("");
  /** Carrying amount (WDV); when set, depreciation runs use this instead of purchase amount. */
  const [bookValue, setBookValue] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPurchaseDatePickerReady(true);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (asset) {
      setAssetName(asset.asset_name);
      setGroupId(asset.group_id);
      setSubGroupId(asset.sub_group_id ?? "");
      setOwnershipType(asset.ownership_type);
      setWorkingStatus(asset.working_status);
      setBranchId(asset.branch_id);
      setDepartmentId(
        asset.department_id != null ? asset.department_id : ""
      );
      setPurchaseDateBs(asset.purchase_date_bs);
      setDepreciationStartDateBs(
        asset.depreciation_start_date_bs ?? asset.purchase_date_bs
      );
      setPurchaseQty(asset.purchase_qty ?? "");
      setUnitRate(asset.unit_rate ?? "");
      setPurchaseInvoiceNo(asset.purchase_invoice_no ?? "");
      setBookValue(
        asset.book_value != null && asset.book_value !== ""
          ? asset.book_value
          : ""
      );
      setError(null);
      el.showModal();
    } else {
      el.close();
    }
  }, [asset]);

  const subGroupsForGroup = useMemo(() => {
    if (groupId === "") return [];
    return subGroups.filter((sg) => sg.group_id === groupId);
  }, [subGroups, groupId]);

  /** Include current DB value if legacy (so the select stays controlled). */
  const ownershipOptions = useMemo(() => {
    const base = [...OWNERSHIP_TYPES] as string[];
    const cur = asset?.ownership_type;
    if (cur && !base.includes(cur)) {
      return [cur, ...base];
    }
    return base;
  }, [asset?.ownership_type]);

  useEffect(() => {
    if (subGroupId === "") return;
    const row = subGroups.find((sg) => sg.id === subGroupId);
    if (!row || row.group_id !== groupId) {
      setSubGroupId("");
    }
  }, [groupId, subGroupId, subGroups]);

  const purchaseAmountFormatted = useMemo(() => {
    const amount = perUnitPurchaseAmount(purchaseQty, unitRate);
    if (amount == null) return "";
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }, [purchaseQty, unitRate]);

  const legacyPerUnitPreview = useMemo(() => {
    if (!asset || !isLegacyMultiUnitQty(asset.purchase_qty)) return null;
    const perUnitBook = perUnitBookValue({
      purchaseQty: asset.purchase_qty,
      bookValue: asset.book_value,
      oldBookValue: asset.old_book_value,
      unitRate: asset.unit_rate,
    });
    return {
      qty: perUnitQtyDisplay(asset.purchase_qty),
      unitRate: asset.unit_rate ?? "—",
      purchaseAmount: perUnitPurchaseAmount(asset.purchase_qty, asset.unit_rate),
      bookValue: perUnitBook,
    };
  }, [asset]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!asset) return;
    setError(null);
    if (groupId === "") {
      setError("Select an asset group.");
      return;
    }
    if (subGroupsForGroup.length > 0 && subGroupId === "") {
      setError("Select an asset sub group for this group.");
      return;
    }
    if (branchId === "") {
      setError("Select a branch.");
      return;
    }
    if (!purchaseDateBs.trim()) {
      setError("Select a purchase date.");
      return;
    }
    if (!depreciationStartDateBs.trim()) {
      setError("Select a depreciation start date.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        asset_name: assetName.trim(),
        group_id: groupId,
        sub_group_id:
          subGroupsForGroup.length > 0 ? subGroupId : null,
        ownership_type: ownershipType,
        working_status: workingStatus,
        branch_id: branchId,
        department_id: departmentId === "" ? null : departmentId,
        purchase_date_bs: purchaseDateBs.trim(),
        depreciation_start_date_bs: depreciationStartDateBs.trim(),
        purchase_qty:
          purchaseQty.trim() === "" ? null : Number.parseFloat(purchaseQty),
        unit_rate:
          unitRate.trim() === "" ? null : Number.parseFloat(unitRate),
        purchase_invoice_no:
          purchaseInvoiceNo.trim() === "" ? null : purchaseInvoiceNo.trim(),
        book_value: (() => {
          const t = bookValue.trim();
          if (t === "") return null;
          const n = Number.parseFloat(t.replace(/,/g, ""));
          if (!Number.isFinite(n) || n <= 0) return null;
          return n;
        })(),
      };

      const res = await fetch(`/api/admin/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not update asset.");
        return;
      }
      const prevBookTrim = (asset.book_value ?? "").trim();
      if (
        asset.depreciation_start_date_bs !== depreciationStartDateBs.trim() ||
        prevBookTrim !== bookValue.trim()
      ) {
        sessionStorage.setItem(
          DEPRECIATION_AUTORELOAD_AFTER_ASSET_EDIT_KEY,
          "1"
        );
      }
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const noGroups = !lookupsBusy && groups.length === 0;
  const noBranches = !lookupsBusy && branches.length === 0;
  const busy = lookupsBusy || submitting;

  return (
    <dialog
      ref={dialogRef}
      className="fixed left-1/2 top-1/2 z-[210] max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
      onClose={onClose}
    >
      {asset ? (
        <form onSubmit={onSubmit}>
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-semibold text-slate-900">
              Edit asset
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Asset codes are generated automatically from branch, group, purchase
              date, and id.
            </p>
          </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${formId}-name`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset name
              </label>
              <input
                id={`${formId}-name`}
                type="text"
                required
                autoComplete="off"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <p className="block text-sm font-medium text-slate-700">Asset code</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Display:{" "}
                <span className="font-mono text-slate-700">
                  {formatAssetCodeForDisplay(asset.asset_code)}
                </span>
              </p>
            </div>
            <div>
              <label
                htmlFor={`${formId}-group`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset group
              </label>
              <select
                id={`${formId}-group`}
                required
                disabled={lookupsBusy || noGroups}
                value={groupId === "" ? "" : String(groupId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {lookupsBusy ? (
                  <option value="">Loading…</option>
                ) : noGroups ? (
                  <option value="">No asset groups</option>
                ) : (
                  groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.code ? `${g.code} — ${g.name}` : g.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-sub`}
                className="block text-sm font-medium text-slate-700"
              >
                Sub group
              </label>
              <select
                id={`${formId}-sub`}
                required={subGroupsForGroup.length > 0}
                disabled={
                  lookupsBusy || noGroups || subGroupsForGroup.length === 0
                }
                value={subGroupId === "" ? "" : String(subGroupId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setSubGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {subGroupsForGroup.length === 0 ? (
                  <option value="">No sub groups for this group</option>
                ) : (
                  <>
                    <option value="">— Select sub group —</option>
                    {subGroupsForGroup.map((sg) => (
                      <option key={sg.id} value={String(sg.id)}>
                        {sg.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-own`}
                className="block text-sm font-medium text-slate-700"
              >
                Ownership type
              </label>
              <select
                id={`${formId}-own`}
                required
                value={ownershipType}
                onChange={(e) => setOwnershipType(e.target.value)}
                className={fieldClass}
              >
                <option value="">— Select —</option>
                {ownershipOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-ws`}
                className="block text-sm font-medium text-slate-700"
              >
                Working status
              </label>
              <select
                id={`${formId}-ws`}
                required
                value={workingStatus}
                onChange={(e) => setWorkingStatus(e.target.value)}
                className={fieldClass}
              >
                <option value="">— Select —</option>
                {WORKING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-branch`}
                className="block text-sm font-medium text-slate-700"
              >
                Branch
              </label>
              <select
                id={`${formId}-branch`}
                required
                disabled={lookupsBusy || noBranches}
                value={branchId === "" ? "" : String(branchId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setBranchId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {lookupsBusy ? (
                  <option value="">Loading…</option>
                ) : noBranches ? (
                  <option value="">No branches</option>
                ) : (
                  branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {formatBranchOptionLabel(b)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-dept`}
                className="block text-sm font-medium text-slate-700"
              >
                Department
              </label>
              <select
                id={`${formId}-dept`}
                disabled={lookupsBusy}
                value={departmentId === "" ? "" : String(departmentId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDepartmentId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {lookupsBusy ? (
                  <option value="">Loading…</option>
                ) : (
                  <>
                    <option value="">— None —</option>
                    {asset?.department_id != null &&
                    !departments.some((d) => d.id === asset.department_id) ? (
                      <option value={String(asset.department_id)}>
                        {asset.department_name ?? `Department #${asset.department_id}`}{" "}
                        (unavailable)
                      </option>
                    ) : null}
                    {departments.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <span className="block text-sm font-medium text-slate-700">
              Purchase date (Bikram Sambat)
            </span>
            <p className="text-xs text-slate-500">
              Calendar in Nepali script; stored as English BS (YYYY/MM/DD).
            </p>
            <div className="relative mt-1 w-full max-w-md">
              <div className="pointer-events-none absolute inset-0 z-0 flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm tabular-nums">
                {purchaseDateBs ? (
                  purchaseDateBs
                ) : (
                  <span className="text-slate-400">Click to select date</span>
                )}
              </div>
              {purchaseDatePickerReady ? (
                <NepaliDatePicker
                  value={bsDateToPickerValue(purchaseDateBs)}
                  onChange={(value: NepaliDatePickerValue) => {
                    const next = normalizeBsDateEnglish(value);
                    setPurchaseDateBs(next);
                    setDepreciationStartDateBs((prev) =>
                      prev.trim() === "" ? next : prev
                    );
                  }}
                  inputClassName={`${fieldClass} relative z-10 cursor-pointer border-transparent bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent`}
                  className="w-full"
                  options={{
                    calenderLocale: "ne",
                    valueLocale: "en",
                    closeOnSelect: true,
                  }}
                />
              ) : (
                <div className={`${fieldClass} relative z-10 bg-transparent`} />
              )}
            </div>
          </div>

          <div className="space-y-3">
            <span className="block text-sm font-medium text-slate-700">
              Depreciation start date (Bikram Sambat)
            </span>
            <p className="text-xs text-slate-500">
              Used for depreciation schedules. Defaults when purchase date changes
              only if this field is empty.
            </p>
            <div className="relative mt-1 w-full max-w-md">
              <div className="pointer-events-none absolute inset-0 z-0 flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm tabular-nums">
                {depreciationStartDateBs ? (
                  depreciationStartDateBs
                ) : (
                  <span className="text-slate-400">Click to select date</span>
                )}
              </div>
              {purchaseDatePickerReady ? (
                <NepaliDatePicker
                  value={bsDateToPickerValue(depreciationStartDateBs)}
                  onChange={(value: NepaliDatePickerValue) =>
                    setDepreciationStartDateBs(normalizeBsDateEnglish(value))
                  }
                  inputClassName={`${fieldClass} relative z-10 cursor-pointer border-transparent bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent`}
                  className="w-full"
                  options={{
                    calenderLocale: "ne",
                    valueLocale: "en",
                    closeOnSelect: true,
                  }}
                />
              ) : (
                <div className={`${fieldClass} relative z-10 bg-transparent`} />
              )}
            </div>
          </div>

          {legacyPerUnitPreview ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Legacy multi-unit row</p>
              <p className="mt-1">
                Stored quantity is {asset?.purchase_qty}. Per unit: qty{" "}
                {legacyPerUnitPreview.qty}, unit rate{" "}
                {legacyPerUnitPreview.unitRate}, purchase amount{" "}
                {legacyPerUnitPreview.purchaseAmount != null
                  ? legacyPerUnitPreview.purchaseAmount.toLocaleString()
                  : "—"}
                {legacyPerUnitPreview.bookValue != null
                  ? `, book value ${legacyPerUnitPreview.bookValue.toLocaleString()}`
                  : ""}
                .
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Run{" "}
                <code className="rounded bg-amber-100 px-1">
                  npm run split-multi-qty-assets
                </code>{" "}
                in backend to register each unit separately.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor={`${formId}-qty`}
                className="block text-sm font-medium text-slate-700"
              >
                Quantity
              </label>
              <input
                id={`${formId}-qty`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={purchaseQty}
                onChange={(e) => setPurchaseQty(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-rate`}
                className="block text-sm font-medium text-slate-700"
              >
                Unit rate
              </label>
              <input
                id={`${formId}-rate`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={unitRate}
                onChange={(e) => setUnitRate(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-amt`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase amount{" "}
                <span className="font-normal text-slate-500">(qty × rate)</span>
              </label>
              <input
                id={`${formId}-amt`}
                type="text"
                readOnly
                tabIndex={-1}
                value={purchaseAmountFormatted}
                placeholder="—"
                aria-readonly="true"
                className={`${fieldClass} cursor-default bg-slate-50 text-slate-800`}
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-inv`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase invoice no.
              </label>
              <input
                id={`${formId}-inv`}
                type="text"
                autoComplete="off"
                value={purchaseInvoiceNo}
                onChange={(e) => setPurchaseInvoiceNo(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label
                htmlFor={`${formId}-book`}
                className="block text-sm font-medium text-slate-700"
              >
                Book value (depreciation basis)
              </label>
              <p className="mt-0.5 text-xs text-slate-500">
                Current written-down value from your legacy register. When set,
                depreciation uses this amount as the cost basis instead of
                purchase (qty × rate). Leave empty for new assets.
              </p>
              <input
                id={`${formId}-book`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={bookValue}
                onChange={(e) => setBookValue(e.target.value)}
                className={fieldClass}
                placeholder="Optional — e.g. from import Book Value column"
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || noGroups || noBranches}
              className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
        </form>
      ) : null}
    </dialog>
  );
}
