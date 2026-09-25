# 生产部署：三个独立进程

## 一键安装（推荐）

新买一台 Ubuntu 22.04 / 24.04 或 Debian 12 服务器，先把域名 A 记录解析到它的公网 IP，在云厂商安全组里开放 80 / 443，然后用 root 执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/opxqo/AeraNexa/main/deploy/install.sh)
```

脚本（[`install.sh`](install.sh)）会先检查系统、内存、磁盘和端口，再逐项提问（域名、安装目录、本机或外部数据库、是否启用 Bot），确认后自动完成：内存不足 4G 时加 swap → 安装 Node / pnpm / MySQL / Caddy → 建库建账号（密码自动生成并写入配置）→ 拉代码装依赖 → 生成 `.env.local` 和全部加密密钥 → 建表 → 编译 → 用 systemd 常驻 web、worker（可选 bot）→ 检查域名解析后配置 Caddy 自动 HTTPS。

启动时有五种模式：

| 模式 | 用途 |
| --- | --- |
| 全新安装 | 空服务器首次部署；装好后用 `admin@admin.com` / `admin123456` 登录并立即改密码 |
| 安装并从旧面板迁移 | 新服务器搬家：装好环境后，用迁移码直接在线拉取旧面板的数据和密钥；也可以填备份文件路径 |
| 更新已有部署 | 拉最新代码 → 装依赖 → 编译 → 重启服务，不动配置和数据。编译写进备用目录（`.next-a` / `.next-b` 轮换），编译期间网站照常访问，只在重启那几秒中断；新版本起不来会自动回滚到上一版 |
| 导入旧面板的数据 | 本机已经装好：只做「停 worker → 拉取或恢复 → 写入密钥 → 重启」，不重装环境 |
| 生成迁移码 | 在**旧服务器**上运行，直接在终端拿到迁移码（面板版本太旧时会先提示更新） |

手动回滚到上一版：把 `.env.local` 里的 `NEXT_DIST_DIR` 改成另一个目录（更新完成时脚本会提示是哪个），再执行 `systemctl restart aeranexa-web`。

每一步都会先检测再动手，可以放心重复运行：中途失败修好问题后直接重跑，已完成的步骤会跳过；**已有的 `.env.local` 密钥永远不会被重新生成**。全程日志在 `/var/log/aeranexa-install.log`，部署信息（访问地址、数据库密码等）保存在 `/root/aeranexa-install-info.txt`，仅 root 可读。

下面是脚本背后的原理和手动部署步骤，供排查或自定义时参考。


AeraNexa 生产环境需要**三个独立进程**，不是一个：

| 进程 | 命令 | 职责 | 是否必需 |
| --- | --- | --- | --- |
| Web | `pnpm start` | 启动前自动跑数据库迁移，然后启动自定义 Node 服务入口采集请求日志 | 必需 |
| Worker | `pnpm worker` | 把用户的套餐/到期/额度变化同步到 3x-ui、采集流量、导入入站 | **只要用到节点域（3x-ui）就必需** |
| Bot | `pnpm bot` | AeraNexaBot 查询与通知 | 仅在后台「系统设置 → Telegram」启用时需要 |

**只启动 Web 进程，节点功能会整个静默失效**：用户购买套餐、页面上一切正常，但 3x-ui 里永远不会创建对应客户端，因为把「用户该有什么权限」写回 3x-ui 这一步只有 worker 会做，Web 进程自己完全不碰这一步，也不会报任何错——这不是那种会在日志里炸出异常的故障，而是「看起来一切正常，实际上什么都没发生」，非常容易在第一次生产部署时漏掉。后台「节点管理」页顶部的「同步状态」面板会直接告诉你 worker 是否存活。

## Zeabur 部署

Zeabur 每个服务只跑一个启动命令，所以同一个仓库要拆成多个服务，全部放在同一个项目里：

| 服务名（建议照抄） | 启动命令 | 域名 | Watch Paths |
| --- | --- | --- | --- |
| `aeranexa`（网页） | 自动检测为 `pnpm start` | 绑定对外域名 | 默认 `*` |
| `aeranexa-worker` | `pnpm worker` | **不要绑定** | 见下文 |
| `aeranexa-bot`（仅启用 Telegram 时） | `pnpm bot` | **不要绑定** | 见下文 |
| MySQL | Zeabur 数据库模板，或外部数据库 | — | — |

### 1. 服务名要和仓库里的配置文件对上

仓库根目录的 `zbpack.aeranexa-worker.json`、`zbpack.aeranexa-bot.json` 会按**服务名**自动生效，里面写好了启动命令，并跳过 `next build`（worker 和 bot 直接运行 TS 源码，用不到网页编译产物，跳过后部署更快、构建更省内存）。

- 新建 worker 服务时，直接把服务名改成 `aeranexa-worker`（服务「设置」页可以改名），就不用再手动配 `ZBPACK_START_COMMAND`。
- 如果不想改名，也可以继续用环境变量 `ZBPACK_START_COMMAND=pnpm worker`，效果相同，只是这样仍会执行一次 `next build`。

第一次按新服务名部署时，看一下构建日志里是否出现 `跳过 next build` 那行 echo 输出，以及容器是否正常启动。万一 zbpack 对这种写法不兼容，删掉对应 json 里的 `build_command` 一行即可恢复默认构建。

### 2. 环境变量

worker 和 bot 需要和网页服务**完全相同**的这些变量，否则会连错库，或解不开网页后台保存的配置：

- `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
- `SETTINGS_ENCRYPTION_KEY`：3x-ui API Token 等后台设置是用它加密存进数据库的。worker 这里填得不一样，就解不开 token，会一直报「未配置 3x-ui」。
- `PAYMENT_CONFIG_ENCRYPTION_KEY`：支付渠道的商户密钥用它加密。worker 缺了它，易支付查单和商户保活都会报「支付渠道配置加密密钥不可用」。
- 其余加密主密钥和 pepper（`AUTH_SESSION_SECRET`、`SMTP_CONFIG_ENCRYPTION_KEY`、`EMAIL_VERIFICATION_PEPPER` 等）直接整份复制，最省事。

如果 MySQL 也部署在 Zeabur 的同一个项目里，数据库这几项可以直接引用 MySQL 服务暴露出来的变量，例如 `DB_HOST=${MYSQL_HOST}`。具体变量名以 MySQL 服务「环境变量」页里标为暴露的为准。这样改数据库密码后，各服务会自动同步。

不需要 `.env.local` 文件：`pnpm worker`、`pnpm bot`、`pnpm db:migrate`、`pnpm db:create-admin` 在没有这个文件时，会直接读取 Zeabur 注入的环境变量。

### 3. worker、bot 不要绑定域名

它们不提供网页服务，也不监听端口。Zeabur 反向代理会对它们的自动域名返回 502，这是预期行为，不影响容器运行，不绑定域名就不会看到。

### 4. Watch Paths（服务「设置」页，只能在面板里配置）

默认每次推送都会重新部署所有服务。worker、bot 只依赖少数目录，配置之后，只改网页的提交就不会再触发它们重启：

`aeranexa-worker`：

```
/src/lib/server/
/src/worker/
/scripts/
/package.json
/pnpm-lock.yaml
/zbpack.aeranexa-worker.json
```

`aeranexa-bot`：

```
/src/lib/server/
/src/bot/
/scripts/
/package.json
/pnpm-lock.yaml
/zbpack.aeranexa-bot.json
```

网页服务保持默认的 `*`。

### 5. 部署行为

- **数据库迁移只由网页服务执行**：`pnpm start` 启动前会先迁移，迁移过程有 MySQL 命名锁保护，滚动部署或多副本同时启动也只会串行执行。worker 可能比网页先启动完成：在网页服务迁移完之前，新增的表或字段暂时不存在，相关任务会记为失败，下一轮自动重试，不会导致崩溃。
- **worker 可以多副本或滚动部署**：同一时刻只有一个副本在工作（MySQL 命名锁），其余待命，每 5 秒检查一次，旧容器退出后几秒内即可接手。
- **首个管理员**：服务首次启动时，如果 `users` 表为空，会自动创建 `admin@admin.com` / `admin123456`。需要重置时，在网页服务的「命令」页运行：

  ```bash
  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='新密码' pnpm db:create-admin
  ```

### 6. 部署后自检

打开后台「节点管理」，顶部「同步状态」应显示「Worker 运行中」，四个任务都有最近运行时间；有用户持有套餐时，各节点的「账号数」不应一直是 0。

## 裸机 / VPS 部署（systemd）

三份 systemd unit 模板都在这个目录：`aeranexa-web.service`、`aeranexa-worker.service`、`aeranexa-bot.service`（仅启用 Telegram 时需要）。

### 安装

```bash
sudo useradd -r -s /usr/sbin/nologin aeranexa   # 如果还没有专用用户
sudo mkdir -p /opt/aeranexa && sudo chown aeranexa:aeranexa /opt/aeranexa
# 把代码部署到 /opt/aeranexa，配好 .env.local

sudo cp deploy/aeranexa-web.service deploy/aeranexa-worker.service /etc/systemd/system/
# 如果启用了 Telegram Bot，再加一份：
sudo cp deploy/aeranexa-bot.service /etc/systemd/system/

# 三份模板里的 WorkingDirectory 默认是 /opt/aeranexa，路径不同要改成实际部署路径

sudo systemctl daemon-reload
sudo systemctl enable --now aeranexa-web aeranexa-worker
# sudo systemctl enable --now aeranexa-bot   # 仅启用 Telegram 时

sudo systemctl status aeranexa-web aeranexa-worker
```

### 部署后自检

```bash
# Web 在跑：应返回 200/302/307
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000

# worker 在跑：应能看到一行进程
ps aux | grep -v grep | grep node-worker

# 或者直接看两个 service 的状态
systemctl is-active aeranexa-web aeranexa-worker
```

后台「节点管理」页每个节点的「账号数」列，是判断 worker 是否正常工作的最直接信号：只要有用户持有该节点所在权限组的套餐，这个数字就不应该长期停在 0。

## Telegram 机器人（AeraNexaBot）

在后台「系统设置 → Telegram」填好 Bot Token 并启用，服务器上跑 `aeranexa-bot`（一键脚本安装时选择启用 Bot 即可）。用户和管理员都在个人中心生成绑定码，发给机器人 `/bind 绑定码` 完成绑定。

**管理员**（已绑定、角色为管理员、账户启用中）私聊机器人时，除了普通用户功能，还有：

- 菜单：📈 运营概览、🩺 系统状态、🎫 待处理工单、🧾 最新订单；
- 命令：`/user 邮箱或ID` 查用户，`/ticket 编号` 看工单，`/reply 编号 内容` 回复工单，`/close 编号` 关闭工单，`/admin` 查看全部命令；
- 直接「回复」机器人推送的工单消息，就等于回复这个工单；
- 主动通知：新订单付款、新工单、用户追加回复、worker 失联、商户保活失败、支付报错（系统告警同一类每小时最多一条）。

管理员功能只在私聊里生效，群里发这些命令不会有反应。**主动通知依赖 `aeranexa-bot` 进程在运行**；停机期间发生的事件不会补发。

## 迁移到新服务器

推荐**在线迁移**：两个面板直接通信，数据不经过你的电脑，也不用传文件。

1. **旧面板先更新到最新版**（服务器上重跑安装脚本，选「更新已有部署」），否则没有在线迁移接口。
2. 拿迁移码：旧服务器上运行一键脚本选「生成迁移码」，或在旧面板后台「数据迁移」→「生成迁移码」。迁移码 30 分钟内有效，**只能使用一次**；传输中断就重新生成一个。
3. 新服务器执行一键脚本：还没装的选「安装并从旧面板迁移」，已经装好的选「导入旧面板的数据」，把迁移码粘贴进去。脚本会自动停 worker、拉取全部数据和加密主密钥、写入 `.env.local`、重启服务；失败时会把停掉的服务重新拉起。
4. 用**旧站的管理员账号**登录新面板，确认无误后停掉旧服务器的 worker，避免两边同时改 3x-ui。

其他入口：
- 已经装好的新面板：后台「数据迁移」→「从旧面板拉取」，粘贴迁移码。网页进程改不了自己的环境变量，页面会列出需要设置的密钥，设好后重启三个进程。
- 命令行：`pnpm backup:restore --from <迁移码>`（或把迁移码放进环境变量 `AERANEXA_MIGRATION_CODE`，用 `--from-env`，不让它出现在命令行里）。

迁移码只能粘贴到**另一个**面板：粘贴回生成它的面板（同一个数据库）会在写入前被拒绝，迁移码不会作废——同一个库边导出边清空会丢数据。

在线迁移的安全措施：迁移码里的令牌是 32 字节随机数，数据库只存哈希；新面板只接受 `https://` 的旧面板地址，不跟随跳转；每次生成、使用、拒绝都写审计日志；旧面板页面可以一键作废所有未使用的迁移码。

**文件方式**（两台服务器互相访问不通时用）：旧站后台「数据迁移」→「下载备份」，文件传到新服务器后，在安装脚本里填文件路径，或执行 `pnpm backup:restore 文件`。备份文件**只压缩不加密**，拿到文件等于拿到整站，传完即删。

恢复前请先停掉 worker（恢复会检测 worker 主锁，worker 在跑时直接拒绝；安装脚本会自动停）。登录会话、验证码、Telegram 更新缓存、迁移码等临时数据不迁移，恢复后所有用户需要重新登录。
