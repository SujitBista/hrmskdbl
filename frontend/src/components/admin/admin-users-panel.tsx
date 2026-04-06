"use client";

import { useState } from "react";
import { CreateUserForm } from "./create-user-form";
import { UsersTable } from "./users-table";

export function AdminUsersPanel() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      <CreateUserForm onCreated={() => setRefreshKey((k) => k + 1)} />
      <UsersTable refreshKey={refreshKey} />
    </div>
  );
}
