"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FixedAssetSectionTabs } from "@/components/admin/fixed-asset-section-tabs";

const SKIPPED_STORAGE_KEY = "hrmskdbl_depreciation_skipped";

type EnsureResponse = {
  run?: { id: number };
  detailsInserted?: number;
  skippedAssets?: {
    asset_id: number;
    asset_name: string;
    reason: string;
  }[];
  error?: string;
};

export default function DepreciationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let navigated = false;

    async function ensureCurrentFyRun() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          "/api/admin/depreciation-runs/ensure-current",
          {
            method: "POST",
            cache: "no-store",
          }
        );
        const json = (await res.json()) as EnsureResponse;
        if (!res.ok) {
          if (!cancelled) {
            setError(
              json.error ??
                "Could not calculate depreciation for the current fiscal year."
            );
          }
          return;
        }
        const runId = json.run?.id;
        if (!runId || !Number.isFinite(runId)) {
          if (!cancelled) {
            setError(
              "Depreciation was calculated but no run id was returned."
            );
          }
          return;
        }
        if (json.skippedAssets && json.skippedAssets.length > 0) {
          const lines = json.skippedAssets.map(
            (s) => `#${s.asset_id} ${s.asset_name}: ${s.reason}`
          );
          window.alert(
            `Depreciation for the current fiscal year was calculated (${json.detailsInserted ?? 0} row(s)).\n\n` +
              `${json.skippedAssets.length} asset(s) were skipped and will not appear in this sheet:\n\n` +
              lines.join("\n")
          );
          try {
            sessionStorage.setItem(
              SKIPPED_STORAGE_KEY,
              JSON.stringify(json.skippedAssets)
            );
          } catch {
            /* ignore */
          }
        }
        navigated = true;
        if (!cancelled) {
          router.replace(
            `/admin/dashboard/asset-register/depreciation/${runId}`
          );
        }
      } catch {
        if (!cancelled) {
          setError("Could not reach the server to calculate depreciation.");
        }
      } finally {
        if (!cancelled && !navigated) {
          setLoading(false);
        }
      }
    }
    void ensureCurrentFyRun();
    return () => {
      cancelled = true;
    };
  }, [router, retryToken]);

  return (
    <div className="flex flex-col gap-4">
      <FixedAssetSectionTabs />
      {loading ? (
        <p className="text-sm text-slate-600">
          Calculating depreciation for the current fiscal year…
        </p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            className="mt-3 inline-flex rounded-lg border border-emerald-900/20 bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-900"
            onClick={() => setRetryToken((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
