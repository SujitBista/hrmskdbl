import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { AdminDashboardShell } from "./dashboard-shell";
import { AdminUsersPanel } from "@/components/admin/admin-users-panel";

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/admin");
  }

  return (
    <AdminDashboardShell email={session.email}>
      <AdminUsersPanel />
    </AdminDashboardShell>
  );
}
