# 节点域设计方案

> 状态：草案（2026-09-20）。已拍板：对接 3x-ui 主控（方案 A）；一个用户一个 3x-ui 客户端、一个 UUID（即 `users.uuid`，用户之间不共用）；独立 worker 进程；入站在 3x-ui 建好后导入；节点倍率暂不考虑（一律按 1.0 计费）；设备数限制同时使用 limitIp（连接层）与 HWID（订阅层，由 AeraNexa 自己实现，见 §4.7）。

## 1. 边界与职责

| 归属 | 负责 | 不负责 |
| --- | --- | --- |
| 业务域（已有） | 用户资格：`users.plan_id / expired_at / transfer_enable / is_active`，套餐 → 权限组 → 节点 | 任何对 3x-ui 的调用 |
| 节点域（本文） | 把"用户资格"同步成 3x-ui 客户端；采集流量回写业务域；生成订阅 | 计费规则、订单状态 |
| 3x-ui 主控 | 入站配置、多节点分发（mTLS）、Xray 运行、客户端流量计数 | 用户、套餐、到期判定的权威来源 |

原则：**AeraNexa 是权威（source of truth），3x-ui 是执行器**。业务代码永远只改数据库并标脏，不直接调 3x-ui；worker 负责让 3x-ui 收敛到数据库描述的状态。

```
业务写路径（Next.js）                      worker（独立进程）
────────────────────                      ─────────────────────────────────────
fulfillOrder / 后台改用户 /  ──同一事务──▶ panel_clients.desired_version++
resetSecurity / 权限组变更                     │
                                              ▼
                                   ┌─ Reconciler（事件 + 全量兜底）
                                   │    计算期望 → diff → PanelClient 调用
                                   ├─ TrafficCollector（每 60s）
                                   │    inbounds/list → 增量 → 入库 → 超额标脏
                                   └─ InboundImporter（手动 / 每 10min）
                                        inbounds/list → nodes 表 upsert
                                              │ Bearer token（node-sync）
                                              ▼
                                        3x-ui 主控 ──mTLS──▶ 子节点
用户客户端 ──GET /api/client/subscribe?token=──▶ Next.js 订阅渲染（读库，不实时调 3x-ui）
```

## 2. 3x-ui 对接约束（已核对 `source/3x-ui`）

优先使用 **`node-sync` 范围的 API Token**（白名单见 3x-ui `internal/web/controller/api.go` 的 `nodeSyncScopeAllow`）。当前部署只能拿到 admin token，因此 `PanelClient` 内置**本地接口白名单**（`ALLOWED_ENDPOINTS`），发请求前拦截白名单外的调用，效果上把 admin token 收窄到下表：

| 用途 | 接口 | 备注 |
| --- | --- | --- |
| 读入站 + 客户端 + 流量 | `GET /panel/api/inbounds/list` | 返回 `settings.clients[]` 与 `clientStats[]`，一次拿全量 |
| 创建客户端 / **挂到更多入站** | `POST /panel/api/clients/add` | 对已存在的 email 重复 add 会复用其 `id/password`，等价于 attach（`clients/attach` 不在白名单内） |
| 改额度 / 到期 / 启停 / 凭据 | `POST /panel/api/clients/update/{email}` | 不改挂载关系 |
| 从入站摘除 | `POST /panel/api/clients/{email}/detach` | |
| 删除客户端 | `POST /panel/api/clients/del/{email}` | 部分失败可重放 |
| 健康检查 | `GET /panel/api/server/status` | |

需要注意的 3x-ui 行为：

- **`client_traffics.email` 全局唯一**：同一个客户端挂在多个入站上，流量只有一个合计值，**无法按节点区分**。因此第一版不支持节点倍率，也没有"用户 × 节点"维度的流量明细（见 §6 已决事项）。
- `up/down` 是**累计计数器**，会被重置（手动 reset、3x-ui 自动续期）；采集必须按快照求增量并处理回退。
- `update/del` 在多入站上并发执行，`success:false` 也可能部分生效 —— 所有操作必须幂等，失败后整体重放。
- 主控面板改动后需要 Xray 重启时由 3x-ui 自己标记，AeraNexa 不调用 `restartXrayService`。

## 3. 数据模型变更

### 3.1 `nodes`（修改）

导入的入站即节点。新增列：

```sql
ALTER TABLE nodes
  ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER is_visible,   -- 参与分配；与"前台可见"分开
  ADD COLUMN origin_node_guid VARCHAR(64) NULL AFTER external_inbound_id, -- 3x-ui originNodeGuid，标识物理节点
  ADD COLUMN inbound_snapshot JSON NULL,                                  -- 最近一次导入的入站原文（去掉 clients）
  ADD COLUMN snapshot_hash CHAR(64) NULL,                                 -- 检测 3x-ui 侧改动
  ADD COLUMN missing_since DATETIME NULL;                                 -- 3x-ui 中已不存在时置位，不自动删
```

- `name / protocol / server_port` 由 3x-ui 导入并在后续同步中覆盖；`host / port` 仍由后台维护（订阅里对外展示的地址可能与入站 listen 不同，例如经过中转）。
- `protocol` 由导入写入，后台只读。

### 3.2 `panel_clients`（新增，一个用户一行）

```sql
CREATE TABLE IF NOT EXISTS panel_clients (
  user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(64) NOT NULL,                 -- 固定 'u{user_id}'，不用真实邮箱（避免泄露、改邮箱不影响）；真实邮箱写进 3x-ui 备注 `AeraNexa · 邮箱`，仅管理员可见
  sub_id CHAR(16) NOT NULL,                   -- 3x-ui subId，AeraNexa 不对外暴露 3x-ui 订阅
  desired_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  synced_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | synced | failed | deleting
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  last_error TEXT NULL,
  last_synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY panel_clients_email_unique (email),
  KEY panel_clients_pending_index (sync_status, next_attempt_at),
  CONSTRAINT panel_clients_user_id_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

### 3.3 `proxy_accounts`（语义调整）

保留为**"用户 × 节点"的实际挂载记录**（worker 写入，业务只读），`external_client_id` 统一填 `panel_clients.email`。它回答"这个用户此刻实际挂在哪些入站上"，用于 diff 和后台排障。流量额度/到期列不再使用（以 `users` 为准），后续迁移可删。

### 3.4 `panel_traffic_cursors`（新增）

```sql
CREATE TABLE IF NOT EXISTS panel_traffic_cursors (
  email VARCHAR(64) NOT NULL,
  last_up BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_down BIGINT UNSIGNED NOT NULL DEFAULT 0,
  collected_at DATETIME NOT NULL,
  PRIMARY KEY (email)
);
```

### 3.5 设备数限制相关（新增）

```sql
ALTER TABLE plans
  ADD COLUMN device_limit INT UNSIGNED NULL COMMENT '设备数上限，NULL 表示不限' AFTER speed_limit;
ALTER TABLE users
  ADD COLUMN device_limit_override INT UNSIGNED NULL COMMENT '单用户覆盖套餐设备数，NULL 跟随套餐' AFTER plan_id;

CREATE TABLE IF NOT EXISTS user_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  hwid_hash CHAR(64) NOT NULL,              -- SHA-256(HWID)，不存原文
  user_agent VARCHAR(255) NULL,
  device_os VARCHAR(64) NULL,
  os_version VARCHAR(64) NULL,
  device_model VARCHAR(128) NULL,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_devices_user_hwid_unique (user_id, hwid_hash),
  KEY user_devices_user_seen_index (user_id, last_seen_at),
  CONSTRAINT user_devices_user_id_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

`resetSecurity`（轮换 uuid / 订阅 token）时同时清空该用户的 `user_devices`。

### 3.6 `worker_leases`（新增）

单实例保证用 MySQL `GET_LOCK('aeranexa:node-worker', 0)`，无需建表；若后续需要可观测的心跳，再加一张 `worker_heartbeats`。

## 4. 核心流程

### 4.1 期望状态（纯函数，便于测试）

```ts
type DesiredClient = {
  email: string;           // u{userId}
  enable: boolean;
  uuid: string;            // users.uuid：该用户在所有入站上的唯一身份，用户之间不共用
  password: string;        // Trojan / Hysteria 直接用 uuid；SS-2022 需要定长 base64 key，由 uuid 经 HKDF 派生（同一用户稳定）
  expiryTimeMs: number;    // users.expired_at * 1000；NULL（一次性套餐）→ 0
  totalBytes: 0;           // 见下
  limitIp: number;         // COALESCE(users.device_limit_override, plans.device_limit, 0)，0 = 不限
  limitHwid: 0;            // 固定 0：HWID 由 AeraNexa 订阅层执行，见 §4.7
  inboundIds: string[];    // 期望挂载的 nodes.external_inbound_id
};
```

- `eligible = is_active && plan_id != null && (expired_at == null || expired_at > now) && (upload+download) < transfer_enable`
- `inboundIds` = 套餐 `group_id` → `node_access_groups` → `nodes.is_enabled = 1 AND missing_since IS NULL`
- **不合格时 `enable=false` 且保留挂载**：续费后只需一次 update 即可恢复，不必重建。
- **`totalGB` 固定为 0（3x-ui 不限量）**：额度由 AeraNexa 统一判定。原因：3x-ui 的计数会被重置、倍率无法表达，让它也判额度会出现两套口径打架。代价是最多超用一个采集周期（60s）的流量。
- `expiryTime` 照常下发，作为 AeraNexa 宕机时的兜底。

### 4.2 标脏（业务域需要改的地方）

新增 `src/lib/server/node-sync.ts` 导出 `markPanelClientDirty(connection, userId)`：`INSERT ... ON DUPLICATE KEY UPDATE desired_version = desired_version + 1, sync_status='pending', next_attempt_at=NOW()`。**必须在业务事务内调用**（outbox 模式），保证"订单开通"和"要求同步"原子。

调用点（已定位）：

| 位置 | 触发原因 |
| --- | --- |
| `client-portal.ts` `fulfillOrder` | 新购 / 续费 / 升级 / 流量重置 |
| `admin/actions.ts` 用户编辑（L170） | 改套餐、到期、额度、封禁 |
| `users.ts` resetSecurity（L285） | uuid 轮换 → 凭据变更（并清空 `user_devices`） |
| 后台改套餐 `device_limit` | 批量标脏该套餐下所有用户 |
| 后台权限组 / 节点分组 / 节点启停 / 删除 | 批量标脏受影响用户 |
| TrafficCollector 发现超额 | 转为不合格 |
| Reconciler 定时扫描 `expired_at` 刚过期的用户 | 到期（3x-ui 也会兜底） |

### 4.3 Reconciler

1. 事件轮询（每 5s）：取 `sync_status IN ('pending','failed') AND next_attempt_at <= NOW()` 的 ≤100 行，记下各自 `desired_version`。
2. 对每个用户：读 `users` 计算 `DesiredClient`；与 3x-ui 实际状态（本轮 `inbounds/list` 的缓存，≤30s）diff：
   - 不存在 → `clients/add`（带全部 inboundIds）
   - 缺挂载 → `clients/add`（仅缺的 inboundIds，复用身份）
   - 多挂载 → `clients/{email}/detach`
   - 字段不一致（enable / expiry / uuid / password / limitIp）→ `clients/update/{email}`
   - 用户已删除 → `clients/del/{email}`，然后删 `panel_clients`
3. 成功：`UPDATE ... SET synced_version = ?, sync_status = IF(desired_version = ?, 'synced', 'pending')`（用读到的版本号做乐观并发，期间又被标脏则下轮继续）；同步重写该用户的 `proxy_accounts`。
4. 失败：`attempts++`，指数退避（10s → 最长 30min），记 `last_error`；3x-ui 整体不可达时整轮暂停，不累加 attempts。
5. 全量兜底（每 60s）：对所有 `panel_clients` 做一次 diff，兜底漏标、到期，并修复手工在 3x-ui 面板里的改动。3x-ui 中存在、但没有对应 `panel_clients` 行的 `u{数字}` 客户端（用户已删除，外键级联删了行）**直接删除**——`u{数字}` 命名空间只属于 AeraNexa，其他 email 的客户端从不触碰。因此**一个 3x-ui 主控只能对接一套 AeraNexa**。

### 4.4 TrafficCollector（每 60s）

1. `inbounds/list` → 取所有 `clientStats` 中 `email` 匹配 `^u\d+$` 的行。
2. 增量 = `cur - cursor`；若 `cur < cursor`（被重置）则增量 = `cur`。首次见到的 email 只建 cursor 不计费。
3. 单事务写入：`user_traffic_records`（hour 粒度，`node_id = NULL`，`server_rate = 1.00`）、`users.upload_bytes/download_bytes += 增量`、更新 cursor。
4. 写完检查超额用户 → `markPanelClientDirty`。
5. 节点维度：`inbounds/list` 的入站 `up/down` 同样按快照求增量写 `node_traffic_records`。

> 现状提示：`traffic.ts` 的 `recordTraffic` 只写明细表，**不累加 `users.upload_bytes/download_bytes`**，所以目前额度永远不会被消耗。采集器接入时需要一并补上，建议抽出 `applyTrafficDelta(connection, …)` 供采集器和 `/api/node/traffic` 共用。

### 4.5 InboundImporter

- 后台「节点」页新增"从 3x-ui 同步入站"按钮（调用 Next.js server action → 直接用同一个 PanelClient 读 `inbounds/list`，导入是只读 + 写本地库，不必经 worker）；worker 每 10min 也跑一次。
- 新入站：插入 `nodes`，`is_visible=0, is_enabled=0`，等待管理员配置分组、对外地址后启用。
- 已有入站：更新 `protocol / inbound_snapshot / snapshot_hash / origin_node_guid`；snapshot 变化时标记该节点所有用户重新生成订阅缓存（不需要调 3x-ui）。
- 3x-ui 中消失：置 `missing_since`，Reconciler 视其为不可分配；**不自动删除**，由管理员确认。

### 4.6 订阅输出

- 路由：`GET /api/client/subscribe?token=…`（替换当前指向 V2Board 代理的 `/api/v1/client/subscribe`，`getSubscribe` 同步改地址）。
- Base64（V2RayN/Shadowrocket）始终由本地库渲染。Clash / Mihomo 可由后台「系统设置 → 订阅 → Clash / Mihomo 规则来源」选择：`AeraNexa` 使用本地节点快照渲染；`3x-ui` 则在完成 AeraNexa 用户资格与设备限制校验后，由服务端代理该用户 `subId` 对应的 3x-ui YAML。选择 3x-ui 时须填写面板「订阅 → Clash URI」的完整前缀；留空才尝试 `/mihomo/` 兼容路径。
- 不合格用户返回仅含提示节点（"已到期/流量用尽"）的订阅，而不是 403，避免客户端报错后清空配置。
- 响应头 `subscription-userinfo: upload=…; download=…; total=…; expire=…`。
- `node-sync` token 无权调用 3x-ui 的 `clients/links`，所以链接必须自己拼，渲染器放在 `src/lib/server/subscription-render/`，一种协议一个文件，用 3x-ui 的 `allLinks` 输出做测试夹具对照。

### 4.7 设备数限制

一个上限值（`device_limit`，用户覆盖优先于套餐）在两层同时执行，二者互补：

| 层 | 机制（已核对 `source/3x-ui`） | 防什么 | 局限 |
| --- | --- | --- | --- |
| 连接层：`limitIp` | 下发到 3x-ui 客户端；各节点 3x-ui 的 `CheckClientIpJob` 每 10s 从 Xray online-stats API 取在线 IP，超出上限的旧 IP 写入 IP-limit 日志由 **fail2ban** 封禁 | 链接泄露后多人同时使用 | 数的是**同时在线的源 IP** 而非设备：同一 NAT 下多设备算 1，手机切换网络会短暂算 2；**节点机器未装/未启用 fail2ban 时不生效**；一个用户同时连多个节点时是否跨节点合并计数需联调确认 |
| 订阅层：HWID | 3x-ui 的 `limitHwid` **只在 3x-ui 自带订阅服务里校验 `X-HWID` 头**（`internal/sub/controller.go` `enforceHwid`）。我们的订阅由 AeraNexa 生成，下发 `limitHwid` 不会生效，所以在 `/api/client/subscribe` 里**按同样语义自己实现** | 订阅链接被分享给新设备导入 | 只卡"拉取订阅"，已拿到配置的设备不受影响（由连接层兜底）；不发送 `X-HWID` 的客户端（Clash 系多数不发）无法识别 |

订阅层 HWID 规则（对齐 3x-ui / Happ 的行为，便于客户端兼容）：

1. 读取 `X-HWID`、`User-Agent`、`X-Device-OS`、`X-Ver-OS`、`X-Device-Model`。
2. 上限为 0 → 放行，仍记录设备（便于用户查看）。
3. 请求无 HWID（或长度不足）→ 放行，响应头 `X-Hwid-Not-Supported: true`。**不因此拒绝**，否则 Clash 类客户端全部不可用。
4. 已登记的 HWID → 更新 `last_seen_at` 后放行。
5. 新 HWID 且已登记数 < 上限 → 登记并放行；已满 → 返回仅含提示节点（"设备数已达上限，请在个人中心移除旧设备"）的订阅，响应头 `X-Hwid-Max-Devices-Reached: true`。
6. 登记在事务内完成（`SELECT … FOR UPDATE` 锁用户行），防止并发拉取超额登记。

用户侧：个人中心新增"我的设备"（列表、移除单个、全部移除），接口 `/api/user/devices`；后台用户详情可查看/清空。设备移除后不自动踢下线（连接层由 limitIp 管）。

部署前提：**每台节点机器需安装并启用 fail2ban**（3x-ui 安装脚本 `x-ui.sh` 提供 IP limit 配置项），否则连接层限制静默失效。后台节点页需提示这一点，联调时要验证。

## 5. 代码组织与 worker 运行方式

```
src/lib/server/panel/
  client.ts          # PanelClient：fetch + Bearer + 超时 + {success,msg,obj} 解包 + 错误分类
  types.ts           # Inbound / ClientTraffic / Client 的最小类型
  desired.ts         # computeDesiredClient（纯函数）
  diff.ts            # diffClient → PanelOp[]（纯函数）
src/lib/server/node-sync.ts        # markPanelClientDirty（业务域唯一入口）
src/lib/server/subscription-render/
src/worker/
  index.ts           # 获取 GET_LOCK、启动三个循环、优雅退出（SIGTERM 等待当前批次）
  reconciler.ts
  traffic-collector.ts
  inbound-importer.ts
```

- worker 与 Next.js **共享同一套 `src/lib/server` 代码与同一个 MySQL**，不引入 Redis/消息队列；outbox 表就是队列。
- 运行：`pnpm worker`。不打包、不引入新依赖：`scripts/node-worker.mjs` 注册 `scripts/ts-hooks.mjs` 解析钩子（`server-only` → 空模块、`@/` → `src/`、无扩展名相对导入 → `.ts`），由 Node（≥ 22.18）直接剥离类型运行。代价：worker 引用到的源码只能用可擦除 TS 语法（不能用 enum、构造参数属性）。
- 部署：与 Next.js 同机两个进程（systemd / pm2 / compose 两个 service），worker 只需出站访问 3x-ui 主控和 MySQL。
- 配置：3x-ui 地址 / Token / 超时、订阅域名、Worker 各任务间隔均在后台「系统设置」（`system_settings` 表，迁移 `20260920_005`；Token 以 `SETTINGS_ENCRYPTION_KEY` 加密）。取值顺序：后台值 → 同名环境变量 → 默认值；Next.js 与 worker 各自缓存 5 秒，worker 每轮重新读取调度间隔，无需重启。

## 6. 待定问题

**已决：节点倍率暂不考虑**

一个用户只有一个客户端（email `u{user_id}`，身份 `users.uuid`），3x-ui 只给出该客户端的流量合计，所有节点按 1.0 计费；`nodes.rate` 保留但不参与计费，后台应标注"暂未生效"。将来若要支持倍率，可按倍率分桶建客户端（`u{id}-r2` 等），`panel_clients` 主键扩为 `(user_id, rate_bucket)`，届时需重新评估"一个 UUID"的约束。

**待定：限速**：`plans.speed_limit` 3x-ui 客户端层面不支持，需要入站/路由层做，建议第一版不实现并在后台标注。

## 7. 实施顺序

> **进度（2026-09-20）**：第 1～4 步与第 6 步（Base64）已打通并对本地 3x-ui 3.8.5 实测：购买套餐 → 标脏 → worker 在 3x-ui 创建 `u{id}` 客户端（UUID = `users.uuid`）→ 订阅输出 vless 链接；停用用户 3 秒内 xray 拒绝该 UUID，恢复后重新接受。
>
> 流量采集与设备数限制（第 5 步、§4.7）已完成并实测：超额后下一轮采集即标脏、3x-ui 停用、订阅显示「流量已用尽」；套餐设备上限 1 时 limitIp=1 下发，第二台 HWID 设备拿到「设备数已达上限」提示节点。
>
> 第一版限制：只分配 **vless / vmess / trojan** 入站（`SYNC_PROTOCOLS`，凭据都能直接用 UUID 表达；Shadowsocks-2022 需要定长密钥，另行设计）。
>
> **VLESS Vision（2026-09-23）**：由系统设置 `panel.vless_flow` 控制，默认关闭。开启后每个 `u{id}` 客户端统一下发 `xtls-rprx-vision`，3x-ui 在 add/update 时按入站剥离不适用的 flow（`clientWithInboundFlow`，v3.2.5 起）。适用条件与 3x-ui 一致：VLESS + (tcp + tls/reality，或 xhttp + VLESS encryption)，且入站未勾选「禁用流控」（`visionEligible`，`sync-model.ts`）。Reconciler 只从适用入站读取实际 flow 做比较；订阅链接与 Clash 用同一函数判定是否带 flow，保证服务端与客户端一致。切换开关会全量标脏；用户需更新订阅，旧链接会被 xray 拒绝。

1. ✅ `PanelClient` + 导入器 + 后台"同步入站"（只读）——`src/lib/server/panel/{client,inbounds,import-inbounds}.ts`，迁移 `20260920_002`，测试 `pnpm test:node`；已对本地 3x-ui 3.8.5 实测导入与重复导入幂等
2. ✅ schema 迁移（`20260920_003` `panel_clients`）+ `markPanelClientDirty` 接入：订单履约、后台改用户、重置安全信息、套餐 / 节点 / 权限组变更（`markAllPanelClientsDirty`）；后台节点页新增「权限组」管理，套餐可选权限组
3. ✅ 纯函数 `src/lib/server/panel/sync-model.ts` + 单元测试
4. ✅ `src/lib/server/panel/reconcile.ts` + `src/worker/index.ts`（主锁、串行循环、失败退避、面板不可达暂停、SIGINT/SIGTERM 优雅退出）
5. ✅ `src/lib/server/panel/collect-traffic.ts`（纯函数 `traffic-model.ts`）：每分钟读 `inbounds/list` 的 clientStats / 入站计数，按游标（`panel_traffic_cursors`，迁移 `20260920_004`）求增量；首次见到从 0 起算、计数变小视为重置。用户明细按东八区自然日、`node_id = NULL` 归档（3x-ui 只给客户端合计）。`/api/node/traffic` 推送接口保留给非 3x-ui 节点，**不参与计费**，避免与采集器重复计数
6. ✅ 设备数限制：`plans.device_limit` / `users.device_limit_override`，连接层下发 limitIp（需节点启用 fail2ban，本地 Docker 版 3x-ui 已启用），订阅层 `src/lib/server/devices.ts` + `user_devices`；门户个人中心「我的设备」，后台用户可设覆盖值、清空设备。
7. 🟡 订阅：Base64 与 Clash / Mihomo 已完成（`/api/client/subscribe`，旧路径 `/api/v1/client/subscribe` 兼容保留；`flag=clash|meta|mihomo|stash` 或 Clash 系 UA 返回 YAML，门户 Clash / Stash 导入按钮自动带 `flag=clash`）。Clash 默认由 AeraNexa 生成（`src/lib/server/panel/clash.ts`），也可在系统设置中切换为 3x-ui 规则：AeraNexa 保留用户鉴权、权限组、流量、设备限制和响应头，服务端只代理合格且已同步用户的 3x-ui YAML。Clash 第一版不下发 xhttp / kcp 传输。待做：sing-box、Surge / Quantumult X
8. ✅ 后台可观测性：worker 每个任务执行后写 `worker_runs`（迁移 `20260923_001`，`src/lib/server/worker-status.ts`），事件同步每轮都执行即心跳；后台节点页顶部「同步状态」面板展示 worker 是否存活（超过 max(120s, 事件间隔×3+60s) 无记录判定未运行）、四个任务的上次结果、客户端同步计数与最近 20 个失败用户（含 `last_error`，可逐个「立即重试」或「全部重试」）；用户列表新增「节点同步」列，编辑弹窗可「立即重同步」（即 `markPanelClientDirty`）
