"use client";

import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { PortalShell } from "@/components/portal-shell";
import { ToastProvider } from "@/components/v2-modal";

function PortalShellInner({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return <PortalShell userEmail={user?.email} userRole={user?.role} onLogout={logout}>{children}</PortalShell>;
}

export function PortalAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <PortalShellInner>{children}</PortalShellInner>
      </AuthProvider>
    </ToastProvider>
  );
}
