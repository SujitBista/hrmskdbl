"use client";

import { useState } from "react";
import { CreateSubGroupForm } from "./create-sub-group-form";
import { SubGroupsTable } from "./sub-groups-table";

export function AdminSubGroupsPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-8">
      <CreateSubGroupForm groupsRefreshKey={refreshKey} onCreated={bump} />
      <SubGroupsTable refreshKey={refreshKey} onImported={bump} />
    </div>
  );
}
