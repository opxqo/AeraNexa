import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

// 独立临时库 + 本地假 Telegram API：必须在加载任何 src 模块之前设置环境变量
const DB_NAME = `aeranexa_tgadmin_test_${randomBytes(4).toString("hex")}`;
process.env.DB_NAME = DB_NAME;
process.env.TELEGRAM_BOT_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "test-token";

const sent = [];
const fakeTelegram = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (req.url?.endsWith("/sendMessage")) sent.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise((resolve) => fakeTelegram.listen(0, "127.0.0.1", resolve));
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${fakeTelegram.address().port}`;

const { handleTelegramUpdate, deliverTelegramNotifications } = await import("../../src/lib/server/telegram.ts");
const { scanAdminEvents, resetAdminScanState } = await import("../../src/lib/server/telegram-admin.ts");
const { getDbPool } = await import("../../src/lib/server/db.ts");

const ADMIN_CHAT = 910001;
const USER_CHAT = 920002;
const GROUP_CHAT = -930003;
let pool;
let updateId = 1;

/** 模拟收到一条消息，返回机器人回给这个聊天的所有文本 */
async function say(chatId, text, { type = "private", replyTo } = {}) {
  const before = sent.length;
  await handleTelegramUpdate({
    update_id: updateId++,
    message: { text, chat: { id: chatId, type }, ...(replyTo ? { reply_to_message: { text: replyTo } } : {}) },
  });
  return sent.slice(before).filter((m) => m.chat_id === chatId).map((m) => m.text).join("\n---\n");
}

async function insertUser(id, email, role, chatId) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, nickname, role, uuid, subscription_token, telegram_id, balance, plan_id)
     VALUES (?, ?, 'x', ?, ?, ?, ?, ?, 1234, 1)`,
    [id, email, email.split("@")[0], role, randomBytes(18).toString("hex").slice(0, 36), randomBytes(16).toString("hex"), chatId],
  );
}

before(async () => {
  await import("../../scripts/migrate-database.mjs");
  pool = getDbPool();
  await pool.query("INSERT INTO plans (id, name, transfer_enable, is_visible) VALUES (1, '标准套餐', 100, 1)").catch(async () => {
    // plans 列随版本可能不同：只填必填列
    const [cols] = await pool.query("SHOW COLUMNS FROM plans WHERE `Null` = 'NO' AND `Default` IS NULL AND Extra NOT LIKE '%auto_increment%'");
    const names = cols.map((c) => c.Field);
    const values = names.map((n) => (n === "name" ? "标准套餐" : /price|amount|enable|limit|sort/.test(n) ? 0 : ""));
    await pool.query(`INSERT INTO plans (id, ${names.join(", ")}) VALUES (1, ${names.map(() => "?").join(", ")})`, values);
  });
  await insertUser(1, "boss@panel.test", "admin", ADMIN_CHAT);
  await insertUser(2, "alice@panel.test", "user", USER_CHAT);
  await pool.query("INSERT INTO tickets (id, user_id, subject, level, status, reply_status) VALUES (7, 2, '节点连不上', 2, 0, 0)");
  await pool.query("INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (7, 2, 'user', '香港节点一直超时')");
});

after(async () => {
  fakeTelegram.close();
  await pool?.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {});
  await pool?.end();
});

beforeEach(() => { sent.length = 0; });

test("管理员 /start 看到管理菜单；普通用户看不到", async () => {
  await say(ADMIN_CHAT, "/start");
  const adminMsg = sent.find((m) => m.chat_id === ADMIN_CHAT);
  assert.match(adminMsg.text, /管理员账户/);
  assert.deepEqual(adminMsg.reply_markup.keyboard[0], ["📈 运营概览", "🩺 系统状态"]);
  await say(USER_CHAT, "/start");
  const userMsg = sent.find((m) => m.chat_id === USER_CHAT);
  assert.doesNotMatch(JSON.stringify(userMsg.reply_markup), /运营概览/);
});

test("查询：概览、系统状态、工单、订单、用户", async () => {
  assert.match(await say(ADMIN_CHAT, "📈 运营概览"), /运营概览[\s\S]*用户：2/);
  assert.match(await say(ADMIN_CHAT, "/status"), /系统状态/);
  assert.match(await say(ADMIN_CHAT, "/tickets"), /#7 \[高\] 节点连不上 · alice@panel.test · 待回复/);
  assert.match(await say(ADMIN_CHAT, "/orders"), /暂无订单|最新订单/);
  assert.match(await say(ADMIN_CHAT, "/user alice@panel.test"), /alice@panel.test（ID 2）[\s\S]*余额：¥12.34/);
  assert.match(await say(ADMIN_CHAT, "/user 2"), /alice@panel.test/);
  assert.match(await say(ADMIN_CHAT, "/user alice"), /相近的有[\s\S]*alice@panel.test/);
  assert.match(await say(ADMIN_CHAT, "/ticket 7"), /工单 #7[\s\S]*香港节点一直超时/);
});

test("普通用户发管理员命令拿不到数据；群聊里管理员命令不生效", async () => {
  const userReply = await say(USER_CHAT, "/stats");
  assert.doesNotMatch(userReply, /运营概览/);
  const groupReply = await say(GROUP_CHAT, "/stats", { type: "group" });
  assert.doesNotMatch(groupReply, /运营概览/);
  // 管理员自己在群里发也不行
  await pool.query("UPDATE users SET telegram_id = ? WHERE id = 1", [GROUP_CHAT]);
  try {
    assert.doesNotMatch(await say(GROUP_CHAT, "/stats", { type: "group" }), /运营概览/);
  } finally {
    await pool.query("UPDATE users SET telegram_id = ? WHERE id = 1", [ADMIN_CHAT]);
  }
});

test("回复工单：命令和「回复通知消息」两种方式；关闭工单；都写审计并通知用户", async () => {
  assert.match(await say(ADMIN_CHAT, "/reply 7 已切换线路，请重试"), /已回复工单 #7/);
  assert.match(await say(ADMIN_CHAT, "好了吗？", { replyTo: "🎫 新工单 #7 [高] 节点连不上\n…\n直接回复这条消息即可回复工单 #7" }), /已回复工单 #7/);
  const [msgs] = await pool.query("SELECT message FROM ticket_messages WHERE ticket_id = 7 AND sender_role = 'staff' ORDER BY id");
  assert.deepEqual(msgs.map((m) => m.message), ["已切换线路，请重试", "好了吗？"]);
  const [[ticket]] = await pool.query("SELECT reply_status FROM tickets WHERE id = 7");
  assert.equal(Number(ticket.reply_status), 1);
  const [notify] = await pool.query("SELECT kind FROM telegram_notification_deliveries WHERE user_id = 2 AND kind = 'ticket_reply'");
  assert.equal(notify.length, 2);
  const [audits] = await pool.query("SELECT context FROM audit_logs WHERE action = 'admin.ticket_replied' AND user_id = 1");
  assert.ok(audits.every((a) => (typeof a.context === "string" ? JSON.parse(a.context) : a.context).source === "telegram"));

  assert.match(await say(ADMIN_CHAT, "/close 7"), /工单 #7 已关闭/);
  assert.match(await say(ADMIN_CHAT, "/reply 7 还在吗"), /工单已关闭/);
  assert.match(await say(ADMIN_CHAT, "/reply 999 hi"), /工单不存在/);
  await pool.query("UPDATE tickets SET status = 0 WHERE id = 7");
});

test("主动通知：付款订单、新工单、用户追加回复各通知一次，重复扫描不重复；正文正确送达", async () => {
  resetAdminScanState();
  await scanAdminEvents({ force: true }); // 第一次只记录起点
  await pool.query("INSERT INTO orders (user_id, plan_id, period, trade_no, total_amount, status, paid_at) VALUES (2, 1, 'month_price', 'TN-PAID-1', 1990, 3, CURRENT_TIMESTAMP)");
  await pool.query("INSERT INTO tickets (id, user_id, subject, level, status, reply_status) VALUES (8, 2, '退款咨询', 1, 0, 0)");
  await pool.query("INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (8, 2, 'user', '想退款')");
  await pool.query("INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (7, 2, 'user', '还是不行')");

  await scanAdminEvents({ force: true });
  // 逐条核对（总数里还可能有窗口内更早的工单 #7、临时库里 worker 从未运行触发的失联告警）
  const [[order]] = await pool.query("SELECT id FROM orders WHERE trade_no = 'TN-PAID-1'");
  const [[reply]] = await pool.query("SELECT id FROM ticket_messages WHERE message = '还是不行'");
  for (const key of [`order-paid:${order.id}`, "ticket-new:8", `ticket-msg:${reply.id}`]) {
    const [rows] = await pool.query("SELECT user_id FROM telegram_notification_deliveries WHERE notification_key = ?", [`admin:${key}:1`]);
    assert.equal(rows.length, 1, `${key} 应给管理员排队一条`);
  }
  const [firstMessageOfNewTicket] = await pool.query("SELECT 1 FROM telegram_notification_deliveries WHERE notification_key LIKE 'admin:ticket-msg:%' AND message LIKE '%想退款%'");
  assert.equal(firstMessageOfNewTicket.length, 0, "新工单的第一条内容只随「新工单」通知，不再算作追加回复");
  const [toUser] = await pool.query("SELECT 1 FROM telegram_notification_deliveries WHERE notification_key LIKE 'admin:%' AND user_id = 2");
  assert.equal(toUser.length, 0, "普通用户不会被排队管理员通知");
  assert.equal(await scanAdminEvents({ force: true }), 0, "重复扫描不能重复通知");

  sent.length = 0;
  await deliverTelegramNotifications();
  const toAdmin = sent.filter((m) => m.chat_id === ADMIN_CHAT).map((m) => m.text).join("\n");
  assert.match(toAdmin, /新订单付款 ¥19.90[\s\S]*TN-PAID-1/);
  assert.match(toAdmin, /新工单 #8[\s\S]*想退款[\s\S]*回复工单 #8/);
  assert.match(toAdmin, /工单 #7 有用户新回复[\s\S]*还是不行/);
  assert.ok(!sent.some((m) => m.chat_id === USER_CHAT && /新订单付款/.test(m.text)), "普通用户收不到管理员通知");
});

test("系统告警：商户保活失败同一小时只通知一次", async () => {
  await pool.query("INSERT INTO worker_runs (task, last_finished_at, last_ok, last_error) VALUES ('epay_keepalive', CURRENT_TIMESTAMP, 0, '网关下单失败：最小支付金额是1元')");
  resetAdminScanState();
  await scanAdminEvents({ force: true });
  const firstRound = await scanAdminEvents({ force: true });
  const secondRound = await scanAdminEvents({ force: true });
  const [rows] = await pool.query("SELECT message FROM telegram_notification_deliveries WHERE notification_key LIKE 'admin:alert-keepalive:%'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /商户保活失败：网关下单失败/);
  assert.ok(firstRound >= 1 && secondRound === 0);
});
