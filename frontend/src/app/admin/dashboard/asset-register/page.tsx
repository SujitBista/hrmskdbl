"use client";

import { useCallback, useState } from "react";
import { AssetRegisterAssetsTable } from "@/components/admin/asset-register-assets-table";
import { AssetRegisterForm } from "@/components/admin/asset-register-form";

export default function AdminAssetRegisterPage() {
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0);
  const onAssetSaved = useCallback(() => {
    setAssetsRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <AssetRegisterForm onSaved={onAssetSaved} />
      <AssetRegisterAssetsTable refreshKey={assetsRefreshKey} />
    </div>
  );
}
