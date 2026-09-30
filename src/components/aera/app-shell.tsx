"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { AeraScope } from "@/components/aera/scope";
import { UserAvatar, type AvatarId } from "@/components/aera/avatars";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** One entry of the account menu: a link, an action, or a divider. */
export type MenuEntry = { label: string; href?: string; onSelect?: () => void } | "separator";

export type AppShellProps = {
  /** Route prefix every nav href is relative to, e.g. "/demo/panel". */
  base: string;
  groups: NavItem[][];
  /** Appended to every link, to carry a query string (e.g. "?plan=free") between pages. */
  linkSuffix?: string;
  /** The quiet link at the top left, next to the logo. */
  back: { label: string; href: string };
  user: { name: string; caption: string; avatar?: AvatarId };
  menu: MenuEntry[];
  /**
   * A strip in the top line, to the right of the back link and aligned with the content column (under the
   * header on phones). It has to fit in 66px. The notice board lives here.
   */
  banner?: ReactNode;
  /** Small print under the content column. */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * The account shell: a quiet top line, then a fixed left nav and a centred content column.
 * At 1920 wide the band is 1646px with 137px margins: nav 366, gap 60, content 1220. Below `lg`
 * the nav stacks above the content as a row of pills. No collapsing, no drawer.
 * Provides the design scope, tooltips and the toast host, so pages only render content.
 */
export function AppShell(props: AppShellProps) {
  const { base, groups, linkSuffix = "", back, user, menu, banner, footer, children } = props;
  return (
    <AeraScope>
      <TooltipProvider>
        <div className="min-h-screen">
          <header data-shell="header" className="flex h-[66px] items-center gap-4 px-4">
            <Link href={`${base}/${groups[0][0].href}${linkSuffix}`} aria-label="AeraNexa" className="text-foreground">
              {/* Where the logo flies to after signing in (enter-splash.tsx). */}
              <span className="inline-flex leading-none" data-enter-target="">
                <BrandMark size={22} />
              </span>
            </Link>
            <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
            <Button variant="link" size="sm" nativeButton={false} className="px-0 font-normal text-muted-foreground hover:text-foreground hover:no-underline" render={<Link href={back.href} />}>
              {back.label}
            </Button>
          </header>

          {banner && (
            <div className="pointer-events-none px-[clamp(16px,7.135vw,137px)] lg:-mt-[66px] lg:h-[66px]">
              <div className="mx-auto max-w-[1646px] lg:grid lg:h-full lg:grid-cols-[clamp(220px,19.0625vw,366px)_minmax(0,1fr)] lg:items-center lg:gap-x-[clamp(24px,3.125vw,60px)]">
                <div className="pointer-events-auto min-w-0 lg:col-start-2">{banner}</div>
              </div>
            </div>
          )}

          <div className="px-[clamp(16px,7.135vw,137px)] pt-4 pb-16 lg:pt-[51px]">
            <div className="mx-auto max-w-[1646px] lg:grid lg:grid-cols-[clamp(220px,19.0625vw,366px)_minmax(0,1fr)] lg:gap-x-[clamp(24px,3.125vw,60px)]">
              <aside data-shell="side" className="mb-6 space-y-4 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
                <UserBlock user={user} menu={menu} linkSuffix={linkSuffix} />
                <Nav base={base} groups={groups} linkSuffix={linkSuffix} />
              </aside>
              <main data-shell="main" className="min-w-0">{children}</main>
            </div>
            {footer}
          </div>
        </div>
      </TooltipProvider>
      <Toaster position="bottom-left" theme="light" />
    </AeraScope>
  );
}

function UserBlock({ user, menu, linkSuffix }: { user: AppShellProps["user"]; menu: MenuEntry[]; linkSuffix: string }) {
  return (
    <div className="flex items-center gap-3 px-3 lg:pt-3">
      <UserAvatar avatar={user.avatar} name={user.name} size="lg" />
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.caption}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Account menu" />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {menu.map((entry, index) =>
            entry === "separator" ? (
              <DropdownMenuSeparator key={index} />
            ) : entry.href ? (
              <DropdownMenuItem key={entry.label} render={<Link href={`${entry.href}${linkSuffix}`} />}>
                {entry.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={entry.label} onClick={entry.onSelect}>
                {entry.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Nav({ base, groups, linkSuffix }: { base: string; groups: NavItem[][]; linkSuffix: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
      {groups.map((group, index) => (
        <div key={index} className="flex shrink-0 gap-1 lg:block lg:space-y-0.5">
          {index > 0 && <Separator className="mx-3 my-2 hidden data-horizontal:w-auto lg:block" />}
          {group.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(`${base}/${href}`);
            return (
              <Link
                key={href}
                href={`${base}/${href}${linkSuffix}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-accent font-medium",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.4} />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
