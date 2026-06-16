"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";
import {
  perUnitBookValue,
} from "@/lib/asset-register-per-unit";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";
import type { AssetDisposal, AssetRegisterRow } from "./asset-register-types";
import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";

const DISPOSAL_TYPES = [
  "SOLD",
  "SCRAPPED",
  "LOST",
  "WRITTEN_OFF",
  "DONATED",
] as const;

type DisposalType = (typeof DISPOSAL_TYPES)[number];

const ZERO_AMOUNT_TYPES = new Set<DisposalType>([
  "SCRAPPED",
  "LOST",
  "WRITTEN_OFF",
]);

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDepreciationBasis(a: AssetRegisterRow): string {
  const amount = perUnitBookValue({
    purchaseQty: a.purchase_qty,
    bookValue: a.book_value,
    oldBookValue: a.old_book_value,
    unitRate: a.unit_rate,
  });
  if (amount == null) return "—";
  return formatMoney(amount);
}

function DisposalDateCalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function BulkDisposalDialog({
  open,
  assets,
  onClose,
  onDisposed,
}: {
  open: boolean;
  assets: AssetRegisterRow[];
  onClose: () => void;
  onDisposed: (options?: { refreshOnly?: boolean }) => void;
}) {
  const formId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const suppressCloseEventRef = useRef(false);
  const [dialogAssets, setDialogAssets] = useState<AssetRegisterRow[]>([]);
  const [disposalDateBs, setDisposalDateBs] = useState("");
  const [disposalType, setDisposalType] = useState<DisposalType>("SCRAPPED");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [amountsByAssetId, setAmountsByAssetId] = useState<
    Record<number, string>
  >({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AssetDisposal[] | null>(null);
  const [disposalDatePickerReady, setDisposalDatePickerReady] = useState(false);
  const disposalDatePickerRef = useRef<HTMLDivElement>(null);
  const fieldsDisabled = submitting || saved != null;
  const amountsEditable = !ZERO_AMOUNT_TYPES.has(disposalType);

  const assetIdsKey = useMemo(
    () =>
      assets
        .map((a) => a.id)
        .sort((a, b) => a - b)
        .join(","),
    [assets]
  );

  const applyDisposalDateFromPicker = useCallback((value: string) => {
    setDisposalDateBs(normalizeBsDateEnglish(value));
  }, []);

  const openDisposalDateCalendar = useCallback(() => {
    disposalDatePickerRef.current?.querySelector<HTMLInputElement>("input")?.click();
  }, []);

  const closeDialog = useCallback(() => {
    const el = dialogRef.current;
    if (!el?.open) {
      onClose();
      return;
    }
    suppressCloseEventRef.current = true;
    el.close();
    suppressCloseEventRef.current = false;
    onClose();
  }, [onClose]);

  useEffect(() => {
    setDisposalDatePickerReady(true);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && assets.length > 0) {
      el.showModal();
      return;
    }
    if (el.open) {
      suppressCloseEventRef.current = true;
      el.close();
      suppressCloseEventRef.current = false;
    }
  }, [open, assets.length]);

  useEffect(() => {
    if (!open || assets.length === 0) {
      return;
    }
    setDialogAssets(assets);
    setDisposalDateBs("");
    setDisposalType("SCRAPPED");
    setReferenceNo("");
    setNotes("");
    setError(null);
    setRowErrors({});
    setSaved(null);
    setSubmitting(false);
    const initial: Record<number, string> = {};
    for (const asset of assets) {
      initial[asset.id] = "0";
    }
    setAmountsByAssetId(initial);
  }, [open, assetIdsKey, assets]);

  useEffect(() => {
    if (!open || !ZERO_AMOUNT_TYPES.has(disposalType)) {
      return;
    }
    setAmountsByAssetId((prev) => {
      const next = { ...prev };
      for (const asset of dialogAssets) {
        next[asset.id] = "0";
      }
      return next;
    });
  }, [open, disposalType, dialogAssets]);

  function handleDialogClose() {
    if (suppressCloseEventRef.current) {
      return;
    }
    onClose();
  }

  async function submit() {
    if (dialogAssets.length === 0) {
      setError("No assets selected.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setRowErrors({});

    const dateNorm = normalizeBsDateEnglish(disposalDateBs);
    if (!dateNorm) {
      setError("Disposal date is required.");
      setSubmitting(false);
      return;
    }

    const items: Array<{ asset_id: number; disposal_amount: number }> = [];
    const localRowErrors: Record<number, string> = {};

    for (const asset of dialogAssets) {
      const raw = amountsByAssetId[asset.id] ?? "";
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        localRowErrors[asset.id] = "Disposal amount must be zero or greater.";
        continue;
      }
      items.push({ asset_id: asset.id, disposal_amount: amount });
    }

    if (Object.keys(localRowErrors).length > 0) {
      setRowErrors(localRowErrors);
      setError("Fix disposal amounts before submitting.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/assets/disposals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disposal_date_bs: dateNorm,
          disposal_type: disposalType,
          reference_no: referenceNo.trim() || null,
          notes: notes.trim() || null,
          items,
        }),
      });
      const json = (await res.json()) as {
        disposals?: AssetDisposal[];
        error?: string;
        item_errors?: Array<{ asset_id: number; error: string }>;
      };
      if (!res.ok) {
        if (json.item_errors?.length) {
          const mapped: Record<number, string> = {};
          for (const item of json.item_errors) {
            mapped[item.asset_id] = item.error;
          }
          setRowErrors(mapped);
        }
        setError(json.error ?? "Could not dispose assets.");
        return;
      }
      setSaved(json.disposals ?? []);
      onDisposed({ refreshOnly: true });
    } catch {
      setError("Could not dispose assets.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleDialogClose}
      className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
    >
      {open && dialogAssets.length > 0 ? (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                id={`${formId}-title`}
                className="text-base font-semibold text-slate-900"
              >
                Bulk Dispose Assets
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {dialogAssets.length} selected asset
                {dialogAssets.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            >
              Close
            </button>
          </div>

          {saved ? (
            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <p className="font-medium">
                {saved.length} disposal{saved.length === 1 ? "" : "s"} saved.
              </p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="block text-sm">
              <span className="font-medium text-slate-700">
                Disposal Date (BS)
              </span>
              <p className="mt-0.5 text-xs text-slate-500">
                Type YYYY/MM/DD or use the calendar (Bikram Sambat).
              </p>
              <div
                className={`relative mt-1 overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-emerald-800/30 ${
                  fieldsDisabled ? "opacity-60" : ""
                }`}
              >
                <input
                  type="text"
                  value={disposalDateBs}
                  onChange={(e) => setDisposalDateBs(e.target.value)}
                  onBlur={() =>
                    setDisposalDateBs((prev) => normalizeBsDateEnglish(prev))
                  }
                  placeholder="YYYY/MM/DD"
                  disabled={fieldsDisabled}
                  className="w-full rounded-lg border-0 bg-transparent py-2 pl-3 pr-11 text-sm tabular-nums text-slate-900 outline-none disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={openDisposalDateCalendar}
                  disabled={fieldsDisabled}
                  className="absolute right-0 top-0 flex h-full w-10 items-center justify-center rounded-r-lg border-l border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed"
                  aria-label="Open Bikram Sambat calendar"
                  title="Open calendar"
                >
                  <DisposalDateCalendarIcon className="h-5 w-5" />
                </button>
                {disposalDatePickerReady ? (
                  <div
                    ref={disposalDatePickerRef}
                    className="disposal-bs-date-picker absolute left-0 right-0 top-full z-10 h-0 overflow-visible"
                  >
                    <NepaliDatePicker
                      value={bsDateToPickerValue(disposalDateBs)}
                      onChange={applyDisposalDateFromPicker}
                      onSelect={applyDisposalDateFromPicker}
                      inputClassName="sr-only"
                      className="block w-full overflow-visible"
                      options={{
                        calenderLocale: "ne",
                        valueLocale: "en",
                        closeOnSelect: true,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Disposal Type</span>
              <select
                value={disposalType}
                onChange={(e) =>
                  setDisposalType(e.target.value as DisposalType)
                }
                disabled={fieldsDisabled}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
              >
                {DISPOSAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Reference No</span>
              <input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                disabled={fieldsDisabled}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={fieldsDisabled}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
              />
            </label>
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Asset Code
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Asset Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Branch
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Book Value / NBV
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Disposal Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dialogAssets.map((asset) => (
                  <tr
                    key={asset.id}
                    className={rowErrors[asset.id] ? "bg-red-50/60" : "bg-white"}
                  >
                    <td className="max-w-[160px] px-3 py-2 font-mono text-xs text-slate-900 break-all">
                      {formatAssetCodeForDisplay(asset.asset_code)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {asset.asset_name}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {formatBranchOptionLabel({
                        branch_code: asset.branch_code,
                        branch_name: asset.branch_name,
                      })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                      {formatDepreciationBasis(asset)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountsByAssetId[asset.id] ?? ""}
                        onChange={(e) =>
                          setAmountsByAssetId((prev) => ({
                            ...prev,
                            [asset.id]: e.target.value,
                          }))
                        }
                        disabled={fieldsDisabled || !amountsEditable}
                        aria-invalid={Boolean(rowErrors[asset.id])}
                        aria-describedby={
                          rowErrors[asset.id]
                            ? `${formId}-err-${asset.id}`
                            : undefined
                        }
                        className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:bg-slate-50"
                      />
                      {rowErrors[asset.id] ? (
                        <p
                          id={`${formId}-err-${asset.id}`}
                          className="mt-1 text-left text-xs text-red-600"
                          role="alert"
                        >
                          {rowErrors[asset.id]}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={submitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {saved ? "Done" : "Cancel"}
            </button>
            {!saved ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Disposing…" : "Dispose Selected"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
