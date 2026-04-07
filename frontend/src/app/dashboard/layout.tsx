import { getUserSession } from "@/lib/user-session";
import { redirect } from "next/navigation";
import { UserDashboardShell } from "./user-dashboard-shell";

export default async function UserDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getUserSession();
  if (!session) {
    redirect("/login");
  }

  return <UserDashboardShell session={session}>{children}</UserDashboardShell>;
}
