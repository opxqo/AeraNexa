import { PortalShell } from "@/components/portal-shell";
import { ToastProvider } from "@/components/v2-modal";

export default function DemoPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PortalShell basePath="/demo">{children}</PortalShell>
    </ToastProvider>
  );
}
