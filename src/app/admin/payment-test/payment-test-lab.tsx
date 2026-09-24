"use client";

import { useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Ban,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  CreditCard,
  FlaskConical,
  LockKeyhole,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Terminal,
  WalletCards,
  X,
} from "lucide-react";

type ChannelId = "alipay" | "wechat" | "qq" | "usdt";
type OrderStatus = "pending" | "paid" | "failed" | "closed";
type Scenario = "success" | "duplicate" | "mismatch" | "failure" | "late";
type ActivityTone = "info" | "success" | "warning" | "error";
type Activity = { id: number; title: string; detail: string; time: string; tone: ActivityTone };

type TestOrder = {
  tradeNo: string;
  providerTradeNo: string;
  amountCents: number;
  channel: ChannelId;
  status: OrderStatus;
};

type TestResult = { tone: "success" | "failed"; title: string; detail: string };

const channels: { id: ChannelId; name: string; note: string; mark: string }[] = [
  { id: "alipay", name: "支付宝沙箱", note: "扫码渠道 · 模拟", mark: "支" },
  { id: "wechat", name: "微信支付沙箱", note: "扫码渠道 · 模拟", mark: "微" },
  { id: "qq", name: "QQ 钱包沙箱", note: "扫码渠道 · 模拟", mark: "Q" },
  { id: "usdt", name: "USDT 沙箱", note: "数字货币 · 模拟", mark: "₮" },
];

const scenarioLabels: Record<Scenario, string> = {
  success: "支付成功回调",
  duplicate: "重复通知",
  mismatch: "金额不一致",
  failure: "渠道支付失败",
  late: "关单后迟到回调",
};

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function localTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function makeTradeNo(prefix: string) {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  const date = new Date();
  const ymd = [date.getFullYear().toString().slice(-2), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
  return prefix + ymd + suffix;
}

function addActivity(title: string, detail: string, tone: ActivityTone): Activity {
  return { id: Date.now() + Math.random(), title, detail, time: localTime(), tone };
}

export function PaymentTestLab() {
  const [amount, setAmount] = useState("49.00");
  const [channel, setChannel] = useState<ChannelId>("alipay");
  const [order, setOrder] = useState<TestOrder | null>(null);
  const [history, setHistory] = useState<Activity[]>([]);
  const [callbackPayload, setCallbackPayload] = useState<Record<string, string | number> | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [lastScenario, setLastScenario] = useState<Scenario | null>(null);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);

  const addLog = (title: string, detail: string, tone: ActivityTone) => {
    setHistory((current) => [addActivity(title, detail, tone), ...current].slice(0, 6));
  };

  const createOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (order) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000 || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setFormError("请输入 0.01 到 1,000,000 之间的金额，最多保留两位小数。");
      return;
    }
    const cents = Math.round(parsed * 100);
    const nextOrder: TestOrder = {
      tradeNo: makeTradeNo("ANX"),
      providerTradeNo: makeTradeNo("MOCK"),
      amountCents: cents,
      channel,
      status: "pending",
    };
    setOrder(nextOrder);
    setHistory([
      addActivity("测试订单已创建", "订单与金额仅保存在当前页面状态中，没有写入数据库。", "success"),
      addActivity("模拟渠道已就绪", "生成 mock://checkout 地址占位；没有发起网络请求。", "info"),
    ]);
    setCallbackPayload(null);
    setResult(null);
    setLastScenario(null);
    setFormError("");
  };

  const runScenario = (scenario: Scenario) => {
    if (!order || order.status !== "pending") return;
    setLastScenario(scenario);

    const successPayload = {
      trade_no: order.tradeNo,
      provider_trade_no: order.providerTradeNo,
      amount_cents: order.amountCents,
      currency: "CNY",
      status: "succeeded",
    };

    if (scenario === "success") {
      setCallbackPayload(successPayload);
      setOrder({ ...order, status: "paid" });
      setResult({ tone: "success", title: "支付成功，订单履约完成", detail: "本地演练按验证通过处理；页面没有调用真实回调或履约接口。" });
      addLog("支付成功回调已接受", "页面订单状态：待支付 → 已完成；没有写入服务端。", "success");
      return;
    }

    if (scenario === "duplicate") {
      setCallbackPayload(successPayload);
      setOrder({ ...order, status: "paid" });
      setResult({ tone: "success", title: "重复通知已按幂等规则处理", detail: "第一次通知完成订单；第二次相同通知返回重复结果，不会再次履约。" });
      addLog("第一次通知已处理", "签名与金额匹配，订单进入已完成状态。", "success");
      addLog("第二次通知识别为重复", "同一渠道交易不会重复加款或重复履约。", "warning");
      return;
    }

    if (scenario === "mismatch") {
      setCallbackPayload({ ...successPayload, amount_cents: order.amountCents + 1 });
      setResult({
        tone: "failed",
        title: "回调金额校验失败",
        detail: "收到 " + ((order.amountCents + 1) / 100).toFixed(2) + " 元，订单金额为 " + formatMoney(order.amountCents) + " 元；订单保持待支付。",
      });
      addLog("支付回调被拒绝", "回调金额与订单金额相差 0.01 元；订单状态未改变。", "error");
      return;
    }

    if (scenario === "failure") {
      setCallbackPayload({
        event: "payment.failed",
        trade_no: order.tradeNo,
        provider_trade_no: order.providerTradeNo,
        reason: "模拟渠道拒绝支付",
      });
      setResult({ tone: "failed", title: "渠道返回支付失败", detail: "没有发送成功回调；订单保持待支付，可以继续测试其他结果。" });
      addLog("渠道支付失败", "模拟渠道没有发出 payment.succeeded 通知，订单仍可重试。", "warning");
      return;
    }

    setCallbackPayload(successPayload);
    setOrder({ ...order, status: "closed" });
    setResult({ tone: "failed", title: "关单后的成功回调已拒绝", detail: "订单已关闭，不再接受后到的成功通知，也不会执行履约。" });
    addLog("测试关单后迟到回调", "订单已关闭；迟到通知被拒绝，未执行履约。", "error");
  };

  const reset = () => {
    setOrder(null);
    setHistory([]);
    setCallbackPayload(null);
    setResult(null);
    setLastScenario(null);
    setFormError("");
    setCopied(false);
  };

  const copyTradeNo = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.tradeNo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const chosenChannel = channels.find((item) => item.id === (order?.channel ?? channel)) ?? channels[0];
  const canSimulate = order?.status === "pending";
  const callbackDone = Boolean(lastScenario);

  return (
    <div className="admin-page-stack payment-lab-page">
      <header className="payment-lab-hero">
        <div>
          <p className="payment-lab-kicker"><FlaskConical size={14} /> PAYMENT SANDBOX</p>
          <h2>支付测试台</h2>
          <p>用一笔隔离的模拟订单，演练支付状态、重复通知、金额校验与关单边界。</p>
        </div>
        <span className="payment-lab-hero-note"><ShieldCheck size={15} /> 纯前端沙箱 · 不发起真实交易</span>
      </header>

        <div className="payment-lab-grid">
        <section className="payment-lab-checkout" aria-labelledby="payment-test-order-title">
          <div className="payment-lab-section-heading">
            <div>
              <p className="payment-lab-overline">ORDER SETUP</p>
              <h2 id="payment-test-order-title">创建测试订单</h2>
            </div>
            <span className="payment-lab-status-dot"><i /> LOCAL ONLY</span>
          </div>

          <div className="payment-lab-product">
            <div className="payment-lab-product-icon"><WalletCards size={19} /></div>
            <div>
              <strong>AeraNexa 支付流程测试</strong>
              <span>一次性沙箱订单 · CNY</span>
            </div>
            <span className="payment-lab-product-price">{order ? "¥" + formatMoney(order.amountCents) : "TEST"}</span>
          </div>

          <form className="payment-lab-form" onSubmit={createOrder}>
            <label className="payment-lab-field">
              <span>测试金额</span>
              <div className="payment-lab-amount-input">
                <b>¥</b>
                <input
                  aria-label="测试金额"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value); setFormError(""); }}
                  disabled={Boolean(order)}
                />
                <small>CNY</small>
              </div>
              <em>支持 0.01 至 1,000,000.00 元，金额仅用于页面内模拟。</em>
            </label>

            <fieldset className="payment-lab-channel-field">
              <legend>选择模拟渠道</legend>
              <div className="payment-lab-channel-grid">
                {channels.map((item) => (
                  <button
                    className={"payment-lab-channel " + (channel === item.id ? "selected" : "")}
                    key={item.id}
                    type="button"
                    aria-pressed={channel === item.id}
                    disabled={Boolean(order)}
                    onClick={() => setChannel(item.id)}
                  >
                    <span className={"payment-lab-channel-mark " + item.id}>{item.mark}</span>
                    <span><strong>{item.name}</strong><small>{item.note}</small></span>
                    <i className="payment-lab-radio" />
                  </button>
                ))}
              </div>
            </fieldset>

            {formError ? <p className="admin-error-text" role="alert">{formError}</p> : null}
            {order ? (
              <button className="button button-secondary payment-lab-primary-action" type="button" onClick={reset}>
                <RotateCcw size={15} /> 重置并创建新订单
              </button>
            ) : (
              <button className="button button-primary payment-lab-primary-action" type="submit">
                <CreditCard size={16} /> 创建模拟订单
              </button>
            )}
          </form>

          <div className="payment-lab-safety-note">
            <LockKeyhole size={15} />
            <span>隔离说明：订单号、渠道流水和回调事件都保存在当前浏览器内存中；刷新页面后清空，不访问支付服务端、数据库或真实渠道。</span>
          </div>
        </section>

        <section className="payment-lab-trace" aria-labelledby="payment-test-flow-title">
          <div className="payment-lab-section-heading">
            <div>
              <p className="payment-lab-overline">ORDER LIFECYCLE</p>
              <h2 id="payment-test-flow-title">支付流程</h2>
            </div>
            <Terminal size={18} aria-hidden="true" />
          </div>

          <div className="payment-lab-timeline" aria-label="订单状态流程">
            <TimelineStep done={Boolean(order)} title="创建订单" detail={order ? "订单号 " + order.tradeNo : "等待生成测试订单"} />
            <TimelineStep done={Boolean(order)} title="请求支付渠道" detail={order ? chosenChannel.name + " · mock://checkout" : "选择渠道后开始模拟"} />
            <TimelineStep
              done={callbackDone}
              failed={Boolean(lastScenario && (lastScenario === "mismatch" || lastScenario === "late"))}
              title={lastScenario === "failure" ? "渠道返回支付失败" : order?.status === "pending" ? "等待支付回调" : "处理支付回调"}
              detail={lastScenario ? scenarioLabels[lastScenario] : order ? "等待选择一个测试场景" : "待支付"}
            />
            <TimelineStep done={order?.status === "paid"} failed={order?.status === "closed"} title="订单履约" detail={order?.status === "paid" ? "本地状态已完成一次履约" : "只在支付成功后执行"} last />
          </div>

          {!order ? (
            <div className="payment-lab-empty-state">
              <QrCode size={25} />
              <strong>等待创建沙箱订单</strong>
              <span>生成后会显示模拟收银台与回调测试场景。</span>
            </div>
          ) : (
            <div className="payment-lab-cashier">
              <div className="payment-lab-cashier-topline">
                <span>{chosenChannel.name}</span>
                <StatusLabel status={order.status} />
              </div>
              <div className="payment-lab-qr-frame" aria-label="不可扫描的二维码占位图">
                <QrCode size={62} strokeWidth={1.2} />
                <span>DEMO</span>
              </div>
              <strong className="payment-lab-cashier-amount">¥{formatMoney(order.amountCents)}</strong>
              <p>仅用于演示收银台布局，不是真实支付二维码。</p>
              <div className="payment-lab-trade-row">
                <span>{order.tradeNo}</span>
                <button type="button" aria-label="复制测试订单号" onClick={copyTradeNo}><Copy size={13} /></button>
                {copied ? <small>已复制</small> : null}
              </div>

              <div className="payment-lab-cashier-actions" aria-label="模拟支付测试场景">
                <button className="button button-primary" type="button" disabled={!canSimulate} onClick={() => runScenario("success")}><Check size={13} /> 支付成功</button>
                <button className="button button-secondary" type="button" disabled={!canSimulate} onClick={() => runScenario("duplicate")}><BadgeCheck size={13} /> 重复通知</button>
                <button className="button button-secondary" type="button" disabled={!canSimulate} onClick={() => runScenario("mismatch")}><CircleAlert size={13} /> 金额不符</button>
                <button className="button button-secondary" type="button" disabled={!canSimulate} onClick={() => runScenario("failure")}><X size={13} /> 支付失败</button>
                <button className="button button-secondary" type="button" disabled={!canSimulate} onClick={() => runScenario("late")}><Clock3 size={13} /> 关单后迟到</button>
              </div>
            </div>
          )}

          {result ? (
            <div className={"payment-lab-result " + result.tone} role="status" aria-live="polite">
              {result.tone === "success" ? <Check size={17} /> : <Ban size={17} />}
              <div><strong>{result.title}</strong><span>{result.detail}</span></div>
            </div>
          ) : null}

          {callbackPayload ? (
            <div className="payment-lab-callback">
              <div className="payment-lab-callback-heading"><CircleAlert size={14} /> 最近一次模拟事件 · {lastScenario ? scenarioLabels[lastScenario] : "回调"}</div>
              <pre>{JSON.stringify(callbackPayload, null, 2)}</pre>
            </div>
          ) : null}
        </section>
        </div>

      <section className="v2-block payment-lab-activity" aria-labelledby="payment-test-activity-title">
        <header className="v2-block-header">
          <h2 id="payment-test-activity-title">本次模拟记录</h2>
          <span>{history.length ? history.length + " 条事件" : "尚无事件"}</span>
        </header>
        {history.length ? (
          <ol className="payment-lab-activity-list">
            {history.map((item) => (
              <li key={item.id} className={"payment-lab-activity-item " + item.tone}>
                <span className="payment-lab-activity-time">{item.time}</span>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="payment-lab-activity-empty">创建订单后，这里会记录当前页面演练过的状态变化。</p>
        )}
      </section>

      <footer className="payment-lab-footer">
        <span><span className="payment-lab-footer-mark">A</span> 本地状态演练，不等同于服务端集成测试</span>
        <span><ShieldCheck size={13} /> 不会产生订单、扣款或账户变更</span>
      </footer>
    </div>
  );
}

function TimelineStep({ done, failed, title, detail, last = false }: { done?: boolean; failed?: boolean; title: string; detail: string; last?: boolean }) {
  const Icon = failed ? X : done ? Check : Clock3;
  return (
    <div className={["payment-lab-timeline-item", done ? "done" : "", failed ? "failed" : ""].filter(Boolean).join(" ")}>
      <span className="payment-lab-timeline-marker"><Icon size={13} /></span>
      {!last ? <span className="payment-lab-timeline-line" /> : null}
      <div className="payment-lab-timeline-copy"><strong>{title}</strong><span>{detail}</span></div>
    </div>
  );
}

function StatusLabel({ status }: { status: OrderStatus }) {
  const labels: Record<OrderStatus, string> = {
    pending: "待支付",
    paid: "已完成",
    failed: "失败",
    closed: "已关闭",
  };
  return <span className={"payment-lab-order-status " + status}>{labels[status]}</span>;
}
