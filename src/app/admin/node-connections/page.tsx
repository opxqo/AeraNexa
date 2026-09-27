import Link from "next/link";
import { AdminPage } from "@/components/admin-page";
import { requireAdminUser } from "@/lib/server/admin";
import { getEnabledNodeTarget, listNodeConnections, type NodeConnectionView } from "@/lib/server/panel/node-connections";
import { listRawInbounds } from "@/lib/server/panel/client";
import { listEnrollmentCodes, type EnrollmentCodeView } from "@/lib/server/panel/node-enrollment";
import { realityClientInfo, type RealityClientInfo } from "@/lib/server/panel/reality";
import { EnrollmentForm } from "./enrollment-form";
import { createLabClientsAction, createLabInboundAction, saveNodeConnectionAction, testNodeClientLifecycleAction, testNodeConnectionAction } from "./actions";
import styles from "./node-connections.module.css";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function validId(value: string): number | null {
  const id = Number(value);
  return value && Number.isSafeInteger(id) && id > 0 ? id : null;
}
function nodeHref(id: number, inspect = false): string {
  return `/admin/node-connections?node=${id}${inspect ? `&inspect=${id}` : ""}#node-detail`;
}
function addHref(mode: "auto" | "manual" | null, nodeId?: number): string {
  const params = new URLSearchParams();
  if (nodeId) params.set("node", String(nodeId));
  if (mode) params.set("add", mode);
  return `/admin/node-connections${params.size ? `?${params}` : ""}${mode ? "#add-node" : nodeId ? "#node-detail" : ""}`;
}
function displayTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "未测试";
}
function testLabel(item: NodeConnectionView): string {
  return !item.lastTestedAt ? "未测试" : item.lastTestError ? "上次失败" : "上次通过";
}
function enrollmentLabel(item: EnrollmentCodeView): string {
  if (item.connectionId) return `已登记为连接 #${item.connectionId}`;
  if (item.usedAt) return "已使用，登记未完成";
  return new Date(item.expiresAt).getTime() <= Date.now() ? "已过期" : "待使用";
}

type InboundView = { id: number; tag: string; port: number; up: number; down: number; reality: RealityClientInfo | null; clients: Array<{ email: string; uuid: string; up: number; down: number }> };

async function inspectInbounds(id: number): Promise<{ rows: InboundView[]; error: string | null }> {
  try {
    const raw = await listRawInbounds(await getEnabledNodeTarget(id)) as Array<Record<string, unknown>>;
    return {
      error: null,
      rows: raw.map((item) => ({
        id: Number(item.id), tag: String(item.tag ?? ""), port: Number(item.port) || 0, up: Number(item.up) || 0, down: Number(item.down) || 0, reality: realityClientInfo(item),
        clients: (Array.isArray(item.clientStats) ? item.clientStats as Array<Record<string, unknown>> : []).map((c) => ({
          email: String(c.email ?? ""), uuid: String(c.uuid ?? ""), up: Number(c.up) || 0, down: Number(c.down) || 0,
        })),
      })),
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "读取失败" };
  }
}

function ManualConnectionForm() {
  return <form action={saveNodeConnectionAction} className={styles.form}>
    <p className={styles.helper}>使用节点本机显示的 Token 与 TLS SHA-256 指纹。保存后默认停用，确认连接后再启用。</p>
    <div className={styles.formGrid}>
      <label className="v2-field"><span>名称</span><input name="name" maxLength={100} required /></label>
      <label className="v2-field"><span>HTTPS 管理地址</span><input name="baseUrl" type="url" placeholder="https://127.0.0.1:2053/" required /></label>
      <label className="v2-field"><span>证书 SHA-256 指纹</span><input name="certificateSha256" required autoComplete="off" /></label>
      <label className="v2-field"><span>Bearer Token</span><input name="token" type="password" minLength={32} required autoComplete="new-password" /></label>
    </div>
    <div className={styles.formFooter}>
      <label className="admin-check-row"><input name="enabled" type="checkbox" /><span>保存后启用此测试连接</span></label>
      <button className="button button-primary" type="submit">保存连接</button>
    </div>
  </form>;
}

export default async function NodeConnectionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdminUser();
  const [connectionResult, enrollmentResult, query] = await Promise.all([
    listNodeConnections().then((rows) => ({ rows, failed: false }), () => ({ rows: [] as NodeConnectionView[], failed: true })),
    listEnrollmentCodes().then((rows) => ({ rows, failed: false }), () => ({ rows: [] as EnrollmentCodeView[], failed: true })),
    searchParams,
  ]);
  const connections = connectionResult.rows;
  const enrollments = enrollmentResult.rows;
  const inspectId = validId(first(query.inspect));
  const requestedId = validId(first(query.node)) ?? inspectId;
  const selected = connections.find((item) => item.id === requestedId) ?? connections[0] ?? null;
  const inspected = selected && inspectId === selected.id ? await inspectInbounds(selected.id) : null;
  const addMode = first(query.add);
  const showingAdd = addMode === "auto" || addMode === "manual";
  const notice = first(query.notice).slice(0, 300);
  const error = first(query.error).slice(0, 300);

  return <AdminPage title="3x-node 联调" description="独立连接测试节点；不会加入买家节点列表、用户同步或流量结算。">
    {notice ? <p className={`${styles.message} ${styles.notice}`} role="status">{notice}</p> : null}
    {error ? <p className={`${styles.message} ${styles.error}`} role="alert">{error}</p> : null}

    <section className={styles.panel} aria-labelledby="connections-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="connections-title">测试节点</h2>
          <p>{connectionResult.failed ? "连接列表读取失败" : `${connections.length} 个独立连接 · 选择节点后查看测试工具`}</p>
        </div>
        <Link className="button button-primary" href={addHref(showingAdd ? null : "auto", selected?.id)}>
          {showingAdd ? "收起添加面板" : "添加测试节点"}
        </Link>
      </div>

      {showingAdd ? <div className={styles.addPanel} id="add-node">
        <nav className={styles.modeNav} aria-label="添加节点方式">
          <Link href={addHref("auto", selected?.id)} aria-current={addMode === "auto" ? "page" : undefined} className={addMode === "auto" ? styles.modeActive : undefined}>一键安装并注册</Link>
          <Link href={addHref("manual", selected?.id)} aria-current={addMode === "manual" ? "page" : undefined} className={addMode === "manual" ? styles.modeActive : undefined}>手动添加连接</Link>
        </nav>
        {addMode === "auto" ? <>
          <EnrollmentForm />
          <div className={styles.history}>
            <h3>最近的注册码</h3>
            {enrollmentResult.failed ? <p className={`${styles.message} ${styles.error}`} role="alert">注册码记录读取失败，请稍后重试。</p> : enrollments.length ? <ul>{enrollments.map((item) => <li key={item.id}>
              <div><strong>{item.name}</strong><span>{enrollmentLabel(item)}</span></div>
              <small>{item.baseUrl} · {item.connectionId || item.usedAt ? "使用记录" : `有效至 ${displayTime(item.expiresAt)}`}</small>
              {item.lastError ? <p role="alert">{item.lastError}</p> : null}
            </li>)}</ul> : <p className={styles.helper}>还没有生成过注册码。</p>}
          </div>
        </> : <ManualConnectionForm />}
      </div> : null}

      {connectionResult.failed ? <div className={styles.emptyState} role="alert"><strong>节点列表读取失败</strong><p>暂时无法确认已有连接，请刷新页面后重试。</p></div> : connections.length ? <ul className={styles.nodeList} aria-label="测试节点连接">
        {connections.map((item) => <li key={item.id}><Link href={nodeHref(item.id)} aria-current={selected?.id === item.id ? "page" : undefined}
          className={`${styles.nodeRow} ${selected?.id === item.id ? styles.nodeRowSelected : ""}`}>
          <span className={styles.nodeIdentity}><strong>{item.name}</strong><small>#{item.id} · {item.baseUrl}</small></span>
          <span className={`${styles.badge} ${item.enabled ? styles.enabled : styles.muted}`}>{item.enabled ? "已启用" : "已停用"}</span>
          <span className={`${styles.testState} ${item.lastTestError ? styles.testFailed : ""}`}>{testLabel(item)}<small>{displayTime(item.lastTestedAt)}</small></span>
          <span className={styles.rowArrow} aria-hidden="true">›</span>
        </Link></li>)}
      </ul> : <div className={styles.emptyState}>
        <strong>还没有测试节点</strong>
        <p>先添加一个独立连接，再进行连通性、入站和流量测试。</p>
        {!showingAdd ? <Link className="button button-secondary" href={addHref("auto")}>添加第一个节点</Link> : null}
      </div>}
    </section>

    {selected ? <section className={styles.detail} id="node-detail" aria-labelledby="node-detail-title">
      <div className={styles.detailHead}>
        <div>
          <span className={styles.eyebrow}>当前节点 · #{selected.id}</span>
          <h2 id="node-detail-title">{selected.name}</h2>
          <p className={styles.address}>{selected.baseUrl}</p>
        </div>
        <span className={`${styles.badge} ${selected.enabled ? styles.enabled : styles.muted}`}>{selected.enabled ? "已启用" : "已停用"}</span>
      </div>

      <div className={styles.summary}>
        <div><span>连接状态</span><strong>{selected.enabled ? "允许测试" : "已停用测试"}</strong></div>
        <div><span>最近测试</span><strong className={selected.lastTestError ? styles.testFailed : undefined}>{testLabel(selected)}</strong><small>{displayTime(selected.lastTestedAt)}</small></div>
        <div><span>证书指纹</span><code title={selected.certificateSha256}>{selected.certificateSha256}</code></div>
      </div>
      {selected.lastTestError ? <p className={`${styles.message} ${styles.error}`} role="alert">上次测试错误：{selected.lastTestError}</p> : null}

      <div className={styles.detailGrid}>
        <section className={styles.detailCard} aria-labelledby="checks-title">
          <div className={styles.cardHead}><div><h3 id="checks-title">连接测试</h3><p>先验证管理接口，再测试随机客户端的完整生命周期。</p></div></div>
          <div className={styles.actions}>
            <form action={testNodeConnectionAction}><input name="id" type="hidden" value={selected.id} /><button className="button button-secondary" type="submit" disabled={!selected.enabled}>测试连接与入站读取</button></form>
            <form action={testNodeClientLifecycleAction}><input name="id" type="hidden" value={selected.id} /><button className="button button-secondary" type="submit" disabled={!selected.enabled}>测试客户端完整生命周期</button></form>
          </div>
          <p className={styles.helper}>客户端测试使用随机 an-test 身份，结束后尝试删除。仅对隔离节点运行。</p>
        </section>

        <section className={styles.detailCard} aria-labelledby="traffic-title">
          <div className={styles.cardHead}><div><h3 id="traffic-title">入站与客户端流量</h3><p>读取当前节点的逐入站、逐客户端计数。</p></div>
            {selected.enabled ? <Link className="button button-secondary" href={nodeHref(selected.id, true)}>读取流量</Link> : <span className="button button-secondary" aria-disabled="true">读取流量</span>}
          </div>
          {!selected.enabled ? <p className={styles.helper}>启用测试连接后可读取。</p> : !inspected ? <p className={styles.helper}>尚未读取本次页面的流量数据。</p> : inspected.error ? <p className={`${styles.message} ${styles.error}`} role="alert">{inspected.error}</p> : inspected.rows.length ? <div className={styles.trafficRows}>
            {inspected.rows.map((row) => <div className={styles.trafficRow} key={row.id}>
              <div className={styles.trafficHead}><strong>入站 #{row.id} · {row.tag}</strong><span>端口 {row.port} · 上行 {row.up} / 下行 {row.down} 字节</span></div>
              {row.reality ? <p>REALITY · 公钥 <code>{row.reality.publicKey}</code> · SNI {row.reality.serverName} · shortId <code>{row.reality.shortId}</code> · 流控 xtls-rprx-vision</p> : null}
              {row.clients.length ? <ul>{row.clients.map((client) => <li key={client.email}><span>{client.email} · <code>{client.uuid}</code></span><span>上行 {client.up} / 下行 {client.down}</span></li>)}</ul> : <p>暂无客户端计数。</p>}
            </div>)}
          </div> : <p className={styles.helper}>节点尚无入站。</p>}
        </section>
      </div>

      <details className={styles.disclosure}>
        <summary><span><strong>准备测试数据</strong><small>创建 VLESS 测试入站和随机客户端</small></span></summary>
        <div className={styles.disclosureBody}>
          <form action={createLabInboundAction} className={styles.form}>
            <h3>创建测试入站（VLESS/TCP）</h3>
            <input name="id" type="hidden" value={selected.id} />
            <div className={styles.formGrid}>
              <label className="v2-field"><span>入站端口（容器内）</span><input name="port" type="number" min={1024} max={65535} defaultValue={8443} required /></label>
              <label className="v2-field"><span>安全层</span><select name="security" defaultValue="none"><option value="none">无加密</option><option value="reality">REALITY</option></select></label>
              <label className="v2-field"><span>REALITY 伪装目标（仅 REALITY）</span><input name="realityTarget" defaultValue="dl.google.com:443" /></label>
            </div>
            <button className="button button-secondary" type="submit" disabled={!selected.enabled}>创建测试 VLESS 入站</button>
          </form>
          <form action={createLabClientsAction} className={styles.form}>
            <h3>创建测试客户端</h3>
            <input name="id" type="hidden" value={selected.id} />
            <div className={styles.formGrid}>
              <label className="v2-field"><span>目标入站编号</span><input name="inboundId" type="number" min={1} defaultValue={1} required /></label>
              <label className="v2-field"><span>数量（1–5）</span><input name="count" type="number" min={1} max={5} defaultValue={2} required /></label>
            </div>
            <button className="button button-secondary" type="submit" disabled={!selected.enabled}>创建测试客户端</button>
          </form>
        </div>
      </details>

      <details className={styles.disclosure}>
        <summary><span><strong>连接配置</strong><small>名称、管理地址、证书指纹与 Token</small></span></summary>
        <div className={styles.disclosureBody}>
          <form action={saveNodeConnectionAction} className={styles.form}>
            <input name="id" type="hidden" value={selected.id} />
            <div className={styles.formGrid}>
              <label className="v2-field"><span>名称</span><input name="name" defaultValue={selected.name} maxLength={100} required /></label>
              <label className="v2-field"><span>HTTPS 管理地址</span><input name="baseUrl" type="url" defaultValue={selected.baseUrl} required /></label>
              <label className="v2-field"><span>证书 SHA-256 指纹</span><input name="certificateSha256" defaultValue={selected.certificateSha256} required autoComplete="off" /></label>
              <label className="v2-field"><span>新 Token（留空则保持）</span><input name="token" type="password" autoComplete="new-password" /></label>
            </div>
            <div className={styles.formFooter}>
              <label className="admin-check-row"><input name="enabled" type="checkbox" defaultChecked={selected.enabled} /><span>启用此测试连接</span></label>
              <button className="button button-primary" type="submit">保存修改</button>
            </div>
          </form>
        </div>
      </details>
    </section> : null}
  </AdminPage>;
}
