# V2Board 前端迁移清单

## 第一阶段目标

将 V2Board 用户面板从 Laravel/Blade 和已编译的 Umi 资源中独立出来，保留用户熟悉的页面语义和 URL，建立 Next.js 前端及统一 API 边界。当前先迁移用户认证与基础账户资料，支付、工单和节点业务继续按模块拆分。

## 用户系统第一阶段

- 数据库：本地 MySQL 的新库 `aeranexa`，初始化脚本为 [`database/schema.sql`](../database/schema.sql)。
- 服务端 API：`/api/auth/login`、`/api/auth/register`、`/api/auth/logout`、`/api/auth/me`。
- 账户 API：`/api/user/info`、`/api/user/update`、`/api/user/changePassword`、`/api/user/resetSecurity`。
- 会话：服务端签发 HttpOnly、SameSite=Lax Cookie，并在 `auth_sessions` 表记录可撤销会话；浏览器不保存 V2Board `auth_data` 或数据库密码。
- 路由保护：生产面板由 `proxy.ts` 快速验证会话签名，再由服务端布局确认用户和数据库会话仍有效；`/demo/*` 不经过生产门禁。
- 账户安全：注销撤销当前会话；修改密码撤销该账户全部旧会话，并拒绝继续使用原密码。
- 订阅资料：`/api/user/getSubscribe` 返回 `aeranexa.users.subscription_token` 对应的私有订阅地址；重置安全信息会轮换 UUID 与订阅 Token。
- 邮箱验证码：SMTP 接入前使用本地过渡码 `666666`，发送接口会在注册页直接提示；生产部署前必须替换为按邮箱签发、限时有效的验证码。
- 暂未启用：找回密码、订单、支付、工单和节点真实数据。

## 页面映射

| 旧路由 | 新路由 | 状态 |
| --- | --- | --- |
| `/dashboard` | `/dashboard` | 完整静态页面 |
| `/plan`、`/plan/:plan_id` | 保持不变 | 套餐列表与配置页已完成 |
| `/order`、`/order/:trade_no` | 保持不变 | 订单列表与详情页已完成 |
| `/invite` | `/invite` | 邀请统计、邀请码和佣金记录已完成 |
| `/knowledge` | `/knowledge` | 文档分类和搜索界面已完成 |
| `/node` | `/node` | 订阅工具和节点状态已完成 |
| `/ticket`、`/ticket/:ticket_id` | 保持不变 | 列表、新建和会话详情已完成 |
| `/traffic` | `/traffic` | 汇总和流量明细已完成 |
| `/profile` | `/profile` | 钱包、密码、通知和重置功能界面已完成 |
| `/login`、`/register`、`/forgetpassword` | 保持不变 | 登录与注册已接入 AeraNexa 用户 API；找回密码待邮件服务 |

以上页面延续源项目 V2Board 1.7.x 的左侧分组导航、深色顶栏、块级卡片、表格密度、表单和中文字段。`/demo/*` 页面继续使用演示数据，生产路由只有已迁移的用户系统会写入新数据库。

## API 过渡原则

旧前端使用 `/api/v1/passport/*`、`/api/v1/guest/*` 和 `/api/v1/user/*`。已迁移的用户认证改用 `/api/auth/*` 与 `/api/user/*`，其余业务仍通过服务端适配层保留兼容边界。3x-ui 仅位于后端节点控制域，前端不得直接访问其管理员 API。

## 源码参考

- `source/v2board`：原始 V2Board 面板和编译后用户前端。
- `source/3x-ui`：节点控制系统参考实现。
