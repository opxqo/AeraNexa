"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/aera/data-table";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Order } from "@/lib/demo/panel-mock";
import { BASE, orderHref } from "./nav";
import { formatTime, StatusBadge, yuan } from "./order-status";
import { usePanelState } from "./state";

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "0", label: "待支付" },
  { value: "3", label: "已完成" },
  { value: "2", label: "已取消" },
] as const;
const PAGE_SIZE = 6;

export function OrderPage() {
  const { orders, cancelOrder } = usePanelState();
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const matching = orders.filter((order) => filter === "all" || String(order.status) === filter);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const columns: Column<Order>[] = [
    {
      key: "tradeNo",
      header: "订单号",
      cell: (order) => (
        <Link href={orderHref(order.tradeNo)} className="font-mono text-[13px] font-medium underline-offset-4 hover:underline max-sm:text-xs">
          {order.tradeNo}
        </Link>
      ),
    },
    { key: "plan", header: "订阅商品", hideBelow: "sm", cell: (order) => order.planName },
    { key: "type", header: "类型", hideBelow: "2xl", cell: (order) => <Badge variant="outline">{order.type}</Badge> },
    { key: "period", header: "周期", hideBelow: "xl", cell: (order) => order.periodLabel },
    { key: "total", header: "应付金额", align: "right", cell: (order) => yuan(order.total), className: "font-medium tabular-nums" },
    { key: "status", header: "订单状态", cell: (order) => <StatusBadge status={order.status} /> },
    { key: "created", header: "创建时间", hideBelow: "xl", cell: (order) => formatTime(order.createdAt), className: "whitespace-nowrap tabular-nums text-muted-foreground" },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      align: "right",
      hideBelow: "sm",
      cell: (order) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={orderHref(order.tradeNo)} />}>
            详情
          </Button>
          {order.status === 0 && (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(order.tradeNo)}>
              取消
            </Button>
          )}
        </div>
      ),
    },
  ];

  const go = (next: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setPage(Math.min(Math.max(1, next), pages));
  };

  return (
    <Page>
      <PageHeader title="我的订单" description="订单与支付状态" />

      <Tabs
        value={filter}
        onValueChange={(value) => {
          setFilter(String(value));
          setPage(1);
        }}
      >
        <TabsList variant="line">
          {FILTERS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(order) => order.tradeNo}
        empty={
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyTitle>暂无订单</EmptyTitle>
              <EmptyDescription>这个分类下还没有订单，前往「购买订阅」创建您的第一笔订单。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/plan`} />}>
                购买订阅
              </Button>
            </EmptyContent>
          </Empty>
        }
        footer={
          <>
            <span className="tabular-nums">
              共 {matching.length} 条 · 第 {current} / {pages} 页
            </span>
            {pages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" text="上一页" onClick={go(current - 1)} aria-disabled={current <= 1} className={current <= 1 ? "pointer-events-none opacity-50" : undefined} />
                  </PaginationItem>
                  {Array.from({ length: pages }, (_, index) => (
                    <PaginationItem key={index} className="max-sm:hidden">
                      <PaginationLink href="#" isActive={current === index + 1} onClick={go(index + 1)}>
                        {index + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext href="#" text="下一页" onClick={go(current + 1)} aria-disabled={current >= pages} className={current >= pages ? "pointer-events-none opacity-50" : undefined} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        }
      />

      <AlertDialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定取消该订单？</AlertDialogTitle>
            <AlertDialogDescription>取消后该订单将被关闭，已使用的优惠券会一并释放，如需购买请重新发起。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>稍后再说</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (cancelling) cancelOrder(cancelling);
                setCancelling(null);
                toast.success("订单已取消");
              }}
            >
              确定取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
