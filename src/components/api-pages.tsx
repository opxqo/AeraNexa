"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  LifeBuoy,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  Ticket as TicketIcon,
  XCircle,
  AlertCircle,
  Loader2,
  Lock,
  Wallet,
  Gift,
  History,
  Tag,
  CreditCard,
  Layers,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { planApi } from "@/lib/api/plan";
import { orderApi } from "@/lib/api/order";
import { serverApi } from "@/lib/api/server";
import { ticketApi } from "@/lib/api/ticket";
import { inviteApi } from "@/lib/api/invite";
import { knowledgeApi } from "@/lib/api/knowledge";
import { userApi } from "@/lib/api/user";
import type {
  Plan,
  OrderItem,
  PaymentMethod,
  ServerNode,
  Ticket,
  InviteFetch,
  TrafficRecord,
  KnowledgeArticle,
} from "@/lib/api/types";
import { Modal, ConfirmModal, useToast } from "@/components/v2-modal";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";

// 格式化金额 (分 -> 元)
function formatAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "¥0.00";
  return `¥${(cents / 100).toFixed(2)}`;
}

// 格式化字节数
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0.00 B";
  const gb = bytes / 1073741824;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1048576;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(2)} KB`;
}

function planPeriodPrice(plan: Plan, period: string): number {
  const value = plan[period as keyof Plan];
  return typeof value === "number" ? value : 0;
}

// =========================================================================
// 1. 套餐购买页面 (ApiPlanPage)
// =========================================================================
export function ApiPlanPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("month_price");
  const [couponCode, setCouponCode] = useState("");
  const [discountCents, setDiscountCents] = useState(0);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    planApi
      .fetchPlans()
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "套餐加载失败", "error"))
      .finally(() => setLoading(false));
  }, []);

  const handleOpenPurchase = (plan: Plan) => {
    setSelectedPlan(plan);
    setDiscountCents(0);
    setCouponCode("");
    // 寻找可用的周期
    if (plan.month_price) setSelectedPeriod("month_price");
    else if (plan.onetime_price) setSelectedPeriod("onetime_price");
    else if (plan.quarter_price) setSelectedPeriod("quarter_price");
    else if (plan.year_price) setSelectedPeriod("year_price");
    setOrderModalOpen(true);
  };

  const handleCheckCoupon = async () => {
    if (!couponCode.trim() || !selectedPlan) return;
    try {
      const res = await planApi.checkCoupon(couponCode, selectedPlan.id);
      if (res?.value) {
        setDiscountCents(res.value);
        showToast("优惠券兑换成功", "success");
      }
    } catch (err: any) {
      showToast(err.message || "无效或已过期的优惠券", "error");
    }
  };

  const handleConfirmOrder = async () => {
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      const trade_no = await orderApi.saveOrder({
        plan_id: selectedPlan.id,
        period: selectedPeriod,
        coupon_code: couponCode.trim() || undefined,
      });
      showToast("订单创建成功，正在跳转收银台...", "success");
      setOrderModalOpen(false);
      router.push(`/order/${trade_no}`);
    } catch (err: any) {
      showToast(err.message || "创建订单失败，请检查未支付订单或重试", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 500, color: "var(--v2-heading)" }}>
          选择最适合您的计划
        </h1>
        <p style={{ margin: 0, color: "var(--v2-muted)", fontSize: 14 }}>
          优质全球线路，全平台通用客户端，畅享极速网络。
        </p>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
          <p>正在拉取最新套餐与资费...</p>
        </div>
      ) : (
        plans.length > 0 ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
          {plans.map((p) => {
            const price = p.month_price ?? p.onetime_price ?? p.quarter_price ?? p.year_price ?? 0;
            return (
              <div key={p.id} className="plan-card" style={{ display: "flex", flexDirection: "column" }}>
                <span className="v2-badge badge-success" style={{ alignSelf: "flex-start", marginBottom: 12 }}>
                  {p.renew ? "周期订阅" : "按流量"}
                </span>
                <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>{p.name}</h2>
                <div style={{ margin: "0 0 16px" }}>
                  <span style={{ fontSize: 28, fontWeight: 600, color: "var(--v2-heading)" }}>
                    {formatAmount(price)}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--v2-muted)", marginLeft: 4 }}>
                    {p.onetime_price ? "/ 一次性" : "/ 月"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--v2-muted)", marginBottom: 16 }}>
                  {p.transfer_enable} GB 流量 · {p.speed_limit ? `${p.speed_limit} Mbps` : "不限速"}
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8, fontSize: 13 }}>
                  <li>· 全球优质专线加速</li>
                  <li>· 支持全平台主流客户端</li>
                  <li>· 流媒体多区域解锁</li>
                  <li>· 专业客服与工单支持</li>
                </ul>
                <div style={{ marginTop: "auto", paddingTop: 24 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                    onClick={() => handleOpenPurchase(p)}
                  >
                    立即购买
                  </button>
                </div>
              </div>
            );
          })}
        </div> : <div className="v2-block" style={{ padding: "36px 20px", textAlign: "center", color: "var(--v2-muted)" }}>暂未配置可购买套餐，请等待管理员发布。</div>
      )}

      {/* 下单确认弹窗 */}
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
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmOrder}
                disabled={submitting}
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : "前往收银台支付"}
              </button>
            </div>
          }
        >
          <div style={{ display: "grid", gap: 16, fontSize: 14 }}>
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>选择付款周期</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {[
                  { key: "month_price", label: "月付", price: selectedPlan.month_price },
                  { key: "quarter_price", label: "季付", price: selectedPlan.quarter_price },
                  { key: "half_year_price", label: "半年付", price: selectedPlan.half_year_price },
                  { key: "year_price", label: "年付", price: selectedPlan.year_price },
                  { key: "two_year_price", label: "两年付", price: selectedPlan.two_year_price },
                  { key: "onetime_price", label: "一次性", price: selectedPlan.onetime_price },
                ]
                  .filter((item) => item.price !== null && item.price !== undefined)
                  .map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`period ${selectedPeriod === item.key ? "active" : ""}`}
                      onClick={() => setSelectedPeriod(item.key)}
                      style={{ textAlign: "center", padding: "10px 8px" }}
                    >
                      <span style={{ fontSize: 12 }}>{item.label}</span>
                      <strong style={{ fontSize: 14 }}>{formatAmount(item.price)}</strong>
                    </button>
                  ))}
              </div>
            </div>

            {/* 优惠券 */}
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>折价优惠券</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="请输入优惠码"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
                />
                <button type="button" className="btn btn-secondary" onClick={handleCheckCoupon}>
                  验证
                </button>
              </div>
              {discountCents > 0 && (
                <small style={{ color: "#52c41a", marginTop: 4, display: "block" }}>
                  优惠券抵扣：-{formatAmount(discountCents)}
                </small>
              )}
            </div>

            <div style={{ padding: "12px 14px", background: "var(--v2-header)", borderRadius: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>应付总计</span>
                <strong style={{ fontSize: 18, color: "var(--v2-primary)" }}>
                  {formatAmount(
                    Math.max(
                      0,
                      planPeriodPrice(selectedPlan, selectedPeriod) - discountCents,
                    ),
                  )}
                </strong>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// 2. 我的订单列表与收银台 (ApiOrderPage & ApiOrderDetailPage)
// =========================================================================
export function ApiOrderPage() {
  const { showToast } = useToast();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<number | undefined>(undefined);
  const [cancellingTradeNo, setCancellingTradeNo] = useState<string | null>(null);

  const fetchOrders = () => {
    setLoading(true);
    orderApi
      .fetchOrders(filterStatus)
      .then((res) => setOrders(Array.isArray(res) ? res : []))
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "订单加载失败", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [filterStatus]);

  const handleCancel = async (trade_no: string) => {
    try {
      await orderApi.cancelOrder(trade_no);
      showToast("订单已成功取消", "success");
      setCancellingTradeNo(null);
      fetchOrders();
    } catch (err: any) {
      showToast(err.message || "取消订单失败", "error");
    }
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0:
        return <span className="v2-badge badge-warning">待支付</span>;
      case 1:
        return <span className="v2-badge badge-info">开通中</span>;
      case 2:
        return <span className="v2-badge badge-danger">已取消</span>;
      case 3:
      case 4:
        return <span className="v2-badge badge-success">已完成</span>;
      default:
        return <span className="v2-badge">未知</span>;
    }
  };

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <h2>我的订单</h2>
        <div className="filter-tabs">
          {[
            { label: "全部", status: undefined },
            { label: "待支付", status: 0 },
            { label: "已完成", status: 3 },
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
      </header>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
          <p>加载订单列表中...</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="v2-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>订阅商品</th>
                <th>周期</th>
                <th>金额</th>
                <th>订单状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.length ? orders.map((o) => (
                <tr key={o.trade_no || o.id}>
                  <td className="mono" style={{ fontWeight: 500 }}>
                    <Link className="table-link" href={`/order/${o.trade_no || (o as any).id}`}>
                      {o.trade_no || (o as any).id}
                    </Link>
                  </td>
                  <td>{o.plan?.name || (o as any).plan || "订阅套餐"}</td>
                  <td>{o.period}</td>
                  <td style={{ fontWeight: 600 }}>{formatAmount(o.total_amount)}</td>
                  <td>{getStatusBadge(o.status ?? (o as any).status === "待支付" ? 0 : 3)}</td>
                  <td>{o.created_at ? new Date(o.created_at * 1000).toLocaleString() : (o as any).time}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Link className="btn btn-primary btn-sm" href={`/order/${o.trade_no || (o as any).id}`}>
                        详情
                      </Link>
                      {o.status === 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setCancellingTradeNo(o.trade_no || (o as any).id)}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--v2-muted)", padding: 28 }}>暂无订单，前往「购买订阅」创建您的第一笔订单。</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* 取消订单确认 */}
      <ConfirmModal
        open={!!cancellingTradeNo}
        title="确定取消该订单？"
        content="取消后该订单将被关闭，如需购买请重新发起。"
        okText="确定取消"
        cancelText="稍后再说"
        onOk={() => cancellingTradeNo && handleCancel(cancellingTradeNo)}
        onCancel={() => setCancellingTradeNo(null)}
      />
    </section>
  );
}

// 订单详情与在线结账页面
export function ApiOrderDetailPage({ tradeNo }: { tradeNo: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [order, setOrder] = useState<OrderItem | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [checkoutData, setCheckoutData] = useState<any>(null);

  useEffect(() => {
    Promise.allSettled([orderApi.fetchOrderDetail(tradeNo), orderApi.getPaymentMethods()])
      .then(([orderRes, methodRes]) => {
        if (orderRes.status === "fulfilled") setOrder(orderRes.value);
        if (methodRes.status === "fulfilled") {
          setMethods(methodRes.value);
          if (methodRes.value.length > 0) setSelectedMethod(methodRes.value[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, [tradeNo]);

  // 发起支付
  const handlePay = async () => {
    if (!selectedMethod) {
      showToast("请先选择支付方式", "warning");
      return;
    }
    setPaying(true);
    try {
      const res = await orderApi.checkout({ trade_no: tradeNo, method: selectedMethod });
      setCheckoutData(res);
      showToast("已发起支付，请完成付款", "info");
    } catch (err: any) {
      showToast(err.message || "支付发起失败，请重试", "error");
    } finally {
      setPaying(false);
    }
  };

  const handleMockConfirm = async () => {
    if (!checkoutData?.transaction_id) return;
    setPaying(true);
    try {
      const paidOrder = await orderApi.confirmMockPayment({ trade_no: tradeNo, transaction_id: checkoutData.transaction_id });
      setOrder(paidOrder);
      showToast("模拟支付已完成，订阅已开通", "success");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "模拟支付确认失败", "error");
    } finally { setPaying(false); }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--v2-heading)" }}>收银台</h1>
          <p style={{ margin: 0, color: "var(--v2-muted)", fontSize: 13 }}>订单号：{tradeNo}</p>
        </div>
        <Link href="/order" className="btn btn-secondary btn-sm">
          返回订单列表
        </Link>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
          <p>正在读取订单与支付渠道...</p>
        </div>
      ) : order ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
          {/* 左侧商品明细与支付选择 */}
          <div style={{ display: "grid", gap: 16 }}>
            <section className="v2-block" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>商品信息</h3>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{order.plan?.name || "订阅商品"}</span>
                <strong>{formatAmount(order.total_amount)}</strong>
              </div>
            </section>

            <section className="v2-block" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>选择支付方式</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                {methods.length > 0 ? methods.map((m) => (
                    <div
                      key={m.id}
                      className={`payment-channel-item ${selectedMethod === m.id ? "active" : ""}`}
                      onClick={() => setSelectedMethod(m.id)}
                    >
                      <CreditCard size={22} style={{ color: "var(--v2-primary)" }} />
                      <span className="payment-channel-name">{m.name}</span>
                    </div>
                  )) : <p style={{ margin: 0, color: "var(--v2-muted)", fontSize: 13 }}>暂无可用支付方式。</p>}
              </div>
            </section>
          </div>

          {/* 右侧金额汇总与结账按钮 */}
          <section className="v2-block" style={{ padding: 20, height: "fit-content" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>支付汇总</h3>
            <div style={{ display: "grid", gap: 10, fontSize: 14, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--v2-muted)" }}>订单金额</span>
                <span>{formatAmount(order.total_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--v2-muted)" }}>抵扣金额</span>
                <span style={{ color: "#52c41a" }}>-{formatAmount(order.discount_amount ?? 0)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 10,
                  borderTop: "1px solid var(--v2-border)",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                <span>实付金额</span>
                <span style={{ color: "var(--v2-primary)" }}>{formatAmount(order.total_amount)}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{ width: "100%" }}
              disabled={paying || order.status !== 0}
              onClick={handlePay}
            >
              {paying ? (
                <Loader2 size={16} className="animate-spin" />
              ) : order.status === 0 ? (
                "立即支付"
              ) : (
                "订单已支付"
              )}
            </button>
            {checkoutData?.provider === "mock" && order.status === 0 && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--v2-border)", borderRadius: 4, background: "var(--v2-header)", fontSize: 13 }}>
                <strong style={{ display: "block", marginBottom: 5 }}>模拟支付收银台</strong>
                <span style={{ color: "var(--v2-muted)" }}>当前为本地测试渠道，不会发起真实扣款。</span>
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10, width: "100%" }} disabled={paying} onClick={handleMockConfirm}>确认模拟支付成功</button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <p>未找到该订单。</p>
      )}
    </div>
  );
}

// =========================================================================
// 3. 节点状态页面 (ApiNodePage)
// =========================================================================
export function ApiNodePage() {
  const { showToast } = useToast();
  const { subscribe } = useAuth();
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribeDrawerOpen, setSubscribeDrawerOpen] = useState(false);
  const [resetSecurityConfirm, setResetSecurityConfirm] = useState(false);

  useEffect(() => {
    serverApi
      .fetchServers()
      .then((data) => setServers(Array.isArray(data) ? data : []))
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "节点加载失败", "error"))
      .finally(() => setLoading(false));
  }, []);

  const handleCopySubscribe = () => {
    const url = subscribe?.subscribe_url;
    if (!url) {
      showToast("订阅链接暂不可用，请先完成订阅开通", "warning");
      return;
    }
    navigator.clipboard.writeText(url);
    showToast("订阅链接已复制到剪贴板", "success");
  };

  const handleResetSecurity = async () => {
    try {
      await userApi.resetSecurity();
      showToast("订阅信息与 Token 已重置", "success");
      setResetSecurityConfirm(false);
    } catch (err: any) {
      showToast(err.message || "重置失败", "error");
    }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* 顶部订阅操作横幅 */}
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
            >
              <RotateCcw size={14} />
              <span>重置订阅信息</span>
            </button>
          </div>
        </div>
      </section>

      {/* 节点列表 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>可用节点线路</h2>
        </header>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
            <p>正在拉取可用节点...</p>
          </div>
        ) : (
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
                {servers.length ? servers.map((s, idx) => (
                  <tr key={s.id || idx}>
                    <td>
                      <span className={`status-dot ${s.is_online !== 0 ? "online" : ""}`} />
                      <span>{s.is_online !== 0 ? "在线" : "维护"}</span>
                    </td>
                    <td className="node-name" style={{ fontWeight: 500 }}>
                      {s.name}
                    </td>
                    <td style={{ textTransform: "uppercase", fontSize: 12 }}>{s.type}</td>
                    <td style={{ fontWeight: 600 }}>{s.rate}x</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(s.tags || ["专线"]).map((t) => (
                          <span key={t} className="v2-badge">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--v2-muted)", padding: 28 }}>暂未配置可用节点。</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

// =========================================================================
// 4. 我的邀请页面 (ApiInvitePage)
// =========================================================================
export function ApiInvitePage() {
  const { showToast } = useToast();
  const [inviteData, setInviteData] = useState<InviteFetch | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");

  const loadData = () => {
    setLoading(true);
    inviteApi
      .fetchInvite()
      .then((data) => setInviteData(data))
      .catch(() => null)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerate = async () => {
    try {
      await inviteApi.generateCode();
      showToast("已生成新的邀请码", "success");
      loadData();
    } catch (err: any) {
      showToast(err.message || "生成失败", "error");
    }
  };

  const handleTransfer = async () => {
    const val = parseFloat(transferAmount);
    if (!val || val <= 0) {
      showToast("请输入有效金额", "warning");
      return;
    }
    try {
      await userApi.transfer(Math.round(val * 100));
      showToast("划转成功，已存入账户可用余额", "success");
      setTransferModalOpen(false);
      setTransferAmount("");
      loadData();
    } catch (err: any) {
      showToast(err.message || "划转失败", "error");
    }
  };

  const stat = inviteData?.stat ?? [0, 0, 0];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* 佣金统计卡片 */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <article>
          <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>累计邀请人数</span>
          <strong>{stat[0]} 人</strong>
        </article>
        <article>
          <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>产生佣金总计</span>
          <strong>{formatAmount(stat[1])}</strong>
        </article>
        <article>
          <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>累计已提现/划转</span>
          <strong>{formatAmount(stat[2])}</strong>
        </article>
      </div>

      {/* 邀请码管理 */}
      <section className="v2-block">
        <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
          <h2>我的邀请码</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTransferModalOpen(true)}>
              <Wallet size={14} />
              <span>划转至余额</span>
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleGenerate}>
              <Plus size={14} />
              <span>生成邀请码</span>
            </button>
          </div>
        </header>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
            <p>加载邀请数据中...</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>访问次数 (PV)</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(inviteData?.codes || []).map((c) => (
                  <tr key={c.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {c.code}
                    </td>
                    <td>{c.pv}</td>
                    <td>
                      <span className={`v2-badge ${c.status === 0 ? "badge-success" : "badge-danger"}`}>
                        {c.status === 0 ? "有效" : "已使用"}
                      </span>
                    </td>
                    <td>{new Date(c.created_at * 1000).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/register?code=${c.code}`);
                          showToast("推广注册链接已复制", "success");
                        }}
                      >
                        复制链接
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 佣金划转弹窗 */}
      <Modal
        open={transferModalOpen}
        title="划转佣金至余额"
        onClose={() => setTransferModalOpen(false)}
        width={420}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setTransferModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleTransfer}>
              确定划转
            </button>
          </div>
        }
      >
        <div>
          <label style={{ display: "block", marginBottom: 8, fontSize: 14 }}>请输入划转金额 (元)</label>
          <input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
          />
        </div>
      </Modal>
    </div>
  );
}

// =========================================================================
// 5. 流量明细 (ApiTrafficPage)
// =========================================================================
export function ApiTrafficPage() {
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    userApi
      .fetchTrafficLog()
      .then((data) => {
        if (Array.isArray(data)) setRecords(data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="v2-block">
      <header className="v2-block-header">
        <h2>近期流量明细</h2>
      </header>
      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
          <p>加载流量记录中...</p>
        </div>
      ) : records.length > 0 ? (
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
              {records.map((r, idx) => (
                <tr key={idx}>
                  <td>{new Date(r.record_at * 1000).toLocaleDateString()}</td>
                  <td>{formatBytes(r.u)}</td>
                  <td>{formatBytes(r.d)}</td>
                  <td style={{ fontWeight: 600 }}>{formatBytes(r.u + r.d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "30px 20px", color: "var(--v2-muted)", textAlign: "center" }}>
          暂无历史流量消耗记录。
        </div>
      )}
    </section>
  );
}

// =========================================================================
// 6. 使用文档 (ApiKnowledgePage)
// =========================================================================
export function ApiKnowledgePage() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeArticle, setActiveArticle] = useState<KnowledgeArticle | null>(null);

  useEffect(() => {
    knowledgeApi
      .fetchArticles()
      .then((data) => {
        if (Array.isArray(data)) setArticles(data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return articles;
    return articles.filter(
      (a) => a.title.includes(search) || a.category.includes(search),
    );
  }, [articles, search]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* 搜索栏 */}
      <div className="knowledge-search">
        <Search size={18} style={{ color: "var(--v2-muted)" }} />
        <input
          type="text"
          placeholder="搜索配置指引或常见问题..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", border: 0, outline: 0 }}
        />
      </div>

      {/* 文章列表 */}
      <section className="v2-block">
        <header className="v2-block-header">
          <h2>文档中心</h2>
        </header>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
            <p>加载文档中...</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="article-list" style={{ padding: "10px 0" }}>
            {filtered.map((a) => (
              <div
                key={a.id}
                onClick={() => setActiveArticle(a)}
                style={{
                  padding: "12px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--v2-border)",
                }}
              >
                <div>
                  <span className="v2-badge" style={{ marginRight: 8 }}>
                    {a.category}
                  </span>
                  <strong style={{ color: "var(--v2-heading)" }}>{a.title}</strong>
                </div>
                <ArrowRight size={15} style={{ color: "var(--v2-muted)" }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "30px 20px", color: "var(--v2-muted)", textAlign: "center" }}>
            未找到相关文档教程。
          </div>
        )}
      </section>

      {/* 文档详情模态框 */}
      {activeArticle && (
        <Modal
          open={!!activeArticle}
          title={activeArticle.title}
          onClose={() => setActiveArticle(null)}
          width={640}
        >
          <div
            dangerouslySetInnerHTML={{ __html: activeArticle.body }}
            style={{ fontSize: 14, lineHeight: 1.8, color: "var(--v2-text)" }}
          />
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// 7. 工单系统 (ApiTicketPage)
// =========================================================================
export function ApiTicketPage() {
  const { showToast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState(1);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = () => {
    setLoading(true);
    ticketApi
      .fetchTickets()
      .then((data) => {
        if (Array.isArray(data)) setTickets(data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleCreate = async () => {
    if (!subject.trim() || !message.trim()) {
      showToast("请填写完整的工单主题与问题描述", "warning");
      return;
    }
    setSubmitting(true);
    try {
      await ticketApi.saveTicket({ subject, level, message });
      showToast("工单已提交，技术支持将尽快处理", "success");
      setNewModalOpen(false);
      setSubject("");
      setMessage("");
      loadTickets();
    } catch (err: any) {
      showToast(err.message || "提交工单失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <h2>我的工单</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewModalOpen(true)}>
          <Plus size={14} />
          <span>新建工单</span>
        </button>
      </header>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
          <p>加载工单列表中...</p>
        </div>
      ) : tickets.length > 0 ? (
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
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">#{t.id}</td>
                  <td>
                    <Link className="table-link" href={`/ticket/${t.id}`}>
                      {t.subject}
                    </Link>
                  </td>
                  <td>
                    <span className={`v2-badge ${t.level === 2 ? "badge-danger" : t.level === 1 ? "badge-warning" : "badge-info"}`}>
                      {t.level === 2 ? "高" : t.level === 1 ? "中" : "低"}
                    </span>
                  </td>
                  <td>
                    <span className={`v2-badge ${t.status === 0 ? "badge-warning" : "badge-success"}`}>
                      {t.status === 0 ? "待处理" : "已关闭"}
                    </span>
                  </td>
                  <td>{new Date(t.updated_at * 1000).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "30px 20px", color: "var(--v2-muted)", textAlign: "center" }}>
          您当前没有处于处理中的工单。遇到网络问题可随时点击右上角新建工单。
        </div>
      )}

      {/* 新建工单弹窗 */}
      <Modal
        open={newModalOpen}
        title="新建工单"
        onClose={() => setNewModalOpen(false)}
        width={500}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setNewModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? <Loader2 size={15} className="animate-spin" /> : "立即提交"}
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
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>优先级</label>
            <select
              value={level}
              onChange={(e) => setLevel(parseInt(e.target.value, 10))}
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
              onChange={(e) => setMessage(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}

export function ApiTicketDetailPage({ ticketId }: { ticketId: number }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadTicket = async () => {
    setLoading(true);
    try { setTicket(await ticketApi.fetchTicket(ticketId)); }
    catch (error: unknown) { showToast(error instanceof Error ? error.message : "工单加载失败", "error"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadTicket(); }, [ticketId]);

  const submitReply = async () => {
    if (!reply.trim()) return;
    setSubmitting(true);
    try { await ticketApi.replyTicket({ id: ticketId, message: reply }); setReply(""); await loadTicket(); showToast("回复已发送", "success"); }
    catch (error: unknown) { showToast(error instanceof Error ? error.message : "回复失败", "error"); }
    finally { setSubmitting(false); }
  };
  const closeTicket = async () => {
    setSubmitting(true);
    try { await ticketApi.closeTicket(ticketId); await loadTicket(); showToast("工单已关闭", "success"); }
    catch (error: unknown) { showToast(error instanceof Error ? error.message : "关闭失败", "error"); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ padding: "40px 0", textAlign: "center", color: "var(--v2-muted)" }}><Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} /><p>加载工单中...</p></div>;
  if (!ticket) return <div className="v2-block" style={{ padding: 24, textAlign: "center", color: "var(--v2-muted)" }}>未找到该工单。</div>;
  return <div style={{ display: "grid", gap: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><h1 style={{ margin: 0, fontSize: 22 }}>{ticket.subject}</h1><p style={{ margin: "5px 0 0", color: "var(--v2-muted)", fontSize: 13 }}>工单 #{ticket.id} · {ticket.status === 0 ? "处理中" : "已关闭"}</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push("/ticket")}>返回工单列表</button></div>
    <section className="v2-block" style={{ padding: 20 }}><div style={{ display: "grid", gap: 14 }}>{ticket.message?.map((item) => <div key={item.id} style={{ padding: "12px 14px", border: "1px solid var(--v2-border)", borderRadius: 4, background: item.is_me ? "var(--v2-header)" : "var(--v2-surface)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: 12, color: "var(--v2-muted)" }}><strong style={{ color: "var(--v2-text)" }}>{item.is_me ? "我" : "客服"}</strong><span>{new Date(item.created_at * 1000).toLocaleString()}</span></div><div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{item.message}</div></div>)}</div></section>
    {ticket.status === 0 && <section className="v2-block" style={{ padding: 20 }}><label style={{ display: "block", marginBottom: 7, fontSize: 14, fontWeight: 500 }}>补充回复</label><textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="补充问题或反馈" style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }} /><div style={{ display: "flex", gap: 10, marginTop: 10 }}><button type="button" className="btn btn-primary" disabled={submitting || !reply.trim()} onClick={submitReply}>{submitting ? "提交中..." : "发送回复"}</button><button type="button" className="btn btn-secondary" disabled={submitting} onClick={closeTicket}>关闭工单</button></div></section>}
  </div>;
}

// =========================================================================
// 8. 个人中心设置 (ApiProfilePage)
// =========================================================================
export function ApiProfilePage() {
  const { showToast } = useToast();
  const { user, refreshUser } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [rePassword, setRePassword] = useState("");
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      showToast("请填写完整旧密码与新密码", "warning");
      return;
    }
    if (newPassword !== rePassword) {
      showToast("两次输入的新密码不一致", "warning");
      return;
    }
    setSubmittingPassword(true);
    try {
      await userApi.changePassword({ old_password: oldPassword, new_password: newPassword });
      showToast("密码修改成功，请妥善保管", "success");
      setOldPassword("");
      setNewPassword("");
      setRePassword("");
    } catch (err: any) {
      showToast(err.message || "密码修改失败，请核对旧密码", "error");
    } finally {
      setSubmittingPassword(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* 账户概览 */}
      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>账户基础资料</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 14 }}>
          <div>
            <span style={{ color: "var(--v2-muted)" }}>登录邮箱：</span>
            <strong>{user?.email || "未登录"}</strong>
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
            <span style={{ color: "var(--v2-muted)" }}>UUID：</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {user?.uuid || "—"}
            </span>
          </div>
        </div>
      </section>

      {/* 修改密码 */}
      <section className="v2-block" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>修改登入密码</h3>
        <form onSubmit={handleChangePassword} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <input
            type="password"
            placeholder="当前旧密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            required
          />
          <input
            type="password"
            placeholder="设置新密码"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            required
          />
          <input
            type="password"
            placeholder="确认新密码"
            value={rePassword}
            onChange={(e) => setRePassword(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid var(--v2-border)", borderRadius: 4 }}
            required
          />
          <div>
            <button type="submit" className="btn btn-primary" disabled={submittingPassword}>
              {submittingPassword ? <Loader2 size={14} className="animate-spin" /> : "更新密码"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
