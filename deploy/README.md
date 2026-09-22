# 生产部署：三个独立进程

AeraNexa 生产环境需要**三个独立进程**，不是一个。三份 systemd unit 模板都在这个目录：

| 进程 | unit | 职责 | 是否必需 |
| --- | --- | --- | --- |
| Web | `aeranexa-web.service` | `pnpm start`：启动前自动跑数据库迁移，然后 `next start` | 必需 |
| Worker | `aeranexa-worker.service` | `pnpm worker`：把用户的套餐/到期/额度变化同步到 3x-ui、采集流量、导入入站 | **只要用到节点域（3x-ui）就必需** |
| Bot | `aeranexa-bot.service` | `pnpm bot`：AeraNexaBot 查询与通知 | 仅在后台「系统设置 → Telegram」启用时需要 |

**只启动 Web 进程，节点功能会整个静默失效**：用户购买套餐、页面上一切正常，但 3x-ui 里永远不会创建对应客户端，因为把「用户该有什么权限」写回 3x-ui 这一步只有 worker 会做，Web 进程自己完全不碰这一步，也不会报任何错——这不是那种会在日志里炸出异常的故障，而是「看起来一切正常，实际上什么都没发生」，非常容易在第一次生产部署时漏掉。

## 安装

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
