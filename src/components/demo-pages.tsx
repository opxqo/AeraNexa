"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Gift,
  Link2,
  MessageSquarePlus,
  QrCode,
  RotateCcw,
  Send,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge, Field, V2Block } from "@/components/v2-ui";
import { ConfirmModal, Modal, useToast } from "@/components/v2-modal";
import { OneClickSubscribeDrawer } from "@/components/one-click-subscribe";
import {
  knowledgeGroups,
  nodes,
  orders as initialOrders,
  plans,
  tickets as initialTickets,
  trafficRows,
} from "@/lib/demo-data";

const ButtonLink = ({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: React.ReactNode;
  secondary?: boolean;
}) => (
  <Link
    className={`btn ${secondary ? "btn-secondary" : "btn-primary"}`}
    href={href}
  >
    {children}
  </Link>
);

/* =========================================================================
   1. 套餐购买与配置页 (Plan & Plan Detail)
   ========================================================================= */

export function PlanPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "cycle" | "traffic">("all");
  const [unpaidOrderModalOpen, setUnpaidOrderModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // 模拟未支付订单检测（原版 V2Board 在有待付订单时购买新套餐会拦截）
  const hasUnpaidOrder = true;

  const handleSubscribeClick = (planId: string) => {
    if (hasUnpaidOrder) {
      setSelectedPlanId(planId);
      setUnpaidOrderModalOpen(true);
    } else {
      router.push(`/plan/${planId}`);
    }
  };

  const filteredPlans = plans.filter((plan) => {
    if (tab === "cycle") return plan.type === "周期订阅";
    if (tab === "traffic") return plan.type === "按流量";
    return true;
  });

  return (
    <div className="page-stack">
      <div className="page-intro">
        <h1>选择最适合您的计划</h1>
        <div className="filter-tabs">
          <button
            className={tab === "all" ? "active" : ""}
            onClick={() => setTab("all")}
          >
            全部
          </button>
          <button
            className={tab === "cycle" ? "active" : ""}
            onClick={() => setTab("cycle")}
          >
            按周期
          </button>
          <button
            className={tab === "traffic" ? "active" : ""}
            onClick={() => setTab("traffic")}
          >
            按流量
          </button>
        </div>
      </div>

      <div className="plan-grid">
        {filteredPlans.map((plan, index) => (
          <article
            className={`plan-card ${index === 1 ? "featured" : ""}`}
            key={plan.id}
          >
            {index === 1 && <span className="plan-ribbon">推荐</span>}
            <p className="plan-type">{plan.type}</p>
            <h2>{plan.name}</h2>
            <div className="plan-price">
              <span>¥</span>
              <strong>{plan.once ?? plan.month}</strong>
              <small>/{plan.once ? "一次性" : "月"}</small>
            </div>
            <p className="plan-traffic">
              {plan.traffic} 流量 · {plan.speed}
            </p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={15} />
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: "auto" }}
              onClick={() => handleSubscribeClick(plan.id)}
            >
              立即订阅
            </button>
          </article>
        ))}
      </div>

      {/* 未完成订单拦截弹窗 (对齐 V2Board zh-CN.js: 您还有未完成的订单...) */}
      <ConfirmModal
        open={unpaidOrderModalOpen}
        title="注意"
        content="您还有未完成的订单，购买前需要先取消，确定要取消之前的订单吗？"
        okText="确定取消"
        cancelText="返回我的订单"
        onOk={() => {
          setUnpaidOrderModalOpen(false);
          if (selectedPlanId) router.push(`/plan/${selectedPlanId}`);
        }}
        onCancel={() => {
          setUnpaidOrderModalOpen(false);
          router.push("/order");
        }}
      />
    </div>
  );
}

export function PlanDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const plan = plans.find((item) => item.id === id) ?? plans[0];

  const [period, setPeriod] = useState<string>(plan.once ? "一次性" : "月付");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);

  // 计算周期对应价格
  const getPeriodPrice = (p: string) => {
    if (p === "一次性") return plan.once ?? 58;
    if (p === "季付") return plan.quarter || plan.month * 3;
    if (p === "半年付") return Math.round(plan.month * 5.3);
    if (p === "年付") return plan.year || plan.month * 10;
    return plan.month;
  };

  const basePrice = getPeriodPrice(period);
  const totalPrice = Math.max(0, basePrice - couponDiscount);

  const handleVerifyCoupon = () => {
    if (!couponCode.trim()) {
      showToast("请输入优惠券代码", "warning");
      return;
    }
    if (couponCode.toUpperCase() === "DISCOUNT5") {
      setCouponDiscount(5);
      showToast("优惠券验证成功，已抵扣 ¥5.00", "success");
    } else {
      showToast("优惠券无效或已过期", "error");
    }
  };

  const handleCheckout = () => {
    showToast("正在创建订单...", "info");
    setTimeout(() => {
      router.push("/order/ANX202609190001");
    }, 600);
  };

  return (
    <div className="page-stack">
      <ButtonLink href="/plan" secondary>
        <ArrowLeft size={16} />
        选择其它订阅
      </ButtonLink>

      <div className="split-layout">
        <V2Block title="配置订阅">
          <div className="form-body">
            <div className="product-summary">
              <div>
                <small>产品名称</small>
                <strong>{plan.name}</strong>
              </div>
              <div>
                <small>产品流量</small>
                <strong>{plan.traffic}</strong>
              </div>
            </div>

            <Field label="付款周期">
              <div className="period-grid">
                {plan.once ? (
                  <button className="period active">
                    <span>一次性</span>
                    <strong>¥{plan.once}</strong>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`period ${period === "月付" ? "active" : ""}`}
                      onClick={() => setPeriod("月付")}
                    >
                      <span>月付</span>
                      <strong>¥{plan.month}</strong>
                    </button>
                    {plan.quarter > 0 && (
                      <button
                        type="button"
                        className={`period ${period === "季付" ? "active" : ""}`}
                        onClick={() => setPeriod("季付")}
                      >
                        <span>季付</span>
                        <strong>¥{plan.quarter}</strong>
                      </button>
                    )}
                    {plan.year > 0 && (
                      <button
                        type="button"
                        className={`period ${period === "半年付" ? "active" : ""}`}
                        onClick={() => setPeriod("半年付")}
                      >
                        <span>半年付</span>
                        <strong>¥{Math.round(plan.month * 5.3)}</strong>
                      </button>
                    )}
                    {plan.year > 0 && (
                      <button
                        type="button"
                        className={`period ${period === "年付" ? "active" : ""}`}
                        onClick={() => setPeriod("年付")}
                      >
                        <span>年付</span>
                        <strong>¥{plan.year}</strong>
                      </button>
                    )}
                  </>
                )}
              </div>
            </Field>

            <Field label="有优惠券？" hint="输入 DISCOUNT5 体验抵扣 ¥5.00">
              <div className="inline-control">
                <input
                  placeholder="请输入优惠券代码"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleVerifyCoupon}
                >
                  验证
                </button>
              </div>
            </Field>

            <div
              style={{
                padding: "10px 14px",
                background: "#fffbe6",
                border: "1px solid #ffe58f",
                borderRadius: 4,
                fontSize: 13,
                color: "#d46b08",
              }}
            >
              请注意，变更订阅会导致当前订阅被新订阅覆盖。
            </div>
          </div>
        </V2Block>

        <V2Block title="订单总额">
          <div className="checkout-summary">
            <p>
              <span>{plan.name}</span>
              <strong>¥{basePrice}.00</strong>
            </p>
            <p>
              <span>付款周期</span>
              <span>{period}</span>
            </p>
            {couponDiscount > 0 && (
              <p style={{ color: "#52c41a" }}>
                <span>优惠金额</span>
                <span>-¥{couponDiscount}.00</span>
              </p>
            )}
            <p className="checkout-total">
              <span>总计</span>
              <strong>¥{totalPrice}.00</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={handleCheckout}
            >
              下单
            </button>
          </div>
        </V2Block>
      </div>
    </div>
  );
}

/* =========================================================================
   2. 我的订单与收银台 (Order & Order Detail)
   ========================================================================= */

export function OrderPage() {
  const [orders, setOrders] = useState(initialOrders);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleCancelClick = (orderId: string) => {
    setCancelingOrderId(orderId);
    setCancelModalOpen(true);
  };

  const confirmCancel = () => {
    if (cancelingOrderId) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === cancelingOrderId
            ? { ...o, status: "已取消", tone: "neutral" }
            : o,
        ),
      );
      showToast("订单已成功取消", "info");
    }
    setCancelModalOpen(false);
  };

  return (
    <div className="page-stack">
      <V2Block title="我的订单">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th># 订单号</th>
                <th>周期</th>
                <th>订单金额</th>
                <th>订单状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="mono">{order.id}</span>
                    <small>{order.plan}</small>
                  </td>
                  <td>{order.period}</td>
                  <td>{order.amount}</td>
                  <td>
                    <Badge tone={order.tone}>{order.status}</Badge>
                  </td>
                  <td>{order.time}</td>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <Link className="table-link" href={`/order/${order.id}`}>
                        查看详情
                      </Link>
                      {order.status === "待支付" && (
                        <button
                          type="button"
                          className="btn btn-link btn-sm"
                          style={{ color: "#ff4d4f", padding: 0 }}
                          onClick={() => handleCancelClick(order.id)}
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
      </V2Block>

      {/* 取消订单确认弹窗 (对齐 V2Board zh-CN.js: 如果你已经付款，取消订单可能会导致支付失败...) */}
      <ConfirmModal
        open={cancelModalOpen}
        title="确认取消订单？"
        content="如果您已经付款，取消订单可能会导致支付失败，确定要取消订单吗？"
        okText="确定取消"
        cancelText="返回"
        okType="danger"
        onOk={confirmCancel}
        onCancel={() => setCancelModalOpen(false)}
      />
    </div>
  );
}

export function OrderDetailPage({ id }: { id: string }) {
  const { showToast } = useToast();
  const order = initialOrders.find((item) => item.id === id) ?? initialOrders[0];

  const [status, setStatus] = useState(order.status);
  const [payChannel, setPayChannel] = useState<"alipay" | "wechat" | "usdt" | "stripe">("alipay");
  const [useBalance, setUseBalance] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [payingModalOpen, setPayingModalOpen] = useState(false);

  const handlePay = () => {
    setPayingModalOpen(true);
    // 模拟从等待支付 -> 开通中 -> 已完成流程
    setTimeout(() => {
      setStatus("开通中");
    }, 2500);
    setTimeout(() => {
      setStatus("已完成");
      setPayingModalOpen(false);
      showToast("订单已支付并开通！", "success");
    }, 5000);
  };

  const handleCancelOrder = () => {
    setStatus("已取消");
    setCancelModalOpen(false);
    showToast("订单已取消", "info");
  };

  return (
    <div className="page-stack">
      <ButtonLink href="/order" secondary>
        <ArrowLeft size={16} />
        返回我的订单
      </ButtonLink>

      <div className="split-layout order-detail">
        <V2Block title="商品信息">
          <dl className="detail-list">
            <div>
              <dt>产品名称</dt>
              <dd>{order.plan}</dd>
            </div>
            <div>
              <dt>类型/周期</dt>
              <dd>新购 / {order.period}</dd>
            </div>
            <div>
              <dt>产品流量</dt>
              <dd>100 GB</dd>
            </div>
          </dl>
        </V2Block>

        <V2Block title="订单信息">
          <dl className="detail-list">
            <div>
              <dt>订单号</dt>
              <dd className="mono">{order.id}</dd>
            </div>
            <div>
              <dt>订单状态</dt>
              <dd>
                <Badge
                  tone={
                    status === "已完成"
                      ? "success"
                      : status === "待支付"
                      ? "warning"
                      : status === "开通中"
                      ? "info"
                      : "neutral"
                  }
                >
                  {status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>订单总额</dt>
              <dd>{order.amount}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{order.time}</dd>
            </div>
          </dl>

          {status === "待支付" && (
            <div style={{ padding: "0 20px 20px" }}>
              {/* 余额支付选项 */}
              <div
                style={{
                  margin: "16px 0",
                  padding: "12px 14px",
                  background: "#f8f9fc",
                  border: "1px solid var(--v2-border)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, color: "#333a40" }}>余额折抵</strong>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8a939c" }}>
                    账户可用余额 ¥36.00
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={useBalance}
                  onChange={(e) => setUseBalance(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--v2-primary)" }}
                />
              </div>

              {/* 在线支付方式选择 */}
              <label style={{ display: "block", fontSize: 13, color: "#727c86", marginBottom: 6 }}>
                请选择支付方式
              </label>
              <div className="payment-channel-list">
                <div
                  className={`payment-channel-item ${payChannel === "alipay" ? "active" : ""}`}
                  onClick={() => setPayChannel("alipay")}
                >
                  <span className="payment-channel-icon" style={{ color: "#1677ff" }}>支</span>
                  <span className="payment-channel-name">支付宝</span>
                </div>
                <div
                  className={`payment-channel-item ${payChannel === "wechat" ? "active" : ""}`}
                  onClick={() => setPayChannel("wechat")}
                >
                  <span className="payment-channel-icon" style={{ color: "#52c41a" }}>微</span>
                  <span className="payment-channel-name">微信支付</span>
                </div>
                <div
                  className={`payment-channel-item ${payChannel === "usdt" ? "active" : ""}`}
                  onClick={() => setPayChannel("usdt")}
                >
                  <span className="payment-channel-icon" style={{ color: "#26a17b" }}>₮</span>
                  <span className="payment-channel-name">USDT</span>
                </div>
                <div
                  className={`payment-channel-item ${payChannel === "stripe" ? "active" : ""}`}
                  onClick={() => setPayChannel("stripe")}
                >
                  <CreditCard size={20} style={{ color: "#635bff" }} />
                  <span className="payment-channel-name">信用卡</span>
                </div>
              </div>

              {payChannel === "stripe" && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    background: "#f8f9fc",
                    borderRadius: 4,
                    border: "1px solid var(--v2-border)",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#8a939c" }}>
                    您的信用卡信息只会用于当次扣款，系统并不会保存，我们认为这是最安全的。
                  </p>
                  <input
                    placeholder="卡号 4000 1234 5678 9010"
                    style={{
                      padding: "8px 10px",
                      border: "1px solid #d9d9d9",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      placeholder="MM/YY"
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        border: "1px solid #d9d9d9",
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                    <input
                      placeholder="CVC"
                      style={{
                        width: 80,
                        padding: "8px 10px",
                        border: "1px solid #d9d9d9",
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="detail-actions" style={{ padding: "20px 0 0" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCancelModalOpen(true)}
                >
                  关闭订单
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handlePay}
                >
                  结账
                </button>
              </div>
            </div>
          )}

          {status === "开通中" && (
            <div className="order-waiting-card">
              <RotateCcw size={32} className="order-waiting-spin" />
              <strong style={{ fontSize: 16 }}>开通中</strong>
              <p style={{ margin: 0, color: "#6c757d", fontSize: 13 }}>
                订单系统正在进行处理，请等候 1-3 分钟。
              </p>
            </div>
          )}

          {status === "已完成" && (
            <div className="order-waiting-card">
              <Check size={36} style={{ color: "#52c41a" }} />
              <strong style={{ fontSize: 16 }}>已完成</strong>
              <p style={{ margin: 0, color: "#6c757d", fontSize: 13 }}>
                订单已支付并开通。
              </p>
              <ButtonLink href="/node">查看订阅节点</ButtonLink>
            </div>
          )}

          {status === "已取消" && (
            <div className="order-waiting-card">
              <XCircle size={36} style={{ color: "#ff4d4f" }} />
              <strong style={{ fontSize: 16 }}>已取消</strong>
              <p style={{ margin: 0, color: "#6c757d", fontSize: 13 }}>
                订单由于超时支付已被取消。
              </p>
            </div>
          )}
        </V2Block>
      </div>

      {/* 取消订单确认 */}
      <ConfirmModal
        open={cancelModalOpen}
        title="确定取消订单？"
        content="如果您已经付款，取消订单可能会导致支付失败，确定要取消订单吗？"
        okText="确定取消"
        cancelText="返回"
        okType="danger"
        onOk={handleCancelOrder}
        onCancel={() => setCancelModalOpen(false)}
      />

      {/* 支付中模态框 */}
      <Modal
        open={payingModalOpen}
        title="等待支付中"
        onClose={() => setPayingModalOpen(false)}
        width={400}
        footer={null}
      >
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p style={{ color: "#495057", fontSize: 14, marginBottom: 16 }}>
            请使用对应 App 扫码或完成在线支付
          </p>
          <div
            style={{
              padding: 16,
              background: "#fff",
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              display: "inline-block",
            }}
          >
            <QrCode size={180} style={{ color: "var(--v2-primary)" }} />
          </div>
          <p style={{ color: "#8a939c", fontSize: 13, marginTop: 14 }}>
            支付完成后页面将自动刷新，请勿关闭本窗口
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================================
   3. 节点状态页 (Node)
   ========================================================================= */

export function NodePage() {
  const { showToast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  const subscribeUrl =
    "https://api.aeranexa.com/api/v1/client/subscribe?token=8a7b9c1d2e3f4g5h6i7j8k9l0m";

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(subscribeUrl).then(() => {
        showToast("复制成功", "success");
      });
    }
  };

  const handleResetConfirm = () => {
    setResetModalOpen(false);
    showToast("重置成功，您的订阅信息与 UUID 已更新", "success");
  };

  return (
    <div className="page-stack">
      <V2Block title="我的订阅">
        <div className="subscription-tools">
          <div>
            <strong>标准订阅</strong>
            <p>已用 20.00 GB / 总计 100.00 GB</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
            >
              <Copy size={15} />
              复制订阅地址
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDrawerOpen(true)}
            >
              <Link2 size={15} />
              一键订阅
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setQrModalOpen(true)}
            >
              <QrCode size={15} />
              二维码订阅
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setResetModalOpen(true)}
            >
              <RotateCcw size={15} />
              重置订阅信息
            </button>
          </div>
        </div>
      </V2Block>

      <V2Block title="节点状态">
        <p className="block-description">
          五分钟内节点在线情况。使用的流量将乘以倍率进行扣除。
        </p>
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>标签</th>
                <th>状态</th>
                <th>倍率</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.name}>
                  <td className="node-name">{node.name}</td>
                  <td>
                    <span className="tag-row">
                      {node.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-dot ${
                        node.status === "在线" ? "online" : ""
                      }`}
                    />
                    {node.status}
                  </td>
                  <td>{node.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </V2Block>

      <OneClickSubscribeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        subscribeUrl={subscribeUrl}
      />

      {/* 二维码弹窗 */}
      <Modal
        open={qrModalOpen}
        title="扫描二维码订阅"
        onClose={() => setQrModalOpen(false)}
        width={360}
        footer={null}
      >
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <p style={{ color: "#6c757d", fontSize: 13, marginBottom: 16 }}>
            使用支持扫码的客户端进行订阅
          </p>
          <div
            style={{
              padding: 16,
              background: "#fff",
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              display: "inline-block",
            }}
          >
            <QrCode size={180} style={{ color: "var(--v2-primary)" }} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 18 }}
            onClick={handleCopy}
          >
            <Copy size={14} /> 复制订阅地址
          </button>
        </div>
      </Modal>

      {/* 重置订阅信息二次确认 (对齐 V2Board zh-CN.js: 如果你的订阅地址或信息泄露...) */}
      <ConfirmModal
        open={resetModalOpen}
        title="确定要重置订阅信息？"
        content="如果您的订阅地址或信息发生泄露可以执行此操作。重置后您的 UUID 及订阅将会变更，需要重新导入订阅。"
        okText="重置"
        cancelText="取消"
        okType="danger"
        onOk={handleResetConfirm}
        onCancel={() => setResetModalOpen(false)}
      />
    </div>
  );
}

/* =========================================================================
   4. 流量明细页 (Traffic)
   ========================================================================= */

export function TrafficPage() {
  return (
    <div className="page-stack">
      <div className="stat-grid traffic-stats">
        <article>
          <small>实际上行</small>
          <strong>1.54 GB</strong>
        </article>
        <article>
          <small>实际下行</small>
          <strong>14.37 GB</strong>
        </article>
        <article>
          <small>合计扣除</small>
          <strong>17.05 GB</strong>
        </article>
      </div>

      <V2Block title="流量明细">
        <p className="block-description">
          流量明细仅保留近一个月数据以供查询。
        </p>
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>记录时间</th>
                <th>实际上行</th>
                <th>实际下行</th>
                <th>扣费倍率</th>
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {trafficRows.map((row) => (
                <tr key={row.time}>
                  <td>{row.time}</td>
                  <td>{row.up}</td>
                  <td>{row.down}</td>
                  <td>{row.rate}</td>
                  <td>
                    <strong>{row.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="formula">
          公式：(实际上行 + 实际下行) × 扣费倍率 = 扣除流量
        </p>
      </V2Block>
    </div>
  );
}

/* =========================================================================
   5. 我的邀请页 (Invite)
   ========================================================================= */

export function InvitePage() {
  const { showToast } = useToast();
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [withdrawAccount, setWithdrawAccount] = useState("");
  const [withdrawChannel, setWithdrawChannel] = useState("alipay");

  const inviteLink = "https://aeranexa.com/register?code=AERANEXA2026";

  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(inviteLink).then(() => {
        showToast("复制成功", "success");
      });
    }
  };

  const handleTransferSubmit = () => {
    if (!transferAmount || Number(transferAmount) <= 0) {
      showToast("请输入正确的划转金额", "warning");
      return;
    }
    setTransferModalOpen(false);
    showToast(`成功将 ¥${transferAmount} 划转至账户余额`, "success");
    setTransferAmount("");
  };

  const handleWithdrawSubmit = () => {
    if (!withdrawAccount.trim()) {
      showToast("请输入提现账号", "warning");
      return;
    }
    setWithdrawModalOpen(false);
    showToast("提现申请已提交，请等待管理员审核", "success");
    setWithdrawAccount("");
  };

  return (
    <div className="page-stack">
      <div className="stat-grid invite-stats">
        <article>
          <Gift size={24} />
          <small>已注册用户数</small>
          <strong>12</strong>
        </article>
        <article>
          <CircleDollarSign size={24} />
          <small>累计获得佣金</small>
          <strong>¥286.40</strong>
        </article>
        <article>
          <Wallet size={24} />
          <small>当前剩余佣金</small>
          <strong>¥126.40</strong>
        </article>
        <article>
          <ShieldCheck size={24} />
          <small>佣金比例</small>
          <strong>10%</strong>
        </article>
      </div>

      <div
        style={{
          padding: "11px 16px",
          background: "#f0f5ff",
          border: "1px solid #adc6ff",
          borderRadius: 4,
          fontSize: 13,
          color: "#2f54eb",
        }}
      >
        您邀请的用户再次邀请用户将按照订单金额乘以分销等级的比例进行分成。佣金将会在确认后到达您的佣金账户。
      </div>

      <V2Block
        title="邀请码管理"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTransferModalOpen(true)}
            >
              划转
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setWithdrawModalOpen(true)}
            >
              推广佣金提现
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => showToast("已生成新的邀请码", "success")}
            >
              生成邀请码
            </button>
          </div>
        }
      >
        <div className="invite-code">
          <div>
            <small>邀请码</small>
            <strong>AERANEXA2026</strong>
            <p>{inviteLink}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopyLink}
          >
            <Copy size={15} />
            复制链接
          </button>
        </div>
      </V2Block>

      <V2Block title="佣金发放记录">
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>完成时间</th>
                <th>订单号</th>
                <th>佣金</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-09-15 14:26</td>
                <td className="mono">ANX202609150062</td>
                <td>¥18.00</td>
                <td>
                  <Badge tone="success">已发放</Badge>
                </td>
              </tr>
              <tr>
                <td>2026-09-18 08:30</td>
                <td className="mono">ANX202609180033</td>
                <td>¥35.00</td>
                <td>
                  <Badge tone="warning">待确认</Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </V2Block>

      {/* 划转至余额弹窗 (对齐 V2Board zh-CN.js: 推广佣金划转至余额...) */}
      <Modal
        open={transferModalOpen}
        title="推广佣金划转至余额"
        onClose={() => setTransferModalOpen(false)}
        onOk={handleTransferSubmit}
        okText="确认"
        cancelText="取消"
        width={420}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ margin: 0, color: "#6c757d", fontSize: 13 }}>
            划转后的余额仅用于本站消费使用
          </p>
          <div
            style={{
              padding: "10px 12px",
              background: "#f8f9fc",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            当前推广佣金余额：<strong>¥126.40</strong>
          </div>
          <Field label="划转金额">
            <input
              type="number"
              placeholder="请输入需要划转到余额的金额"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      {/* 推广佣金申请提现弹窗 (对齐 V2Board zh-CN.js: 申请提现...) */}
      <Modal
        open={withdrawModalOpen}
        title="申请提现"
        onClose={() => setWithdrawModalOpen(false)}
        onOk={handleWithdrawSubmit}
        okText="确认"
        cancelText="取消"
        width={420}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              padding: "10px 12px",
              background: "#f8f9fc",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            可提现佣金：<strong>¥126.40</strong>
          </div>
          <Field label="提现方式">
            <select
              value={withdrawChannel}
              onChange={(e) => setWithdrawChannel(e.target.value)}
            >
              <option value="alipay">支付宝</option>
              <option value="usdt">USDT (TRC20)</option>
            </select>
          </Field>
          <Field label="提现账号">
            <input
              placeholder="请输入提现账号"
              value={withdrawAccount}
              onChange={(e) => setWithdrawAccount(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================================
   6. 使用文档页 (Knowledge)
   ========================================================================= */

export function KnowledgePage() {
  const [search, setSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);

  const filteredGroups = knowledgeGroups.map((group) => ({
    ...group,
    articles: group.articles.filter((a) =>
      a.toLowerCase().includes(search.toLowerCase()),
    ),
  }));

  return (
    <div className="page-stack">
      <div className="knowledge-search">
        <BookOpen size={22} />
        <input
          aria-label="搜索文档"
          placeholder="搜索文档"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="knowledge-grid">
        {filteredGroups.map((group) => (
          <V2Block title={group.title} key={group.title}>
            <div className="article-list">
              {group.articles.map((article) => (
                <div
                  key={article}
                  onClick={() => setSelectedArticle(article)}
                  role="button"
                  tabIndex={0}
                  style={{
                    minHeight: 55,
                    padding: "13px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderTop: "1px solid var(--v2-border)",
                    cursor: "pointer",
                  }}
                >
                  <span>{article}</span>
                  <ChevronRight size={17} color="#a5acb3" />
                </div>
              ))}
            </div>
          </V2Block>
        ))}
      </div>

      {/* 文档详情模态框 */}
      <Modal
        open={Boolean(selectedArticle)}
        title={selectedArticle ?? "使用文档"}
        onClose={() => setSelectedArticle(null)}
        width={680}
        footer={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSelectedArticle(null)}
          >
            关闭
          </button>
        }
      >
        <div>
          <p style={{ color: "#8a939c", fontSize: 12, marginBottom: 16 }}>
            最后更新: 2026-09-18
          </p>
          <div style={{ lineHeight: 1.8, fontSize: 14, color: "#333a40" }}>
            <p>
              欢迎查阅 <strong>{selectedArticle}</strong> 官方配置指引。
            </p>
            <h4>快速配置步骤：</h4>
            <ol style={{ paddingLeft: 20 }}>
              <li>
                首先在控制台「节点状态」页面或点击「一键订阅」获取您的专属订阅地址。
              </li>
              <li>
                打开对应客户端（如 Clash、Shadowrocket 等），将订阅链接粘贴到配置订阅地址中。
              </li>
              <li>点击「更新订阅」，等待节点列表下载完成。</li>
              <li>在策略组中选择「自动选择」或手动选择所需低延迟线路启动代理。</li>
            </ol>
            <p>
              如遇到订阅更新失败，请确认您的系统时间与标准北京时间同步，或通过技术支持工单联系我们。
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================================
   7. 我的工单与新建工单页 (Ticket & Ticket Detail)
   ========================================================================= */

export function TicketPage() {
  return (
    <V2Block
      title="我的工单"
      action={
        <ButtonLink href="/ticket/new">
          <MessageSquarePlus size={16} />
          新的工单
        </ButtonLink>
      }
    >
      <div className="table-wrap">
        <table className="v2-table">
          <thead>
            <tr>
              <th>主题</th>
              <th>工单级别</th>
              <th>工单状态</th>
              <th>最后回复</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {initialTickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.subject}</td>
                <td>
                  <Badge
                    tone={
                      ticket.level === "高"
                        ? "danger"
                        : ticket.level === "中"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {ticket.level}
                  </Badge>
                </td>
                <td>{ticket.status}</td>
                <td>{ticket.time}</td>
                <td>
                  <Link className="table-link" href={`/ticket/${ticket.id}`}>
                    查看
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </V2Block>
  );
}

export function TicketDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const isNew = id === "new";

  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("中");
  const [message, setMessage] = useState("");
  const [replyText, setReplyText] = useState("");
  const [messagesList, setMessagesList] = useState([
    {
      sender: "demo@aeranexa.com",
      time: "2026-09-19 09:42",
      text: "客户端中粘贴订阅地址后提示更新失败，请问应该如何处理？",
      isMine: true,
    },
    {
      sender: "技术支持",
      time: "2026-09-19 10:06",
      text: "您好，请先确认客户端系统时间正确，然后在节点页面重新复制订阅地址。如果仍然失败，请回复客户端版本号。",
      isMine: false,
    },
  ]);

  const handleCreateTicket = () => {
    if (!subject.trim() || !message.trim()) {
      showToast("请完整填写工单主题与问题描述", "warning");
      return;
    }
    showToast("工单创建成功！", "success");
    router.push("/ticket");
  };

  const handleReply = () => {
    if (!replyText.trim()) return;
    setMessagesList((prev) => [
      ...prev,
      {
        sender: "demo@aeranexa.com",
        time: "刚刚",
        text: replyText,
        isMine: true,
      },
    ]);
    setReplyText("");
    showToast("回复已发送", "success");
  };

  if (isNew) {
    return (
      <div className="page-stack">
        <ButtonLink href="/ticket" secondary>
          <ArrowLeft size={16} />
          工单历史
        </ButtonLink>
        <V2Block title="新的工单">
          <div className="form-body narrow-form">
            <Field label="主题">
              <input
                placeholder="请输入工单主题"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            <Field label="工单等级">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="低">低</option>
                <option value="中">中</option>
                <option value="高">高</option>
              </select>
            </Field>
            <Field label="消息">
              <textarea
                rows={7}
                placeholder="请描述您遇到的问题"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="btn btn-primary"
              style={{ justifySelf: "start" }}
              onClick={handleCreateTicket}
            >
              确认
            </button>
          </div>
        </V2Block>
      </div>
    );
  }

  const ticket =
    initialTickets.find((item) => item.id === id) ?? initialTickets[0];

  return (
    <div className="page-stack">
      <ButtonLink href="/ticket" secondary>
        <ArrowLeft size={16} />
        工单历史
      </ButtonLink>
      <V2Block
        title={ticket.subject}
        action={<Badge tone="warning">{ticket.status}</Badge>}
      >
        <div className="conversation">
          {messagesList.map((m, idx) => (
            <article
              key={idx}
              className={`message ${m.isMine ? "mine" : "support"}`}
            >
              <header>
                <strong>{m.sender}</strong>
                <time>{m.time}</time>
              </header>
              <p>{m.text}</p>
            </article>
          ))}
        </div>
        <div className="reply-box">
          <textarea
            rows={4}
            placeholder="输入内容回复工单..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => showToast("工单已关闭", "info")}
            >
              关闭工单
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleReply}
            >
              <Send size={15} />
              回复
            </button>
          </div>
        </div>
      </V2Block>
    </div>
  );
}

/* =========================================================================
   8. 个人中心页 (Profile)
   ========================================================================= */

export function ProfilePage() {
  const { showToast } = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");

  const handleSavePassword = () => {
    if (!oldPassword || !newPassword) {
      showToast("请输入旧密码和新密码", "warning");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("两次新密码输入不同", "error");
      return;
    }
    showToast("密码修改成功！", "success");
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleResetConfirm = () => {
    setResetModalOpen(false);
    showToast("重置成功，您的 UUID 与订阅地址已变更", "success");
  };

  return (
    <div className="page-stack profile-grid">
      {/* 我的钱包 */}
      <V2Block
        title="我的钱包"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setTransferModalOpen(true)}
            >
              划转
            </button>
          </div>
        }
      >
        <div className="wallet-grid">
          <div>
            <Wallet size={26} />
            <span>账户余额(仅消费)</span>
            <strong>¥36.00</strong>
          </div>
          <div>
            <CircleDollarSign size={26} />
            <span>推广佣金(可提现)</span>
            <strong>¥126.40</strong>
          </div>
        </div>
      </V2Block>

      {/* 修改密码 */}
      <V2Block title="修改密码">
        <div className="form-body">
          <Field label="旧密码">
            <input
              type="password"
              placeholder="请输入旧密码"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </Field>
          <Field label="新密码">
            <input
              type="password"
              placeholder="请输入新密码"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="确认新密码">
            <input
              type="password"
              placeholder="请再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="btn btn-primary"
            style={{ justifySelf: "start" }}
            onClick={handleSavePassword}
          >
            保存
          </button>
        </div>
      </V2Block>

      {/* 消息通知 */}
      <V2Block title="通知">
        <div className="setting-list">
          <label>
            <span>
              <strong>到期邮件提醒</strong>
              <small>订阅即将到期时发送邮件提醒</small>
            </span>
            <input type="checkbox" defaultChecked />
          </label>
          <label>
            <span>
              <strong>流量邮件提醒</strong>
              <small>剩余流量不足时发送邮件提醒</small>
            </span>
            <input type="checkbox" defaultChecked />
          </label>
        </div>
      </V2Block>

      {/* 绑定 Telegram */}
      <V2Block title="绑定 Telegram">
        <div style={{ padding: "18px 20px", display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>
            绑定 Telegram 后可接收节点状态告警、流量提醒以及使用快捷机器人查询。
          </p>
          <div
            style={{
              padding: "10px 14px",
              background: "#f8f9fc",
              border: "1px solid var(--v2-border)",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            向机器人 <code>@AeraNexa_bot</code> 发送代码：
            <strong style={{ color: "var(--v2-primary)", marginLeft: 6 }}>
              /bind 78d91f2a3e5c4b609e2f1837a
            </strong>
          </div>
        </div>
      </V2Block>

      {/* 重置订阅信息 */}
      <V2Block title="重置订阅信息" style={{ gridColumn: "1 / -1" }}>
        <div className="danger-action">
          <div>
            <strong>重置订阅信息</strong>
            <p>
              如果您的订阅地址或信息发生泄露可以执行此操作。重置后您的 UUID 及订阅将会变更，需要重新导入订阅。
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setResetModalOpen(true)}
          >
            <RotateCcw size={15} />
            重置
          </button>
        </div>
      </V2Block>

      {/* 重置确认弹窗 */}
      <ConfirmModal
        open={resetModalOpen}
        title="确定要重置订阅信息？"
        content="如果您的订阅地址或信息发生泄露可以执行此操作。重置后您的 UUID 及订阅将会变更，需要重新导入订阅。"
        okText="重置"
        cancelText="取消"
        okType="danger"
        onOk={handleResetConfirm}
        onCancel={() => setResetModalOpen(false)}
      />

      {/* 划转至余额弹窗 */}
      <Modal
        open={transferModalOpen}
        title="推广佣金划转至余额"
        onClose={() => setTransferModalOpen(false)}
        onOk={() => {
          if (!transferAmount) return;
          setTransferModalOpen(false);
          showToast(`成功划转 ¥${transferAmount} 至账户余额`, "success");
          setTransferAmount("");
        }}
        okText="确认"
        cancelText="取消"
        width={400}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>
            当前推广佣金余额：¥126.40
          </p>
          <Field label="划转金额">
            <input
              type="number"
              placeholder="请输入划转金额"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

export const sectionPages: Record<string, () => React.ReactNode> = {
  plan: PlanPage,
  order: OrderPage,
  node: NodePage,
  traffic: TrafficPage,
  invite: InvitePage,
  knowledge: KnowledgePage,
  ticket: TicketPage,
  profile: ProfilePage,
};

export function DetailPage({ section, id }: { section: string; id: string }) {
  if (section === "plan") return <PlanDetailPage id={id} />;
  if (section === "order") return <OrderDetailPage id={id} />;
  if (section === "ticket") return <TicketDetailPage id={id} />;
  return null;
}
