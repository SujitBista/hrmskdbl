"use client";

import { useState } from "react";
import { CreateGroupForm } from "./create-group-form";
import { GroupsTable } from "./groups-table";

export function AdminGroupsPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-8">
      <CreateGroupForm onCreated={bump} />
      <GroupsTable refreshKey={refreshKey} />
    </div>
  );
}
