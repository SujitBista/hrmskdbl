"use client";

import { AssetDisposalsScreen } from "@/components/admin/asset-disposals-screen";
import { FixedAssetSectionTabs } from "@/components/admin/fixed-asset-section-tabs";

export default function AssetRegisterDisposalsPage() {
  return (
    <div className="flex flex-col gap-8">
      <FixedAssetSectionTabs />
      <AssetDisposalsScreen />
    </div>
  );
}
