"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BadgePercent, BookOpen, BriefcaseBusiness, ChartNoAxesCombined, ChevronDown,
  ChevronRight, ClipboardList, CreditCard, DatabaseBackup, ExternalLink, FileText,
  Gauge, KeyRound, LifeBuoy, LogOut, Mail, Megaphone, Package, Scale, Server,
  Settings, Settings2, Ticket, Undo2, Users,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { adminSections, type AdminIcon, type AdminNavCounts, type AdminSection } from "@/lib/admin-navigation";

const adminIconByKey: Record<AdminIcon, LucideIcon> = {
  dashboard: Gauge, users: Users, plans: Package, orders: ClipboardList,
  coupons: BadgePercent, payments: CreditCard, refunds: Undo2,
  reconciliation: Scale, rechargeCards: KeyRound, nodes: Server, tickets: Ticket,
  notices: Megaphone, knowledge: BookOpen, traffic: ChartNoAxesCombined,
  mail: Mail, settings: Settings, logs: FileText, backup: DatabaseBackup,
};

type NavGroup = NonNullable<AdminSection["group"]>;
const groups: { label: NavGroup; icon: LucideIcon }[] = [
  { label: "业务管理", icon: BriefcaseBusiness },
  { label: "资源与支持", icon: LifeBuoy },
  { label: "系统", icon: Settings2 },
];
const defaultAdminAvatar = "https://ui.shadcn.com/avatars/shadcn.jpg";

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
}

function NavGroupSection({
  label, icon: Icon, pathname, counts, closeMobileSidebar,
}: {
  label: NavGroup;
  icon: LucideIcon;
  pathname: string;
  counts: AdminNavCounts | null;
  closeMobileSidebar: () => void;
}) {
  const { open: sidebarOpen, setOpen, isMobile } = useSidebar();
  const [expanded, setExpanded] = useState(() => adminSections.some((section) => section.group === label && isActive(pathname, section.href)));
  const sections = adminSections.filter((section) => section.group === label);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="group/collapsible">
      <SidebarGroup className="admin-nav-group">
        <SidebarGroupContent>
          <SidebarMenu className="admin-nav-menu m-0 list-none p-0">
            <SidebarMenuItem className="list-none">
              {!sidebarOpen && !isMobile ? (
                <SidebarMenuButton className="admin-group-trigger" tooltip={label} aria-label={`展开${label}`} onClick={() => { setExpanded(true); setOpen(true); }}>
                  <Icon aria-hidden="true" /><span className="admin-sidebar-label">{label}</span>
                </SidebarMenuButton>
              ) : (
                <CollapsibleTrigger className="admin-group-trigger flex items-center gap-2 px-2 text-left" aria-label={`${expanded ? "收起" : "展开"}${label}`}>
                  <Icon aria-hidden="true" /><span className="admin-sidebar-label">{label}</span>
                  <ChevronRight className="admin-group-chevron" aria-hidden="true" />
                </CollapsibleTrigger>
              )}
              <CollapsibleContent className="admin-nav-panel">
                <SidebarMenuSub className="admin-nav-submenu m-0 list-none p-0">
                  {sections.map(({ href, label: itemLabel, icon, count }) => {
                    const ItemIcon = adminIconByKey[icon];
                    const active = isActive(pathname, href);
                    const badge = count && counts ? counts[count] : 0;
                    return (
                      <SidebarMenuSubItem key={href} className="list-none">
                        <SidebarMenuSubButton render={<Link href={href} aria-current={active ? "page" : undefined} onClick={closeMobileSidebar} />} isActive={active} className="admin-sidebar-link">
                          <ItemIcon aria-hidden="true" /><span className="admin-sidebar-label">{itemLabel}</span>
                        </SidebarMenuSubButton>
                        {badge > 0 ? (
                          <SidebarMenuBadge className="admin-nav-badge" data-danger={count === "syncFailed" ? "true" : undefined} aria-label={`${badge} 项待处理`}>
                            {badge > 99 ? "99+" : badge}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AdminSidebar({ counts, userEmail, onLogout }: { counts: AdminNavCounts | null; userEmail: string; onLogout: () => void }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => { if (isMobile) setOpenMobile(false); };
  const overview = adminSections.find((section) => section.href === "/admin")!;
  const OverviewIcon = adminIconByKey[overview.icon];
  const overviewActive = pathname === "/admin";

  return (
    <Sidebar collapsible="icon" variant="inset" className="admin-app-sidebar">
      <SidebarHeader className="admin-sidebar-header">
        <SidebarMenu className="m-0 list-none p-0">
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton render={<Link href="/admin" onClick={closeMobileSidebar} />} size="lg" tooltip={isMobile ? undefined : "AeraNexa 管理端"} className="admin-brand-link">
              <span className="admin-brand-mark"><BrandMark size={20} /></span>
              <span className="admin-sidebar-brand admin-sidebar-label">AeraNexa <small>管理端</small></span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="admin-sidebar-content">
        <SidebarGroup className="admin-nav-group admin-overview-group">
          <SidebarGroupContent>
            <SidebarMenu className="admin-nav-menu m-0 list-none p-0">
              <SidebarMenuItem className="list-none">
                <SidebarMenuButton render={<Link href="/admin" aria-current={overviewActive ? "page" : undefined} onClick={closeMobileSidebar} />} isActive={overviewActive} tooltip={isMobile ? undefined : overview.label} className="admin-sidebar-link admin-overview-link">
                  <OverviewIcon aria-hidden="true" /><span className="admin-sidebar-label">{overview.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="admin-nav-section-label admin-sidebar-label">工作台</div>
        {groups.map(({ label, icon }) => (
          <NavGroupSection key={`${pathname}-${label}`} label={label} icon={icon} pathname={pathname} counts={counts} closeMobileSidebar={closeMobileSidebar} />
        ))}
      </SidebarContent>

      <SidebarFooter className="admin-sidebar-footer">
        <SidebarSeparator />
        <SidebarMenu className="m-0 list-none p-0">
          <SidebarMenuItem className="list-none">
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="admin-account-trigger" />} aria-label={`账户菜单：${userEmail}`} title={userEmail}>
                  <Avatar className="admin-account-avatar">
                    <AvatarImage src={defaultAdminAvatar} alt="管理员账户头像" />
                    <AvatarFallback>{userEmail.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="admin-account-identity admin-sidebar-label"><strong>管理员账户</strong><small title={userEmail}>{userEmail}</small></span>
                  <ChevronDown className="admin-account-chevron" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="admin-account-dropdown" side={isMobile ? "bottom" : "right"} align={isMobile ? "start" : "end"} sideOffset={8}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="admin-account-menu-header">
                    <Avatar className="admin-account-menu-avatar">
                      <AvatarImage src={defaultAdminAvatar} alt="管理员账户头像" />
                      <AvatarFallback>{userEmail.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span><strong>管理员账户</strong><small>{userEmail}</small></span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href="/dashboard" onClick={closeMobileSidebar} />}><ExternalLink aria-hidden="true" />返回用户面板</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={onLogout}><LogOut aria-hidden="true" />登出</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
