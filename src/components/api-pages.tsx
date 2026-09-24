"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { planApi } from "@/lib/api/plan";
import { orderApi } from "@/lib/api/order";
import { serverApi } from "@/lib/api/server";
import { ticketApi } from "@/lib/api/ticket";
import { inviteApi } from "@/lib/api/invite";
import { knowledgeApi } from "@/lib/api/knowledge";
import { userApi, type UserDevice, type UserDevices } from "@/lib/api/user";
import { walletApi } from "@/lib/api/wallet";
import { localApiRequest } from "@/lib/api/client";
import type {
  CheckoutResult,
  InviteFetch,
  KnowledgeArticle,
  OrderItem,
  PagedMeta,
  PaymentMethod,
  Plan,
  ServerNode,
  Ticket,
  TrafficRecord,
  UserSubscribe,
  WalletTransaction,
} from "@/lib/api/types";
import { ConfirmModal, Modal, useToast } from "@/components/v2-modal";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";
import { ServerStatusSection } from "@/components/node-monitor";
import {
  AsyncBoundary,
  EmptyState,
  FieldError,
  copyText,
  sanitizeHtml,
  toErrorMessage,
  useAsyncData,
  useSubmitGuard,
} from "@/components/api-ui";

/* =========================================================================
   展示常量与格式化
   ========================================================================= */

/** 金额单位为「分」，展示时统一转为元。 */
function formatAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "¥0.00";
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0.00 B";
  const gb = bytes / 1073741824;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1048576;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(2)} KB`;
  return `${bytes} B`;
}

function formatTime(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

const PERIOD_KEYS = [
  "month_price",
  "quarter_price",
  "half_year_price",
  "year_price",
  "two_year_price",
  "three_year_price",
  "onetime_price",
] as const;

const PERIOD_LABELS: Record<string, string> = {
  month_price: "月付",
  quarter_price: "季付",
  half_year_price: "半年付",
  year_price: "年付",
  two_year_price: "两年付",
  three_year_price: "三年付",
  onetime_price: "一次性",
  reset_price: "流量重置",
};

/** 周期原价（分）；未配置该周期返回 null。 */
function planPeriodPrice(plan: Plan, period: string): number | null {
  const value = plan[period as keyof Plan];
  return typeof value === "number" && value >= 0 ? value : null;
}

/**
 * 套餐可售周期。优先使用服务端下发的 available_periods，
 * 这样前台永远不会渲染出一个「点了会报错」的周期按钮。
 */
function planPeriods(plan: Plan): string[] {
  const fromServer = (plan.available_periods ?? []).filter((period) => period !== "reset_price");
  if (fromServer.length) return fromServer;
  return PERIOD_KEYS.filter((key) => planPeriodPrice(plan, key) !== null);
}

/**
 * 下单前说明这笔订单付款后何时生效（规则见服务端 subscription-rules.ts）：
 * 同套餐生效中 → 续费顺延；别的套餐生效中或已有排队 → 排队，到期后生效、互不折抵；永久套餐 → 不能买别的套餐。
 */
function PurchaseEffectHint({ subscribe, planId }: { subscribe: UserSubscribe | null; planId: number }) {
  if (!subscribe?.plan_id) return null;
  const now = subscribe.server_time ?? 0;
  const permanent = subscribe.expired_at === null;
  const active = permanent || (subscribe.expired_at ?? 0) > now;
  const queued = subscribe.queued_plans?.length ?? 0;
  const currentName = subscribe.plan?.name ?? "当前套餐";
  let text: string | null = null;
  if (active && subscribe.plan_id === planId) {
    text = permanent ? null : "续费：到期时间将在当前到期日的基础上顺延，已用流量保留。";
  } else if (active && permanent) {
    text = `当前「${currentName}」为永久套餐，不会到期，无法再购买其它套餐；流量用完可在仪表盘购买流量重置。`;
  } else if (active || queued) {
    const until = subscribe.expired_at ? new Date(subscribe.expired_at * 1000).toLocaleDateString("zh-CN") : "";
    text = `「${currentName}」${until ? `有效期至 ${until}` : "仍在有效期内"}${queued ? `，另有 ${queued} 个套餐在排队` : ""}。本套餐付款后将排队，等前面的套餐到期后自动生效，与当前套餐互不折抵。`;
  }
  return text ? <small className="field-hint" style={{ margin: 0 }}>{text}</small> : null;
}

/** 支付方式图标：易支付的支付宝 / 微信用品牌图标（public/payment-icons，TDesign MIT），余额用钱包，其余通用卡片。 */
const PAYMENT_BRAND_ICONS: Record<string, { src: string; alt: string }> = {
  epay_alipay: { src: "/payment-icons/alipay.svg", alt: "支付宝" },
  epay_wxpay: { src: "/payment-icons/wechatpay.svg", alt: "微信支付" },
};

function PaymentMethodIcon({ payment }: { payment: string }) {
  const brand = PAYMENT_BRAND_ICONS[payment];
  // eslint-disable-next-line @next/next/no-img-element -- 22px 的静态 SVG，无需 next/image 的优化管线
  if (brand) return <img src={brand.src} alt={brand.alt} width={22} height={22} />;
  if (payment === "balance") return <Wallet size={22} style={{ color: "var(--v2-primary)" }} />;
  return <CreditCard size={22} style={{ color: "var(--v2-primary)" }} />;
}

const ORDER_STATUS_META: Record<number, { label: string; tone: string }> = {
  0: { label: "待支付", tone: "badge-warning" },
  1: { label: "待生效", tone: "badge-info" },
  2: { label: "已取消", tone: "badge-danger" },
  3: { label: "已完成", tone: "badge-success" },
  4: { label: "已折抵", tone: "badge-success" },
  5: { label: "已退款", tone: "badge-danger" },
};

function OrderStatusBadge({ status, label }: { status: number; label?: string }) {
  const meta = ORDER_STATUS_META[status] ?? { label: "未知", tone: "" };
  return <span className={`v2-badge ${meta.tone}`}>{label || meta.label}</span>;
}

const TICKET_LEVEL_META: Record<number, { label: string; tone: string }> = {
  0: { label: "低", tone: "badge-info" },
  1: { label: "中", tone: "badge-warning" },
  2: { label: "高", tone: "badge-danger" },
};

/** 极简 HTML 净化见 api-ui.tsx 的 sanitizeHtml。 */

/* =========================================================================
   1. 套餐购买
   ========================================================================= */

export function ApiPlanPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAuthenticated, subscribe } = useAuth();

  const plansState = useAsyncData<Plan[]>(
    async () => {
      const data = await planApi.fetchPlans();
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "套餐加载失败，请稍后重试" },
  );

  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [planFilter, setPlanFilter] = useState<"all" | "renew" | "traffic">("all");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ status: "idle" | "applied" | "invalid"; message: string; discount: number }>({
    status: "idle",
    message: "",
    discount: 0,
  });
  const [orderModalOpen, setOrderModalOpen] = useState(false);

  const couponGuard = useSubmitGuard();
  const orderGuard = useSubmitGuard();

  const availablePeriods = useMemo(() => (selectedPlan ? planPeriods(selectedPlan) : []), [selectedPlan]);

  const subtotal = selectedPlan && selectedPeriod ? planPeriodPrice(selectedPlan, selectedPeriod) : null;
  const payable = Math.max(0, (subtotal ?? 0) - coupon.discount);

  const handleOpenPurchase = (plan: Plan) => {
    const periods = planPeriods(plan);
    if (!periods.length) {
      showToast("该套餐暂未配置可购买周期，请联系管理员", "warning");
      return;
    }
    if (!isAuthenticated) {
      showToast("请先登录后再购买", "warning");
      router.push("/login");
      return;
    }
    setSelectedPlan(plan);
    setSelectedPeriod(periods[0]);
    setCouponCode("");
    setCoupon({ status: "idle", message: "", discount: 0 });
    setOrderModalOpen(true);
  };

  // 周期变化后优惠券抵扣额会变，必须重新校验，否则展示金额与实际应付不符。
  const handleSelectPeriod = (period: string) => {
    if (period === selectedPeriod) return;
    setSelectedPeriod(period);
    if (coupon.status !== "idle") {
      setCoupon({ status: "idle", message: "付款周期已变更，请重新验证优惠券", discount: 0 });
    }
  };

  const handleCouponInput = (value: string) => {
    setCouponCode(value);
    if (coupon.status !== "idle") setCoupon({ status: "idle", message: "", discount: 0 });
  };

  const handleCheckCoupon = () => {
    if (!selectedPlan || !selectedPeriod) return;
    void couponGuard.run(async () => {
      const code = couponCode.trim();
      if (!code) {
        setCoupon({ status: "invalid", message: "请输入优惠码", discount: 0 });
        return;
      }
      try {
        const result = await planApi.checkCoupon(code, selectedPlan.id, selectedPeriod);
        const discount = result.discount_amount ?? 0;
        if (discount > 0) {
          setCoupon({ status: "applied", message: `已抵扣 ${formatAmount(discount)}`, discount });
        } else {
          setCoupon({ status: "invalid", message: "该优惠券在当前付款周期下没有可抵扣金额", discount: 0 });
        }
      } catch (error: unknown) {
        setCoupon({ status: "invalid", message: toErrorMessage(error, "优惠券无效或已过期"), discount: 0 });
      }
    });
  };

  const handleConfirmOrder = () => {
    if (!selectedPlan || !selectedPeriod) return;
    void orderGuard.run(async () => {
      try {
        const tradeNo = await orderApi.saveOrder({
          plan_id: selectedPlan.id,
          period: selectedPeriod,
          coupon_code: coupon.status === "applied" ? couponCode.trim() : undefined,
        });
        showToast("订单创建成功，正在前往收银台", "success");
        setOrderModalOpen(false);
        router.push(`/order/${tradeNo}`);
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "创建订单失败，请稍后重试"), "error");
      }
    });
  };

  const plans = plansState.data ?? [];
  const visiblePlans = plans.filter((plan) => planFilter === "all" || (planFilter === "renew" ? Boolean(plan.renew) : !plan.renew));

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 500, color: "var(--v2-heading)" }}>
          选择最适合您的计划
        </h1>
        <p style={{ margin: 0, color: "var(--v2-muted)", fontSize: 14 }}>
          优质全球线路，全平台通用客户端，畅享极速网络。
        </p>
        <div className="plan-filter-tabs" role="tablist" aria-label="套餐类型筛选">
          {([ ["all", "全部"], ["renew", "按周期"], ["traffic", "按流量"] ] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={planFilter === value} className={planFilter === value ? "active" : ""} onClick={() => setPlanFilter(value)}>{label}</button>
          ))}
        </div>
      </div>

      <AsyncBoundary
        loading={plansState.loading}
        error={plansState.error}
        onRetry={plansState.reload}
        loadingText="正在拉取最新套餐与资费..."
        empty={plans.length === 0 ? "暂未配置可购买套餐，请等待管理员发布。" : undefined}
      >
        <div className="plan-catalog">
          {visiblePlans.map((plan) => {
            const periods = planPeriods(plan);
            const leadPeriod = periods[0];
            const leadPrice = leadPeriod ? planPeriodPrice(plan, leadPeriod) : null;
            const isOneTime = periods.length === 1 && leadPeriod === "onetime_price";
            return (
              <div key={plan.id} className="plan-card api-plan-card">
                <header className="api-plan-card-header">
                  <h2>{plan.name}</h2>
                </header>
                <div className="api-plan-price-band">
                  <strong>{formatAmount(leadPrice)}</strong>
                  <span>{periods.length > 1 ? "起" : (leadPeriod ? PERIOD_LABELS[leadPeriod] ?? leadPeriod : "—")}</span>
                </div>
                <div className="api-plan-periods" aria-label="可选付款周期">
                  {periods.map((period) => (
                    <span key={period} className="v2-badge">
                      {PERIOD_LABELS[period] ?? period}
                    </span>
                  ))}
                </div>
                {plan.content && (
                  <div
                    className="api-plan-description"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(plan.content) }}
                  />
                )}
                <div className="api-plan-action">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleOpenPurchase(plan)}
                  >
                    立即购买{isOneTime ? "" : ""}
                  </button>
                </div>
              </div>
            );
          })}
          {!visiblePlans.length && <p className="plan-filter-empty">该分类下暂未配置可购买套餐。</p>}
        </div>
      </AsyncBoundary>

      {selectedPlan && (
        <Modal
          open={orderModalOpen}
          title={`购买 · ${selectedPlan.name}`}
          onClose={() => setOrderModalOpen(false)}
          width={520}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOrderModalOpen(false)}
                disabled={orderGuard.pending}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmOrder}
                disabled={orderGuard.pending || !selectedPeriod}
              >
                {orderGuard.pending ? <Loader2 size={15} className="animate-spin" /> : "前往收银台支付"}
              </button>
            </div>
          }
        >
          <div className="api-plan-order-form">
            {selectedPlan.content && (
              <div className="api-plan-modal-description" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedPlan.content) }} />
            )}
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>选择付款周期</label>
              <div className="api-plan-period-grid">
                {availablePeriods.map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={`period ${selectedPeriod === period ? "active" : ""}`}
                    onClick={() => handleSelectPeriod(period)}
                    style={{ textAlign: "center", padding: "10px 8px" }}
                  >
                    <span style={{ fontSize: 12 }}>{PERIOD_LABELS[period] ?? period}</span>
                    <strong style={{ fontSize: 14 }}>{formatAmount(planPeriodPrice(selectedPlan, period))}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>折价优惠券</label>
              <div className="api-plan-coupon-row">
                <input
                  type="text"
                  placeholder="请输入优惠码"
                  value={couponCode}
                  onChange={(event) => handleCouponInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCheckCoupon();
                    }
                  }}
                  className={`api-plan-coupon-input${coupon.status === "invalid" ? " input-invalid" : ""}`}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCheckCoupon}
                  disabled={couponGuard.pending || !couponCode.trim()}
                >
                  {couponGuard.pending ? <Loader2 size={14} className="animate-spin" /> : "验证"}
                </button>
              </div>
              {coupon.status !== "idle" && (
                <div className={`coupon-result ${coupon.status === "applied" ? "applied" : "invalid"}`}>
                  <span>{coupon.message}</span>
                  {coupon.status === "applied" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setCouponCode("");
                        setCoupon({ status: "idle", message: "", discount: 0 });
                      }}
                    >
                      移除
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="api-plan-order-summary">
              <div className="summary-row">
                <span>周期原价</span>
                <span>{formatAmount(subtotal)}</span>
              </div>
              {coupon.discount > 0 && (
                <div className="summary-row">
                  <span>优惠券抵扣</span>
                  <span style={{ color: "#52c41a" }}>-{formatAmount(coupon.discount)}</span>
                </div>
              )}
              <div className="summary-row total">
                <span>应付总计</span>
                <strong style={{ fontSize: 18, color: "var(--v2-primary)" }}>{formatAmount(payable)}</strong>
              </div>
              <PurchaseEffectHint subscribe={subscribe} planId={selectedPlan.id} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   2. 订单列表
   ========================================================================= */

const ORDER_FILTERS: { label: string; status: number | undefined }[] = [
  { label: "全部", status: undefined },
  { label: "待支付", status: 0 },
  { label: "已完成", status: 3 },
  { label: "已取消", status: 2 },
];

export function ApiOrderPage() {
  const { showToast } = useToast();
  const [filterStatus, setFilterStatus] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [cancellingTradeNo, setCancellingTradeNo] = useState<string | null>(null);
  const cancelGuard = useSubmitGuard();

  const ordersState = useAsyncData<{ items: OrderItem[]; meta: PagedMeta }>(
    () => orderApi.fetchOrderPage({ status: filterStatus, page }),
    [filterStatus, page],
    { fallbackMessage: "订单加载失败，请稍后重试" },
  );

  const items = ordersState.data?.items ?? [];
  const meta = ordersState.data?.meta;

  const handleCancel = () => {
    const tradeNo = cancellingTradeNo;
    if (!tradeNo) return;
    void cancelGuard.run(async () => {
      try {
        await orderApi.cancelOrder(tradeNo);
        showToast("订单已取消", "success");
        setCancellingTradeNo(null);
        ordersState.reload();
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "取消订单失败"), "error");
      }
    });
  };

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <h2>我的订单</h2>
        <div className="filter-tabs">
          {ORDER_FILTERS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className={filterStatus === tab.status ? "active" : ""}
              onClick={() => {
                setFilterStatus(tab.status);
                setPage(1);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <AsyncBoundary
        loading={ordersState.loading}
        error={ordersState.error}
        onRetry={ordersState.reload}
        loadingText="加载订单列表中..."
        empty={items.length === 0 ? "暂无订单，前往「购买订阅」创建您的第一笔订单。" : undefined}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="v2-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>订阅商品</th>
                <th>类型</th>
                <th>周期</th>
                <th>应付金额</th>
                <th>订单状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id}>
                  <td className="mono" style={{ fontWeight: 500 }}>
                    <Link className="table-link" href={`/order/${order.trade_no}`}>
                      {order.trade_no}
                    </Link>
                  </td>
                  <td>{order.plan?.name ?? "订阅套餐"}</td>
                  <td>
                    <span className="v2-badge">{order.type_label ?? "新购"}</span>
                  </td>
                  <td>{order.period_label ?? PERIOD_LABELS[order.period] ?? order.period}</td>
                  <td style={{ fontWeight: 600 }}>{formatAmount(order.total_amount)}</td>
                  <td>
                    <OrderStatusBadge status={order.status} label={order.status_label} />
                  </td>
                  <td>{formatTime(order.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Link className="btn btn-primary btn-sm" href={`/order/${order.trade_no}`}>
                        详情
                      </Link>
                      {order.status === 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setCancellingTradeNo(order.trade_no)}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {meta && meta.total > meta.page_size && (
          <div className="pagination-bar">
            <span>
              共 {meta.total} 条 · 第 {meta.page} 页
            </span>
            <div className="pagination-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!meta.has_more}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </AsyncBoundary>

      <ConfirmModal
        open={!!cancellingTradeNo}
        title="确定取消该订单？"
        content="取消后该订单将被关闭，已使用的优惠券会一并释放，如需购买请重新发起。"
        okText="确定取消"
        cancelText="稍后再说"
        onOk={handleCancel}
        onCancel={() => setCancellingTradeNo(null)}
      />
    </section>
  );
}

/* =========================================================================
   3. 收银台
   ========================================================================= */

/** 轮询上限：约 5 分钟后停止，避免用户长时间停留在页面上空转请求。 */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 100;

/** resumePolling：从支付渠道收银台跳回（?paying=1）时直接进入等待结果状态。 */
export function ApiOrderDetailPage({ tradeNo, resumePolling = false }: { tradeNo: string; resumePolling?: boolean }) {
  const { showToast } = useToast();
  const { refreshUser } = useAuth();

  const orderState = useAsyncData<OrderItem>(() => orderApi.fetchOrderDetail(tradeNo), [tradeNo], {
    fallbackMessage: "订单加载失败，请稍后重试",
  });
  const methodsState = useAsyncData<PaymentMethod[]>(
    async () => {
      const data = await orderApi.getPaymentMethods();
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "支付方式加载失败" },
  );

  const [selectedMethodState, setSelectedMethod] = useState<number | null>(null);
  const [checkoutData, setCheckoutData] = useState<CheckoutResult | null>(null);
  const [polling, setPolling] = useState(resumePolling);

  const payGuard = useSubmitGuard();
  const pollAttemptsRef = useRef(0);

  const order = orderState.data;
  const methods = methodsState.data ?? [];

  // 未手动选择时默认使用第一个渠道；用派生值而非 effect 同步，避免级联渲染。
  const selectedMethod = selectedMethodState ?? methods[0]?.id ?? null;

  // 发起支付后订单仍为待支付时，轮询订单状态以捕获外部渠道的异步回调。
  useEffect(() => {
    if (!polling) return;
    pollAttemptsRef.current = 0;
    const timer = setInterval(() => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > POLL_MAX_ATTEMPTS) {
        setPolling(false);
        return;
      }
      orderApi
        .checkStatus(tradeNo)
        .then(async (result) => {
          if (result.status === 0) return;
          setPolling(false);
          orderState.reload();
          await refreshUser();
          if (result.status === 2) showToast("订单已超时关闭；如已付款，系统确认到账后会自动恢复开通", "warning");
          else showToast(`支付结果已确认：${result.status_label}`, "success");
        })
        .catch(() => {
          // 轮询失败不打扰用户，交由下一轮重试
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, tradeNo]);

  const handlePay = () => {
    if (!selectedMethod) {
      showToast("请先选择支付方式", "warning");
      return;
    }
    void payGuard.run(async () => {
      try {
        const result = await orderApi.checkout({ trade_no: tradeNo, method: selectedMethod });
        setCheckoutData(result);
        if (result.completed) {
          setPolling(false);
          await Promise.all([orderState.reload(), refreshUser()]);
          showToast("余额支付成功，订阅已开通", "success");
          return;
        }
        // 当前页跳转收银台：await 之后再 window.open 会被浏览器当作弹窗拦截，手机上多开标签页体验也差。
        // 付款后渠道经 return 路由跳回本订单页（?paying=1），自动继续等待结果。
        if (result.type === 1 && result.data) {
          window.location.assign(result.data);
          return;
        }
        showToast("已发起支付，请完成付款", "info");
        setPolling(true);
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "支付发起失败，请重试"), "error");
      }
    });
  };

  const refreshStatus = () => {
    orderState.reload();
    void refreshUser();
  };

  const subtotal =
    order?.subtotal_amount ?? (order ? order.total_amount + (order.discount_amount ?? 0) + (order.surplus_amount ?? 0) : 0);

  return (
    <div className="checkout-page">
      <div className="checkout-head">
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--v2-heading)" }}>收银台</h1>
          <p className="checkout-trade-no">订单号：{tradeNo}</p>
        </div>
        <div className="checkout-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={refreshStatus}>
            <RotateCcw size={13} />
            <span>刷新状态</span>
          </button>
          <Link href="/order" className="btn btn-secondary btn-sm">
            返回订单列表
          </Link>
        </div>
      </div>

      <AsyncBoundary
        loading={orderState.loading}
        error={orderState.error}
        onRetry={orderState.reload}
        loadingText="正在读取订单与支付渠道..."
      >
        {order && (
          <div className="checkout-layout">
            <div className="checkout-main">
              <section className="v2-block checkout-card">
                <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>商品信息</h3>
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="summary-row">
                    <span>订阅商品</span>
                    <strong>{order.plan?.name ?? "订阅商品"}</strong>
                  </div>
                  <div className="summary-row">
                    <span>购买类型</span>
                    <span>{order.type_label ?? "新购"}</span>
                  </div>
                  <div className="summary-row">
                    <span>付款周期</span>
                    <span>{order.period_label ?? PERIOD_LABELS[order.period] ?? order.period}</span>
                  </div>
                  <div className="summary-row">
                    <span>订单状态</span>
                    <OrderStatusBadge status={order.status} label={order.status_label} />
                  </div>
                  <div className="summary-row">
                    <span>创建时间</span>
                    <span>{formatTime(order.created_at)}</span>
                  </div>
                  {order.paid_at ? (
                    <div className="summary-row">
                      <span>支付时间</span>
                      <span>{formatTime(order.paid_at)}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="v2-block checkout-card">
                <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>选择支付方式</h3>
                <AsyncBoundary
                  loading={methodsState.loading}
                  error={methodsState.error}
                  onRetry={methodsState.reload}
                  loadingText="加载支付方式中..."
                  minHeight={90}
                  empty={methods.length === 0 ? "管理员尚未配置可用支付方式，请联系客服。" : undefined}
                >
                  <div className="checkout-channel-grid">
                    {methods.map((method) => (
                      <div
                        key={method.id}
                        className={`payment-channel-item ${selectedMethod === method.id ? "active" : ""}`}
                        onClick={() => setSelectedMethod(method.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setSelectedMethod(method.id);
                        }}
                      >
                        <PaymentMethodIcon payment={method.payment} />
                        <span className="payment-channel-name">{method.name}</span>
                      </div>
                    ))}
                  </div>
                </AsyncBoundary>
              </section>
            </div>

            <section className="v2-block checkout-card checkout-pay-card">
              <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>支付汇总</h3>
              <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                <div className="summary-row">
                  <span>周期原价</span>
                  <span>{formatAmount(subtotal)}</span>
                </div>
                {(order.discount_amount ?? 0) > 0 && (
                  <div className="summary-row">
                    <span>优惠券抵扣</span>
                    <span style={{ color: "#52c41a" }}>-{formatAmount(order.discount_amount)}</span>
                  </div>
                )}
                {(order.surplus_amount ?? 0) > 0 && (
                  <div className="summary-row">
                    <span>订阅剩余价值折抵</span>
                    <span style={{ color: "#52c41a" }}>-{formatAmount(order.surplus_amount)}</span>
                  </div>
                )}
                <div className="summary-row total">
                  <span>应付金额</span>
                  <span style={{ color: "var(--v2-primary)" }}>{formatAmount(order.total_amount)}</span>
                </div>
                {(order.refund_amount ?? 0) > 0 && (
                  <div className="summary-row">
                    <span>超额部分退回余额</span>
                    <span style={{ color: "#52c41a" }}>+{formatAmount(order.refund_amount)}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
                disabled={payGuard.pending || order.status !== 0}
                onClick={handlePay}
              >
                {payGuard.pending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : order.status === 0 ? (
                  "立即支付"
                ) : (
                  order.status_label ?? "订单已处理"
                )}
              </button>

              {polling && order.status === 0 && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--v2-muted)" }}>
                  <Loader2 size={14} className="animate-spin" />
                  <span>正在等待支付结果，完成后将自动刷新...</span>
                </div>
              )}

              {checkoutData?.provider === "mock" && order.status === 0 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid var(--v2-border)",
                    borderRadius: 4,
                    background: "var(--v2-header)",
                    fontSize: 13,
                  }}
                >
                  <strong style={{ display: "block", marginBottom: 5 }}>模拟支付收银台</strong>
                  <span style={{ color: "var(--v2-muted)" }}>当前为本地测试渠道，不会发起真实扣款。</span>
                  <p style={{ margin: "10px 0 0", color: "var(--v2-muted)" }}>等待支付网关回调确认，请勿在客户面板手动确认。</p>
                </div>
              )}

              {order.status === 0 && !checkoutData && (
                <p className="field-hint" style={{ marginTop: 10 }}>
                  {order.pay_deadline
                    ? `请在 ${new Date(order.pay_deadline * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} 前完成支付，超时未付的订单会自动关闭。`
                    : null}
                  支付完成后如页面未自动刷新，可点击上方「刷新状态」。
                </p>
              )}
            </section>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}

/* =========================================================================
   4. 节点状态
   ========================================================================= */

export function ApiNodePage() {
  const { showToast } = useToast();
  const { subscribe, refreshUser } = useAuth();
  const [subscribeDrawerOpen, setSubscribeDrawerOpen] = useState(false);
  const [resetSecurityConfirm, setResetSecurityConfirm] = useState(false);
  const [resetResult, setResetResult] = useState<{ subscribe_url: string; uuid: string } | null>(null);
  const resetGuard = useSubmitGuard();

  const nodesState = useAsyncData<ServerNode[]>(
    async () => {
      const data = await serverApi.fetchServers();
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "节点加载失败，请稍后重试" },
  );

  const servers = nodesState.data ?? [];

  const handleCopy = async (text: string, successText: string) => {
    const ok = await copyText(text);
    showToast(ok ? successText : "复制失败，请手动选择文本复制", ok ? "success" : "error");
  };

  const handleCopySubscribe = () => {
    const url = subscribe?.subscribe_url;
    if (!url) {
      showToast("订阅链接暂不可用，请先完成订阅开通", "warning");
      return;
    }
    void handleCopy(url, "订阅链接已复制到剪贴板");
  };

  const handleResetSecurity = () => {
    void resetGuard.run(async () => {
      try {
        const result = await userApi.resetSecurity();
        setResetResult({ subscribe_url: result.subscribe_url, uuid: result.uuid });
        setResetSecurityConfirm(false);
        await refreshUser();
        showToast("订阅信息与 Token 已重置", "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "重置失败，请稍后重试"), "error");
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="v2-block" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>节点与订阅服务</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--v2-muted)" }}>
              您可以在此处管理或一键导入所有节点配置至各大主流客户端。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopySubscribe}>
              <Copy size={14} />
              <span>复制订阅</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSubscribeDrawerOpen(true)}
            >
              <ExternalLink size={14} />
              <span>一键导入</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setResetSecurityConfirm(true)}
              disabled={resetGuard.pending}
            >
              <RotateCcw size={14} />
              <span>重置订阅信息</span>
            </button>
          </div>
        </div>

        {resetResult && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #cfe3b8",
              background: "#f4faee",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong style={{ display: "block", marginBottom: 6, color: "#4f7f24" }}>
              订阅信息已重置，请重新导入客户端
            </strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code className="mono" style={{ flex: 1, wordBreak: "break-all", fontSize: 12 }}>
                {resetResult.subscribe_url}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleCopy(resetResult.subscribe_url, "新订阅链接已复制")}
              >
                复制
              </button>
            </div>
            <small className="field-hint">UUID 已同步轮换：{resetResult.uuid}</small>
          </div>
        )}
      </section>

      <section className="v2-block">
        <header className="v2-block-header">
          <h2>可用节点线路</h2>
        </header>

        <AsyncBoundary
          loading={nodesState.loading}
          error={nodesState.error}
          onRetry={nodesState.reload}
          loadingText="正在拉取可用节点..."
          empty={servers.length === 0 ? "暂未配置可用节点。" : undefined}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>节点名称</th>
                  <th>类型</th>
                  <th>倍率</th>
                  <th>标签</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <span className={`status-dot ${server.is_online !== 0 ? "online" : ""}`} />
                      <span>{server.is_online !== 0 ? "在线" : "维护"}</span>
                    </td>
                    <td className="node-name" style={{ fontWeight: 500 }}>
                      {server.name}
                    </td>
                    <td style={{ textTransform: "uppercase", fontSize: 12 }}>{server.type}</td>
                    <td style={{ fontWeight: 600 }}>{server.rate}x</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {(server.tags?.length ? server.tags : ["专线"]).map((tag) => (
                          <span key={tag} className="v2-badge">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
      </section>

      <ServerStatusSection />

      <OneClickSubscribeDrawer
        open={subscribeDrawerOpen}
        onClose={() => setSubscribeDrawerOpen(false)}
        subscribeUrl={subscribe?.subscribe_url}
      />

      <ConfirmModal
        open={resetSecurityConfirm}
        title="确定重置订阅信息？"
        content="重置后，原有的订阅链接将全部失效，您需要重新将新订阅导入您的客户端中。"
        okText="确定重置"
        cancelText="取消"
        onOk={handleResetSecurity}
        onCancel={() => setResetSecurityConfirm(false)}
      />
    </div>
  );
}

/* =========================================================================
   5. 我的邀请
   ========================================================================= */

export function ApiInvitePage() {
  const { showToast } = useToast();
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [selectedCode, setSelectedCode] = useState<{ id: number; code: string; status: 0 | 1 } | null>(null);

  const generateGuard = useSubmitGuard();
  const statusGuard = useSubmitGuard();
  const transferGuard = useSubmitGuard();

  const inviteState = useAsyncData<InviteFetch>(() => inviteApi.fetchInvite(), [], {
    fallbackMessage: "邀请数据加载失败，请稍后重试",
  });
  const detailsState = useAsyncData(() => inviteApi.fetchDetails(), [], {
    fallbackMessage: "佣金明细加载失败",
  });

  const stat = inviteState.data?.stat ?? [0, 0, 0, 0];
  const availableCommission = inviteState.data?.available_commission ?? 0;
  const commissionRate = inviteState.data?.commission_rate ?? 0;
  const availableAfterDays = inviteState.data?.available_after_days ?? 0;
  const codes = inviteState.data?.codes ?? [];
  const referrals = inviteState.data?.referrals ?? [];
  const details = detailsState.data ?? [];

  const copyInviteLink = async (code: string) => {
    const ok = await copyText(`${window.location.origin}/register?code=${code}`);
    showToast(ok ? "推广注册链接已复制" : "复制失败，请手动选择文本复制", ok ? "success" : "error");
  };

  const handleGenerate = () => {
    const parsedMaxUses = maxUses.trim() ? Number(maxUses) : undefined;
    const parsedExpires = expiresInDays.trim() ? Number(expiresInDays) : undefined;
    void generateGuard.run(async () => {
      try {
        const code = await inviteApi.generateCode({ maxUses: parsedMaxUses, expiresInDays: parsedExpires });
        showToast("已生成新的邀请码", "success");
        setGenerateModalOpen(false);
        setMaxUses("");
        setExpiresInDays("");
        await inviteState.reload();
        await copyInviteLink(code);
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "生成邀请码失败"), "error");
      }
    });
  };

  const handleCodeStatus = () => {
    if (!selectedCode) return;
    const nextStatus: 0 | 1 = selectedCode.status === 0 ? 1 : 0;
    void statusGuard.run(async () => {
      try {
        await inviteApi.updateCodeStatus(selectedCode.id, nextStatus);
        showToast(nextStatus === 0 ? "邀请码已启用" : "邀请码已停用", "success");
        setSelectedCode(null);
        await inviteState.reload();
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "更新邀请码失败"), "error");
      }
    });
  };

  const handleTransfer = () => {
    const value = Number.parseFloat(transferAmount);
    if (!Number.isFinite(value) || value <= 0) {
      setTransferError("请输入大于 0 的划转金额");
      return;
    }
    const cents = Math.round(value * 100);
    if (cents > availableCommission) {
      setTransferError(`当前可划转佣金为 ${formatAmount(availableCommission)}，无法超额划转`);
      return;
    }
    setTransferError(null);
    void transferGuard.run(async () => {
      try {
        await userApi.transfer(cents);
        showToast("划转成功，已存入账户可用余额", "success");
        setTransferModalOpen(false);
        setTransferAmount("");
        inviteState.reload();
      } catch (error: unknown) {
        setTransferError(toErrorMessage(error, "划转失败"));
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className="stat-grid invite-stat-grid">
        <article>
          <small>累计邀请人数</small>
          <strong>{stat[0]}</strong>
        </article>
        <article>
          <small>产生佣金总计</small>
          <strong>{formatAmount(stat[1])}</strong>
        </article>
        <article>
          <small>可划转佣金</small>
          <strong>{formatAmount(availableCommission)}</strong>
        </article>
        <article>
          <small>待结算佣金</small>
          <strong>{formatAmount(stat[3])}</strong>
        </article>
      </div>

      <section className="invite-program-note">
        <div>
          <strong>返佣比例 {commissionRate}%</strong>
          <span>
            {commissionRate > 0
              ? `好友完成支付后产生佣金${availableAfterDays > 0 ? `，${availableAfterDays} 天后可划转` : "，确认后即可划转"}`
              : "当前返佣已关闭，邀请码仍可用于统计邀请关系"}
          </span>
        </div>
        <span>累计已划转 {formatAmount(stat[2])}</span>
      </section>

      <section className="v2-block">
        <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
          <h2>我的邀请码</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setTransferAmount("");
                setTransferError(null);
                setTransferModalOpen(true);
              }}
              disabled={availableCommission <= 0}
              title={availableCommission <= 0 ? "当前没有可划转佣金" : undefined}
            >
              <Wallet size={14} />
              <span>划转至余额</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setGenerateModalOpen(true)}
              disabled={generateGuard.pending}
            >
              {generateGuard.pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              <span>生成邀请码</span>
            </button>
          </div>
        </header>

        <AsyncBoundary
          loading={inviteState.loading}
          error={inviteState.error}
          onRetry={inviteState.reload}
          loadingText="加载邀请数据中..."
          empty={codes.length === 0 ? "您还没有邀请码，点击右上角「生成邀请码」开始推广。" : undefined}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>访问次数 (PV)</th>
                  <th>使用情况</th>
                  <th>有效期</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => {
                  const expired = code.expired === true;
                  const exhausted = code.max_uses != null && (code.used_count ?? 0) >= code.max_uses;
                  const usable = code.status === 0 && !expired && !exhausted;
                  const canEnable = code.status === 1 && !expired && !exhausted;
                  return (
                    <tr key={code.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {code.code}
                      </td>
                      <td>{code.pv}</td>
                      <td>
                        {code.used_count ?? 0}
                        {code.max_uses ? ` / ${code.max_uses}` : " / 不限"}
                      </td>
                      <td>{code.expires_at ? formatTime(code.expires_at) : "长期有效"}</td>
                      <td>
                        <span className={`v2-badge ${usable ? "badge-success" : "badge-danger"}`}>
                          {expired ? "已过期" : exhausted ? "已用尽" : code.status === 0 ? "有效" : "已停用"}
                        </span>
                      </td>
                      <td>{formatTime(code.created_at)}</td>
                      <td>
                        <div className="invite-code-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyInviteLink(code.code)}>
                            复制链接
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${code.status === 0 ? "btn-danger" : "btn-secondary"}`}
                            onClick={() => setSelectedCode({ id: code.id, code: code.code, status: code.status })}
                            disabled={code.status === 1 && !canEnable}
                            title={code.status === 1 && !canEnable ? "邀请码已过期或达到使用上限，不能重新启用" : undefined}
                          >
                            {code.status === 0 ? "停用" : canEnable ? "启用" : "不可启用"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
      </section>

      <section className="v2-block">
        <header className="v2-block-header"><h2>受邀用户</h2></header>
        {referrals.length === 0 ? (
          <EmptyState>暂无受邀用户，复制推广链接邀请好友注册。</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>用户</th><th>使用邀请码</th><th>完成订单</th><th>实付总额</th><th>贡献佣金</th><th>注册时间</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr key={referral.id}>
                    <td>{referral.email}</td>
                    <td className="mono">{referral.invite_code ?? "—"}</td>
                    <td>{referral.completed_orders}</td>
                    <td>{formatAmount(referral.paid_amount)}</td>
                    <td>{formatAmount(referral.commission_amount)}</td>
                    <td>{formatTime(referral.created_at)}</td>
                    <td><span className={`v2-badge ${referral.is_active ? "badge-success" : "badge-danger"}`}>{referral.is_active ? "正常" : "停用"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="v2-block">
        <header className="v2-block-header">
          <h2>佣金明细</h2>
        </header>
        <AsyncBoundary
          loading={detailsState.loading}
          error={detailsState.error}
          onRetry={detailsState.reload}
          loadingText="加载佣金明细中..."
          empty={details.length === 0 ? "暂无佣金记录，邀请好友下单后即可在此查看。" : undefined}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>被邀请人</th>
                  <th>订单金额</th>
                  <th>获得佣金</th>
                  <th>结算状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {details.map((item) => (
                  <tr key={item.id}>
                    <td>{item.invitee_email ?? `用户 #${item.user_id}`}</td>
                    <td>{formatAmount(item.order_amount)}</td>
                    <td style={{ fontWeight: 600, color: "var(--v2-primary)" }}>{formatAmount(item.get_amount)}</td>
                    <td>
                      <span className={`v2-badge ${item.status === "settled" ? "badge-success" : "badge-warning"}`}>
                        {item.status === "settled" ? "已结算" : "待结算"}
                      </span>
                    </td>
                    <td>{formatTime(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
      </section>

      <Modal
        open={generateModalOpen}
        title="生成邀请码"
        onClose={() => setGenerateModalOpen(false)}
        width={440}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setGenerateModalOpen(false)} disabled={generateGuard.pending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generateGuard.pending}>
              {generateGuard.pending ? <Loader2 size={15} className="animate-spin" /> : "生成并复制链接"}
            </button>
          </div>
        }
      >
        <div className="invite-create-form">
          <label>
            <span>最多使用次数</span>
            <input type="number" min="1" max="10000" step="1" placeholder="不填表示不限" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </label>
          <label>
            <span>有效天数</span>
            <input type="number" min="1" max="365" step="1" placeholder="不填表示长期有效" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
          </label>
          <small className="field-hint">生成后可随时停用；重新启用时仍会检查有效期和使用上限。</small>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(selectedCode)}
        title={selectedCode?.status === 0 ? "停用邀请码？" : "重新启用邀请码？"}
        content={selectedCode?.status === 0 ? "停用后该推广链接将不能用于新用户注册，已有邀请关系不受影响。" : "启用后推广链接将恢复使用。"}
        okText={selectedCode?.status === 0 ? "确认停用" : "确认启用"}
        okType={selectedCode?.status === 0 ? "danger" : "primary"}
        onCancel={() => setSelectedCode(null)}
        onOk={handleCodeStatus}
      />

      <Modal
        open={transferModalOpen}
        title="划转佣金至余额"
        onClose={() => setTransferModalOpen(false)}
        width={420}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTransferModalOpen(false)}
              disabled={transferGuard.pending}
            >
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleTransfer} disabled={transferGuard.pending}>
              {transferGuard.pending ? <Loader2 size={15} className="animate-spin" /> : "确定划转"}
            </button>
          </div>
        }
      >
        <div>
          <label style={{ display: "block", marginBottom: 8, fontSize: 14 }}>
            请输入划转金额 (元)，当前可划转 {formatAmount(availableCommission)}
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={transferAmount}
            onChange={(event) => {
              setTransferAmount(event.target.value);
              setTransferError(null);
            }}
            className={transferError ? "input-invalid" : undefined}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
          />
          <FieldError>{transferError}</FieldError>
          <small className="field-hint">划转后金额将进入可用余额，可用于支付订单。</small>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================================
   6. 流量明细
   ========================================================================= */

export function ApiTrafficPage() {
  const trafficState = useAsyncData<TrafficRecord[]>(
    async () => {
      const data = await userApi.fetchTrafficLog(30);
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "流量记录加载失败，请稍后重试" },
  );

  const records = trafficState.data ?? [];
  const total = useMemo(
    () => (trafficState.data ?? []).reduce((sum, item) => sum + item.u + item.d, 0),
    [trafficState.data],
  );

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <h2>近期流量明细</h2>
        {records.length > 0 && <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>近 30 天合计 {formatBytes(total)}</span>}
      </header>
      <AsyncBoundary
        loading={trafficState.loading}
        error={trafficState.error}
        onRetry={trafficState.reload}
        loadingText="加载流量记录中..."
        empty={records.length === 0 ? "暂无历史流量消耗记录。" : undefined}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="v2-table">
            <thead>
              <tr>
                <th>记录时间</th>
                <th>上行流量</th>
                <th>下行流量</th>
                <th>消耗总计</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.record_at}>
                  <td>{new Date(record.record_at * 1000).toLocaleDateString()}</td>
                  <td>{formatBytes(record.u)}</td>
                  <td>{formatBytes(record.d)}</td>
                  <td style={{ fontWeight: 600 }}>{formatBytes(record.u + record.d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBoundary>
    </section>
  );
}

/* =========================================================================
   7. 使用文档
   ========================================================================= */

export function ApiKnowledgePage() {
  const [search, setSearch] = useState("");
  const [activeArticle, setActiveArticle] = useState<KnowledgeArticle | null>(null);

  const knowledgeState = useAsyncData<KnowledgeArticle[]>(
    async () => {
      const data = await knowledgeApi.fetchArticles();
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "文档加载失败，请稍后重试" },
  );

  const articles = knowledgeState.data ?? [];
  const filtered = useMemo(() => {
    const source = knowledgeState.data ?? [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return source;
    return source.filter(
      (article) =>
        article.title.toLowerCase().includes(keyword) || article.category.toLowerCase().includes(keyword),
    );
  }, [knowledgeState.data, search]);

  const articleHtml = useMemo(() => (activeArticle ? sanitizeHtml(activeArticle.body) : ""), [activeArticle]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className="knowledge-search">
        <Search size={18} style={{ color: "var(--v2-muted)" }} />
        <input
          type="text"
          placeholder="搜索配置指引或常见问题..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: "100%", border: 0, outline: 0 }}
        />
      </div>

      <section className="v2-block">
        <header className="v2-block-header">
          <h2>文档中心</h2>
        </header>

        <AsyncBoundary
          loading={knowledgeState.loading}
          error={knowledgeState.error}
          onRetry={knowledgeState.reload}
          loadingText="加载文档中..."
          empty={
            filtered.length === 0
              ? articles.length === 0
                ? "管理员尚未发布任何文档。"
                : "未找到与关键词匹配的文档。"
              : undefined
          }
        >
          <div className="article-list" style={{ padding: "10px 0" }}>
            {filtered.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => setActiveArticle(article)}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  background: "transparent",
                  border: 0,
                  borderBottom: "1px solid var(--v2-border)",
                  color: "inherit",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span className="v2-badge">{article.category}</span>
                  <strong style={{ color: "var(--v2-heading)" }}>{article.title}</strong>
                </span>
                <ArrowRight size={15} style={{ color: "var(--v2-muted)", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </AsyncBoundary>
      </section>

      {activeArticle && (
        <Modal open={!!activeArticle} title={activeArticle.title} onClose={() => setActiveArticle(null)} width={640}>
          {articleHtml ? (
            <div
              dangerouslySetInnerHTML={{ __html: articleHtml }}
              style={{ fontSize: 14, lineHeight: 1.8, color: "var(--v2-text)" }}
            />
          ) : (
            <EmptyState>该文档暂无正文内容。</EmptyState>
          )}
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   8. 工单列表
   ========================================================================= */

export function ApiTicketPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState(1);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});
  const [filterStatus, setFilterStatus] = useState<number | undefined>(undefined);

  const createGuard = useSubmitGuard();

  const ticketsState = useAsyncData<Ticket[]>(
    async () => {
      const data = await ticketApi.fetchTickets();
      return Array.isArray(data) ? data : [];
    },
    [],
    { fallbackMessage: "工单加载失败，请稍后重试" },
  );

  const tickets = (ticketsState.data ?? []).filter((ticket) =>
    filterStatus === undefined ? true : ticket.status === filterStatus,
  );

  const handleCreate = () => {
    const nextErrors: { subject?: string; message?: string } = {};
    if (subject.trim().length < 2) nextErrors.subject = "工单主题至少 2 个字符";
    if (subject.trim().length > 255) nextErrors.subject = "工单主题不能超过 255 个字符";
    if (message.trim().length < 5) nextErrors.message = "请至少填写 5 个字符的问题描述";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    void createGuard.run(async () => {
      try {
        const ticketId = await ticketApi.saveTicket({ subject: subject.trim(), level, message: message.trim() });
        showToast("工单已提交，技术支持将尽快处理", "success");
        setNewModalOpen(false);
        setSubject("");
        setMessage("");
        setLevel(1);
        ticketsState.reload();
        if (ticketId) router.push(`/ticket/${ticketId}`);
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "提交工单失败"), "error");
      }
    });
  };

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <h2>我的工单</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="filter-tabs">
            {[
              { label: "全部", status: undefined },
              { label: "处理中", status: 0 },
              { label: "已关闭", status: 1 },
            ].map((tab) => (
              <button
                key={tab.label}
                type="button"
                className={filterStatus === tab.status ? "active" : ""}
                onClick={() => setFilterStatus(tab.status)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setErrors({});
              setNewModalOpen(true);
            }}
          >
            <Plus size={14} />
            <span>新建工单</span>
          </button>
        </div>
      </header>

      <AsyncBoundary
        loading={ticketsState.loading}
        error={ticketsState.error}
        onRetry={ticketsState.reload}
        loadingText="加载工单列表中..."
        empty={
          tickets.length === 0
            ? filterStatus === undefined
              ? "您当前没有工单记录。遇到网络问题可随时点击右上角新建工单。"
              : "该状态下暂无工单。"
            : undefined
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table className="v2-table">
            <thead>
              <tr>
                <th>工单号</th>
                <th>主题</th>
                <th>优先级</th>
                <th>状态</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const levelMeta = TICKET_LEVEL_META[ticket.level] ?? { label: "低", tone: "badge-info" };
                return (
                  <tr key={ticket.id}>
                    <td className="mono">#{ticket.id}</td>
                    <td>
                      <Link className="table-link" href={`/ticket/${ticket.id}`}>
                        {ticket.subject}
                      </Link>
                    </td>
                    <td>
                      <span className={`v2-badge ${levelMeta.tone}`}>{levelMeta.label}</span>
                    </td>
                    <td>
                      <span className={`v2-badge ${ticket.status === 0 ? "badge-warning" : "badge-success"}`}>
                        {ticket.status === 0 ? (ticket.reply_status === 1 ? "已回复" : "待处理") : "已关闭"}
                      </span>
                    </td>
                    <td>{formatTime(ticket.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AsyncBoundary>

      <Modal
        open={newModalOpen}
        title="新建工单"
        onClose={() => setNewModalOpen(false)}
        width={500}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNewModalOpen(false)}
              disabled={createGuard.pending}
            >
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={createGuard.pending}>
              {createGuard.pending ? <Loader2 size={15} className="animate-spin" /> : "立即提交"}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>工单主题</label>
            <input
              type="text"
              placeholder="简要概括您遇到的问题"
              value={subject}
              maxLength={255}
              onChange={(event) => {
                setSubject(event.target.value);
                if (errors.subject) setErrors((prev) => ({ ...prev, subject: undefined }));
              }}
              className={errors.subject ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{errors.subject}</FieldError>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>优先级</label>
            <select
              value={level}
              onChange={(event) => setLevel(Number.parseInt(event.target.value, 10))}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            >
              <option value={0}>低（一般性咨询）</option>
              <option value={1}>中（功能异常）</option>
              <option value={2}>高（严重影响使用）</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>详细描述</label>
            <textarea
              rows={4}
              placeholder="请尽可能详细提供您的客户端平台、节点名称及报错截图或提示信息"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
              }}
              className={errors.message ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{errors.message}</FieldError>
          </div>
        </div>
      </Modal>
    </section>
  );
}

/* =========================================================================
   9. 工单详情
   ========================================================================= */

export function ApiTicketDetailPage({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [reply, setReply] = useState("");
  const [closeConfirm, setCloseConfirm] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const replyGuard = useSubmitGuard();
  const closeGuard = useSubmitGuard();

  const ticketState = useAsyncData<Ticket>(() => ticketApi.fetchTicket(ticketId), [ticketId], {
    fallbackMessage: "工单加载失败，请稍后重试",
  });

  const ticket = ticketState.data;
  const messages = ticket?.message ?? [];

  // 新回复到达后滚到底部，避免用户以为消息没发出去。
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length]);

  const submitReply = () => {
    const text = reply.trim();
    if (!text) {
      showToast("请输入回复内容", "warning");
      return;
    }
    void replyGuard.run(async () => {
      try {
        await ticketApi.replyTicket({ id: ticketId, message: text });
        setReply("");
        ticketState.reload();
        showToast("回复已发送", "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "回复失败"), "error");
      }
    });
  };

  const handleClose = () => {
    void closeGuard.run(async () => {
      try {
        await ticketApi.closeTicket(ticketId);
        setCloseConfirm(false);
        ticketState.reload();
        showToast("工单已关闭", "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "关闭工单失败"), "error");
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{ticket?.subject ?? `工单 #${ticketId}`}</h1>
          <p style={{ margin: "5px 0 0", color: "var(--v2-muted)", fontSize: 13 }}>
            工单 #{ticketId}
            {ticket ? ` · ${ticket.status === 0 ? "处理中" : "已关闭"}` : ""}
            {ticket ? ` · 优先级 ${TICKET_LEVEL_META[ticket.level]?.label ?? "低"}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={ticketState.reload}>
            <RotateCcw size={13} />
            <span>刷新</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push("/ticket")}>
            返回工单列表
          </button>
        </div>
      </div>

      <AsyncBoundary
        loading={ticketState.loading}
        error={ticketState.error}
        onRetry={ticketState.reload}
        loadingText="加载工单中..."
      >
        {ticket && (
          <>
            <section className="v2-block" style={{ padding: 20 }}>
              {messages.length === 0 ? (
                <EmptyState>该工单暂无对话记录。</EmptyState>
              ) : (
                <div className="ticket-thread" ref={threadRef}>
                  {messages.map((item) => (
                    <div key={item.id} className={`ticket-bubble ${item.is_me ? "mine" : ""}`}>
                      <div className="ticket-bubble-meta">
                        <strong style={{ color: "var(--v2-text)" }}>
                          {item.is_me ? "我" : item.sender_role === "staff" ? "客服" : "对方"}
                        </strong>
                        <span>{formatTime(item.created_at)}</span>
                      </div>
                      <div className="ticket-bubble-body">{item.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {ticket.status === 0 ? (
              <section className="v2-block" style={{ padding: 20 }}>
                <label style={{ display: "block", marginBottom: 7, fontSize: 14, fontWeight: 500 }}>补充回复</label>
                <textarea
                  rows={4}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="补充问题或反馈"
                  style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={replyGuard.pending || !reply.trim()}
                    onClick={submitReply}
                  >
                    {replyGuard.pending ? <Loader2 size={14} className="animate-spin" /> : "发送回复"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={closeGuard.pending}
                    onClick={() => setCloseConfirm(true)}
                  >
                    关闭工单
                  </button>
                </div>
              </section>
            ) : (
              <section className="v2-block" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--v2-muted)", fontSize: 14 }}>
                  <Lock size={15} />
                  <span>该工单已关闭，如需继续沟通请新建工单。</span>
                </div>
              </section>
            )}
          </>
        )}
      </AsyncBoundary>

      <ConfirmModal
        open={closeConfirm}
        title="确定关闭该工单？"
        content="关闭后将无法继续回复，如问题仍未解决请重新提交工单。"
        okText="确定关闭"
        cancelText="取消"
        onOk={handleClose}
        onCancel={() => setCloseConfirm(false)}
      />
    </div>
  );
}

/* =========================================================================
   10. 个人中心
   ========================================================================= */

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

function describeDevice(device: UserDevice): string {
  const parts = [device.device_model, [device.device_os, device.os_version].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : device.user_agent ?? "未知设备";
}

/** 我的设备：订阅层按 HWID 登记的设备。上限来自套餐（或管理员单独设置），0 表示不限。 */
function DevicesSection() {
  const { showToast } = useToast();
  const devicesState = useAsyncData<UserDevices>(() => userApi.fetchDevices(), [], { fallbackMessage: "设备列表加载失败" });
  const removeGuard = useSubmitGuard();
  const [confirmAll, setConfirmAll] = useState(false);
  const data = devicesState.data;

  const remove = (id?: number) => {
    void removeGuard.run(async () => {
      try {
        const result = await userApi.removeDevices(id);
        await devicesState.reload();
        showToast(id === undefined ? `已移除 ${result.removed} 台设备` : "设备已移除", "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "移除设备失败"), "error");
      }
    });
  };

  return (
    <section className="v2-block" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>我的设备</h3>
        {data?.items.length ? (
          <button type="button" className="btn" onClick={() => setConfirmAll(true)} disabled={removeGuard.pending}>全部移除</button>
        ) : null}
      </div>
      <p className="field-hint" style={{ marginTop: 0 }}>
        {data
          ? data.limit > 0
            ? `当前套餐最多 ${data.limit} 台设备，已登记 ${data.items.length} 台。已满时新设备将无法获取节点，可在此移除不再使用的设备。`
            : "当前套餐不限设备数量。"
          : "拉取订阅时自动登记支持设备标识的客户端。"}
        {" "}同时在线的设备（按网络地址计）同样受此数量限制；部分客户端（如 Clash 系）不上报设备标识，不会出现在列表中。
      </p>
      <AsyncBoundary loading={devicesState.loading} error={devicesState.error} onRetry={devicesState.reload} loadingText="正在读取设备..." minHeight={60}>
        <div className="table-wrap">
          <table className="v2-table">
            <thead><tr><th>设备</th><th>首次登记</th><th>最近拉取订阅</th><th>操作</th></tr></thead>
            <tbody>{data?.items.length ? data.items.map((device) => (
              <tr key={device.id}>
                <td>{describeDevice(device)}{device.user_agent ? <small style={{ display: "block", color: "var(--v2-muted)" }}>{device.user_agent}</small> : null}</td>
                <td>{formatTime(device.first_seen_at)}</td>
                <td>{formatTime(device.last_seen_at)}</td>
                <td><button type="button" className="btn" onClick={() => remove(device.id)} disabled={removeGuard.pending}>移除</button></td>
              </tr>
            )) : <tr><td colSpan={4} className="admin-empty">暂无登记的设备</td></tr>}</tbody>
          </table>
        </div>
      </AsyncBoundary>
      <ConfirmModal
        open={confirmAll}
        title="移除全部设备？"
        content="移除后，各设备下次更新订阅时会重新登记并占用名额。"
        okText="全部移除"
        okType="danger"
        onCancel={() => setConfirmAll(false)}
        onOk={() => {
          setConfirmAll(false);
          remove();
        }}
      />
    </section>
  );
}

export function ApiProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { user, refreshUser } = useAuth();

  // null 表示「跟随服务端值」，用户输入后才有本地草稿，避免用 effect 同步 state。
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const nickname = nicknameDraft ?? user?.nickname ?? "";
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const nicknameGuard = useSubmitGuard();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const passwordGuard = useSubmitGuard();
  const [rechargeCode, setRechargeCode] = useState("");
  const rechargeGuard = useSubmitGuard();
  const telegramGuard = useSubmitGuard();
  const [confirmTelegramUnbind, setConfirmTelegramUnbind] = useState(false);
  const walletState = useAsyncData<WalletTransaction[]>(
    async () => (await walletApi.transactions()).items,
    [],
    { fallbackMessage: "余额流水加载失败" },
  );

  const handleRecharge = (event: React.FormEvent) => {
    event.preventDefault();
    const code = rechargeCode.trim();
    if (!code) {
      showToast("请输入卡密", "warning");
      return;
    }
    void rechargeGuard.run(async () => {
      try {
        const result = await walletApi.redeem(code);
        setRechargeCode("");
        await Promise.all([refreshUser(), walletState.reload()]);
        showToast(`充值成功，已到账 ${formatAmount(result.credited_amount)}`, "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "卡密充值失败"), "error");
      }
    });
  };

  const handleSaveNickname = () => {
    const value = nickname.trim();
    if (value.length < 1 || value.length > 50) {
      setNicknameError("昵称长度需在 1 到 50 个字符之间");
      return;
    }
    setNicknameError(null);
    void nicknameGuard.run(async () => {
      try {
        await userApi.update({ nickname: value });
        await refreshUser();
        showToast("昵称已更新", "success");
      } catch (error: unknown) {
        setNicknameError(toErrorMessage(error, "昵称更新失败"));
      }
    });
  };

  const handleChangePassword = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!oldPassword) nextErrors.oldPassword = "请输入当前密码";
    if (newPassword.length < PASSWORD_MIN_LENGTH) nextErrors.newPassword = `新密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`;
    else if (newPassword.length > PASSWORD_MAX_LENGTH) nextErrors.newPassword = `新密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`;
    else if (!newPassword.trim()) nextErrors.newPassword = "新密码不能为空白字符";
    else if (newPassword === oldPassword) nextErrors.newPassword = "新密码不能与旧密码相同";
    if (newPassword !== rePassword) nextErrors.rePassword = "两次输入的新密码不一致";
    setPasswordErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    void passwordGuard.run(async () => {
      try {
        await userApi.changePassword({ old_password: oldPassword, new_password: newPassword });
        setOldPassword("");
        setNewPassword("");
        setRePassword("");
        setPasswordErrors({});
        showToast("密码修改成功，请使用新密码重新登录", "success");
        // 服务端已撤销全部会话，这里跳回登录页避免停留在已失效的页面。
        setTimeout(() => router.replace("/login"), 900);
      } catch (error: unknown) {
        setPasswordErrors({ form: toErrorMessage(error, "密码修改失败，请核对旧密码") });
      }
    });
  };

  const handleTelegramUnbind = () => {
    void telegramGuard.run(async () => {
      try {
        await localApiRequest("user/telegram/unbind", { method: "POST" });
        await refreshUser();
        setConfirmTelegramUnbind(false);
        showToast("Telegram 已解绑", "success");
      } catch (error: unknown) {
        showToast(toErrorMessage(error, "Telegram 解绑失败"), "error");
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>账户基础资料</h3>
        <div className="profile-basic-grid">
          <div>
            <span style={{ color: "var(--v2-muted)" }}>登录邮箱：</span>
            <strong>{user?.email ?? "未登录"}</strong>
          </div>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>账户角色：</span>
            <strong>{user?.role ?? "—"}</strong>
          </div>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>可用余额：</span>
            <strong>{formatAmount(user?.balance)}</strong>
          </div>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>佣金余额：</span>
            <strong>{formatAmount(user?.commission_balance)}</strong>
          </div>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>订阅到期：</span>
            <strong>{user?.is_permanent ? "长期有效" : formatTime(user?.expired_at)}</strong>
          </div>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>UUID：</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {user?.uuid ?? "—"}
            </span>
          </div>
        </div>
      </section>

      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Telegram 绑定</h3>
        {user?.telegram_id ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
              <strong style={{ color: "#3898ec" }}>已绑定</strong>
              <span style={{ color: "var(--v2-muted)" }}>Telegram ID：<span className="mono">{user.telegram_id}</span></span>
              <small className="field-hint">可通过 AeraNexaBot 查询订阅、流量、余额、订单与工单。</small>
            </div>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmTelegramUnbind(true)}>解绑</button>
          </div>
        ) : <p className="field-hint" style={{ margin: 0 }}>尚未绑定 Telegram，请在仪表盘生成一次性绑定码后发送给 Bot。</p>}
      </section>

      <DevicesSection />

      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>余额充值</h3>
        <p className="field-hint" style={{ marginTop: 0 }}>输入管理员发放的卡密后，余额将即时到账，可在订单收银台选择「余额支付」。</p>
        <form onSubmit={handleRecharge} style={{ display: "flex", gap: 10, maxWidth: 520, alignItems: "flex-start" }}>
          <input
            value={rechargeCode}
            onChange={(event) => setRechargeCode(event.target.value.toUpperCase())}
            placeholder="例如 ANX-ABCD-EFGH-IJKM-NPQR-STUV"
            autoComplete="off"
            maxLength={128}
            style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
          />
          <button type="submit" className="btn btn-primary" disabled={rechargeGuard.pending || !rechargeCode.trim()}>
            {rechargeGuard.pending ? <Loader2 size={14} className="animate-spin" /> : "充值"}
          </button>
        </form>
        <AsyncBoundary loading={walletState.loading} error={walletState.error} onRetry={walletState.reload} loadingText="正在读取余额流水..." minHeight={80}>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="v2-table">
              <thead><tr><th>时间</th><th>说明</th><th>变动</th><th>余额</th></tr></thead>
              <tbody>{(walletState.data ?? []).length ? (walletState.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{formatTime(item.created_at)}</td><td>{item.description ?? item.transaction_type}</td>
                  <td style={{ color: item.amount >= 0 ? "#52c41a" : "var(--v2-text)" }}>{item.amount >= 0 ? "+" : ""}{formatAmount(item.amount)}</td>
                  <td>{formatAmount(item.balance_after)}</td>
                </tr>
              )) : <tr><td colSpan={4} className="admin-empty">暂无余额流水</td></tr>}</tbody>
            </table>
          </div>
        </AsyncBoundary>
      </section>
      <ConfirmModal
        open={confirmTelegramUnbind}
        title="解除 Telegram 绑定？"
        content="解绑后 Bot 将不能继续查询该账户或接收提醒；后续可重新绑定。"
        okText="确认解绑"
        okType="danger"
        onCancel={() => setConfirmTelegramUnbind(false)}
        onOk={handleTelegramUnbind}
      />

      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>昵称</h3>
        <div style={{ display: "flex", gap: 10, maxWidth: 420, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="设置一个昵称"
              value={nickname}
              maxLength={50}
              onChange={(event) => {
                setNicknameDraft(event.target.value);
                if (nicknameError) setNicknameError(null);
              }}
              className={nicknameError ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{nicknameError}</FieldError>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveNickname}
            disabled={nicknameGuard.pending || nickname.trim() === (user?.nickname ?? "")}
          >
            {nicknameGuard.pending ? <Loader2 size={14} className="animate-spin" /> : "保存"}
          </button>
        </div>
      </section>

      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>修改登入密码</h3>
        <form onSubmit={handleChangePassword} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <div>
            <input
              type="password"
              placeholder="当前旧密码"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => {
                setOldPassword(event.target.value);
                if (passwordErrors.oldPassword) setPasswordErrors((prev) => ({ ...prev, oldPassword: "" }));
              }}
              className={passwordErrors.oldPassword ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{passwordErrors.oldPassword}</FieldError>
          </div>
          <div>
            <input
              type="password"
              placeholder={`设置新密码（至少 ${PASSWORD_MIN_LENGTH} 位）`}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                if (passwordErrors.newPassword) setPasswordErrors((prev) => ({ ...prev, newPassword: "" }));
              }}
              className={passwordErrors.newPassword ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{passwordErrors.newPassword}</FieldError>
          </div>
          <div>
            <input
              type="password"
              placeholder="确认新密码"
              autoComplete="new-password"
              value={rePassword}
              onChange={(event) => {
                setRePassword(event.target.value);
                if (passwordErrors.rePassword) setPasswordErrors((prev) => ({ ...prev, rePassword: "" }));
              }}
              className={passwordErrors.rePassword ? "input-invalid" : undefined}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
            <FieldError>{passwordErrors.rePassword}</FieldError>
          </div>
          <FieldError>{passwordErrors.form}</FieldError>
          <div>
            <button type="submit" className="btn btn-primary" disabled={passwordGuard.pending}>
              {passwordGuard.pending ? <Loader2 size={14} className="animate-spin" /> : "更新密码"}
            </button>
            <small className="field-hint">修改密码后所有设备上的登录会话都会失效，需要重新登录。</small>
          </div>
        </form>
      </section>
    </div>
  );
}
