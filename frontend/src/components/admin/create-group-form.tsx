"use client";

import { FormEvent, useId, useState } from "react";

const DEPRECIATION_METHODS = [
  "Declining Balance",
  "Straight Line",
] as const;

type Props = {
  onCreated?: () => void;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2";

export function CreateGroupForm({ onCreated }: Props) {
  const formId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [depMethod, setDepMethod] = useState<string>("");
  const [depRate, setDepRate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!depMethod.trim()) {
      setError("Depreciation method is required.");
      return;
    }
    const parsedDepRate =
      depRate.trim() === "" ? NaN : Number.parseFloat(depRate);
    if (!Number.isFinite(parsedDepRate) || parsedDepRate <= 0) {
      setError("Dep rate must be greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          dep_method: depMethod,
          dep_rate: parsedDepRate,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create asset group.");
        return;
      }
      setSuccess("Asset group created successfully.");
      setCode("");
      setName("");
      setDepMethod("");
      setDepRate("");
      onCreated?.();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="create-group"
      className="scroll-mt-24 rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${formId}-heading`}
    >
      <h2
        id={`${formId}-heading`}
        className="text-base font-semibold text-slate-900"
      >
        Asset Groups
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Define the asset group code, name, and depreciation settings.
      </p>
      <form className="mt-6 flex flex-col gap-8" onSubmit={onSubmit}>
        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Asset group</h3>
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
            <div>
              <label
                htmlFor={`${formId}-code`}
                className="block text-sm font-medium text-slate-700"
              >
                Group code
              </label>
              <input
                id={`${formId}-code`}
                type="text"
                autoComplete="off"
                required
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                className={inputClass}
                placeholder="e.g. FF, VEH"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-name`}
                className="block text-sm font-medium text-slate-700"
              >
                Group name
              </label>
              <input
                id={`${formId}-name`}
                type="text"
                autoComplete="off"
                required
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                className={inputClass}
                placeholder="e.g. FURNITURE"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Depreciation</h3>
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
            <div>
              <label
                htmlFor={`${formId}-dep-method`}
                className="block text-sm font-medium text-slate-700"
              >
                Depreciation method
              </label>
              <select
                id={`${formId}-dep-method`}
                value={depMethod}
                onChange={(ev) => setDepMethod(ev.target.value)}
                className={inputClass}
                required
              >
                <option value="">— Select —</option>
                {DEPRECIATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-dep-rate`}
                className="block text-sm font-medium text-slate-700"
              >
                Dep rate (%)
              </label>
              <input
                id={`${formId}-dep-rate`}
                type="number"
                min={0}
                step="any"
                required
                value={depRate}
                onChange={(ev) => setDepRate(ev.target.value)}
                className={inputClass}
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
          disabled={submitting}
          className="w-full max-w-lg rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Create asset group"}
        </button>
      </form>
    </section>
  );
}

const sectionHeadingClass =
  "border-b border-emerald-900/10 pb-2 text-sm font-semibold text-slate-800";
