# AeraNexa Web

AeraNexa 是从 V2Board 用户面板逐步迁移出来的独立网络服务前端。应用使用 Next.js、React 和 TypeScript；`source/` 中的 V2Board 与 3x-ui 仅作为上游源码参考，不参与本应用构建。

## 开发

```bash
pnpm install
pnpm dev
```

默认访问 `http://localhost:3000/dashboard`。

`/demo/*` 提供一套完整的静态业务 Demo，覆盖认证、仪表盘、套餐购买、订单、节点、邀请、文档、工单、流量和个人中心。生产路由保留在根路径下，当前已接入第一阶段用户系统：注册、登录、登出、当前用户、个人资料、偏好设置和修改密码。

首次运行前，请复制 `.env.example` 为 `.env.local` 并填写本地 MySQL 密码与会话密钥。用户系统使用新建的 `aeranexa` 数据库，表结构见 [`database/schema.sql`](database/schema.sql)。SMTP 尚未配置时，注册使用本地过渡验证码 `666666`；找回密码仍需后续接入邮件服务。

生产面板路由会在服务端校验用户与会话；注销会撤销当前数据库会话，旧 Cookie 无法重放。启动开发服务器后可运行用户系统 HTTP 集成测试：

```bash
pnpm test:user
```

## 边界

- Next.js 负责用户界面、路由、服务端渲染和轻量 BFF。
- 用户认证和基础账户资料已由 Next.js 服务端 API 连接 `aeranexa` 数据库；订单、支付、工单和节点编排仍属于后续后端迁移范围。
- 浏览器不直接调用 3x-ui 管理接口，也不持有 3x-ui 管理凭据。
- 迁移期间可通过服务端适配层兼容 V2Board API，之后逐个切换到新后端。

迁移范围和旧页面映射见 [`docs/frontend-migration.md`](docs/frontend-migration.md)。
