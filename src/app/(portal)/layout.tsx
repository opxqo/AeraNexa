import { redirect } from "next/navigation";
import { PortalAuthShell } from "@/components/portal-auth-shell";
import { getCurrentUser } from "@/lib/server/users";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  if (!(await getCurrentUser())) redirect("/login");
  return <PortalAuthShell>{children}</PortalAuthShell>;
}
