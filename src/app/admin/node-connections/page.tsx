import { AdminPage } from "@/components/admin-page";
import { requireAdminUser } from "@/lib/server/admin";
import { getEnabledNodeTarget, listNodeConnections } from "@/lib/server/panel/node-connections";
import { listRawInbounds } from "@/lib/server/panel/client";
import { createLabClientsAction, createLabInboundAction, saveNodeConnectionAction, testNodeClientLifecycleAction, testNodeConnectionAction } from "./actions";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

type InboundView = { id: number; tag: string; port: number; up: number; down: number; clients: Array<{ email: string; uuid: string; up: number; down: number }> };

async function inspectInbounds(id: number): Promise<{ rows: InboundView[]; error: string | null }> {
  try {
    const raw = await listRawInbounds(await getEnabledNodeTarget(id)) as Array<Record<string, unknown>>;
    return {
      error: null,
      rows: raw.map((item) => ({
        id: Number(item.id), tag: String(item.tag ?? ""), port: Number(item.port) || 0, up: Number(item.up) || 0, down: Number(item.down) || 0,
        clients: (Array.isArray(item.clientStats) ? item.clientStats as Array<Record<string, unknown>> : []).map((c) => ({
          email: String(c.email ?? ""), uuid: String(c.uuid ?? ""), up: Number(c.up) || 0, down: Number(c.down) || 0,
        })),
      })),
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "读取失败" };
  }
}

export default async function NodeConnectionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdminUser();
  const [connections, query] = await Promise.all([listNodeConnections(), searchParams]);
  const inspectId = Number(first(query.inspect));
  const inspected = Number.isSafeInteger(inspectId) && inspectId > 0 ? await inspectInbounds(inspectId) : null;
  const notice = first(query.notice).slice(0, 300);
  const error = first(query.error).slice(0, 300);
  return <AdminPage title="3x-node 联调" description="独立连接测试节点；不会加入买家节点列表、用户同步或流量结算。">
    {notice ? <p className="v2-block" role="status">{notice}</p> : null}
    {error ? <p className="v2-block" role="alert">{error}</p> : null}
    <section className="v2-block">
      <h2>新增测试节点连接</h2>
      <p>使用 3x-ui-node credentials 显示的 Token 与 TLS SHA-256 指纹。保存后默认停用；勾选启用才允许连接测试。</p>
      <form action={saveNodeConnectionAction}>
        <div className="admin-form-grid">
          <label className="v2-field"><span>名称</span><input name="name" maxLength={100} required /></label>
          <label className="v2-field"><span>HTTPS 管理地址</span><input name="baseUrl" type="url" placeholder="https://127.0.0.1:2053/" required /></label>
          <label className="v2-field"><span>证书 SHA-256 指纹</span><input name="certificateSha256" required autoComplete="off" /></label>
          <label className="v2-field"><span>Bearer Token</span><input name="token" type="password" minLength={32} required autoComplete="new-password" /></label>
        </div>
        <label className="admin-check-row"><input name="enabled" type="checkbox" /><span>启用此测试连接</span></label>
        <button className="button button-primary" type="submit">保存连接</button>
      </form>
    </section>
    {connections.map((item) => <section className="v2-block" key={item.id}>
      <h2>{item.name} <small>#{item.id} · {item.enabled ? "已启用" : "已停用"}</small></h2>
      <p>上次测试：{item.lastTestedAt ?? "未测试"}{item.lastTestError ? ` · ${item.lastTestError}` : ""}</p>
      <form action={saveNodeConnectionAction}>
        <input name="id" type="hidden" value={item.id} />
        <div className="admin-form-grid">
          <label className="v2-field"><span>名称</span><input name="name" defaultValue={item.name} maxLength={100} required /></label>
          <label className="v2-field"><span>HTTPS 管理地址</span><input name="baseUrl" type="url" defaultValue={item.baseUrl} required /></label>
          <label className="v2-field"><span>证书 SHA-256 指纹</span><input name="certificateSha256" defaultValue={item.certificateSha256} required autoComplete="off" /></label>
          <label className="v2-field"><span>新 Token（留空则保持）</span><input name="token" type="password" autoComplete="new-password" /></label>
        </div>
        <div className="node-lab-save">
          <label className="admin-check-row"><input name="enabled" type="checkbox" defaultChecked={item.enabled} /><span>启用此测试连接</span></label>
          <button className="button button-primary" type="submit">保存修改</button>
        </div>
      </form>
      <div className="node-lab-group">
        <h3>连通性测试</h3>
        <form action={testNodeConnectionAction}><input name="id" type="hidden" value={item.id} /><button className="button button-secondary" type="submit" disabled={!item.enabled}>测试连接与入站读取</button></form>
        <form action={testNodeClientLifecycleAction}><input name="id" type="hidden" value={item.id} /><button className="button button-secondary" type="submit" disabled={!item.enabled}>测试客户端完整生命周期</button></form>
      </div>
      <form action={createLabInboundAction} className="node-lab-group">
        <h3>创建测试入站（无加密 VLESS/TCP）</h3>
        <input name="id" type="hidden" value={item.id} />
        <label className="v2-field"><span>入站端口（容器内）</span><input name="port" type="number" min={1024} max={65535} defaultValue={8443} required /></label>
        <button className="button button-secondary" type="submit" disabled={!item.enabled}>创建测试 VLESS 入站</button>
      </form>
      <form action={createLabClientsAction} className="node-lab-group">
        <h3>创建测试客户端（用于区分单用户流量）</h3>
        <input name="id" type="hidden" value={item.id} />
        <label className="v2-field"><span>目标入站编号</span><input name="inboundId" type="number" min={1} defaultValue={1} required /></label>
        <label className="v2-field"><span>数量（1–5）</span><input name="count" type="number" min={1} max={5} defaultValue={2} required /></label>
        <button className="button button-secondary" type="submit" disabled={!item.enabled}>创建测试客户端</button>
      </form>
      <div className="node-lab-group">
        <h3>入站与客户端流量</h3>
        <a className="button button-secondary" href={`/admin/node-connections?inspect=${item.id}`}>读取并显示</a>
      </div>
      {inspected && inspectId === item.id ? <div className="node-lab-traffic">
        {inspected.error ? <p role="alert">{inspected.error}</p> : null}
        {inspected.rows.map((row) => <div key={row.id}>
          <p><strong>入站 #{row.id}</strong> · {row.tag} · 端口 {row.port} · 上行 {row.up} / 下行 {row.down} 字节</p>
          <ul>{row.clients.map((c) => <li key={c.email}>{c.email} · {c.uuid} · 上行 {c.up} / 下行 {c.down}</li>)}</ul>
        </div>)}
      </div> : null}
      <p>客户端测试只使用随机生成的 an-test 身份，结束后删除。请仅对隔离节点运行。</p>
    </section>)}
  </AdminPage>;
}
