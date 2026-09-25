"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUndo20Regular,
  BookOpen20Regular,
  Box20Regular,
  ClipboardTask20Regular,
  DataUsage20Regular,
  DatabaseArrowRight20Regular,
  DocumentCheckmark20Regular,
  DocumentSearch20Regular,
  Home20Regular,
  Key20Regular,
  Mail20Regular,
  Megaphone20Regular,
  Money20Regular,
  People20Regular,
  Receipt20Regular,
  Server20Regular,
  Settings20Regular,
  TicketDiagonal20Regular,
} from "@fluentui/react-icons";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldAlert,
  Sun,
  UserCircle,
  X,
} from "lucide-react";
import { adminSections, locateAdminPage, type AdminIcon, type AdminNavCounts } from "@/lib/admin-navigation";
import { authApi } from "@/lib/api/auth";
import { clearAuthToken } from "@/lib/api/client";
import { ToastProvider, useToast } from "@/components/v2-modal";
import { BrandMark } from "@/components/brand-mark";
import { useStackedTables } from "@/components/use-stacked-tables";
import { AdminCommandPalette, isPaletteShortcut } from "@/components/admin-command-palette";

const adminIconByKey: Record<AdminIcon, React.ComponentType<{ fontSize?: number; "aria-hidden"?: boolean }>> = {
  dashboard: Home20Regular,
  users: People20Regular,
  plans: Box20Regular,
  orders: ClipboardTask20Regular,
  coupons: Money20Regular,
  payments: Receipt20Regular,
  refunds: ArrowUndo20Regular,
  reconciliation: DocumentCheckmark20Regular,
  rechargeCards: Key20Regular,
  nodes: Server20Regular,
  tickets: TicketDiagonal20Regular,
  notices: Megaphone20Regular,
  knowledge: BookOpen20Regular,
  traffic: DataUsage20Regular,
  mail: Mail20Regular,
  settings: Settings20Regular,
  logs: DocumentSearch20Regular,
  backup: DatabaseArrowRight20Regular,
};

const GROUPS = [undefined, "业务管理", "资源与支持", "系统"] as const;
const COLLAPSE_KEY = "aeranexa-admin-sidebar-collapsed";
const COUNTS_REFRESH_MS = 60_000;

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
}

/** 顶栏面包屑：分组 / 页面 / 子页。useSearchParams 需要放在 Suspense 里。 */
function Breadcrumb() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { section, subPage } = locateAdminPage(pathname, new URLSearchParams(search.toString()));
  const crumbs = [section?.group ?? "管理后台", section && section.href !== "/admin" ? section.label : "管理概览"];
  if (subPage && subPage.value) crumbs.push(subPage.label);
  return (
    <nav className="admin-breadcrumb" aria-label="当前位置">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb}-${index}`} className={index === crumbs.length - 1 ? "current" : undefined}>
          {index > 0 ? <ChevronRight size={14} aria-hidden="true" /> : null}
          {index === crumbs.length - 1 ? <b aria-current="page">{crumb}</b> : crumb}
        </span>
      ))}
    </nav>
  );
}

function AdminShellInner({ children, userEmail, usesDefaultPassword }: { children: React.ReactNode; userEmail: string; usesDefaultPassword: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [counts, setCounts] = useState<AdminNavCounts | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const accountRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  // 窄屏把表格折叠成卡片，与用户端一致（样式见 globals.css「移动端表格卡片化」）
  useStackedTables(contentRef);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDarkMode(document.documentElement.getAttribute("data-theme") === "dark" || localStorage.getItem("theme") === "dark");
      setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
      try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* 隐私模式等读不到时按展开处理 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ⌘K / Ctrl+K 打开快速跳转
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 待办数字：进入页面、切换页面时各拉一次，之后每分钟刷新；网络抖动时保留上一次的数字
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

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* 存不了就只在本次生效 */ }
      return next;
    });
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
    <div className={`portal-shell admin-shell${collapsed ? " admin-collapsed" : ""}`}>
      <button
        className="mobile-menu"
        type="button"
        aria-label={open ? "关闭导航" : "打开导航"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <Link className="brand" href="/admin" onClick={() => setOpen(false)}>
          <BrandMark />
          <span className="brand-text">AeraNexa</span>
          <span className="brand-tag">Admin</span>
        </Link>
        <nav className="primary-nav" aria-label="管理员面板导航">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group ?? "main"}>
              {group && <p className="nav-label">{group}</p>}
              {adminSections
                .filter((section) => section.group === group)
                .map(({ href, label, icon, count }) => {
                  const Icon = adminIconByKey[icon];
                  const active = isActive(pathname, href);
                  const badge = count && counts ? counts[count] : 0;
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={label}
                      onClick={() => setOpen(false)}
                    >
                      <Icon fontSize={18} aria-hidden />
                      <span>{label}</span>
                      {badge > 0 ? (
                        <em className={`nav-badge${count === "syncFailed" ? " danger" : ""}`} aria-label={`${badge} 项待处理`}>
                          {badge > 99 ? "99+" : badge}
                        </em>
                      ) : null}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="sidebar-collapse" onClick={toggleCollapsed} title={collapsed ? "展开侧栏" : "收起侧栏"} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span>收起侧栏</span>
          </button>
          <p className="sidebar-version">v0.1.0</p>
        </div>
      </aside>

      {open ? (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} />
      ) : null}

      <div className="portal-main">
        <header className="topbar">
          <div className="topbar-inner">
            <Suspense fallback={<nav className="admin-breadcrumb" />}>
              <Breadcrumb />
            </Suspense>
            <div className="topbar-actions">
              <button type="button" className="admin-search-trigger" onClick={() => setPaletteOpen(true)} aria-label="搜索并跳转到后台页面">
                <Search size={15} aria-hidden="true" />
                <span>搜索页面…</span>
                <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
              </button>
              <button className="icon-button" type="button" aria-label="切换主题" onClick={toggleTheme}>
                {isDarkMode ? <Moon size={17} /> : <Sun size={17} />}
              </button>
              <div className="admin-account-menu" ref={accountRef}>
                <button
                  className="account-button"
                  type="button"
                  aria-expanded={accountMenuOpen}
                  onClick={() => setAccountMenuOpen((value) => !value)}
                >
                  <UserCircle size={18} aria-hidden="true" />
                  <span className="account-copy">{userEmail}</span>
                  <ChevronDown className="account-caret" size={14} aria-hidden="true" />
                </button>
                {accountMenuOpen ? (
                  <div className="v2-dropdown-menu admin-account-dropdown">
                    <Link href="/dashboard" className="v2-dropdown-item" onClick={() => setAccountMenuOpen(false)}>
                      <ExternalLink size={15} />
                      <span>返回用户面板</span>
                    </Link>
                    <div className="v2-dropdown-divider" />
                    <button type="button" className="v2-dropdown-item admin-logout" onClick={logout}>
                      <LogOut size={15} />
                      <span>登出</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <main className="content" ref={contentRef}>
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
        </main>
      </div>

      {paletteOpen ? <AdminCommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}

export function AdminShell({ children, userEmail, usesDefaultPassword = false }: { children: React.ReactNode; userEmail: string; usesDefaultPassword?: boolean }) {
  return (
    <ToastProvider>
      <AdminShellInner userEmail={userEmail} usesDefaultPassword={usesDefaultPassword}>{children}</AdminShellInner>
    </ToastProvider>
  );
}
