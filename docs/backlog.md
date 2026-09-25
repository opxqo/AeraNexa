# 待办事项（Backlog）

> 来源：2026-09-25 系统完成度评估（当时整体约 78/100）。均为非阻塞项，按性价比排序。

## 1. 默认管理员改为随机密码

`src/lib/server/bootstrap-admin.ts` 在 `users` 表为空时创建固定账号 `admin@admin.com / admin123456`。公网部署若未及时改密即为入口。

- 首次启动生成随机密码，只打印到启动日志一次
- 可选：首次登录强制修改密码
- 同步更新 README 中的说明与 `scripts/create-admin.mjs` 的默认值

## 2. 文档与代码对齐

- `docs/delivery-acceptance.md` 第六节仍写「3x-ui 开户链路未实现」「流量采集无写入路径」，实际已在节点域完成（见 `docs/node-domain-design.md` §7）
- README「边界」一节仍称订单、支付、节点编排属于后续迁移范围

## 3. 限速与节点倍率

套餐「限速」、节点「倍率」可在后台填写但不生效（3x-ui 客户端层不支持限速；倍率一律按 1.0 计费）。二选一：

- 实现：倍率可按 `docs/node-domain-design.md` §6 的分桶方案（`u{id}-r2`）
- 或在表单中隐藏，避免误解

## 4. 订阅格式与协议

- 新增 sing-box 订阅，其次 Surge / Quantumult X
- 支持 Shadowsocks-2022 入站（需定长密钥，另行设计；当前 `SYNC_PROTOCOLS` 仅 vless / vmess / trojan）
- Clash 下发 xhttp / kcp 传输

## 5. 告警通知

`/admin/logs` 的告警目前只在后台显示。接入已有的 Telegram Bot（`src/bot`、`src/lib/server/telegram.ts`）推送给管理员，重点覆盖 worker 失联与支付回调异常。

## 6. 富文本改为服务端净化

套餐说明等管理员内容在前端经 `sanitizeHtml`（`src/components/api-ui.tsx`，手写 DOMParser）净化。改为复用服务端 `src/lib/server/sanitize.ts`，或引入 DOMPurify。

## 7. 客户端多风格（暂缓，2026-09-25 讨论）

结论：做“可切换主题系统”，不做多套独立客户端。分三层按需推进：① 配色 ② 视觉风格（圆角、阴影、密度、字体）③ 布局外壳；页面组件与数据全部共用。

前置工作（单独也值得做）：`globals.css` 设计变量化——当前只有 11 个 `--v2-*` 变量、584 处硬编码颜色、261 条 `[data-theme="dark"]` 覆盖、`api-pages.tsx` 140 处内联 style。变量化后暗色模式可随之重写。

产品建议：首批 2～3 套；后台设默认与启用范围，用户在偏好设置中切换并随账户保存；统计选用率，无人使用即下线。

## 8. SEO 与中文名「天赐」

品牌定为英文名 AeraNexa（UI 为主）、中文名「天赐」（SEO 用）。目前代码里还没有「天赐」，也没有 robots、sitemap、Open Graph。具体规则和要改的位置见 [`docs/seo.md`](seo.md)。
