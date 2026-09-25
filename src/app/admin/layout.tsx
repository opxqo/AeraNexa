import "./admin.css";
import { AdminShell } from "@/components/admin-shell";
import { requireAdminUser } from "@/lib/server/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminUser();
  return <AdminShell userEmail={admin.email} usesDefaultPassword={admin.usesDefaultPassword}>{children}</AdminShell>;
}
