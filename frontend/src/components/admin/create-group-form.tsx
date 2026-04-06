"use client";

import { FormEvent, useId, useState } from "react";

type Props = {
  onCreated?: () => void;
};

export function CreateGroupForm({ onCreated }: Props) {
  const formId = useId();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create group.");
        return;
      }
      setSuccess("Group created successfully.");
      setName("");
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
        Create group
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Add a named group for organizing users or permissions later.
      </p>
      <form className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
        <div>
          <label
            htmlFor={`${formId}-name`}
            className="block text-sm font-medium text-slate-700"
          >
            Name
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            autoComplete="off"
            required
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
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
          {submitting ? "Creating…" : "Create group"}
        </button>
      </form>
    </section>
  );
}
