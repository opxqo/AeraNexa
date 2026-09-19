import { notFound } from "next/navigation";
import { adminSectionKeys, type AdminSectionKey } from "@/lib/admin-navigation";
import { AdminEditor } from "@/components/admin-editor";
import { getAdminEditorData } from "@/lib/server/admin-editor";

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!adminSectionKeys.has(section as AdminSectionKey)) notFound();

  const data = await getAdminEditorData(section as AdminSectionKey);
  const descriptions = {
    users: "管理账户信息、身份标签与启用状态。",
    plans: "创建和编辑可售套餐。",
    orders: "安全处理待支付订单，不绕过支付履约。",
    payments: "创建和编辑支付渠道的基础配置。",
    nodes: "创建和编辑 3x-ui 节点映射。",
    tickets: "调整工单优先级和处理状态。",
  } as const;
  const titles = { users: "用户管理", plans: "套餐管理", orders: "订单管理", payments: "支付管理", nodes: "节点管理", tickets: "工单管理" } as const;
  return (
    <div className="admin-page-stack">
      <section className="admin-page-heading">
        <div>
          <p className="admin-kicker">AeraNexa 管理控制台</p>
          <h1>{titles[data.section]}</h1>
          <p>{descriptions[data.section]}</p>
        </div>
        <span className="v2-badge badge-success">可编辑</span>
      </section>
      <AdminEditor data={data} />
      <p className="admin-source-note">数据源：本地 <span className="mono">aeranexa</span> 数据库。</p>
    </div>
  );
}
