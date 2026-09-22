# 生产部署：三个独立进程

AeraNexa 生产环境需要**三个独立进程**，不是一个：

| 进程 | 命令 | 职责 | 是否必需 |
| --- | --- | --- | --- |
| Web | `pnpm start` | 启动前自动跑数据库迁移，然后 `next start` | 必需 |
| Worker | `pnpm worker` | 把用户的套餐/到期/额度变化同步到 3x-ui、采集流量、导入入站 | **只要用到节点域（3x-ui）就必需** |
| Bot | `pnpm bot` | AeraNexaBot 查询与通知 | 仅在后台「系统设置 → Telegram」启用时需要 |

**只启动 Web 进程，节点功能会整个静默失效**：用户购买套餐、页面上一切正常，但 3x-ui 里永远不会创建对应客户端，因为把「用户该有什么权限」写回 3x-ui 这一步只有 worker 会做，Web 进程自己完全不碰这一步，也不会报任何错——这不是那种会在日志里炸出异常的故障，而是「看起来一切正常，实际上什么都没发生」，非常容易在第一次生产部署时漏掉。后台「节点管理」页顶部的「同步状态」面板会直接告诉你 worker 是否存活。

## Zeabur（PaaS）部署

Zeabur 之类的 PaaS 默认每个服务只跑一个启动命令，不会像裸机那样让你自己起多个常驻进程。做法是**再建一个独立服务，指到同一个仓库，覆盖它的启动命令**：

1. 同一个 Zeabur 项目下「新建服务」，源选同一个 GitHub 仓库（`opxqo/AeraNexa`），会得到一个独立于 web 服务的新容器。
2. 给这个新服务加环境变量 `ZBPACK_START_COMMAND=pnpm worker`，覆盖 zbpack 自动检测出的 `pnpm start`。
3. 把 web 服务的环境变量（数据库连接、各加密主密钥等）复制一份给这个新服务——worker 需要连同一个 MySQL。
4. 不用给这个服务绑公网域名：它不提供网页服务，不监听端口，Zeabur 反代会对它的自动域名返回 502，这是预期行为，忽略即可，不影响容器本身运行。

如果启用了 Telegram Bot，`pnpm bot` 照同样方式再建一个服务。

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

## 部署后自检

```bash
# Web 在跑：应返回 200/302/307
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000

# worker 在跑：应能看到一行进程
ps aux | grep -v grep | grep node-worker

# 或者直接看两个 service 的状态
systemctl is-active aeranexa-web aeranexa-worker
```

后台「节点管理」页每个节点的「账号数」列，是判断 worker 是否正常工作的最直接信号：只要有用户持有该节点所在权限组的套餐，这个数字就不应该长期停在 0。
