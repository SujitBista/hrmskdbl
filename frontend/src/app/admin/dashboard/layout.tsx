import { adminDashboardPageTitle } from "@/lib/admin-dashboard-page-title";
import { getSession } from "@/lib/session";
import { headers } from "next/headers";
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

  const headerList = await headers();
  const pathnameFromMiddleware = headerList.get("x-pathname") ?? "/admin/dashboard";
  const initialPageTitle = adminDashboardPageTitle(pathnameFromMiddleware);

  return (
    <AdminDashboardShell
      email={session.email}
      initialPageTitle={initialPageTitle}
    >
      {children}
    </AdminDashboardShell>
  );
}
