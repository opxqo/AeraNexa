# AeraNexa Web

AeraNexa 是从 V2Board 用户面板逐步迁移出来的独立网络服务前端。应用使用 Next.js、React 和 TypeScript；`source/` 中的 V2Board 与 3x-ui 仅作为上游源码参考，不参与本应用构建。

## 开发

```bash
pnpm install
pnpm dev
```

默认访问 `http://localhost:3000/dashboard`。

首次运行前，请复制 `.env.example` 为 `.env.local` 并填写本地 MySQL 密码、会话密钥、各加密主密钥（SMTP / 支付 / 系统设置）和哈希 pepper。环境变量只放这些必须与数据库分离的配置；3x-ui 连接、订阅域名、佣金比例、Worker 调度等在后台 `/admin/settings`「系统设置」中调整，保存后数秒内生效。用户系统的数据库名由 `DB_NAME` 决定（不填默认为 `aeranexa`，也可以指向任意已有的库，比如托管平台自带的默认库），表结构见 [`database/schema.sql`](database/schema.sql)，`pnpm db:migrate` 会按 `DB_NAME` 自动建库建表。SMTP 主机、账号、发件人由 `/admin/mail` 配置；服务未启用时注册和找回密码会安全拒绝，不会回显验证码。

生产启动命令 `pnpm start` 会先跑一遍 [`scripts/migrate-database.mjs`](scripts/migrate-database.mjs)，再运行自定义 Node 服务入口 [`scripts/web-server.mjs`](scripts/web-server.mjs)。它在响应完成时记录状态码、耗时和 `x-request-id`；继续使用 Node 部署，不使用 Next.js `standalone`。schema.sql 按幂等方式迁移；迁移失败会中断启动。本地 `pnpm dev` 不自动迁移，首次运行先执行 `pnpm db:migrate`。

管理员可在 `/admin/logs` 查询操作审计、请求访问、运行事件和告警状态。请求访问、慢请求、应用错误、Worker、Bot、支付运行记录可分别关闭，关键操作审计始终写入 `audit_logs`。运行日志写入 `runtime_logs`，同时向服务标准输出写结构化 JSON；采集异常不阻断业务。Web 服务每小时清理超过 30 天的运行日志，多个实例用 MySQL 命名锁协调；审计日志不自动清理。请求正文、Cookie、密钥及 URL 查询参数不会进入新日志。告警状态仅在后台显示，不发送通知。

日志列表为事件显示中文解释，并保留原始事件代码。管理员可按当前时间、类别、级别、操作者、路径和请求 ID 筛选后导出 UTF-8 CSV；导出不受列表分页影响，单次最多 50,000 条，超过上限时请缩小时间范围分批导出。导出操作也会写入审计记录。

首次部署且尚未配置 SMTP 时，注册流程需要的邮箱验证码无法发出，界面上也没有入口能直接建立第一个管理员账号。为此服务启动时（见 [`src/instrumentation.ts`](src/instrumentation.ts) 与 [`src/lib/server/bootstrap-admin.ts`](src/lib/server/bootstrap-admin.ts)）会自动检测 `users` 表：一旦发现一个用户都没有，就会创建默认管理员账号 `admin@admin.com` / `admin123456`（`role = 'admin'`）。配合上面的自动迁移，一个全新环境部署完就能直接登录；表里只要出现任意用户，之后启动都会自动跳过，不会覆盖已有数据。**登录后请立即在「个人中心」修改密码**，并在 `/admin/settings` 补齐 3x-ui、SMTP 等运行时配置。

如果 `users` 表已经非空，但仍想手动创建或重置某个管理员账号，可以运行：

```bash
ADMIN_EMAIL=admin@admin.com ADMIN_PASSWORD=admin123456 pnpm db:create-admin
```

不传环境变量时同样默认 `admin@admin.com` / `admin123456`；邮箱已存在则升级为管理员并重置密码，否则新建。

支付仍以“卡密充值 → 余额支付”为正式路径。退款、回调沙箱和 CSV 对账由后台管理：部署时需额外配置 `PAYMENT_CONFIG_ENCRYPTION_KEY`（Base64 编码 32 字节）；本地 mock 回调可配置 `PAYMENT_SANDBOX_WEBHOOK_SECRET`。真实支付宝、微信等渠道尚未接入。

生产面板路由会在服务端校验用户与会话；注销会撤销当前数据库会话，旧 Cookie 无法重放。启动开发服务器后可运行用户系统 HTTP 集成测试：

```bash
pnpm test:user
```

## 边界

- Next.js 负责用户界面、路由、服务端渲染和轻量 BFF。
- 用户认证和基础账户资料已由 Next.js 服务端 API 连接 `DB_NAME` 指向的数据库（默认 `aeranexa`）；订单、支付、工单和节点编排仍属于后续后端迁移范围。
- 浏览器不直接调用 3x-ui 管理接口，也不持有 3x-ui 管理凭据。
- 用户、支付、订阅与节点均已由 AeraNexa 自己实现，旧的 V2Board `/api/v1/*` 转发已移除；仅保留 `/api/v1/client/subscribe` 兼容路径，保证迁移前分发的订阅链接继续可用。

## 节点域（3x-ui）

节点由 3x-ui 主控提供：入站在 3x-ui 创建，后台「节点管理 → 从 3x-ui 同步入站」导入，加入「权限组」并启用后，持有对应套餐的用户会被自动下发 3x-ui 客户端。**下发与对账由独立进程完成**，开发时与 `pnpm dev` 一起运行：

```bash
pnpm worker
```

> **生产部署必须把它当成第二个常驻进程，跟 `pnpm start` 一起跑，否则节点功能会静默失效**：只启动 Web 进程时页面一切正常、用户能正常购买套餐，但 3x-ui 里永远不会创建对应客户端——因为「把用户权限写回 3x-ui」这一步只有 worker 会做，Web 进程完全不碰、也不会报错。用 systemd 常驻的模板见 [`deploy/`](deploy/README.md)；「节点管理」页每个节点的「账号数」列长期为 0，就是 worker 没在跑的信号。

3x-ui 面板地址与 API Token 在后台「系统设置 → 节点」中填写（可点「测试 3x-ui 连接」验证），设计与进度见 [`docs/node-domain-design.md`](docs/node-domain-design.md)。

迁移范围和旧页面映射见 [`docs/frontend-migration.md`](docs/frontend-migration.md)。
