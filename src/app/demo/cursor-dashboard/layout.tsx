import "@/styles/aera.css";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { CursorShell } from "@/components/cursor-dashboard/shell";

export const metadata: Metadata = {
  title: "Account dashboard demo",
  description: "A shadcn/ui account dashboard with mock data: the reference for the Aera UI design language.",
};

export default function CursorDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <CursorShell>{children}</CursorShell>
    </Suspense>
  );
}
