import { AdminPage } from "@/components/admin-page";
import { requireAdminUser } from "@/lib/server/admin";
import { listNodeConnections } from "@/lib/server/panel/node-connections";
import { saveNodeConnectionAction, testNodeClientLifecycleAction, testNodeConnectionAction } from "./actions";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export default async function NodeConnectionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdminUser();
  const [connections, query] = await Promise.all([listNodeConnections(), searchParams]);
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
        <label className="admin-check-row"><input name="enabled" type="checkbox" defaultChecked={item.enabled} /><span>启用此测试连接</span></label>
        <button className="button button-primary" type="submit">保存修改</button>
      </form>
      <div className="admin-form-grid">
        <form action={testNodeConnectionAction}><input name="id" type="hidden" value={item.id} /><button className="button button-secondary" type="submit" disabled={!item.enabled}>测试连接与入站读取</button></form>
        <form action={testNodeClientLifecycleAction}><input name="id" type="hidden" value={item.id} /><button className="button button-secondary" type="submit" disabled={!item.enabled}>测试客户端完整生命周期</button></form>
      </div>
      <p>客户端测试只使用随机生成的 an-test 身份，结束后删除。请仅对隔离节点运行。</p>
    </section>)}
  </AdminPage>;
}
