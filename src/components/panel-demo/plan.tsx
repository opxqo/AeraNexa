"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Calculator } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/aera/page-layout";
import { AI_TILES, BrandTiles, STREAMING_TILES } from "@/components/aera/brand-tiles";
import { PricingCard } from "@/components/aera/pricing-card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { COUPONS, CURRENT_SUBSCRIPTION, ENTERPRISE, PERIOD_LABELS, PERIOD_MONTHS, SALE_PLANS, type PlanPeriodKey, type SalePlan } from "@/lib/demo/panel-mock";
import { BASE, orderHref } from "./nav";
import { usePanelState } from "./state";

/** ¥ amounts without trailing zeros: 1250 cents -> "12.5". */
const yuan = (cents: number) => `${Number((cents / 100).toFixed(2))}`;
const PERIODS = Object.keys(PERIOD_LABELS) as PlanPeriodKey[];
const periodsOf = (plan: SalePlan) => PERIODS.filter((period) => plan.prices[period] !== undefined);
const leadPeriod = (plan: SalePlan, annual: boolean): PlanPeriodKey => (annual && plan.prices.year_price !== undefined ? "year_price" : periodsOf(plan)[0]);

/** How many whole months of the monthly price the yearly price saves on every plan. */
function freeMonths() {
  const saved = SALE_PLANS.map((plan) => (plan.prices.month_price && plan.prices.year_price ? 12 - plan.prices.year_price / plan.prices.month_price : 0));
  return Math.floor(Math.min(...saved) + 1e-6);
}

const PILL = "h-[38px] w-full rounded-full text-base font-medium";

export function PlanPage() {
  const [annual, setAnnual] = useState(true);
  const [buying, setBuying] = useState<SalePlan | null>(null);
  const [blocked, setBlocked] = useState(false);
  const { pendingOrder } = usePanelState();
  const router = useRouter();
  const free = freeMonths();

  // An account can only hold one unpaid order: point at it instead of opening a second purchase.
  const startPurchase = (plan: SalePlan) => (pendingOrder ? setBlocked(true) : setBuying(plan));

  return (
    <Page>
      <PageHeader title="购买订阅" description="选择套餐与周期" />

      <div className="flex items-center justify-center gap-2.5">
        <Switch
          checked={annual}
          onCheckedChange={setAnnual}
          aria-label="按年付款"
          className="data-[size=default]:h-[18px] data-[size=default]:w-[34px] data-checked:bg-brand [&>span]:ml-[3px] [&>span]:size-3 data-checked:[&>span]:translate-x-[14px]"
        />
        <span className="text-sm text-stone-500">年付</span>
        {free > 0 && <span className="inline-flex items-center rounded-full border border-dashed border-brand px-2.5 py-[3px] text-xs text-stone-900">{free} 个月免费</span>}
      </div>

      <div className="@container">
        <div className="grid gap-6 @xl:grid-cols-2 @4xl:grid-cols-4">
          {SALE_PLANS.map((plan) => {
            const current = CURRENT_SUBSCRIPTION.planId === plan.id;
            const period = leadPeriod(plan, annual);
            const total = plan.prices[period] ?? 0;
            return (
              <PricingCard
                key={plan.id}
                name={plan.name}
                tagline={plan.tagline}
                corner={current ? "当前套餐" : plan.recommended ? "推荐" : undefined}
                highlighted={plan.recommended}
                price={<>¥{yuan(total / PERIOD_MONTHS[period])}</>}
                unit={period === "month_price" ? "每月" : `每月 · ${PERIOD_LABELS[period]} ¥${yuan(total)}`}
                meta={
                  <>
                    <span className="text-base font-medium text-stone-900">{plan.transfer_enable}</span> GB 流量 ·{" "}
                    {plan.speed_limit === null ? (
                      "不限速"
                    ) : (
                      <>
                        <span className="text-base font-medium text-stone-900">{plan.speed_limit}</span> Mbps
                      </>
                    )}
                  </>
                }
                aside={<PeriodPrices plan={plan} />}
                lead={
                  plan.extends ? (
                    <>
                      包含 <b className="font-medium">{plan.extends}</b> 全部功能，另有：
                    </>
                  ) : undefined
                }
                features={plan.content}
                action={
                  <Button
                    variant="secondary"
                    className={plan.recommended ? `${PILL} bg-stone-900 text-white hover:bg-stone-800` : `${PILL} bg-hairline text-stone-900 hover:bg-stone-200`}
                    onClick={() => startPurchase(plan)}
                  >
                    {current ? "续费" : "立即购买"}
                    {plan.recommended && <ArrowRight data-icon="inline-end" />}
                  </Button>
                }
                footer={<UnlockedServices planId={plan.id} />}
              />
            );
          })}
          <PricingCard
            name={ENTERPRISE.name}
            tagline={ENTERPRISE.tagline}
            price="定制"
            lead={
              <>
                包含 <b className="font-medium">{ENTERPRISE.extends}</b> 全部功能，另有：
              </>
            }
            features={ENTERPRISE.content}
            action={
              <Button variant="secondary" nativeButton={false} className={`${PILL} bg-hairline text-stone-900 hover:bg-stone-200`} render={<Link href={`${BASE}/ticket`} />}>
                联系我们
              </Button>
            }
          />
        </div>
      </div>

      <AlertDialog open={blocked} onOpenChange={setBlocked}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>您有一笔未支付的订单</AlertDialogTitle>
            <AlertDialogDescription>一个账户同一时间只能存在一笔待支付订单。请先完成支付，或在订单页取消后再重新下单。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>稍后处理</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingOrder && router.push(orderHref(pendingOrder.tradeNo))}>前往支付</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {buying && <PurchaseDialog key={buying.id} plan={buying} initial={leadPeriod(buying, annual)} onClose={() => setBuying(null)} />}
    </Page>
  );
}

/**
 * The services a plan unlocks, matching its feature lines: 入门版 "流媒体基础解锁" shows the basic streaming set,
 * 专业版 "流媒体与 AI 服务解锁" shows AI and streaming, 旗舰版 says all of them. 企业定制 is bespoke, so it shows none.
 */
function UnlockedServices({ planId }: { planId: number }) {
  if (planId === 1) return <BrandTiles label="已解锁流媒体" tiles={STREAMING_TILES.filter((tile) => ["Netflix", "YouTube", "Spotify"].includes(tile.name))} />;
  if (planId === 2) return <BrandTiles label="已解锁 AI 服务与流媒体" tiles={[...AI_TILES, ...STREAMING_TILES]} />;
  if (planId === 3) return <BrandTiles label="已解锁全部 AI 服务与流媒体" tiles={[...AI_TILES, ...STREAMING_TILES]} />;
  return null;
}

/** The calculator button: every period's price and what it comes to per month. */
function PeriodPrices({ plan }: { plan: SalePlan }) {
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" aria-label="查看各周期价格" className="grid size-9 place-items-center rounded-[4px] bg-white outline-none hover:bg-stone-100 focus-visible:ring-3 focus-visible:ring-ring/50" />}>
        <Calculator className="size-5 text-stone-900/40" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{plan.name} · 各周期价格</PopoverTitle>
        </PopoverHeader>
        <dl className="space-y-1.5 text-sm">
          {periodsOf(plan).map((period) => {
            const total = plan.prices[period] ?? 0;
            return (
              <div key={period} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{PERIOD_LABELS[period]}</dt>
                <dd className="tabular-nums">
                  ¥{yuan(total)}
                  <span className="ml-1.5 text-xs text-muted-foreground">¥{yuan(total / PERIOD_MONTHS[period])}/月</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** When the order takes effect, given what the user already holds (rules: server subscription-rules.ts). */
function effectHint(plan: SalePlan) {
  const current = CURRENT_SUBSCRIPTION;
  if (current.planId === plan.id) return "续费：到期时间将在当前到期日的基础上顺延，已用流量保留。";
  return `「${current.planName}」有效期至 ${current.expiresOn}${current.queued ? `，另有 ${current.queued} 个套餐在排队` : ""}。本套餐付款后将排队，等前面的套餐到期后自动生效，与当前套餐互不折抵。`;
}

function PurchaseDialog({ plan, initial, onClose }: { plan: SalePlan; initial: PlanPeriodKey; onClose: () => void }) {
  const router = useRouter();
  const { createOrder } = usePanelState();
  const [period, setPeriod] = useState<PlanPeriodKey>(initial);
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<{ status: "idle" | "applied" | "invalid"; message: string; discount: number }>({ status: "idle", message: "", discount: 0 });

  const subtotal = plan.prices[period] ?? 0;
  const payable = Math.max(0, subtotal - coupon.discount);

  // The discount depends on the period, so a period change asks for the code to be checked again.
  const choosePeriod = (next: PlanPeriodKey) => {
    if (next === period) return;
    setPeriod(next);
    if (coupon.status !== "idle") setCoupon({ status: "idle", message: "付款周期已变更，请重新验证优惠券", discount: 0 });
  };

  const check = () => {
    const entered = code.trim().toUpperCase();
    if (!entered) return setCoupon({ status: "invalid", message: "请输入优惠码", discount: 0 });
    const discount = COUPONS[entered];
    if (discount) setCoupon({ status: "applied", message: `已抵扣 ¥${yuan(discount)}`, discount });
    else setCoupon({ status: "invalid", message: "优惠券无效或已过期", discount: 0 });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>购买 · {plan.name}</DialogTitle>
          <DialogDescription>选择付款周期，确认后前往收银台支付。</DialogDescription>
        </DialogHeader>

        <ToggleGroup variant="outline" value={[period]} onValueChange={(value) => value[0] && choosePeriod(value[0] as PlanPeriodKey)} className="grid w-full grid-cols-2 sm:grid-cols-4" aria-label="付款周期">
          {periodsOf(plan).map((key) => (
            <ToggleGroupItem key={key} value={key} className="h-auto flex-col gap-0.5 py-2">
              <span className="text-xs text-muted-foreground">{PERIOD_LABELS[key]}</span>
              <span className="tabular-nums">¥{yuan(plan.prices[key] ?? 0)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="space-y-1.5">
          <InputGroup>
            <InputGroupInput
              aria-label="优惠码"
              placeholder="优惠码（演示可用 WELCOME10）"
              value={code}
              aria-invalid={coupon.status === "invalid"}
              onChange={(event) => {
                setCode(event.target.value);
                if (coupon.status !== "idle") setCoupon({ status: "idle", message: "", discount: 0 });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  check();
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              {coupon.status === "applied" ? (
                <InputGroupButton
                  variant="outline"
                  onClick={() => {
                    setCode("");
                    setCoupon({ status: "idle", message: "", discount: 0 });
                  }}
                >
                  移除
                </InputGroupButton>
              ) : (
                <InputGroupButton variant="outline" disabled={!code.trim()} onClick={check}>
                  验证
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          {coupon.message && <p className={coupon.status === "invalid" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{coupon.message}</p>}
        </div>

        <dl className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">周期原价</dt>
            <dd className="tabular-nums">¥{yuan(subtotal)}</dd>
          </div>
          {coupon.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">优惠券抵扣</dt>
              <dd className="tabular-nums">-¥{yuan(coupon.discount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t pt-1.5">
            <dt className="font-medium">应付总计</dt>
            <dd className="text-lg font-medium tabular-nums">¥{yuan(payable)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground text-pretty">{effectHint(plan)}</p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              const tradeNo = createOrder({ planId: plan.id, planName: plan.name, transferGb: plan.transfer_enable, periodLabel: PERIOD_LABELS[period], subtotal, discount: coupon.discount, total: payable });
              toast.success("订单创建成功，正在前往收银台");
              onClose();
              router.push(orderHref(tradeNo));
            }}
          >
            前往收银台支付
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
