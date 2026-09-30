"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell, type MenuEntry } from "@/components/aera/app-shell";
import { NoticeBoard } from "@/components/aera/notice-board";
import { DEMO_SITE } from "@/lib/demo-site/flag";
import { endSession, useSession } from "@/lib/demo-site/session";
import { NOTICES, SUBSCRIPTION } from "@/lib/demo/panel-mock";
import { BASE, NAV_GROUPS } from "./nav";
import { PanelStateProvider, usePanelState } from "./state";

const MENU: MenuEntry[] = [
  { label: "个人中心", href: `${BASE}/profile` },
  { label: "我的工单", href: `${BASE}/ticket` },
  "separator",
  { label: "退出登录", onSelect: () => toast("演示环境：没有可退出的登录。") },
];

/** The account panel demo's shell: the generic AppShell with the panel's pages. */
export function PanelShell({ children }: { children: ReactNode }) {
  if (DEMO_SITE) return <DemoPanel>{children}</DemoPanel>;
  return (
    <PanelStateProvider>
      <Frame>{children}</Frame>
    </PanelStateProvider>
  );
}

/**
 * The static demo site's panel: nothing shows without a login, and what the account does is kept in the browser.
 * The session is only known in the browser, so the server-rendered page is empty and the panel mounts after hydration.
 */
function DemoPanel({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);
  if (!session) return null;
  return (
    <PanelStateProvider account={session}>
      <Frame>{children}</Frame>
    </PanelStateProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { nickname, avatar, resetData } = usePanelState();
  // The announcements strip belongs to the dashboard only.
  const pathname = usePathname().replace(/\/$/, ""); // the static export serves /dashboard/
  const onDashboard = pathname.endsWith("/dashboard");
  const onPlan = pathname.endsWith("/plan");
  return (
    <AppShell base={BASE} groups={NAV_GROUPS} back={{ label: "返回首页", href: "/" }} user={{ name: nickname, caption: SUBSCRIPTION.planName, avatar }} menu={DEMO_SITE ? [...MENU.slice(0, 3), { label: "重置演示数据", onSelect: resetData }, { label: "退出登录", onSelect: endSession }] : MENU} banner={onDashboard ? <NoticeBoard notices={NOTICES} /> : undefined} footer={onPlan ? <PlanCredits /> : undefined}>
      {children}
    </AppShell>
  );
}

/** The Disney+ and Prime Video marks are Streamline Logos (CC BY 4.0), which asks for a credit where they are shown. */
function PlanCredits() {
  return (
    <p className="mx-auto mt-12 max-w-[1646px] text-xs text-muted-foreground lg:pl-[calc(clamp(220px,19.0625vw,366px)+clamp(24px,3.125vw,60px))]">
      Disney+ and Prime Video marks from{" "}
      <a href="https://www.streamlinehq.com" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
        Streamline
      </a>{" "}
      (CC BY 4.0).
    </p>
  );
}
