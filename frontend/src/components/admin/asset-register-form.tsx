"use client";

import { FormEvent, useEffect, useId, useMemo, useState } from "react";

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

const OWNERSHIP_TYPES = [
  "Company owned",
  "Leased",
  "Rented",
  "Financed",
  "Donated",
  "Other",
] as const;

const WORKING_STATUSES = [
  "In use",
  "Idle",
  "Under repair",
  "Retired",
  "Disposed",
] as const;

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

const sectionHeadingClass =
  "border-b border-emerald-900/10 pb-2 text-sm font-semibold text-slate-800";

export function AssetRegisterForm() {
  const formId = useId();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [subGroups, setSubGroups] = useState<SubGroupRow[]>([]);
  const [subGroupsLoading, setSubGroupsLoading] = useState(true);
  const [subGroupsError, setSubGroupsError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const [assetName, setAssetName] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [subGroupId, setSubGroupId] = useState<number | "">("");
  const [ownershipType, setOwnershipType] = useState<string>("");
  const [workingStatus, setWorkingStatus] = useState<string>("");
  const [branchId, setBranchId] = useState<number | "">("");
  const [departmentName, setDepartmentName] = useState("");

  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("");
  const [unitRate, setUnitRate] = useState("");
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState("");
  const [lifetimeYears, setLifetimeYears] = useState("");
  const [salvageValue, setSalvageValue] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      setGroupsLoading(true);
      setGroupsError(null);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        const res = await fetch(`/api/admin/groups?${params.toString()}`);
        const json = (await res.json()) as {
          groups?: GroupOption[];
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setGroupsError(json.error ?? "Could not load asset groups.");
            setGroups([]);
          }
          return;
        }
        const list = json.groups ?? [];
        if (!cancelled) {
          setGroups(list);
          setGroupId((prev) => {
            if (prev === "" && list.length > 0) return list[0]!.id;
            if (
              typeof prev === "number" &&
              !list.some((g) => g.id === prev) &&
              list.length > 0
            ) {
              return list[0]!.id;
            }
            return prev;
          });
        }
      } catch {
        if (!cancelled) {
          setGroupsError("Something went wrong.");
          setGroups([]);
        }
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    }
    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSubGroups() {
      setSubGroupsLoading(true);
      setSubGroupsError(null);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        const res = await fetch(`/api/admin/sub-groups?${params.toString()}`);
        const json = (await res.json()) as {
          subGroups?: SubGroupRow[];
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setSubGroupsError(json.error ?? "Could not load asset sub groups.");
            setSubGroups([]);
          }
          return;
        }
        if (!cancelled) setSubGroups(json.subGroups ?? []);
      } catch {
        if (!cancelled) {
          setSubGroupsError("Something went wrong.");
          setSubGroups([]);
        }
      } finally {
        if (!cancelled) setSubGroupsLoading(false);
      }
    }
    void loadSubGroups();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBranches() {
      setBranchesLoading(true);
      setBranchesError(null);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        const res = await fetch(`/api/admin/branches?${params.toString()}`);
        const json = (await res.json()) as {
          branches?: BranchOption[];
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setBranchesError(json.error ?? "Could not load branches.");
            setBranches([]);
          }
          return;
        }
        const list = json.branches ?? [];
        if (!cancelled) {
          setBranches(list);
          setBranchId((prev) => {
            if (prev === "" && list.length > 0) return list[0]!.id;
            if (
              typeof prev === "number" &&
              !list.some((b) => b.id === prev) &&
              list.length > 0
            ) {
              return list[0]!.id;
            }
            return prev;
          });
        }
      } catch {
        if (!cancelled) {
          setBranchesError("Something went wrong.");
          setBranches([]);
        }
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    }
    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, []);

  const subGroupsForGroup = useMemo(() => {
    if (groupId === "") return [];
    return subGroups.filter((sg) => sg.group_id === groupId);
  }, [subGroups, groupId]);

  const purchaseAmountFormatted = useMemo(() => {
    const q = Number.parseFloat(purchaseQty);
    const r = Number.parseFloat(unitRate);
    if (
      !Number.isFinite(q) ||
      !Number.isFinite(r) ||
      q < 0 ||
      r < 0
    ) {
      return "";
    }
    const amount = q * r;
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }, [purchaseQty, unitRate]);

  useEffect(() => {
    if (subGroupId === "") return;
    const row = subGroups.find((sg) => sg.id === subGroupId);
    if (!row || row.group_id !== groupId) {
      setSubGroupId("");
    }
  }, [groupId, subGroupId, subGroups]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (groupId === "") {
      setError("Select an asset group.");
      return;
    }
    if (subGroupsForGroup.length > 0 && subGroupId === "") {
      setError("Select an asset sub group for this group.");
      return;
    }
    if (ownershipType === "") {
      setError("Select an ownership type.");
      return;
    }
    if (workingStatus === "") {
      setError("Select a working status.");
      return;
    }
    if (branchId === "") {
      setError("Select a branch.");
      return;
    }
    setSubmitting(true);
    try {
      setSuccess("Asset register entry saved.");
      setAssetName("");
      setAssetCode("");
      setSubGroupId("");
      setOwnershipType("");
      setWorkingStatus("");
      setBranchId(branches[0]?.id ?? "");
      setDepartmentName("");
      setPurchaseDate("");
      setPurchaseQty("");
      setUnitRate("");
      setPurchaseInvoiceNo("");
      setLifetimeYears("");
      setSalvageValue("");
    } finally {
      setSubmitting(false);
    }
  }

  const lookupsBusy =
    groupsLoading || subGroupsLoading || branchesLoading;
  const noGroups = !groupsLoading && groups.length === 0;
  const noBranches = !branchesLoading && branches.length === 0;

  return (
    <section
      id="asset-register"
      className="scroll-mt-24 rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${formId}-heading`}
    >
      <h2
        id={`${formId}-heading`}
        className="text-base font-semibold text-slate-900"
      >
        Asset register
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Record basic details, classification, and purchase data for a fixed
        asset.
      </p>

      <form className="mt-6 flex flex-col gap-8" onSubmit={onSubmit}>
        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Basic information</h3>
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
            <div>
              <label
                htmlFor={`${formId}-asset-name`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset name
              </label>
              <input
                id={`${formId}-asset-name`}
                type="text"
                autoComplete="off"
                required
                value={assetName}
                onChange={(ev) => setAssetName(ev.target.value)}
                className={inputClass}
                placeholder="e.g. Dell laptop"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-asset-code`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset code
              </label>
              <input
                id={`${formId}-asset-code`}
                type="text"
                autoComplete="off"
                required
                value={assetCode}
                onChange={(ev) => setAssetCode(ev.target.value)}
                className={inputClass}
                placeholder="e.g. FA-IT-001"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Asset classification</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
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
                disabled={groupsLoading || noGroups}
                value={groupId === "" ? "" : String(groupId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {groupsLoading ? (
                  <option value="">Loading…</option>
                ) : noGroups ? (
                  <option value="">No asset groups — create one first</option>
                ) : (
                  groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.code ? `${g.code} — ${g.name}` : g.name}
                    </option>
                  ))
                )}
              </select>
              {groupsError ? (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {groupsError}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor={`${formId}-sub-group`}
                className="block text-sm font-medium text-slate-700"
              >
                Sub group
              </label>
              <select
                id={`${formId}-sub-group`}
                required={subGroupsForGroup.length > 0}
                disabled={
                  lookupsBusy ||
                  noGroups ||
                  subGroupsForGroup.length === 0
                }
                value={subGroupId === "" ? "" : String(subGroupId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setSubGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {subGroupsLoading ? (
                  <option value="">Loading…</option>
                ) : subGroupsForGroup.length === 0 ? (
                  <option value="">
                    No sub groups for this group
                  </option>
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
              {subGroupsError ? (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {subGroupsError}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor={`${formId}-ownership`}
                className="block text-sm font-medium text-slate-700"
              >
                Ownership type
              </label>
              <select
                id={`${formId}-ownership`}
                required
                value={ownershipType}
                onChange={(ev) => setOwnershipType(ev.target.value)}
                className={inputClass}
              >
                <option value="">— Select —</option>
                {OWNERSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`${formId}-status`}
                className="block text-sm font-medium text-slate-700"
              >
                Working status
              </label>
              <select
                id={`${formId}-status`}
                required
                value={workingStatus}
                onChange={(ev) => setWorkingStatus(ev.target.value)}
                className={inputClass}
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
                disabled={branchesLoading || noBranches}
                value={branchId === "" ? "" : String(branchId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setBranchId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {branchesLoading ? (
                  <option value="">Loading…</option>
                ) : noBranches ? (
                  <option value="">No branches — add one under Branch first</option>
                ) : (
                  branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.branch_code} — {b.branch_name}
                    </option>
                  ))
                )}
              </select>
              {branchesError ? (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {branchesError}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor={`${formId}-department`}
                className="block text-sm font-medium text-slate-700"
              >
                Department name
              </label>
              <input
                id={`${formId}-department`}
                type="text"
                autoComplete="off"
                value={departmentName}
                onChange={(ev) => setDepartmentName(ev.target.value)}
                className={inputClass}
                placeholder="e.g. IT"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Purchase information</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
            <div>
              <label
                htmlFor={`${formId}-purchase-date`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase date
              </label>
              <input
                id={`${formId}-purchase-date`}
                type="date"
                value={purchaseDate}
                onChange={(ev) => setPurchaseDate(ev.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-purchase-qty`}
                className="block text-sm font-medium text-slate-700"
              >
                Quantity
              </label>
              <input
                id={`${formId}-purchase-qty`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={purchaseQty}
                onChange={(ev) => setPurchaseQty(ev.target.value)}
                className={inputClass}
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-unit-rate`}
                className="block text-sm font-medium text-slate-700"
              >
                Unit rate
              </label>
              <input
                id={`${formId}-unit-rate`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={unitRate}
                onChange={(ev) => setUnitRate(ev.target.value)}
                className={inputClass}
                placeholder="Per unit"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-purchase-amount`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase amount
                <span className="ml-1 font-normal text-slate-500">
                  (qty × unit rate)
                </span>
              </label>
              <input
                id={`${formId}-purchase-amount`}
                type="text"
                readOnly
                tabIndex={-1}
                value={purchaseAmountFormatted}
                placeholder="—"
                aria-readonly="true"
                className={`${inputClass} cursor-default bg-slate-50 text-slate-800`}
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-invoice-no`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase invoice no.
              </label>
              <input
                id={`${formId}-invoice-no`}
                type="text"
                autoComplete="off"
                value={purchaseInvoiceNo}
                onChange={(ev) => setPurchaseInvoiceNo(ev.target.value)}
                className={inputClass}
                placeholder="e.g. INV-2024-0142"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-lifetime-years`}
                className="block text-sm font-medium text-slate-700"
              >
                Useful life (years)
              </label>
              <input
                id={`${formId}-lifetime-years`}
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                value={lifetimeYears}
                onChange={(ev) => setLifetimeYears(ev.target.value)}
                className={inputClass}
                placeholder="e.g. 5"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label
                htmlFor={`${formId}-salvage-value`}
                className="block text-sm font-medium text-slate-700"
              >
                Salvage value
              </label>
              <input
                id={`${formId}-salvage-value`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={salvageValue}
                onChange={(ev) => setSalvageValue(ev.target.value)}
                className={inputClass}
                placeholder="Estimated residual value"
              />
            </div>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="text-sm text-emerald-800" role="status">
            {success}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || lookupsBusy || noGroups || noBranches}
          className="w-full max-w-lg rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save asset"}
        </button>
      </form>
    </section>
  );
}
