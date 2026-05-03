"use client";

import { useCallback, useState } from "react";
import { AssetRegisterAllocationTable } from "@/components/admin/asset-register-allocation-table";
import { FixedAssetSectionTabs } from "@/components/admin/fixed-asset-section-tabs";

export default function AssetRegisterAllocationsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <FixedAssetSectionTabs />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
        >
          Refresh list
        </button>
      </div>
      <AssetRegisterAllocationTable
        refreshKey={refreshKey}
        onProfileSaved={onRefresh}
      />
    </div>
  );
}
