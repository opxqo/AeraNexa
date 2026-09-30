# 演示站（demo-site）

一个**纯前端**的全流程演示：门户网页（首页、定价、注册、登录、找回密码）加客户面板（仪表盘、使用文档、购买订阅、我的订单、我的邀请、个人中心、我的工单、流量明细），可以从头点到尾。没有后端、没有数据库、没有管理端，产物是一堆静态文件，可放在任何静态托管上（目标是腾讯 EdgeOne Pages）。

## 怎么玩

| 项目 | 值 |
|---|---|
| 演示账号 | `admin`（也可填 `admin@aeranexa.demo`），密码 `admin123456` |
| 自己注册 | 任意邮箱；**邮箱验证码固定 `123456`**（不会真的发邮件，页面上也有提示）；密码至少 8 位 |
| 找回密码 | 只能重置在演示站注册过的邮箱，验证码同样是 `123456`；内置演示账号的密码不变 |
| 优惠码 | `WELCOME10`（立减 ¥10） |
| 充值卡密 | `ANX-DEMO-0000-1111-2222-3333`（+¥50，可重复使用） |
| 演示时钟 | 面板里的「现在」固定在 2026-03-26 10:30 附近，套餐到期、订单时间都以它为准 |

流程举例：首页 → 定价 → 注册（或登录）→ 仪表盘 → 购买订阅 → 收银台支付（余额 / 支付宝 / 微信均为模拟）→ 我的订单 → 我的邀请 → 个人中心 → 我的工单 → 流量明细 → 退出登录。

- 新注册的账号和演示账号都从同一份种子数据开始（有套餐、订单、工单、邀请码等），之后各自的操作互不影响。
- 头像旁的菜单里有「重置演示数据」，把当前账号恢复到初始状态；「退出登录」回到登录页。
- 面板里只有中文；首页、定价和登录页支持中英切换。

## 数据存在哪里

所有状态只存在**访客自己浏览器**的 `localStorage`，不会上传，也不会在访客之间共享：

| 键 | 内容 |
|---|---|
| `aeranexa-demo-session` | 当前登录的账号 |
| `aeranexa-demo-accounts` | 在演示站注册的账号（含明文密码，仅演示用） |
| `aeranexa-demo-state-v1:<邮箱>` | 该账号在面板里做过的事：订单、工单、邀请码、余额流水、昵称头像、设备等 |
| `aeranexa_locale` | 页面语言 |

清空站点数据即可完全重置。存储被浏览器禁用时演示仍可用，只是刷新后丢失。

## 本地运行与构建

```bash
pnpm dev:demo      # 开发，http://localhost:3100
pnpm build:demo    # 构建，产物在 demo-site/out（纯静态）
```

`build:demo`（[`scripts/build-demo.mjs`](../scripts/build-demo.mjs)）先把根目录 `public/` 和应用图标复制进 `demo-site/public/`，再在 `demo-site/` 里执行 `next build`。这些复制出来的文件、`demo-site/out`、`demo-site/.next` 都在 `.gitignore` 中，每次构建重新生成。本地预览产物可以用任意静态服务器，例如 `cd demo-site/out && python3 -m http.server 4173`。

## 它是怎么做的

`demo-site/` 是一个独立的 Next.js 工程（`output: "export"`、`trailingSlash: true`、图片不优化），**直接引用 `src/` 里的组件**，所以门户和面板的界面与主应用是同一份代码；主应用里的 `src/app/admin`、`src/app/api`、代理都不会进入演示站。差异靠三处机制：

1. **`DEMO_SITE` 开关**（[`src/lib/demo-site/flag.ts`](../src/lib/demo-site/flag.ts)，由 `demo-site/next.config.ts` 的 `NEXT_PUBLIC_DEMO_SITE=1` 打开）。`src/lib/api/auth.ts` 在演示站里改走 [`src/lib/demo-site/auth.ts`](../src/lib/demo-site/auth.ts)（账号存浏览器），登录页多出演示账号提示。主应用不设置这个变量，行为不变。
2. **静态导出限制的绕法**：
   - Server Action（记语言）→ 由 `next.config.ts` 的 `resolveAlias` 换成 [`demo-site/locale-action.ts`](../demo-site/locale-action.ts)，语言存 `localStorage`，页面用 `useDemoLocale()` 在浏览器里读。
   - 服务端读会话 → 面板外壳 `DemoPanel`（[`src/components/panel-demo/shell.tsx`](../src/components/panel-demo/shell.tsx)）在浏览器里读会话，未登录跳 `/login/`，已登录访问登录页跳 `/dashboard/`。
   - 动态路由 `/order/[no]`、`/ticket/[id]` 无法预渲染运行时才有的编号 → 改成单页加查询串：`/order/view/?no=…`、`/ticket/view/?id=…`（链接由 [`nav.ts`](../src/components/panel-demo/nav.ts) 的 `orderHref` / `ticketHref` 生成）。
3. **面板状态**（[`src/components/panel-demo/state.tsx`](../src/components/panel-demo/state.tsx)）：所有面板页共用一个 Provider，种子数据在 [`src/lib/demo/panel-mock.ts`](../src/lib/demo/panel-mock.ts)，演示站里按账号写入 `localStorage`。面板挂载路径由 `NEXT_PUBLIC_PANEL_BASE` 决定：演示站是站点根（`/dashboard`），主应用里的演示是 `/demo/panel`。

## 部署到腾讯 EdgeOne Pages

仓库根的 [`edgeone.json`](../edgeone.json) 已写好构建配置，在 EdgeOne Pages 里**导入这个 Git 仓库、选对分支**即可，不需要在控制台再填构建命令：

- 安装：`npx --yes pnpm@10 install --frozen-lockfile --config.manage-package-manager-versions=false`
- 构建：`node scripts/build-demo.mjs`
- 输出目录：`./demo-site/out`
- Node：`22.11.0`（EdgeOne 可选版本里最高的一档）；`/_next/static/*` 加了长期缓存头。

**为什么安装用 pnpm 10，而不是项目声明的 `pnpm@11.25.0`**：pnpm 11 要求 Node ≥ 22.13，EdgeOne 最高只提供 22.11，跑起来会直接报 `requires at least Node.js v22.13`。pnpm 10 能读同一份 `pnpm-lock.yaml`（lockfileVersion 9.0），`--config.manage-package-manager-versions=false` 是为了让它不要按 `package.json` 的 `packageManager` 字段自动切回 pnpm 11。构建这一步不再经过 pnpm，直接用 `node` 跑脚本。这套命令已在干净拷贝里用 Node 22.11.0 完整跑通（安装 34 秒、构建 17 秒、18 个静态页面）；EdgeOne 构建机本身没有实测过，第一次部署请留意构建日志。

要点：

- 构建依赖的所有文件（`src/components/ui`、`src/components/aera`、`src/styles`、`demo-site/` 等）必须已提交并推送，EdgeOne 只看得到 Git 里的内容。
- `demo-site/public/` 由构建脚本从根目录 `public/` 复制，不用提交。
- 静态导出已开 `trailingSlash`，`/login/` 会落到 `login/index.html`；产物根目录带有 `404.html`，部署后打开一个不存在的地址确认 EdgeOne 是否使用它。
- 构建机若仍装不上，兜底做法：本机 `pnpm build:demo`，把 `demo-site/out` 整个目录上传（控制台上传或 EdgeOne CLI）。

## 已知限制

- **管理端不在演示站**，也没有任何后端接口；演示站构建产物里不会请求 `/api/*`。
- 「节点状态」页还在重做：面板导航里没有它，首页顶部、页脚的「节点」链接和仪表盘的「查看节点状态」会打开占位页（未登录会先被送去登录）。
- 个人中心的「修改登入密码」只弹演示提示，不校验旧密码、也不会真的改掉登录密码。
- Google / GitHub 登录按钮是占位，点击只提示尚未开放（与主应用一致）。
- 「复制链接」等按钮用浏览器剪贴板接口，需要 HTTPS 或 localhost（EdgeOne 域名是 HTTPS，没问题）。
- 账号与密码明文存在访客浏览器里，只适合演示，不要输入真实密码。
