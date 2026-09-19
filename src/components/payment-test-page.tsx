"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  FlaskConical,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Webhook,
  XCircle,
} from "lucide-react";

type PaymentChannel = "alipay" | "wxpay" | "qqpay" | "usdt";
type DemoStage = "draft" | "checkout" | "success" | "failed";

const channels: Array<{
  id: PaymentChannel;
  label: string;
  detail: string;
  mark: string;
  tone: string;
}> = [
  { id: "alipay", label: "支付宝", detail: "Alipay", mark: "支", tone: "alipay" },
  { id: "wxpay", label: "微信支付", detail: "WeChat Pay", mark: "微", tone: "wechat" },
  { id: "qqpay", label: "QQ钱包", detail: "QQ Wallet", mark: "Q", tone: "qq" },
  { id: "usdt", label: "USDT", detail: "TRC-20", mark: "₮", tone: "usdt" },
];

function createTradeNo() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ANX-TEST-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${suffix}`;
}

function formatAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function PaymentTestPage() {
  const [channel, setChannel] = useState<PaymentChannel>("alipay");
  const [amount, setAmount] = useState("0.01");
  const [stage, setStage] = useState<DemoStage>("draft");
  const [tradeNo, setTradeNo] = useState("");
  const [copied, setCopied] = useState(false);

  const selectedChannel = channels.find((item) => item.id === channel) ?? channels[0];
  const displayAmount = formatAmount(amount);
  const isTerminal = stage === "success" || stage === "failed";

  const stages = useMemo(
    () => [
      {
        key: "created",
        label: "创建测试订单",
        detail: tradeNo || "等待生成订单号",
        state: stage === "draft" ? "pending" : "done",
        icon: CreditCard,
      },
      {
        key: "checkout",
        label: "进入模拟收银台",
        detail: stage === "draft" ? "支付链接尚未生成" : "本地模拟页面已就绪",
        state: stage === "draft" ? "pending" : "done",
        icon: QrCode,
      },
      {
        key: "callback",
        label: "等待异步回调",
        detail:
          stage === "success"
            ? "已收到模拟 webhook"
            : stage === "failed"
              ? "模拟支付被主动标记为失败"
              : "点击右侧按钮推进测试",
        state: stage === "success" ? "done" : stage === "failed" ? "failed" : "pending",
        icon: Webhook,
      },
      {
        key: "complete",
        label: "更新订单状态",
        detail:
          stage === "success"
            ? "订单已完成 · 订阅待开通"
            : stage === "failed"
              ? "订单仍保持待支付"
              : "等待支付结果",
        state: stage === "success" ? "done" : stage === "failed" ? "failed" : "pending",
        icon: stage === "failed" ? XCircle : CheckCircle2,
      },
    ],
    [stage, tradeNo],
  );

  const resetDemo = () => {
    setStage("draft");
    setTradeNo("");
    setCopied(false);
  };

  const createOrder = () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;
    setTradeNo(createTradeNo());
    setStage("checkout");
    setCopied(false);
  };

  const copyTradeNo = async () => {
    if (!tradeNo || !navigator.clipboard) return;
    await navigator.clipboard.writeText(tradeNo);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const finishDemo = (nextStage: "success" | "failed") => {
    setStage(nextStage);
  };

  return (
    <div className="payment-lab-page">
      <header className="payment-lab-hero">
        <div>
          <div className="payment-lab-kicker">
            <FlaskConical size={15} />
            <span>测试环境 · 不会扣款</span>
          </div>
          <h1>测试支付工作台</h1>
          <p>在接入正式支付渠道之前，先把下单、收银台和异步回调流程走通。</p>
        </div>
        <div className="payment-lab-hero-note">
          <ShieldCheck size={18} />
          <span>所有操作只在当前浏览器内模拟</span>
        </div>
      </header>

      <div className="payment-lab-grid">
        <section className="payment-lab-checkout">
          <div className="payment-lab-section-heading">
            <div>
              <p className="payment-lab-overline">下单测试</p>
              <h2>创建测试订单</h2>
            </div>
            <span className="payment-lab-status-dot"><i />本地模拟</span>
          </div>

          <div className="payment-lab-product">
            <div className="payment-lab-product-icon"><CreditCard size={22} /></div>
            <div>
              <strong>AeraNexa 月度订阅</strong>
              <span>TEST-PRODUCT · 本地演示商品</span>
            </div>
            <div className="payment-lab-product-price">¥{displayAmount}</div>
          </div>

          <div className="payment-lab-form">
            <label className="payment-lab-field">
              <span>测试金额</span>
              <div className="payment-lab-amount-input">
                <b>¥</b>
                <input
                  aria-label="测试金额"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={stage !== "draft"}
                />
                <small>CNY</small>
              </div>
              <em>建议使用 ¥0.01 验证流程，当前不会产生真实支付。</em>
            </label>

            <fieldset className="payment-lab-channel-field">
              <legend>模拟支付渠道</legend>
              <div className="payment-lab-channel-grid">
                {channels.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`payment-lab-channel ${channel === item.id ? "selected" : ""}`}
                    onClick={() => setChannel(item.id)}
                    disabled={stage !== "draft"}
                    aria-pressed={channel === item.id}
                  >
                    <span className={`payment-lab-channel-mark ${item.tone}`}>{item.mark}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="payment-lab-radio" />
                  </button>
                ))}
              </div>
            </fieldset>

            {stage === "draft" ? (
              <button
                type="button"
                className="button button-primary payment-lab-primary-action"
                onClick={createOrder}
                disabled={!Number.isFinite(Number(amount)) || Number(amount) <= 0}
              >
                生成模拟订单
                <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" className="button button-secondary payment-lab-primary-action" onClick={resetDemo}>
                <RotateCcw size={16} />
                重新开始测试
              </button>
            )}
          </div>

          <div className="payment-lab-safety-note">
            <ShieldCheck size={16} />
            <span>当前是前端演示。不会连接码支付，不会写入订单数据库，也不会发送 webhook。</span>
          </div>
        </section>

        <aside className="payment-lab-trace">
          <div className="payment-lab-section-heading">
            <div>
              <p className="payment-lab-overline">回调测试</p>
              <h2>订单状态</h2>
            </div>
            <Clock3 size={19} />
          </div>

          <div className="payment-lab-timeline">
            {stages.map((item, index) => {
              const Icon = item.icon;
              return (
                <div className={`payment-lab-timeline-item ${item.state}`} key={item.key}>
                  <div className="payment-lab-timeline-marker"><Icon size={15} /></div>
                  {index < stages.length - 1 && <span className="payment-lab-timeline-line" />}
                  <div className="payment-lab-timeline-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {stage === "draft" && (
            <div className="payment-lab-empty-state">
              <QrCode size={24} />
              <strong>收银台尚未打开</strong>
              <span>生成订单后，这里会出现可操作的模拟收银台。</span>
            </div>
          )}

          {stage === "checkout" && (
            <div className="payment-lab-cashier">
              <div className="payment-lab-cashier-topline">
                <span>模拟收银台</span>
                <span className={`payment-lab-mini-mark ${selectedChannel.tone}`}>{selectedChannel.mark}</span>
              </div>
              <div className="payment-lab-qr-frame" aria-label="模拟二维码">
                <QrCode size={72} strokeWidth={1.25} />
                <span>模拟</span>
              </div>
              <strong className="payment-lab-cashier-amount">¥{displayAmount}</strong>
              <p>使用 {selectedChannel.label} 完成模拟支付</p>
              <div className="payment-lab-trade-row">
                <span>{tradeNo}</span>
                <button type="button" onClick={copyTradeNo} aria-label="复制测试订单号">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div className="payment-lab-cashier-actions">
                <button type="button" className="button button-primary" onClick={() => finishDemo("success")}>
                  模拟支付成功
                </button>
                <button type="button" className="button button-secondary" onClick={() => finishDemo("failed")}>
                  标记失败
                </button>
              </div>
            </div>
          )}

          {isTerminal && (
            <div className={`payment-lab-result ${stage}`}>
              {stage === "success" ? <CheckCircle2 size={25} /> : <XCircle size={25} />}
              <div>
                <strong>{stage === "success" ? "模拟支付成功" : "模拟支付失败"}</strong>
                <span>
                  {stage === "success"
                    ? "已模拟平台回调，下一步可接真实订单状态更新。"
                    : "这笔订单没有完成支付，可以重新开始一次测试。"}
                </span>
              </div>
            </div>
          )}

          <div className="payment-lab-callback">
            <div className="payment-lab-callback-heading">
              <Webhook size={15} />
              <strong>Webhook 预览</strong>
            </div>
            <pre>{JSON.stringify({
              trade_no: tradeNo || "ANX-TEST-PENDING",
              out_trade_no: tradeNo || "等待生成",
              type: channel,
              money: displayAmount,
              trade_status: stage === "success" ? "TRADE_SUCCESS" : "WAIT_BUYER_PAY",
            }, null, 2)}</pre>
          </div>
        </aside>
      </div>

      <footer className="payment-lab-footer">
        <span>AeraNexa 支付接口联调演示</span>
        <span>下一步：接入真实 EPay / 码支付适配器</span>
      </footer>
    </div>
  );
}
