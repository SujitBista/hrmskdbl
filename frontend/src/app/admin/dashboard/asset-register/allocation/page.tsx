"use client";

import { AssetAllocationScreen } from "@/components/admin/asset-allocation-screen";
import { FixedAssetSectionTabs } from "@/components/admin/fixed-asset-section-tabs";

export default function AdminAssetAllocationPage() {
  return (
    <div className="flex flex-col gap-8">
      <FixedAssetSectionTabs />
      <AssetAllocationScreen />
    </div>
  );
}
