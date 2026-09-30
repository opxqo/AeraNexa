"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { AppShell, type MenuEntry } from "@/components/aera/app-shell";
import type { Plan } from "@/lib/demo/cursor-mock";
import { BASE, NAV_GROUPS } from "./nav";
import { CursorStateProvider, useCursorState } from "./state";

/** The Cursor-style demo's shell: the generic AppShell with this demo's nav, user and menu. */
export function CursorShell({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const initialPlan: Plan = params.get("plan") === "free" ? "free" : "pro";
  return (
    <CursorStateProvider initialPlan={initialPlan}>
      <Frame>{children}</Frame>
    </CursorStateProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  // ?plan=free shows the Free-plan screens; keep it while moving between pages.
  const suffix = useSearchParams().get("plan") === "free" ? "?plan=free" : "";
  const { plan, first, last, avatar } = useCursorState();
  const menu: MenuEntry[] = [
    { label: "Cloud Agent Settings", href: `${BASE}/cloud-agents` },
    { label: "Download app", onSelect: () => toast("This is a demo: there is nothing to download.") },
    "separator",
    { label: "Docs", onSelect: () => toast("Documentation is not part of this demo.") },
    { label: "Contact us", onSelect: () => toast("Contact is not part of this demo.") },
    "separator",
    { label: "Log out", onSelect: () => toast("This is a demo: there is nothing to log out of.") },
  ];
  return (
    <AppShell
      base={BASE}
      groups={NAV_GROUPS}
      linkSuffix={suffix}
      back={{ label: "Back to Agents", href: `${BASE}/overview${suffix}` }}
      user={{ name: `${first} ${last}`.trim(), caption: plan === "pro" ? "Pro" : "Free", avatar }}
      menu={menu}
      footer={
        <p className="mx-auto mt-12 max-w-[1646px] text-xs text-muted-foreground lg:pl-[calc(clamp(220px,19.0625vw,366px)+clamp(24px,3.125vw,60px))]">
          Activity grid from{" "}
          <a href="https://www.rareui.com" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
            Rare UI
          </a>
          .
        </p>
      }
    >
      {children}
    </AppShell>
  );
}
