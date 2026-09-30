"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, Copy, LifeBuoy, Rss, Send, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader, Section } from "@/components/aera/page-layout";
import { UsageMeter } from "@/components/aera/usage-meter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityLegend, GitHubActivity, type Contribution } from "@/components/ui/github-activity";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { CLIENTS, RESET_QUOTE, SUBSCRIPTION, TRAFFIC_DAYS } from "@/lib/demo/panel-mock";
import { BASE } from "./nav";
import { usePanelState } from "./state";
import { copy, TelegramDialog } from "./telegram-dialog";

const GB = 1024 ** 3;
const gb = (bytes: number) => (bytes / GB).toFixed(2);
const formatMb = (mb: number) => (mb >= 1024 ** 2 ? `${(mb / 1024 ** 2).toFixed(2)} TB` : mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`);
const describeTraffic = (day: Contribution) => {
  const [y, m, d] = day.date.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日 · ${day.count === 0 ? "无流量" : formatMb(day.count)}`;
};

/** Module-level so that coming back to the dashboard does not repeat the reminders. */
let remindersShown = false;

export function DashboardPage() {
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const { telegramBound, orders, tickets } = usePanelState();
  const unpaid = orders.filter((item) => item.status === 0).length;
  const openTickets = tickets.filter((item) => item.status === 0).length;
  const router = useRouter();
  const days = useMemo<Contribution[]>(() => TRAFFIC_DAYS.map((day) => ({ date: day.date, count: day.mb, level: day.level })), []);
  const traffic = useMemo(() => ({ total: TRAFFIC_DAYS.reduce((sum, day) => sum + day.mb, 0) }), []);

  // Reminders pop up in the bottom-left corner instead of taking room on the page. Once per page load.
  useEffect(() => {
    if (remindersShown) return;
    remindersShown = true;
    // No cleanup on purpose: in development React runs this effect twice, and cancelling the timer
    // on the first pass would leave the flag set with no toast ever shown.
    window.setTimeout(() => {
      if (unpaid > 0) toast.warning(`您有 ${unpaid} 笔待支付的订单`, { id: "unpaid-orders", duration: 12000, action: { label: "立即支付", onClick: () => router.push(`${BASE}/order`) } });
      if (openTickets > 0) toast.info(`${openTickets} 条工单正在处理中`, { id: "open-tickets", duration: 12000, action: { label: "立即查看", onClick: () => router.push(`${BASE}/ticket`) } });
    }, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reminders are a once-per-load notice, not a live counter
  }, [router]);

  const { usedBytes, totalBytes } = SUBSCRIPTION;
  const percent = Math.min(100, (usedBytes / totalBytes) * 100);
  const expires = `${SUBSCRIPTION.expiredAt.getFullYear()} 年 ${SUBSCRIPTION.expiredAt.getMonth() + 1} 月 ${SUBSCRIPTION.expiredAt.getDate()} 日`;

  return (
    <Page>
      <PageHeader title="仪表盘" description="订阅与账户概览" />

      <Card>
        <CardContent className="@container">
          <div className="grid gap-6 @2xl:grid-cols-2 @2xl:gap-0 @2xl:divide-x">
            <div className="flex flex-col gap-3 @2xl:pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-medium tracking-tight">{SUBSCRIPTION.planName}</span>
                <Badge variant="secondary">{SUBSCRIPTION.periodLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground text-pretty">
                于 {expires} 到期，距离到期还有 {SUBSCRIPTION.daysRemaining} 天。
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button onClick={() => setSubscribeOpen(true)}>
                  <Rss data-icon="inline-start" />
                  一键订阅
                </Button>
                <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/node`} />}>
                  查看节点状态
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3 @2xl:pl-6">
              <UsageMeter
                label="已用流量"
                figure={`${gb(usedBytes)} / ${gb(totalBytes)} GB`}
                value={percent}
                note={`剩余 ${gb(totalBytes - usedBytes)} GB · 流量将在 ${SUBSCRIPTION.resetInDays} 天后重置`}
              />
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" onClick={() => setResetOpen(true)}>
                  购买流量重置
                </Button>
                {SUBSCRIPTION.queuedPlans.length > 0 && (
                  <Popover>
                    <PopoverTrigger render={<Button variant="ghost" className="text-muted-foreground" />}>排队中的套餐 · {SUBSCRIPTION.queuedPlans.length}</PopoverTrigger>
                    <PopoverContent align="start" className="w-72">
                      <PopoverHeader>
                        <PopoverTitle>排队中的套餐</PopoverTitle>
                        <PopoverDescription>当前套餐到期后按顺序生效。</PopoverDescription>
                      </PopoverHeader>
                      <ol className="space-y-1.5 text-sm">
                        {SUBSCRIPTION.queuedPlans.map((item) => (
                          <li key={item.tradeNo} className="flex items-center justify-between gap-3">
                            <Link href={`${BASE}/order`} className="underline-offset-4 hover:underline">
                              {item.planName}
                            </Link>
                            <span className="text-muted-foreground">{item.periodLabel}</span>
                          </li>
                        ))}
                      </ol>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>近一年流量使用</CardDescription>
          <CardTitle className="text-3xl font-medium tracking-tight tabular-nums">{formatMb(traffic.total)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FittedActivity days={days} />
          <ActivityLegend accent="var(--brand)" less="少" more="多" className="justify-end" />
        </CardContent>
      </Card>

      <Section label="捷径">
        <Card className="gap-0 py-0">
          <ShortcutLink href={`${BASE}/knowledge`} icon={<BookOpen />} title="查看教程" text="学习如何使用 AeraNexa" />
          <Separator />
          <ShortcutLink href={`${BASE}/plan`} icon={<ShoppingBag />} title="续费订阅" text="对您当前的订阅进行购买或续费" />
          <Separator />
          <ShortcutLink href={`${BASE}/ticket`} icon={<LifeBuoy />} title="遇到问题" text="遇到问题可以通过工单与我们沟通" />
          <Separator />
          <Item size="default" className="px-4 py-3">
            <ItemMedia variant="icon" className="size-9 rounded-lg border bg-background">
              <Send />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Telegram</ItemTitle>
              <ItemDescription>绑定后可在 Bot 内查询订阅、流量、余额、订单与工单</ItemDescription>
            </ItemContent>
            <ItemActions>
              {telegramBound ? (
                <Badge variant="secondary">已绑定</Badge>
              ) : (
                <Button variant="outline" onClick={() => setTelegramOpen(true)}>
                  绑定
                </Button>
              )}
            </ItemActions>
          </Item>
        </Card>
      </Section>

      <SubscribeDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} />
      <TelegramDialog open={telegramOpen} onOpenChange={setTelegramOpen} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>购买流量重置？</AlertDialogTitle>
            <AlertDialogDescription>
              将为「{RESET_QUOTE.planName}」重置已用流量，价格 ¥{(RESET_QUOTE.priceCents / 100).toFixed(2)}（月付价的 {RESET_QUOTE.percent}%）。确定后前往支付，支付完成立即生效，到期时间不变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => toast.success("演示：已创建订单，不会真的扣款。")}>去支付</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Page>
  );
}

function ShortcutLink({ href, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Item size="default" className="rounded-none px-4 py-3 hover:bg-muted/50" render={<Link href={href} />}>
      <ItemMedia variant="icon" className="size-9 rounded-lg border bg-background">
        {icon}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{text}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ChevronRight className="size-4 text-muted-foreground" />
      </ItemActions>
    </Item>
  );
}

/** One-click import: the subscription link and a button per client app. */
function SubscribeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>一键订阅</DialogTitle>
          <DialogDescription>选择你使用的客户端，快速导入节点；也可以复制订阅链接手动添加。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CLIENTS.map((client) => (
            <Button key={client.name} variant="outline" className="h-auto flex-col gap-2 px-2 py-3 whitespace-normal" onClick={() => toast(`演示：将在此调起 ${client.name} 导入订阅。`)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={client.icon} alt="" className="size-8 rounded-lg" />
              <span className="text-center text-xs leading-tight">{client.name}</span>
            </Button>
          ))}
        </div>
        <InputGroup>
          <InputGroupInput readOnly aria-label="订阅链接" value={SUBSCRIPTION.subscribeUrl} onFocus={(event) => event.currentTarget.select()} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton variant="outline" onClick={() => void copy(SUBSCRIPTION.subscribeUrl, "订阅链接已复制")}>
              <Copy />
              复制
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </DialogContent>
    </Dialog>
  );
}

const WEEKS = 53;

/** The largest cell size (8 to 20px) at which a full year of weeks fills the card's width. */
function cellSizeFor(width: number) {
  for (let size = 20; size >= 8; size -= 1) {
    const gap = Math.max(2, Math.round(size / 4));
    if (WEEKS * (size + gap) - gap <= width) return size;
  }
  return 8;
}

/** The year heat map, sized so that the whole year spans the card instead of sitting in its middle. */
function FittedActivity({ days }: { days: Contribution[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(12);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setCellSize(cellSizeFor(node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <GitHubActivity contributions={days} heading={false} accent="var(--brand)" cellSize={cellSize} showMonths describe={describeTraffic} label="近一年每日流量" className="w-full rounded-none bg-transparent p-0 dark:bg-transparent" style={{ width: "100%" }} />
    </div>
  );
}
