import { notFound } from "next/navigation";
import { adminSectionKeys, type AdminSectionKey } from "@/lib/admin-navigation";
import { AdminEditor } from "@/components/admin-editor";
import { AdminListPager } from "@/components/admin-pagination";
import { getAdminEditorData } from "@/lib/server/admin-editor";

const DESCRIPTIONS: Record<string, string> = {
  users: "管理账户信息、身份标签、订阅额度与启用状态。",
  plans: "创建和编辑可售套餐，配置各付款周期的价格。",
  orders: "处理待支付订单；已支付订单必须经支付回调履约，后台不会伪造成功状态。",
  coupons: "创建折扣码并限制适用范围；已核销次数以核销记录为准，不可手工改写。",
  payments: "创建和编辑支付渠道的基础配置与手续费规则。",
  refunds: "查看管理员余额退款账本；退款不会自动撤销已开通的订阅权益。",
  reconciliation: "导入固定模板的渠道账单，核对交易并人工处理差异。",
  "recharge-cards": "批量生成余额充值卡；数据库仅保存哈希与尾号，明文仅在生成时导出。",
  nodes: "创建和编辑 3x-ui 节点映射与展示状态。",
  tickets: "调整工单优先级、处理状态，并直接回复用户。",
  notices: "撰写门户公告，设置标签、封面与定时发布；未到时间的公告不会出现在前台。",
  knowledge: "维护文档中心的分类与正文，正文按 HTML 白名单过滤后入库。",
  traffic: "查看节点上报的流量。数据由节点通过上报接口写入，后台只读、不提供手工录入。",
  mail: "配置 SMTP 邮件验证码服务；敏感密码以密文保存，服务可由管理员随时启停。",
  settings: "运行时可调整的配置，保存后数秒内生效（worker 无需重启）。数据库连接、会话密钥与加密主密钥仍只在服务器环境变量中配置。",
};

/** 只读板块：数据来自外部系统，后台不提供写操作。 */
const READ_ONLY_SECTIONS = new Set(["traffic"]);

const TITLES: Record<string, string> = {
  users: "用户管理",
  plans: "套餐管理",
  orders: "订单管理",
  coupons: "惠券管理",
  payments: "支付管理",
  refunds: "退款管理",
  reconciliation: "对账管理",
  "recharge-cards": "卡密管理",
  nodes: "节点管理",
  tickets: "工单管理",
  notices: "公告管理",
  knowledge: "文档管理",
  traffic: "流量统计",
  mail: "邮件服务",
  settings: "系统设置",
};

export default async function AdminSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  if (!adminSectionKeys.has(section as AdminSectionKey)) notFound();

  const resolvedSearch = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = resolvedSearch[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const q = readParam("q") ?? "";
  const page = Number(readParam("page") ?? "1");

  const data = await getAdminEditorData(section as AdminSectionKey, { q, page: Number.isFinite(page) ? page : 1 });

  return (
    <div className="admin-page-stack">
      <section className="admin-page-heading">
        <div>
          <p className="admin-kicker">AeraNexa 管理控制台</p>
          <h1>{TITLES[data.section]}</h1>
          <p>{DESCRIPTIONS[data.section]}</p>
        </div>
        {READ_ONLY_SECTIONS.has(data.section)
          ? <span className="v2-badge">只读</span>
          : <span className="v2-badge badge-success">可编辑</span>}
      </section>
      <AdminEditor data={data} q={q} />
      {data.section !== "recharge-cards" && data.section !== "mail" && data.section !== "settings" ? <AdminListPager
        section={data.section}
        q={q}
        page={data.page.page}
        pageSize={data.page.pageSize}
        total={data.page.total}
      /> : null}
      <p className="admin-source-note">
        数据源：本地 <span className="mono">aeranexa</span> 数据库。所有写操作都会写入 <span className="mono">audit_logs</span>。
      </p>
    </div>
  );
}
