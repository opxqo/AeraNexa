"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, CreditCard, ExternalLink, PlugZap, RefreshCw, Satellite } from "lucide-react";
import type { EpayMerchantCheck, EpayTestOverview, EpayTestStatus } from "@/lib/server/payments/epay-test";
import { checkEpayMerchantAction, createEpayTestPaymentAction, getEpayTestStatusAction } from "./actions";

const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT_MS = 10 * 60_000;

function yuan(cents: number | null) {
  return cents === null ? "—" : `¥${(cents / 100).toFixed(2)}`;
}

function isComplete(status: EpayTestStatus) {
  return Boolean(status.gateway?.paid && status.notifications.some((item) => item.verified));
}

function Badge({ tone, children }: { tone: "success" | "warning" | "danger"; children: React.ReactNode }) {
  return <span className={`v2-badge badge-${tone}`}>{children}</span>;
}

/** 易支付真实联调：用真实网关跑一遍 下单 → 付款 → 渠道查询 → 异步通知，不产生站内订单。 */
export function EpayLiveTest({ overview, initialStatus }: { overview: EpayTestOverview; initialStatus: EpayTestStatus | null }) {
  const usable = overview.channels.filter((channel) => channel.enabled && channel.hasKey && channel.notifyDomain);
  const [methodId, setMethodId] = useState<number>(usable[0]?.id ?? overview.channels[0]?.id ?? 0);
  const [amount, setAmount] = useState("1.00");
  const [merchant, setMerchant] = useState<EpayMerchantCheck | null>(null);
  const [payment, setPayment] = useState<{ outTradeNo: string; payUrl: string; notifyUrl: string } | null>(
    initialStatus ? { outTradeNo: initialStatus.outTradeNo, payUrl: "", notifyUrl: "" } : null,
  );
  const [status, setStatus] = useState<EpayTestStatus | null>(initialStatus);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const pollStartedAt = useRef<number | null>(null);
  // 从收银台跳回（?epay=ET…）时，异步通知可能还在路上，继续轮询一段时间。
  const [polling, setPolling] = useState(() => Boolean(initialStatus && !isComplete(initialStatus)));

  const selected = overview.channels.find((channel) => channel.id === methodId) ?? null;
  const done = status ? isComplete(status) : false;

  const refresh = useCallback(async (outTradeNo: string) => {
    const result = await getEpayTestStatusAction(outTradeNo);
    if (result.ok) setStatus(result.data);
    else setError(result.error);
    return result.ok ? result.data : null;
  }, []);

  useEffect(() => {
    const outTradeNo = payment?.outTradeNo;
    if (!outTradeNo || !polling) return;
    const timer = window.setInterval(async () => {
      pollStartedAt.current ??= Date.now();
      const next = await refresh(outTradeNo);
      const timedOut = Date.now() - (pollStartedAt.current ?? 0) > POLL_LIMIT_MS;
      if (timedOut || (next && isComplete(next))) setPolling(false);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [payment?.outTradeNo, polling, refresh]);

  const checkMerchant = () => {
    setError("");
    setMerchant(null);
    startTransition(async () => {
      const result = await checkEpayMerchantAction(methodId);
      if (result.ok) setMerchant(result.data);
      else setError(result.error);
    });
  };

  const createPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(amount.trim());
    if (!match) {
      setError("金额格式不正确，最多两位小数");
      return;
    }
    const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    startTransition(async () => {
      const result = await createEpayTestPaymentAction(methodId, cents);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPayment(result.data);
      setStatus(null);
      window.open(result.data.payUrl, "_blank", "noopener");
      pollStartedAt.current = Date.now();
      setPolling(true);
      await refresh(result.data.outTradeNo);
    });
  };

  const reset = () => {
    setPayment(null);
    setStatus(null);
    setPolling(false);
    setError("");
  };

  return (
    <div className="admin-page-stack epay-live">
      <section className="v2-block">
        <header className="v2-block-header">
          <div>
            <h2><Satellite size={17} /> 易支付真实联调</h2>
            <p className="admin-audit-note">走真实网关与真实回调地址，会产生一笔真实付款（进入你的商户余额）；测试单以 ET 开头，不建订单、不入账、不履约。</p>
          </div>
        </header>

        <dl className="epay-live-config">
          <div><dt>网关地址</dt><dd className="mono">{overview.gatewayUrl || "—"}</dd></div>
          <div><dt>商户号</dt><dd className="mono">{overview.pid || "—"}</dd></div>
          <div><dt>下单地址</dt><dd className="mono">{overview.gatewayUrl ? `${overview.gatewayUrl.replace(/\/+$/, "")}/submit.php` : "—"}</dd></div>
        </dl>
        {overview.configError ? (
          <p className="admin-error-text"><CircleAlert size={14} /> {overview.configError}。<Link href="/admin/settings">去系统设置</Link></p>
        ) : null}

        {overview.channels.length ? (
          <div className="table-wrap">
            <table className="v2-table">
              <thead><tr><th>测试</th><th>渠道</th><th>Provider</th><th>状态</th><th>商户密钥</th><th>回调域名</th></tr></thead>
              <tbody>
                {overview.channels.map((channel) => (
                  <tr key={channel.id}>
                    <td><input type="radio" name="epay-channel" aria-label={`选择 ${channel.name}`} checked={methodId === channel.id} disabled={Boolean(payment)} onChange={() => { setMethodId(channel.id); setMerchant(null); }} /></td>
                    <td>{channel.name}</td>
                    <td className="mono">{channel.provider}</td>
                    <td>{channel.enabled ? <Badge tone="success">启用</Badge> : <Badge tone="warning">停用</Badge>}</td>
                    <td>{channel.hasKey ? <Badge tone="success">已配置</Badge> : <Badge tone="danger">缺失</Badge>}</td>
                    <td>{channel.notifyDomain ? <span className="mono">{channel.notifyDomain}</span> : <Badge tone="danger">缺失</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-audit-note">还没有易支付渠道。请先到 <Link href="/admin/payments">支付渠道</Link> 新建 provider 为 <span className="mono">epay_alipay</span> 或 <span className="mono">epay_wxpay</span> 的渠道。</p>
        )}

        {selected ? (
          <div className="epay-live-steps">
            <div className="epay-live-step">
              <strong>① 商户连通性</strong>
              <span>调用 api.php?act=query 只读查询商户信息，校验网关、商户号与密钥是否匹配，不产生交易。</span>
              <button type="button" className="button button-secondary" disabled={pending || Boolean(overview.configError)} onClick={checkMerchant}>
                <PlugZap size={15} /> 测试连通性
              </button>
              {merchant ? (
                <p className="epay-live-result">
                  {merchant.active ? <Badge tone="success">商户正常</Badge> : <Badge tone="danger">商户未激活</Badge>}
                  <span>余额 ¥{merchant.balance} · 今日订单 {merchant.ordersToday} · 累计 {merchant.orders}</span>
                </p>
              ) : null}
            </div>

            <form className="epay-live-step" onSubmit={createPayment}>
              <strong>② 发起测试支付</strong>
              <span>生成签名后的 submit.php 地址并在新标签页打开收银台，付款后回调会发到本站。</span>
              <div className="epay-live-inline">
                <label className="v2-field">
                  <span>金额（元）</span>
                  <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={Boolean(payment)} aria-label="测试金额" />
                </label>
                {payment ? (
                  <button type="button" className="button button-secondary" onClick={reset}>新建测试单</button>
                ) : (
                  <button type="submit" className="button button-primary" disabled={pending || Boolean(overview.configError)}>
                    <CreditCard size={15} /> 发起并打开收银台
                  </button>
                )}
              </div>
              {payment?.payUrl ? (
                <p className="epay-live-result">
                  <span className="mono">{payment.outTradeNo}</span>
                  <a className="admin-action-button" href={payment.payUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> 重新打开收银台</a>
                </p>
              ) : null}
            </form>

            <div className="epay-live-step">
              <strong>③ 支付结果</strong>
              <span>同时核对两条链路：渠道侧 act=order 查询，以及本站是否收到并验签通过异步通知。{polling ? "每 5 秒自动刷新中…" : ""}</span>
              {payment ? (
                <>
                  <button type="button" className="button button-secondary" disabled={pending} onClick={() => startTransition(async () => { await refresh(payment.outTradeNo); })}>
                    <RefreshCw size={15} /> 立即查询
                  </button>
                  {status ? (
                    <ul className="epay-live-checks">
                      <li>
                        <b>渠道订单</b>
                        {status.gateway
                          ? status.gateway.paid
                            ? <><Badge tone="success">已支付</Badge><span>{yuan(status.gateway.amountCents)} · 渠道单号 {status.gateway.tradeNo} · {status.gateway.paidAt}</span></>
                            : <><Badge tone="warning">未支付</Badge><span>{yuan(status.gateway.amountCents)}</span></>
                          : <><Badge tone="warning">未查到</Badge><span>{status.gatewayError}（尚未打开收银台时属正常）</span></>}
                      </li>
                      <li>
                        <b>异步通知</b>
                        {status.notifications.length ? status.notifications.map((item, index) => (
                          <span key={index} className="epay-live-notice">
                            {item.verified ? <Badge tone="success">验签通过</Badge> : <Badge tone="danger">验签失败</Badge>}
                            {item.amountMatches ? <Badge tone="success">金额一致</Badge> : <Badge tone="danger">金额不符</Badge>}
                            <span>{item.source === "notify" ? "服务器通知" : "页面跳转"} · {item.receivedAt}</span>
                          </span>
                        )) : <><Badge tone="warning">未收到</Badge><span>若渠道已支付但迟迟收不到，检查回调域名能否被公网访问：{payment.notifyUrl || "/api/payments/epay/notify"}</span></>}
                      </li>
                      {done ? <li><b>结论</b><Badge tone="success">支付接口工作正常</Badge></li> : null}
                    </ul>
                  ) : null}
                </>
              ) : <p className="admin-audit-note">发起测试支付后在这里查看结果。</p>}
            </div>
          </div>
        ) : null}

        {error ? <p className="admin-error-text" role="alert"><CircleAlert size={14} /> {error}</p> : null}
      </section>
    </div>
  );
}
