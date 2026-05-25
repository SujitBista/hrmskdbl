"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";
import { formatAssetCodeForDisplay } from "@/lib/format-asset-code";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";
import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";

type ProfilePayload = {
  profile: {
    asset_id: number;
    asset_code: string | null;
    asset_name: string;
    purchase_date_bs: string;
    working_status: string;
    asset_status: "ACTIVE" | "DISPOSED";
    group_name: string;
    purchase_amount: string | null;
    dep_method: string | null;
    asset_user: string | null;
    branch_name: string;
    department_name: string | null;
    branch_id: number;
    department_id: number | null;
    allocation_date_bs: string;
  };
  history: Array<{
    allocation_id: number | null;
    purchase_date_bs: string;
    allocation_date_display: string;
    fiscal_year: string | null;
    allocation_type: string;
    old_asset_code: string;
    asset_user: string | null;
    responsible_unit_name: string | null;
    branch_name: string;
    department_name: string | null;
  }>;
};

type BranchOption = { id: number; branch_code: string; branch_name: string };
type DepartmentOption = { id: number; name: string };

const fieldLabel =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-600";
const inputClass =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/30";

function formatMoneyLike(raw: string | null): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(raw).trim();
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayText(v: string | null | undefined): string {
  if (v == null || String(v).trim() === "") return "—";
  return String(v).trim();
}

async function fetchAllBranches(): Promise<BranchOption[]> {
  const out: BranchOption[] = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const res = await fetch(
      `/api/admin/branches?page=${page}&pageSize=${pageSize}`
    );
    const json = (await res.json()) as {
      branches?: BranchOption[];
      total?: number;
    };
    if (!res.ok) break;
    const batch = json.branches ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    const total = json.total ?? 0;
    if (total > 0 && out.length >= total) break;
    page += 1;
    if (page > 50) break;
  }
  return out;
}

async function fetchAllDepartments(): Promise<DepartmentOption[]> {
  const out: DepartmentOption[] = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const res = await fetch(
      `/api/admin/departments?page=${page}&pageSize=${pageSize}`
    );
    const json = (await res.json()) as {
      departments?: DepartmentOption[];
      total?: number;
    };
    if (!res.ok) break;
    const batch = json.departments ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    const total = json.total ?? 0;
    if (total > 0 && out.length >= total) break;
    page += 1;
    if (page > 50) break;
  }
  return out;
}

export function AssetAllocationProfileModal({
  assetId,
  open,
  onClose,
  onProfileSaved,
  depreciationFiscalYearStart,
}: {
  assetId: number | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful Transfer/Return save so the list can refresh. */
  onProfileSaved?: () => void;
  /** When set, profile header depreciation FY column matches the allocation grid filter. */
  depreciationFiscalYearStart?: number;
}) {
  const titleId = useId();
  const formId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [mode, setMode] = useState<"view" | "add">("view");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [allocationType, setAllocationType] = useState<"Transfer" | "Return">(
    "Transfer"
  );
  const [allocationDateBs, setAllocationDateBs] = useState("");
  const [branchId, setBranchId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [allocationDatePickerReady, setAllocationDatePickerReady] =
    useState(false);

  useEffect(() => {
    setAllocationDatePickerReady(true);
  }, []);

  const load = useCallback(async () => {
    if (assetId == null) return;
    setLoading(true);
    setError(null);
    try {
      const qs =
        depreciationFiscalYearStart != null &&
        Number.isFinite(depreciationFiscalYearStart)
          ? `?fiscalYearStart=${encodeURIComponent(String(Math.floor(depreciationFiscalYearStart)))}`
          : "";
      const res = await fetch(
        `/api/admin/assets/${encodeURIComponent(String(assetId))}/allocation-profile${qs}`
      );
      const json = (await res.json()) as ProfilePayload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load profile.");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Could not load profile.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [assetId, depreciationFiscalYearStart]);

  useEffect(() => {
    if (!open || assetId == null) {
      setData(null);
      setError(null);
      setMode("view");
      setSubmitError(null);
      return;
    }
    void load();
  }, [open, assetId, load]);

  useEffect(() => {
    if (!open || assetId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, assetId]);

  useEffect(() => {
    if (!open || mode !== "add") return;
    let cancelled = false;
    setRefsLoading(true);
    void (async () => {
      try {
        const [b, d] = await Promise.all([
          fetchAllBranches(),
          fetchAllDepartments(),
        ]);
        if (!cancelled) {
          setBranches(b);
          setDepartments(d);
        }
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  function resetFormFromProfile(payload: ProfilePayload): void {
    const p = payload.profile;
    const h0 = payload.history[0];
    const t =
      h0?.allocation_type === "Transfer" || h0?.allocation_type === "Return"
        ? h0.allocation_type
        : "Transfer";
    setAllocationType(t);
    const dateInit =
      p.allocation_date_bs.trim() !== ""
        ? p.allocation_date_bs
        : p.purchase_date_bs.trim();
    setAllocationDateBs(dateInit);
    setBranchId(p.branch_id);
    setDepartmentId(
      p.department_id != null && p.department_id >= 1 ? p.department_id : ""
    );
  }

  function openAddForm(): void {
    if (!data) return;
    if (data.profile.asset_status === "DISPOSED") return;
    resetFormFromProfile(data);
    setMode("add");
    setSubmitError(null);
  }

  async function submitAllocation(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (assetId == null) return;
    setSubmitting(true);
    setSubmitError(null);
    const dateNorm = normalizeBsDateEnglish(allocationDateBs);
    if (dateNorm === "") {
      setSubmitError("Allocation date is required.");
      setSubmitting(false);
      return;
    }
    if (branchId === "" || typeof branchId !== "number") {
      setSubmitError("Branch is required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/assets/${encodeURIComponent(String(assetId))}/allocation-change`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocation_type: allocationType,
            allocation_date_bs: dateNorm,
            branch_id: branchId,
            department_id:
              departmentId === "" || typeof departmentId !== "number"
                ? null
                : departmentId,
          }),
        }
      );
      const json = (await res.json()) as ProfilePayload & { error?: string };
      if (!res.ok) {
        setSubmitError(json.error ?? "Save failed.");
        return;
      }
      setData(json);
      setMode("view");
      onProfileSaved?.();
    } catch {
      setSubmitError("Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || assetId == null) {
    return null;
  }

  const p = data?.profile;
  const codeForQr =
    p?.asset_code != null && String(p.asset_code).trim() !== ""
      ? String(p.asset_code).trim()
      : `asset:${p?.asset_id ?? assetId}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=${encodeURIComponent(codeForQr)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="my-4 w-full max-w-5xl rounded-lg border border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {mode === "add" ? "Add asset allocation" : "Asset profile"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {loading ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : p ? (
            <>
              <section className="flex flex-col gap-6 border-b border-slate-200 pb-6 lg:flex-row lg:items-start">
                <div className="shrink-0 self-start rounded border border-slate-200 bg-white p-2 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external QR data URL service */}
                  <img
                    src={qrSrc}
                    width={168}
                    height={168}
                    alt={`QR code for asset ${p.asset_id}`}
                    className="block"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-900">
                    Asset profile
                  </h3>
                  <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Purchase date (BS)
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {displayText(p.purchase_date_bs)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Asset group
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {displayText(p.group_name)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Asset name
                      </dt>
                      <dd className="mt-0.5 text-slate-900">{p.asset_name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Purchase amount
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {formatMoneyLike(p.purchase_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Asset code
                      </dt>
                      <dd className="mt-0.5 font-mono text-xs text-slate-900">
                        {p.asset_code
                          ? formatAssetCodeForDisplay(p.asset_code.trim())
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {displayText(p.working_status)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Asset status
                      </dt>
                      <dd className="mt-0.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            p.asset_status === "DISPOSED"
                              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          }`}
                        >
                          {p.asset_status}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Asset user
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {displayText(p.asset_user)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Dep method
                      </dt>
                      <dd className="mt-0.5 text-slate-900">
                        {displayText(p.dep_method)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              <div className="mt-5 border-b border-slate-200 pb-px">
                <span className="inline-block border-b-2 border-blue-600 px-1 pb-2 text-sm font-medium text-blue-800">
                  Allocation
                </span>
              </div>

              <section className="mt-4" aria-label="Allocation history">
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openAddForm}
                    disabled={
                      mode === "add" || loading || p.asset_status === "DISPOSED"
                    }
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {p.asset_status === "DISPOSED" ? "Allocation disabled" : "Add New"}
                  </button>
                  {["Edit", "Delete", "Details"].map((label) => (
                    <button
                      key={label}
                      type="button"
                      disabled
                      className="cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === "add" ? (
                  <form
                    id={formId}
                    onSubmit={(e) => {
                      void submitAllocation(e);
                    }}
                    className="mb-6 rounded-lg border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <h4 className="text-sm font-semibold text-slate-900">
                      Allocation
                    </h4>
                    <p className="mt-1 text-xs text-slate-600">
                      Record a transfer or return by updating allocation date,
                      branch, and department only.
                    </p>
                    {submitError ? (
                      <p
                        className="mt-2 text-sm text-red-600"
                        role="alert"
                      >
                        {submitError}
                      </p>
                    ) : null}
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={fieldLabel} htmlFor={`${formId}-type`}>
                          Allocation type
                        </label>
                        <select
                          id={`${formId}-type`}
                          className={inputClass}
                          value={allocationType}
                          onChange={(e) =>
                            setAllocationType(
                              e.target.value === "Return"
                                ? "Return"
                                : "Transfer"
                            )
                          }
                          disabled={refsLoading || submitting}
                        >
                          <option value="Transfer">Transfer</option>
                          <option value="Return">Return</option>
                        </select>
                      </div>
                      <div>
                        <span className={fieldLabel}>Allocation date (BS)</span>
                        {allocationDatePickerReady ? (
                          <NepaliDatePicker
                            value={bsDateToPickerValue(allocationDateBs)}
                            onChange={(value) =>
                              setAllocationDateBs(normalizeBsDateEnglish(value))
                            }
                            inputClassName={inputClass}
                            className="w-full max-w-md"
                            options={{
                              calenderLocale: "ne",
                              valueLocale: "en",
                              closeOnSelect: true,
                            }}
                          />
                        ) : (
                          <div className={`${inputClass} h-9`} />
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <label className={fieldLabel} htmlFor={`${formId}-branch`}>
                          Branch
                        </label>
                        <select
                          id={`${formId}-branch`}
                          className={inputClass}
                          value={branchId === "" ? "" : String(branchId)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBranchId(v === "" ? "" : Number.parseInt(v, 10));
                          }}
                          disabled={refsLoading || submitting}
                          required
                        >
                          <option value="">Select branch…</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {formatBranchOptionLabel(b)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          className={fieldLabel}
                          htmlFor={`${formId}-dept`}
                        >
                          Department
                        </label>
                        <select
                          id={`${formId}-dept`}
                          className={inputClass}
                          value={
                            departmentId === "" ? "" : String(departmentId)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setDepartmentId(
                              v === "" ? "" : Number.parseInt(v, 10)
                            );
                          }}
                          disabled={refsLoading || submitting}
                        >
                          <option value="">—</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={submitting || refsLoading}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {submitting ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setMode("view");
                          setSubmitError(null);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="min-w-[900px] w-full border-collapse text-left text-xs text-slate-900">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          AllocationID
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Purchase Date
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Allocation Date
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Fiscal Year
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Allocation Type
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Old Asset Code
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Asset User
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Responsible Unit Name
                        </th>
                        <th className="whitespace-nowrap border-r border-slate-200 px-2 py-2">
                          Branch Name
                        </th>
                        <th className="whitespace-nowrap px-2 py-2">Department</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.history ?? []).map((h) => (
                        <tr
                          key={`${p.asset_id}-${h.allocation_id ?? "none"}`}
                          className="border-b border-slate-100 odd:bg-white even:bg-slate-50/70"
                        >
                          <td className="border-r border-slate-100 px-2 py-2 tabular-nums">
                            {h.allocation_id != null
                              ? h.allocation_id
                              : "—"}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2 whitespace-nowrap">
                            {displayText(h.purchase_date_bs)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2 whitespace-nowrap">
                            {displayText(h.allocation_date_display)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2 whitespace-nowrap">
                            {displayText(h.fiscal_year)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2">
                            {displayText(h.allocation_type)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2">
                            {displayText(h.old_asset_code)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2">
                            {displayText(h.asset_user)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2">
                            {displayText(h.responsible_unit_name)}
                          </td>
                          <td className="border-r border-slate-100 px-2 py-2">
                            {displayText(h.branch_name)}
                          </td>
                          <td className="px-2 py-2">
                            {displayText(h.department_name)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Rows are listed newest first. Each Transfer or Return appends a
                  row; older rows stay for audit history.
                </p>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
