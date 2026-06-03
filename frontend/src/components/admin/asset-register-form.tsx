"use client";

import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";
import * as XLSX from "xlsx";

import {
  formatAssetCodeForDisplay,
  parseBranchSegmentFromSkdblAssetCode,
} from "@/lib/format-asset-code";
import { formatBranchOptionLabel } from "@/lib/format-branch-label";
import {
  bsDateToPickerValue,
  normalizeBsDateEnglish,
} from "@/lib/bs-date-english";

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

const OWNERSHIP_TYPES = ["Owner", "Lease"] as const;

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
type ImportAssetRow = {
  asset_code: string | null;
  asset_name: string;
  group_name: string;
  sub_group_name: string | null;
  ownership_type: string;
  working_status: string;
  branch_name: string;
  department_name: string | null;
  purchase_date_bs: string;
  depreciation_start_date_bs: string;
  purchase_qty: number | null;
  purchase_amount: number | null;
  /** Carrying amount from legacy export (column e.g. Book Value) — depreciation cost basis. */
  book_value: number | null;
  purchase_invoice_no: string | null;
  allocation_remarks: string;
  allocation_category_name: string;
  allocation_branch_name: string;
  allocation_emp_name: string;
  allocation_serial_number: string | null;
};

type ImportIssueRow = {
  row: number;
  assetCode: string | null;
  message: string;
  kind: "duplicate" | "error";
};

type ImportSummary = {
  status: "failed" | "partial" | "success";
  importedCount: number;
  skippedDuplicatesCount: number;
  errorCount: number;
  issues: ImportIssueRow[];
};

function distinctImportValidationMessages(
  issues: ImportIssueRow[],
  maxDistinct: number
): { samples: Array<{ message: string; count: number }>; truncated: boolean } {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (issue.kind !== "error") continue;
    const text =
      issue.message.trim() === ""
        ? "This row could not be imported. Check required columns and values."
        : issue.message;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const truncated = sorted.length > maxDistinct;
  const samples = sorted
    .slice(0, maxDistinct)
    .map(([message, count]) => ({ message, count }));
  return { samples, truncated };
}

/** Picks department label from common Excel export / manual header spellings. */
function pickDepartmentNameFromImportRow(r: Record<string, unknown>): string {
  const keys = [
    "DepartmentName",
    "Department",
    "Department Name",
    "DeptName",
    "Dept",
    "department_name",
  ];
  for (const k of keys) {
    const s = String(r[k] ?? "").trim();
    if (s !== "") {
      return s;
    }
  }
  return "";
}

function pickPurchaseInvoiceNoFromImportRow(
  r: Record<string, unknown>
): string | null {
  const keys = [
    "PurchaseInvoiceNo",
    "InvoiceNo",
    "Invoice",
    "Purchase Invoice No",
    "purchase_invoice_no",
  ];
  for (const k of keys) {
    const s = String(r[k] ?? "").trim();
    if (s !== "") {
      return s;
    }
  }
  return null;
}

function findImportHeaderRow(sheet: XLSX.WorkSheet): number {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  const withBranch = ["AssetName", "GroupName", "BranchName"];
  const withAssetCode = ["AssetName", "GroupName", "AssetCode"];
  const withAllocationCode = [
    "AssetName",
    "SubGroupName",
    "AssetCode",
    "AllocationCategoryName",
  ];
  const maxScan = Math.min(rows.length, 40);
  for (let i = 0; i < maxScan; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const normalized = row.map((cell) => String(cell ?? "").trim());
    const hasBranchCols = withBranch.every((h) => normalized.includes(h));
    const hasCodeCols = withAssetCode.every((h) => normalized.includes(h));
    const hasAllocCols = withAllocationCode.every((h) => normalized.includes(h));
    if (hasBranchCols || hasCodeCols || hasAllocCols) {
      return i;
    }
  }
  return -1;
}

/** Reads current book / WDV from common Excel header spellings (legacy register export). */
function pickImportedBookValue(r: Record<string, unknown>): number | null {
  const explicitKeys = [
    "BookValue",
    "Book Value",
    "BOOK VALUE",
    "Book_Value",
    "CurrentBookValue",
    "WrittenDownValue",
    "WDV",
  ];
  for (const k of explicitKeys) {
    const raw = r[k];
    if (raw === null || raw === undefined || raw === "") continue;
    const s = String(raw).replace(/,/g, "").trim();
    if (s === "") continue;
    const n = Number.parseFloat(s);
    if (Number.isFinite(n) && n > 0) return n;
  }
  for (const key of Object.keys(r)) {
    const nk = key.trim().replace(/\s+/g, " ").toLowerCase();
    if (
      nk === "book value" ||
      nk === "bookvalue" ||
      nk === "current book value" ||
      nk === "written down value"
    ) {
      const raw = r[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const s = String(raw).replace(/,/g, "").trim();
      if (s === "") continue;
      const n = Number.parseFloat(s);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function formatBranchCodeSegmentForPreview(branchCode: string): string {
  const t = branchCode
    .trim()
    .replace(/[()[\]{}]/g, "")
    .trim();
  if (/^BC\s*:/i.test(t)) {
    const rest = t.replace(/^BC\s*:\s*/i, "").trim();
    const m = rest.match(/\d+/);
    if (m) return m[0]!.padStart(3, "0");
    return rest.length > 0 ? rest : t;
  }
  if (/^\d+$/.test(t)) return t.padStart(3, "0");
  return t;
}

export function AssetRegisterForm({
  onSaved,
}: {
  onSaved?: () => void;
} = {}) {
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

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);

  const [assetName, setAssetName] = useState("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [subGroupId, setSubGroupId] = useState<number | "">("");
  const [ownershipType, setOwnershipType] = useState<string>("");
  const [workingStatus, setWorkingStatus] = useState<string>("");
  const [branchId, setBranchId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");

  const [purchaseDateBs, setPurchaseDateBs] = useState("");
  const [depreciationStartDateBs, setDepreciationStartDateBs] = useState("");
  /** NepaliDatePicker is client-only — avoids SSR/client DOM mismatches. */
  const [purchaseDatePickerReady, setPurchaseDatePickerReady] = useState(false);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [unitRate, setUnitRate] = useState("");
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    totalRows: number;
    processedRows: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function loadDepartments() {
      setDepartmentsLoading(true);
      setDepartmentsError(null);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        const res = await fetch(`/api/admin/departments?${params.toString()}`);
        const json = (await res.json()) as {
          departments?: DepartmentOption[];
          error?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setDepartmentsError(json.error ?? "Could not load departments.");
            setDepartments([]);
          }
          return;
        }
        if (!cancelled) setDepartments(json.departments ?? []);
      } catch {
        if (!cancelled) {
          setDepartmentsError("Something went wrong.");
          setDepartments([]);
        }
      } finally {
        if (!cancelled) setDepartmentsLoading(false);
      }
    }
    void loadDepartments();
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

  const generatedAssetCodePreview = useMemo(() => {
    if (groupId === "" || branchId === "" || !purchaseDateBs.trim()) {
      return "Will auto generate after save";
    }
    const group = groups.find((g) => g.id === groupId);
    const branch = branches.find((b) => b.id === branchId);
    const dateText = purchaseDateBs.trim();
    const parts = dateText.split("/").map((p) => p.trim());
    if (!group?.code || !branch || parts.length !== 3) {
      return "Will auto generate after save";
    }
    const y = Number.parseInt(parts[0] ?? "", 10);
    const m = Number.parseInt(parts[1] ?? "", 10);
    const d = Number.parseInt(parts[2] ?? "", 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return "Will auto generate after save";
    }
    const branchSegment = formatBranchCodeSegmentForPreview(branch.branch_code);
    const groupSegment = group.code.trim().toUpperCase();
    return `SKDBL/${branchSegment}/${groupSegment}/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/######`;
  }, [groupId, branchId, purchaseDateBs, groups, branches]);

  useEffect(() => {
    if (subGroupId === "") return;
    const row = subGroups.find((sg) => sg.id === subGroupId);
    if (!row || row.group_id !== groupId) {
      setSubGroupId("");
    }
  }, [groupId, subGroupId, subGroups]);

  useEffect(() => {
    setPurchaseDatePickerReady(true);
  }, []);

  async function onSubmit(e: FormEvent) {
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
        book_value: null,
      };

      const res = await fetch("/api/admin/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        assets?: Array<{ asset_code?: string }>;
        asset?: { asset_code?: string };
        createdCount?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not save asset.");
        return;
      }
      const savedAssets =
        json.assets ?? (json.asset != null ? [json.asset] : []);
      const displayCodes = savedAssets
        .map((a) => formatAssetCodeForDisplay(a.asset_code ?? ""))
        .filter((code) => code !== "");
      if (displayCodes.length === 0) {
        setSuccess("Asset register entry saved.");
      } else if (displayCodes.length === 1) {
        setSuccess(`Asset saved. Asset code: ${displayCodes[0]}`);
      } else {
        setSuccess(
          `${displayCodes.length} assets saved. Asset codes: ${displayCodes.join(", ")}`
        );
      }
      onSaved?.();
      setAssetName("");
      setSubGroupId("");
      setOwnershipType("");
      setWorkingStatus("");
      setBranchId(branches[0]?.id ?? "");
      setDepartmentId("");
      setPurchaseDateBs("");
      setDepreciationStartDateBs("");
      setPurchaseQty("");
      setUnitRate("");
      setPurchaseInvoiceNo("");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onImportFile(file: File) {
    setError(null);
    setSuccess(null);
    setImportSummary(null);
    if (groupsLoading || branchesLoading) {
      setError(
        "Still loading branches and groups. Wait a moment, then try import again."
      );
      return;
    }
    if (noGroups) {
      setError(
        "Import needs at least one asset group. Add groups under Groups in the admin menu, then try again."
      );
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setError("The selected file has no worksheet.");
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet) {
        setError("Could not read worksheet from the selected file.");
        return;
      }

      const headerRowIndex = findImportHeaderRow(sheet);
      if (headerRowIndex < 0) {
        setError(
          "Could not find import columns. Use AssetName + GroupName + BranchName, or AssetName + GroupName + AssetCode (SKDBL/…), or an allocation-style row with AssetName + SubGroupName + AssetCode + AllocationCategoryName."
        );
        return;
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        range: headerRowIndex,
      });
      if (rows.length === 0) {
        setError("The worksheet has no rows to import.");
        return;
      }

      const payloadRows: ImportAssetRow[] = rows
        .map((r) => {
          const assetName = String(r.AssetName ?? "").trim();
          if (assetName === "") {
            return null;
          }
          const purchaseAmountRaw = String(r.PurchaseAmount ?? "").trim();
          const qtyRaw = String(r.Qty ?? "").trim();
          const departmentName = pickDepartmentNameFromImportRow(r);
          const parseNumber = (v: string): number | null => {
            if (v === "") return null;
            const n = Number(v.replace(/,/g, ""));
            return Number.isFinite(n) ? n : null;
          };
          const serialRaw = String(r.SerialNumber ?? "").trim();
          return {
            asset_code: String(r.AssetCode ?? "").trim() || null,
            asset_name: assetName,
            group_name: String(r.GroupName ?? "").trim(),
            sub_group_name: String(r.SubGroupName ?? "").trim() || null,
            ownership_type: String(r.OwnType ?? "").trim() || "Owner",
            working_status: String(r.WorkingStatus ?? "").trim() || "In use",
            branch_name: String(r.BranchName ?? "").trim(),
            department_name: departmentName !== "" ? departmentName : null,
            purchase_date_bs: String(r.PurchaseDateNepali ?? "").trim(),
            depreciation_start_date_bs: String(r.DepStartDateNepali ?? "").trim(),
            purchase_qty: parseNumber(qtyRaw),
            purchase_amount: parseNumber(purchaseAmountRaw),
            book_value: pickImportedBookValue(r as Record<string, unknown>),
            purchase_invoice_no: pickPurchaseInvoiceNoFromImportRow(
              r as Record<string, unknown>
            ),
            allocation_remarks: String(r.Remarks ?? "").trim(),
            allocation_category_name: String(
              r.AllocationCategoryName ?? ""
            ).trim(),
            allocation_branch_name: String(
              r.AllocationBranchName ?? ""
            ).trim(),
            allocation_emp_name: String(r.EmpName ?? "").trim(),
            allocation_serial_number: serialRaw === "" ? null : serialRaw,
          };
        })
        .filter((r): r is ImportAssetRow => r !== null);

      if (payloadRows.length === 0) {
        setError("No valid asset rows found in the selected file.");
        return;
      }

      const rowMissingBranchSource = payloadRows.find((r) => {
        const branchName = (r.branch_name ?? "").trim();
        const code = (r.asset_code ?? "").trim();
        const fromAsset =
          code !== "" ? parseBranchSegmentFromSkdblAssetCode(code) : null;
        const hasSkdblBranch =
          fromAsset !== null && fromAsset !== "";
        return branchName === "" && !hasSkdblBranch;
      });
      if (rowMissingBranchSource) {
        setError(
          "Each row needs a BranchName, or an AssetCode in SKDBL/{branch}/… form so the branch can be created from the file. Add a Branch column or SKDBL asset codes, then try again."
        );
        return;
      }

      setImportProgress({
        totalRows: payloadRows.length,
        processedRows: 0,
      });
      const res = await fetch("/api/admin/assets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payloadRows }),
      });
      const json = (await res.json()) as {
        importedCount?: number;
        skippedCount?: number;
        errors?: Array<{ row: number; message: string }>;
        error?: string;
      };
      if (!res.ok) {
        setError(
          "Import could not be completed. Please review the file and try again."
        );
        return;
      }
      const importedCount = json.importedCount ?? 0;
      const rowErrors = json.errors ?? [];
      const issues: ImportIssueRow[] = rowErrors.map((e) => {
        const sourceRow = payloadRows[e.row - 1];
        const assetCode = sourceRow?.asset_code ?? null;
        const isDuplicate =
          /assetcode/i.test(e.message) && /(duplicate|already exists)/i.test(e.message);
        const detail =
          typeof e.message === "string" && e.message.trim() !== ""
            ? e.message.trim()
            : "This row could not be imported. Check required columns and values.";
        return {
          row: e.row,
          assetCode,
          message: isDuplicate
            ? "This asset code is already in your system or repeated in this file."
            : detail,
          kind: isDuplicate ? "duplicate" : "error",
        };
      });
      const skippedDuplicatesCount = issues.filter(
        (i) => i.kind === "duplicate"
      ).length;
      const errorCount = issues.length - skippedDuplicatesCount;
      const status: ImportSummary["status"] =
        importedCount === 0 && (skippedDuplicatesCount > 0 || errorCount > 0)
          ? "failed"
          : skippedDuplicatesCount > 0 || errorCount > 0
            ? "partial"
            : "success";
      setImportProgress({
        totalRows: payloadRows.length,
        processedRows: payloadRows.length,
      });
      setImportSummary({
        status,
        importedCount,
        skippedDuplicatesCount,
        errorCount,
        issues,
      });
      setError(null);
      setSuccess(null);
      onSaved?.();
    } catch {
      setError("Could not read/import the XLSX file.");
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  const lookupsBusy =
    groupsLoading || subGroupsLoading || branchesLoading || departmentsLoading;
  const noGroups = !groupsLoading && groups.length === 0;
  const noBranches = !branchesLoading && branches.length === 0;
  const duplicatePreview = (importSummary?.issues ?? [])
    .filter((i) => i.kind === "duplicate")
    .slice(0, 5);

  const importValidationDistinct = useMemo(() => {
    if (!importSummary || importSummary.errorCount === 0) return null;
    return distinctImportValidationMessages(importSummary.issues, 8);
  }, [importSummary]);

  function downloadImportErrorReport() {
    if (!importSummary || importSummary.issues.length === 0) return;
    const rows = importSummary.issues.map((issue) => ({
      Row: issue.row,
      AssetCode: issue.assetCode ?? "",
      Type: issue.kind === "duplicate" ? "Duplicate" : "Validation error",
      Message: issue.message,
    }));
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Status:
          importSummary.status === "success"
            ? "Success"
            : importSummary.status === "partial"
              ? "Partial success"
              : "Import failed",
        Imported: importSummary.importedCount,
        SkippedDuplicates: importSummary.skippedDuplicatesCount,
        Errors: importSummary.errorCount,
      },
    ]);
    const errorsSheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, errorsSheet, "Issues");
    XLSX.writeFile(wb, `asset-import-error-report-${Date.now()}.xlsx`);
  }

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
      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-700">
          Import from Excel (`.xlsx`) using your Assets Register export format.
          Include a <strong className="font-medium">Book Value</strong> column
          (current written-down value) so depreciation uses that as the cost
          basis; purchase amount stays historical cost on the register.{" "}
          <strong className="font-medium">Branches</strong> are created automatically
          when missing: from <strong className="font-medium">AssetCode</strong> (
          <code className="rounded bg-slate-100 px-1">SKDBL/…</code>, second segment =
          branch code; stored branch name includes{" "}
          <code className="rounded bg-slate-100 px-1">(BC:…)</code> from that segment),
          from <code className="rounded bg-slate-100 px-1">(BC:branchCode)</code> on
          BranchName, or from BranchName alone (a code is generated). You do not need
          any branches in Admin before import when those rules apply.
        </p>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50">
          {importing ? "Importing..." : "Import XLSX"}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={importing || submitting || lookupsBusy || noGroups}
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
      {importProgress ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-sm text-emerald-900">
            Importing rows...
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{
                width: `${Math.max(
                  5,
                  Math.round(
                    (importProgress.processedRows / importProgress.totalRows) * 100
                  )
                )}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-emerald-800">
            {importProgress.processedRows}/{importProgress.totalRows} rows processed
            this pass.
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {success}
        </p>
      ) : null}
      {importSummary ? (
        <div
          className={`mt-3 rounded-lg border p-4 ${
            importSummary.status === "success"
              ? "border-emerald-200 bg-emerald-50/70"
              : importSummary.status === "partial"
                ? "border-amber-200 bg-amber-50/70"
                : "border-red-200 bg-red-50/70"
          }`}
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold text-slate-900">
            {importSummary.status === "success"
              ? "Success"
              : importSummary.status === "partial"
                ? "Partial success"
                : "Import failed"}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {importSummary.status === "success"
              ? "All valid rows were imported successfully."
              : importSummary.status === "partial"
                ? importSummary.errorCount > 0
                  ? "Some rows were imported. Update the remaining rows in your file using the validation messages below (or the downloaded report), then import again."
                  : "Some rows were imported, but a few rows need attention."
                : importSummary.errorCount > 0
                  ? "No rows were imported. Fix the issues below (for example asset group names must match the register, dates must be valid BS YYYY/MM/DD, and duplicate asset codes must be removed), then import again."
                  : importSummary.skippedDuplicatesCount > 0
                    ? "No new rows were imported; rows were skipped because the asset code already exists or is repeated in this file."
                    : "No rows were imported. Please fix the issues below and try again."}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Imported</p>
              <p className="text-base font-semibold text-slate-900">
                {importSummary.importedCount}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Skipped duplicates</p>
              <p className="text-base font-semibold text-slate-900">
                {importSummary.skippedDuplicatesCount}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Errors</p>
              <p className="text-base font-semibold text-slate-900">
                {importSummary.errorCount}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Rows with issues</p>
              <p className="text-base font-semibold text-slate-900">
                {importSummary.issues.length}
              </p>
            </div>
          </div>

          {importSummary.errorCount > 0 && importValidationDistinct ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                What to correct in your file
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-800">
                {importValidationDistinct.samples.map(({ message, count }) => (
                  <li key={message}>
                    {count > 1 ? (
                      <>
                        {message}{" "}
                        <span className="whitespace-nowrap text-slate-600">
                          ({count} rows)
                        </span>
                      </>
                    ) : (
                      message
                    )}
                  </li>
                ))}
              </ul>
              {importValidationDistinct.truncated ? (
                <p className="mt-2 text-xs text-slate-600">
                  More issue types are included in the downloaded error report.
                </p>
              ) : null}
            </div>
          ) : null}

          {duplicatePreview.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                Duplicate rows (first 5)
              </p>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {duplicatePreview.map((row) => (
                  <li key={`${row.row}-${row.assetCode ?? "no-code"}`}>
                    Row {row.row}: {row.assetCode ?? "(no asset code)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {importSummary.issues.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={downloadImportErrorReport}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 sm:w-auto"
              >
                Download Full Error Report (.xlsx)
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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
              <p className="block text-sm font-medium text-slate-700">Asset code</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Auto-generated from branch, group, purchase date, and row id.
              </p>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                value={generatedAssetCodePreview}
                aria-readonly="true"
                className={`${inputClass} cursor-default bg-slate-50 font-mono text-xs text-slate-700`}
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
                      {formatBranchOptionLabel(b)}
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
                Department
              </label>
              <select
                id={`${formId}-department`}
                disabled={departmentsLoading}
                value={departmentId === "" ? "" : String(departmentId)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setDepartmentId(v === "" ? "" : Number.parseInt(v, 10));
                }}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50`}
              >
                {departmentsLoading ? (
                  <option value="">Loading…</option>
                ) : (
                  <>
                    <option value="">— None —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {departmentsError ? (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {departmentsError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionHeadingClass}>Purchase information</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
            <div className="sm:col-span-2 lg:col-span-3">
              <span
                id={`${formId}-purchase-bs-label`}
                className="block text-sm font-medium text-slate-700"
              >
                Purchase date
              </span>
              <p
                id={`${formId}-purchase-bs-hint`}
                className="mt-0.5 text-xs text-slate-500"
              >
                Bikram Sambat — calendar in Nepali script; date below is stored
                as English BS (YYYY/MM/DD).
              </p>
              <div
                className="relative mt-1 w-full max-w-md"
                aria-labelledby={`${formId}-purchase-bs-label`}
                aria-describedby={`${formId}-purchase-bs-hint`}
              >
                <div
                  className="pointer-events-none absolute inset-0 z-0 flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm tabular-nums"
                >
                  {purchaseDateBs ? (
                    purchaseDateBs
                  ) : (
                    <span className="text-slate-400">Click to select date</span>
                  )}
                </div>
                {purchaseDatePickerReady ? (
                  <NepaliDatePicker
                    value={bsDateToPickerValue(purchaseDateBs)}
                    onChange={(value) => {
                      const next = normalizeBsDateEnglish(value);
                      setPurchaseDateBs(next);
                      setDepreciationStartDateBs((prev) =>
                        prev.trim() === "" ? next : prev
                      );
                    }}
                    inputClassName={`${inputClass} relative z-10 cursor-pointer border-transparent bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent`}
                    className="w-full"
                    options={{
                      calenderLocale: "ne",
                      valueLocale: "en",
                      closeOnSelect: true,
                    }}
                  />
                ) : (
                  <div
                    className={`${inputClass} relative z-10 bg-transparent`}
                  />
                )}
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <span
                id={`${formId}-depreciation-bs-label`}
                className="block text-sm font-medium text-slate-700"
              >
                Depreciation start date
              </span>
              <p
                id={`${formId}-depreciation-bs-hint`}
                className="mt-0.5 text-xs text-slate-500"
              >
                Bikram Sambat — used for depreciation schedules (defaults to
                purchase date when you first select purchase date; adjust if
                different).
              </p>
              <div
                className="relative mt-1 w-full max-w-md"
                aria-labelledby={`${formId}-depreciation-bs-label`}
                aria-describedby={`${formId}-depreciation-bs-hint`}
              >
                <div
                  className="pointer-events-none absolute inset-0 z-0 flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm tabular-nums"
                >
                  {depreciationStartDateBs ? (
                    depreciationStartDateBs
                  ) : (
                    <span className="text-slate-400">Click to select date</span>
                  )}
                </div>
                {purchaseDatePickerReady ? (
                  <NepaliDatePicker
                    value={bsDateToPickerValue(depreciationStartDateBs)}
                    onChange={(value) =>
                      setDepreciationStartDateBs(normalizeBsDateEnglish(value))
                    }
                    inputClassName={`${inputClass} relative z-10 cursor-pointer border-transparent bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent`}
                    className="w-full"
                    options={{
                      calenderLocale: "ne",
                      valueLocale: "en",
                      closeOnSelect: true,
                    }}
                  />
                ) : (
                  <div
                    className={`${inputClass} relative z-10 bg-transparent`}
                  />
                )}
              </div>
            </div>
            <div>
              <label
                htmlFor={`${formId}-purchase-qty`}
                className="block text-sm font-medium text-slate-700"
              >
                Quantity
                <span className="ml-1 font-normal text-slate-500">
                  (creates one register row per unit)
                </span>
              </label>
              <input
                id={`${formId}-purchase-qty`}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
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
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || importing || lookupsBusy || noGroups || noBranches}
          className="w-full max-w-lg rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save asset"}
        </button>
      </form>
    </section>
  );
}
