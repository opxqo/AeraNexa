"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Copy, CreditCard, Info, RotateCcw, SearchX, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { KeyValueList } from "@/components/aera/key-value-list";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { AlertBar } from "@/components/aera/alert-bar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { CURRENT_SUBSCRIPTION, ORDER_STATUS, PAYMENT_METHODS, SUBSCRIPTION, type Order, type PaymentMethod } from "@/lib/demo/panel-mock";
import { BASE } from "./nav";
import { formatTime, StatusBadge, yuan } from "./order-status";
import { usePanelState } from "./state";

const CANCEL_REASON: Record<NonNullable<Order["cancelReason"]>, string> = {
  timeout: "订单由于超时未支付已被取消。",
  user: "您已取消该订单。",
  admin: "订单已由管理员取消。",
};

const PAY_WAIT_MS = 1500;
const GB = 1024 ** 3;

function MethodIcon({ icon }: { icon: PaymentMethod["icon"] }) {
  if (icon === "balance") return <Wallet className="size-[22px]" strokeWidth={1.5} />;
  // eslint-disable-next-line @next/next/no-img-element -- 22px static SVGs: no need for the image pipeline
  return <img src={`/payment-icons/${icon === "alipay" ? "alipay" : "wechatpay"}.svg`} alt="" width={22} height={22} />;
}

export function OrderDetailPage({ tradeNo }: { tradeNo: string }) {
  const { orders, cancelOrder, payOrder, activateOrder } = usePanelState();
  const order = orders.find((item) => item.tradeNo === tradeNo);

  if (!order) {
    return (
      <Page>
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>找不到这笔订单</EmptyTitle>
            <EmptyDescription>订单号 {tradeNo} 不存在，或不属于当前账户。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/order`} />}>
              返回订单列表
            </Button>
          </EmptyContent>
        </Empty>
      </Page>
    );
  }

  if (order.status === 2) return <CancelledView order={order} />;
  return <Checkout order={order} onPay={() => payOrder(order.tradeNo)} onCancel={() => cancelOrder(order.tradeNo)} onActivate={() => activateOrder(order.tradeNo)} />;
}

function OrderNumber({ tradeNo }: { tradeNo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      订单号 <span className="font-mono text-foreground">{tradeNo}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="复制订单号"
        onClick={() => {
          void navigator.clipboard.writeText(tradeNo).then(
            () => toast.success("订单号已复制"),
            () => toast.error("复制失败，请手动选择复制"),
          );
        }}
      >
        <Copy />
      </Button>
    </span>
  );
}

function ProductInfo({ order }: { order: Order }) {
  return (
    <KeyValueList
      items={[
        { label: "订阅商品", value: <span className="font-medium">{order.planName}</span> },
        { label: "产品流量", value: `${order.transferGb} GB`, hidden: order.type === "流量重置" },
        { label: "购买类型", value: order.type },
        { label: "付款周期", value: order.periodLabel },
        { label: "订单状态", value: <StatusBadge status={order.status} /> },
        { label: "创建时间", value: <span className="tabular-nums">{formatTime(order.createdAt)}</span> },
        { label: "支付时间", value: <span className="tabular-nums">{order.paidAt ? formatTime(order.paidAt) : ""}</span>, hidden: !order.paidAt },
        { label: "取消时间", value: <span className="tabular-nums">{order.cancelledAt ? formatTime(order.cancelledAt) : ""}</span>, hidden: !order.cancelledAt },
      ]}
    />
  );
}

function CancelledView({ order }: { order: Order }) {
  return (
    <Page>
      <PageHeader title="订单详情" description={<OrderNumber tradeNo={order.tradeNo} />} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>已取消</EmptyTitle>
          <EmptyDescription>
            {order.cancelReason ? CANCEL_REASON[order.cancelReason] : "订单已取消。"}
            {order.cancelReason === "timeout" && " 如您已完成付款，系统确认到账后会自动恢复订单并开通。"}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button nativeButton={false} render={<Link href={`${BASE}/plan`} />}>
            重新购买
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/order`} />}>
            返回订单列表
          </Button>
        </EmptyContent>
      </Empty>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">订单信息</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductInfo order={order} />
        </CardContent>
      </Card>
    </Page>
  );
}

function Checkout({ order, onPay, onCancel, onActivate }: { order: Order; onPay: () => void; onCancel: () => void; onActivate: () => void }) {
  const [method, setMethod] = useState<string>(String(PAYMENT_METHODS[0].id));
  const [paying, setPaying] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "activate" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pending = order.status === 0;
  const queued = order.status === 1;
  const deadline = order.payDeadline ? new Date(order.payDeadline) : null;

  // Pay: a beat of "waiting for the result" (the real page polls the gateway), then the order is settled.
  const pay = () => {
    setPaying(true);
    timer.current = setTimeout(() => {
      onPay();
      setPaying(false);
      toast.success(order.planId === CURRENT_SUBSCRIPTION.planId ? "演示：支付成功，订阅已开通。" : "演示：支付成功，套餐已进入排队，等当前套餐到期后生效。");
    }, PAY_WAIT_MS);
  };

  return (
    <Page>
      <PageHeader
        title="收银台"
        description={<OrderNumber tradeNo={order.tradeNo} />}
        actions={
          <>
            <Button variant="outline" onClick={() => toast("演示：状态已是最新。")}>
              <RotateCcw data-icon="inline-start" />
              刷新状态
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href={`${BASE}/order`} />}>
              返回订单列表
            </Button>
            {pending && (
              <Button variant="ghost" disabled={paying} onClick={() => setConfirm("cancel")}>
                取消订单
              </Button>
            )}
          </>
        }
      />

      <div className="@container">
        <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">商品信息</CardTitle>
              </CardHeader>
              <CardContent>
                <ProductInfo order={order} />
              </CardContent>
            </Card>

            {pending && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">选择支付方式</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={method} onValueChange={setMethod} className="grid gap-3" aria-label="支付方式">
                    {PAYMENT_METHODS.map((item) => (
                      <FieldLabel key={item.id} htmlFor={`method-${item.id}`}>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>
                              <MethodIcon icon={item.icon} />
                              {item.name}
                            </FieldTitle>
                          </FieldContent>
                          <RadioGroupItem value={String(item.id)} id={`method-${item.id}`} disabled={paying} />
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                  <AlertBar icon={<Info />} title="演示环境" description="当前为模拟支付渠道，不会发起真实扣款。" />
                </CardContent>
              </Card>
            )}
          </div>

          <Card className="@3xl:sticky @3xl:top-6">
            <CardHeader>
              <CardTitle className="text-base">支付汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <KeyValueList
                items={[
                  { label: "周期原价", value: <span className="tabular-nums">{yuan(order.subtotal)}</span> },
                  { label: "优惠券抵扣", value: <span className="tabular-nums">-{yuan(order.discount)}</span>, hidden: order.discount <= 0 },
                  { label: "订阅剩余价值折抵", value: <span className="tabular-nums">-{yuan(order.surplus)}</span>, hidden: order.surplus <= 0 },
                  { label: <span className="font-medium text-foreground">应付金额</span>, value: <span className="text-xl font-medium tabular-nums">{yuan(order.total)}</span> },
                  { label: "超额部分退回余额", value: <span className="tabular-nums">+{yuan(order.refund)}</span>, hidden: order.refund <= 0 || order.status === 5 },
                ]}
              />

              {queued ? (
                <>
                  <Button size="lg" className="w-full" onClick={() => setConfirm("activate")}>
                    立即生效
                  </Button>
                  <p className="text-xs text-muted-foreground text-pretty">已付款，正在排队。不想等当前套餐到期，可以点「立即生效」马上开通；当前套餐会立即失效，剩余时间和流量不折算。</p>
                </>
              ) : (
                <Button size="lg" className="w-full" disabled={!pending || paying} onClick={pay}>
                  {paying ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      正在等待支付结果…
                    </>
                  ) : pending ? (
                    <>
                      <CreditCard data-icon="inline-start" />
                      立即支付
                    </>
                  ) : (
                    ORDER_STATUS[order.status]
                  )}
                </Button>
              )}

              {pending && deadline && (
                <p className="text-xs text-muted-foreground text-pretty">
                  请在 {String(deadline.getHours()).padStart(2, "0")}:{String(deadline.getMinutes()).padStart(2, "0")} 前完成支付，超时未付的订单会自动关闭。支付完成后如页面未自动刷新，可点击上方「刷新状态」。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirm === "cancel"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定取消该订单？</AlertDialogTitle>
            <AlertDialogDescription>取消后如需购买需要重新下单；订单使用的优惠券会被释放。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onCancel();
                setConfirm(null);
              }}
            >
              确定取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "activate"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定立即生效？</AlertDialogTitle>
            <AlertDialogDescription>
              「{order.planName}」将从现在开始计算，已用流量清零。当前的「{SUBSCRIPTION.planName}」会<strong>立即失效</strong>，剩余 {SUBSCRIPTION.daysRemaining} 天、剩余 {((SUBSCRIPTION.totalBytes - SUBSCRIPTION.usedBytes) / GB).toFixed(2)} GB 流量
              <strong>不折算、不退还</strong>。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onActivate();
                setConfirm(null);
                toast.success("套餐已立即生效");
              }}
            >
              确定立即生效
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
