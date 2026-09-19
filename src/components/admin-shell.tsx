"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ExternalLink,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  UserCircle,
  X,
} from "lucide-react";
import { adminSections } from "@/lib/admin-navigation";
import { authApi } from "@/lib/api/auth";
import { clearAuthToken } from "@/lib/api/client";
import { ToastProvider, useToast } from "@/components/v2-modal";

function AdminShellInner({ children, userEmail }: { children: React.ReactNode; userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const current = adminSections.find(
    ({ href }) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)),
  );
  const groups = [undefined, "业务管理", "资源与支持"] as const;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDarkMode(
        document.documentElement.getAttribute("data-theme") === "dark" ||
          localStorage.getItem("theme") === "dark",
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    <div className="portal-shell">
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
          AeraNexa
        </Link>
        <nav className="primary-nav" aria-label="管理员面板导航">
          {groups.map((group) => (
            <div className="nav-group" key={group ?? "main"}>
              {group && <p className="nav-label">{group}</p>}
              {adminSections
                .filter((section) => section.group === group)
                .map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <Icon size={17} strokeWidth={1.55} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
        <p className="sidebar-version">AeraNexa Admin v0.1.0</p>
      </aside>

      {open ? (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} />
      ) : null}

      <div className="portal-main">
        <header className="topbar">
          <div className="admin-topbar-heading">
            <p className="topbar-title">{current?.label ?? "管理员面板"}</p>
            <span className="v2-mode-badge prod"><ShieldCheck size={12} /> 管理员</span>
          </div>
          <div className="topbar-actions">
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
                <ChevronDown size={14} aria-hidden="true" />
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
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function AdminShell({ children, userEmail }: { children: React.ReactNode; userEmail: string }) {
  return (
    <ToastProvider>
      <AdminShellInner userEmail={userEmail}>{children}</AdminShellInner>
    </ToastProvider>
  );
}
