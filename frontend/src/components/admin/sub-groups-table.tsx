"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import * as XLSX from "xlsx";
import { formatAdminDateTime } from "@/lib/format-datetime";

export type SubGroupRow = {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  created_at: string;
};

type GroupOption = { id: number; name: string; code?: string };

type ListResponse = {
  subGroups: SubGroupRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;

type SubGroupImportPayloadRow = {
  group_name: string;
  sub_group_name: string;
};

type SubGroupImportSummary = {
  importedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
};

function findSubGroupImportHeaderRow(sheet: XLSX.WorkSheet): number {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  const required = ["GroupName", "SubGroupName"];
  const maxScan = Math.min(rows.length, 40);
  for (let i = 0; i < maxScan; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const normalized = row.map((cell) => String(cell ?? "").trim());
    const hasAll = required.every((h) => normalized.includes(h));
    if (hasAll) {
      return i;
    }
  }
  return -1;
}

export function SubGroupsTable({
  refreshKey,
  onImported,
}: {
  refreshKey: number;
  onImported?: () => void;
}) {
  const searchId = useId();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SubGroupRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<SubGroupRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editGroupId, setEditGroupId] = useState<number | "">("");
  const [editGroups, setEditGroups] = useState<GroupOption[]>([]);
  const [editGroupsLoading, setEditGroupsLoading] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<SubGroupImportSummary | null>(
    null
  );

  useEffect(() => {
    const el = deleteDialogRef.current;
    if (!el) return;
    if (deleteTarget) {
      setActionError(null);
      el.showModal();
    } else {
      el.close();
    }
  }, [deleteTarget]);

  useEffect(() => {
    const el = editDialogRef.current;
    if (!el) return;
    if (editTarget) {
      setEditName(editTarget.name);
      setEditGroupId(editTarget.group_id);
      setActionError(null);
      el.showModal();
      setEditGroupsLoading(true);
      void (async () => {
        try {
          const params = new URLSearchParams({ page: "1", pageSize: "100" });
          const res = await fetch(`/api/admin/groups?${params.toString()}`);
          const json = (await res.json()) as {
            groups?: GroupOption[];
            error?: string;
          };
          if (res.ok) {
            setEditGroups(json.groups ?? []);
          } else {
            setEditGroups([]);
          }
        } catch {
          setEditGroups([]);
        } finally {
          setEditGroupsLoading(false);
        }
      })();
    } else {
      el.close();
    }
  }, [editTarget]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }
      const res = await fetch(`/api/admin/sub-groups?${params.toString()}`);
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load asset sub groups.");
        setData(null);
        return;
      }
      setData({
        subGroups: json.subGroups ?? [],
        total: json.total ?? 0,
        page: json.page ?? page,
        pageSize: json.pageSize ?? pageSize,
      });
    } catch {
      setError("Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function onImportFile(file: File) {
    setImportError(null);
    setImportSummary(null);
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setImportError("The selected file has no worksheet.");
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet) {
        setImportError("Could not read worksheet from the selected file.");
        return;
      }
      const headerRowIndex = findSubGroupImportHeaderRow(sheet);
      if (headerRowIndex < 0) {
        setImportError(
          "Could not find import columns. Include headers GroupName and SubGroupName (same as the asset register export)."
        );
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        range: headerRowIndex,
      });
      if (rows.length === 0) {
        setImportError("The worksheet has no rows to import.");
        return;
      }
      const payloadRows: SubGroupImportPayloadRow[] = rows
        .map((r) => {
          const groupName = String(r.GroupName ?? "").trim();
          const subGroupName = String(
            r.SubGroupName ?? r.SubgroupName ?? ""
          ).trim();
          if (groupName === "" && subGroupName === "") {
            return null;
          }
          return { group_name: groupName, sub_group_name: subGroupName };
        })
        .filter((r): r is SubGroupImportPayloadRow => r !== null);

      if (payloadRows.length === 0) {
        setImportError("No data rows found under the header row.");
        return;
      }

      const res = await fetch("/api/admin/sub-groups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payloadRows }),
      });
      const json = (await res.json()) as SubGroupImportSummary & { error?: string };
      if (!res.ok) {
        setImportError(
          json.error ?? "Import could not be completed. Please review the file."
        );
        return;
      }
      setImportSummary({
        importedCount: json.importedCount ?? 0,
        skippedCount: json.skippedCount ?? 0,
        errors: json.errors ?? [],
      });
      await load();
      onImported?.();
    } catch {
      setImportError("Could not read or import the XLSX file.");
    } finally {
      setImporting(false);
    }
  }

  const total = data?.total ?? 0;
  const subGroups = data?.subGroups ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  useEffect(() => {
    if (page > totalPages && totalPages >= 1) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/sub-groups/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionError(json.error ?? "Could not delete asset sub group.");
        return;
      }
      setDeleteTarget(null);
      await load();
    } catch {
      setActionError("Something went wrong.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function onEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editTarget || editGroupId === "") return;
    setEditSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/sub-groups/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          groupId: editGroupId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error ?? "Could not update asset sub group.");
        return;
      }
      setEditTarget(null);
      await load();
    } catch {
      setActionError("Something went wrong.");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-[0_4px_24px_-8px_rgba(15,81,50,0.12)] sm:p-8"
      aria-labelledby={`${searchId}-sub-groups-heading`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={`${searchId}-sub-groups-heading`}
            className="text-base font-semibold text-slate-900"
          >
            Asset sub groups
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Asset sub groups listed under their parent asset group.
          </p>
        </div>
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor={`${searchId}-search`}
            className="block text-sm font-medium text-slate-700"
          >
            Search
          </label>
          <input
            id={`${searchId}-search`}
            type="search"
            placeholder="Asset sub group or asset group name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-700">
          Import sub groups from Excel (`.xlsx`). Each row needs{" "}
          <strong className="font-medium">GroupName</strong> (must match an
          existing asset group) and{" "}
          <strong className="font-medium">SubGroupName</strong>. Rows that
          already exist for that group are skipped.
        </p>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50">
          {importing ? "Importing…" : "Import XLSX"}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={importing || loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void onImportFile(file);
              }
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {importError ? (
        <p
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {importError}
        </p>
      ) : null}
      {importSummary ? (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            importSummary.errors.length > 0
              ? "border-red-200 bg-red-50/80 text-red-900"
              : "border-emerald-200 bg-emerald-50/80 text-emerald-900"
          }`}
          role="status"
        >
          {importSummary.errors.length > 0 ? (
            <>
              <p className="font-semibold">Import failed</p>
              <p className="mt-1">
                {importSummary.errors[0]?.message ?? "Validation error."}
                {importSummary.errors.length > 1
                  ? ` (+${importSummary.errors.length - 1} more rows)`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Import complete</p>
              <p className="mt-1">
                Imported {importSummary.importedCount} sub group
                {importSummary.importedCount === 1 ? "" : "s"}
                {importSummary.skippedCount > 0
                  ? `; skipped ${importSummary.skippedCount} duplicate or blank row${
                      importSummary.skippedCount === 1 ? "" : "s"
                    }.`
                  : "."}
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Asset group
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Asset sub group name
              </th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                Created
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium whitespace-nowrap"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-red-600"
                  role="alert"
                >
                  {error}
                </td>
              </tr>
            ) : subGroups.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {debouncedSearch
                    ? "No asset sub groups match your search."
                    : "No asset sub groups yet. Create one using the form above."}
                </td>
              </tr>
            ) : (
              subGroups.map((row) => (
                <tr key={row.id} className="bg-white hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.group_name}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{row.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatAdminDateTime(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget(row)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          {total === 0 ? (
            "No asset sub groups yet."
          ) : (
            <>
              Showing{" "}
              <span className="font-medium text-slate-800">
                {from}–{to}
              </span>{" "}
              of <span className="font-medium text-slate-800">{total}</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page{" "}
              <span className="font-medium text-slate-900">{safePage}</span> of{" "}
              <span className="font-medium text-slate-900">{totalPages}</span>
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages || loading || total === 0}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <dialog
        ref={deleteDialogRef}
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setDeleteTarget(null)}
      >
        <div className="p-6">
          <h3 className="text-base font-semibold text-slate-900">
            Delete asset sub group?
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Are you sure you want to delete{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget?.name}
            </span>{" "}
            under{" "}
            <span className="font-medium text-slate-900">
              {deleteTarget?.group_name}
            </span>
            ? This cannot be undone.
          </p>
          {actionError && deleteTarget ? (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteSubmitting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={editDialogRef}
        className="fixed left-1/2 top-1/2 z-[200] max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
        onClose={() => setEditTarget(null)}
      >
        <form onSubmit={onEditSubmit}>
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-semibold text-slate-900">
              Edit asset sub group
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Update the asset group or asset sub group name.
            </p>
          </div>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div>
              <label
                htmlFor={`${searchId}-edit-group`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset group
              </label>
              <select
                id={`${searchId}-edit-group`}
                required
                disabled={editGroupsLoading || editGroups.length === 0}
                value={editGroupId === "" ? "" : String(editGroupId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setEditGroupId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                {editGroupsLoading ? (
                  <option value="">Loading groups…</option>
                ) : editGroups.length === 0 ? (
                  <option value="">No groups</option>
                ) : (
                  editGroups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.code ? `${g.code} — ${g.name}` : g.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${searchId}-edit-name`}
                className="block text-sm font-medium text-slate-700"
              >
                Asset sub group name
              </label>
              <input
                id={`${searchId}-edit-name`}
                type="text"
                required
                autoComplete="off"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm outline-none ring-emerald-800/30 focus:ring-2"
              />
            </div>
            {actionError && editTarget ? (
              <p className="text-sm text-red-600" role="alert">
                {actionError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              disabled={editSubmitting}
              onClick={() => setEditTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                editSubmitting ||
                editGroupId === "" ||
                editGroupsLoading ||
                editGroups.length === 0
              }
              className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
