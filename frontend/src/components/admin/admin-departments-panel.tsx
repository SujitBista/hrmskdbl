"use client";

import { useState } from "react";
import { CreateDepartmentForm } from "./create-department-form";
import { DepartmentsTable } from "./departments-table";

export function AdminDepartmentsPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-8">
      <CreateDepartmentForm onCreated={bump} />
      <DepartmentsTable refreshKey={refreshKey} />
    </div>
  );
}
