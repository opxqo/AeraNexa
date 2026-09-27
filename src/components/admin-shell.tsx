"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Moon, Search, ShieldAlert, Sun } from "lucide-react";
import { AdminSidebar } from "@/components/admin-sidebar";
import { AdminCommandPalette, isPaletteShortcut } from "@/components/admin-command-palette";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb as ShadcnBreadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider, useToast } from "@/components/v2-modal";
import { useStackedTables } from "@/components/use-stacked-tables";
import { locateAdminPage, type AdminNavCounts } from "@/lib/admin-navigation";
import { authApi } from "@/lib/api/auth";
import { clearAuthToken } from "@/lib/api/client";

const COLLAPSE_KEY = "aeranexa-admin-sidebar-collapsed";
const COUNTS_REFRESH_MS = 60_000;

/** 顶栏面包屑：分组 / 页面 / 子页。useSearchParams 需要放在 Suspense 里。 */
function AdminBreadcrumb() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { section, subPage } = locateAdminPage(pathname, new URLSearchParams(search.toString()));
  const crumbs = [section?.group ?? "管理后台", section && section.href !== "/admin" ? section.label : "管理概览"];
  if (subPage?.value) crumbs.push(subPage.label);

  return (
    <ShadcnBreadcrumb className="admin-header-breadcrumb" aria-label="当前位置">
      <BreadcrumbList className="admin-header-crumb-list">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb}-${index}`}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {index === crumbs.length - 1 ? <BreadcrumbPage>{crumb}</BreadcrumbPage> : <span>{crumb}</span>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </ShadcnBreadcrumb>
  );
}

function AdminShellInner({ children, userEmail, usesDefaultPassword }: { children: React.ReactNode; userEmail: string; usesDefaultPassword: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [counts, setCounts] = useState<AdminNavCounts | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  useStackedTables(contentRef);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDarkMode(document.documentElement.getAttribute("data-theme") === "dark" || localStorage.getItem("theme") === "dark");
      setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
      try {
        setSidebarOpen(localStorage.getItem(COLLAPSE_KEY) !== "1");
      } catch {
        // 隐私模式等读不到时按展开处理。
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/admin/nav-counts", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<AdminNavCounts> : null))
        .then((data) => { if (!cancelled && data) setCounts(data); })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, COUNTS_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pathname]);

  const handleSidebarOpenChange = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(COLLAPSE_KEY, open ? "0" : "1");
    } catch {
      // 存不了就只在本次打开期间生效。
    }
  };

  const toggleTheme = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
    showToast(nextDark ? "已切换至暗色模式" : "已切换至亮色模式", "info");
  };

  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    clearAuthToken();
    showToast("已成功登出", "info");
    router.push("/login");
  };

  return (
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange} className="portal-shell admin-shell">
        <AdminSidebar counts={counts} userEmail={userEmail} onLogout={logout} />
        <SidebarInset className="admin-sidebar-inset">
          <header className="admin-workbench-header">
            <div className="admin-header-inner">
              <div className="admin-header-leading">
                <SidebarTrigger className="admin-header-trigger" aria-label="切换侧栏" />
                <span className="admin-header-divider" aria-hidden="true" />
                <Suspense fallback={<nav className="admin-header-breadcrumb" />}>
                  <AdminBreadcrumb />
                </Suspense>
              </div>
              <div className="admin-header-actions">
                <button type="button" className="admin-header-search" onClick={() => setPaletteOpen(true)} aria-label="搜索并跳转到后台页面">
                  <Search size={15} aria-hidden="true" />
                  <span>搜索页面…</span>
                  <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
                </button>
                <button className="admin-header-theme" type="button" aria-label="切换主题" onClick={toggleTheme}>
                  {isDarkMode ? <Moon size={17} /> : <Sun size={17} />}
                </button>
              </div>
            </div>
          </header>

          <div className="admin-workbench-content" ref={contentRef}>
            {usesDefaultPassword ? (
              <div className="admin-password-alert" role="alert">
                <ShieldAlert size={18} aria-hidden="true" />
                <div>
                  <strong>你还在使用默认密码 admin123456</strong>
                  <span>这个密码是公开的，任何人都能用它登录后台。请立即修改，改完这条提醒会自动消失。</span>
                </div>
                <Link href="/profile#change-password" className="button button-primary">去修改密码</Link>
              </div>
            ) : null}
            {children}
          </div>
        </SidebarInset>
        {paletteOpen ? <AdminCommandPalette onClose={() => setPaletteOpen(false)} /> : null}
      </SidebarProvider>
    </TooltipProvider>
  );
}

export function AdminShell({ children, userEmail, usesDefaultPassword = false }: { children: React.ReactNode; userEmail: string; usesDefaultPassword?: boolean }) {
  return (
    <ToastProvider>
      <AdminShellInner userEmail={userEmail} usesDefaultPassword={usesDefaultPassword}>{children}</AdminShellInner>
    </ToastProvider>
  );
}
