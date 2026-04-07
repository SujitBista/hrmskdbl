"use client";

import { FormEvent, useEffect, useId, useState } from "react";

type GroupOption = { id: number; name: string; code?: string };

type Props = {
  groupsRefreshKey: number;
  onCreated?: () => void;
};

export function CreateSubGroupForm({ groupsRefreshKey, onCreated }: Props) {
  const formId = useId();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      setGroupsLoading(true);
      setGroupsError(null);
      try {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "100",
        });
        const res = await fetch(`/api/admin/groups?${params.toString()}`);
        const json = (await res.json()) as {
          groups?: GroupOption[];
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setGroupsError(json.error ?? "Could not load groups.");
            setGroups([]);
          }
          return;
        }
        const list = json.groups ?? [];
        if (!cancelled) {
          setGroups(list);
          setGroupId((prev) => {
            if (prev === "" && list.length > 0) {
              return list[0]!.id;
            }
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
        if (!cancelled) {
          setGroupsLoading(false);
        }
      }
    }
    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [groupsRefreshKey]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (groupId === "") {
      setError("Select a group.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/sub-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create asset sub group.");
        return;
      }
      setSuccess("Asset sub group created successfully.");
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
      id="create-sub-group"
      className="scroll-mt-24 rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${formId}-heading`}
    >
      <h2
        id={`${formId}-heading`}
        className="text-base font-semibold text-slate-900"
      >
        Create asset sub group
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Choose an asset group, then add a name for an asset sub group under it.
      </p>
      <form className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
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
            disabled={groupsLoading || groups.length === 0}
            value={groupId === "" ? "" : String(groupId)}
            onChange={(ev) => {
              const v = ev.target.value;
              setGroupId(v === "" ? "" : Number.parseInt(v, 10));
            }}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            {groupsLoading ? (
              <option value="">Loading groups…</option>
            ) : groups.length === 0 ? (
              <option value="">No asset groups yet — create one first</option>
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
            htmlFor={`${formId}-name`}
            className="block text-sm font-medium text-slate-700"
          >
            Asset sub group name
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            autoComplete="off"
            required
            disabled={groups.length === 0 && !groupsLoading}
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            className="mt-1 w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50"
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
          disabled={
            submitting || groupsLoading || groups.length === 0 || groupId === ""
          }
          className="w-full max-w-lg rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create asset sub group"}
        </button>
      </form>
    </section>
  );
}
