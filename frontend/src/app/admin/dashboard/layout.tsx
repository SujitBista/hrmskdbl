import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { AdminDashboardShell } from "./dashboard-shell";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/admin");
  }

  return (
    <AdminDashboardShell email={session.email}>{children}</AdminDashboardShell>
  );
}
