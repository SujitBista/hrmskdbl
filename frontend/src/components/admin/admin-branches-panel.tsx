"use client";

import { useState } from "react";
import { CreateBranchForm } from "./create-branch-form";
import { BranchesTable } from "./branches-table";

export function AdminBranchesPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-8">
      <CreateBranchForm onCreated={bump} />
      <BranchesTable refreshKey={refreshKey} />
    </div>
  );
}
