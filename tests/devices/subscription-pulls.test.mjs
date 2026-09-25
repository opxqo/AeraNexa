import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";

// 独立临时库：必须在加载 db.ts 之前改 DB_NAME
const DB_NAME = `aeranexa_pulls_test_${randomBytes(4).toString("hex")}`;
process.env.DB_NAME = DB_NAME;

const { parseClientName, recordSubscriptionPull, listSubscriptionPulls } = await import("../../src/lib/server/subscription-pulls.ts");
const { getSubscriptionFeed } = await import("../../src/lib/server/subscription-feed.ts");
const { getDbPool } = await import("../../src/lib/server/db.ts");

let pool;
const token = randomBytes(16).toString("hex");

before(async () => {
  await import("../../scripts/migrate-database.mjs");
  pool = getDbPool();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, nickname, uuid, subscription_token) VALUES (1, 'p@test', 'x', 'p', ?, ?)`,
    [randomBytes(18).toString("hex").slice(0, 36), token],
  );
});

after(async () => {
  await pool?.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {});
  await pool?.end();
});

test("从 User-Agent 解析客户端名称和版本", () => {
  assert.equal(parseClientName("clash-verge/v2.2.3"), "Clash Verge v2.2.3");
  assert.equal(parseClientName("ClashVergeRev/2.0.1"), "Clash Verge v2.0.1");
  assert.equal(parseClientName("FlClash/v0.8.80 clash-verge Platform/android"), "FlClash v0.8.80");
  assert.equal(parseClientName("mihomo/1.19.0"), "Mihomo v1.19.0");
  assert.equal(parseClientName("Shadowrocket/2070 CFNetwork/1498 Darwin/23.6.0"), "Shadowrocket v2070");
  assert.equal(parseClientName("Stash/2.4.1 Clash/1.9.0"), "Stash v2.4.1");
  assert.equal(parseClientName("Happ/1.6.0"), "Happ v1.6.0");
  assert.equal(parseClientName("v2rayNG/1.9.30"), "v2rayNG v1.9.30");
  assert.equal(parseClientName("v2rayN/7.0"), "v2rayN v7.0");
  assert.equal(parseClientName("SFA/1.10.1 (sing-box 1.10.1)"), "sing-box");
  assert.equal(parseClientName("Mozilla/5.0 (Macintosh) Chrome/128"), "浏览器");
  assert.equal(parseClientName("okhttp/4.9.3"), "okhttp");
  assert.equal(parseClientName(""), "未知客户端");
});

test("按客户端 + IP 合并，最近的在前；30 天前的记录会被清理", async () => {
  await recordSubscriptionPull(1, { userAgent: "clash-verge/v2.2.3", ip: "1.1.1.1", hasHwid: false });
  await recordSubscriptionPull(1, { userAgent: "clash-verge/v2.2.3", ip: "1.1.1.1", hasHwid: false });
  await recordSubscriptionPull(1, { userAgent: "clash-verge/v2.2.3", ip: "2.2.2.2", hasHwid: false });
  await pool.query("INSERT INTO subscription_pulls (user_id, client, ip, pulled_at) VALUES (1, 'Old', '9.9.9.9', DATE_SUB(NOW(), INTERVAL 40 DAY))");
  await pool.query("UPDATE subscription_pulls SET pulled_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE ip = '1.1.1.1'");

  const groups = await listSubscriptionPulls(1);
  assert.deepEqual(groups.map((g) => [g.client, g.ip, g.times]), [
    ["Clash Verge v2.2.3", "2.2.2.2", 1],
    ["Clash Verge v2.2.3", "1.1.1.1", 2],
  ]);
  // 下一次记录时清理 30 天前的
  await recordSubscriptionPull(1, { userAgent: "Happ/1.6.0", ip: "3.3.3.3", hasHwid: true });
  const [[old]] = await pool.query("SELECT COUNT(*) AS n FROM subscription_pulls WHERE client = 'Old'");
  assert.equal(Number(old.n), 0);
});

test("拉取订阅时记录客户端和来源 IP（Clash Verge 不带 HWID 也会记）", async () => {
  await pool.query("DELETE FROM subscription_pulls");
  const headers = new Headers({ "user-agent": "clash-verge/v2.3.0", "x-forwarded-for": "8.8.8.8, 10.0.0.1" });
  const { readDeviceInfo } = await import("../../src/lib/server/devices.ts");
  await getSubscriptionFeed(token, "clash", readDeviceInfo(headers));
  // 记录是异步写入的，不阻塞订阅下发
  for (let i = 0; i < 20; i += 1) {
    const [rows] = await pool.query("SELECT client, ip, has_hwid FROM subscription_pulls WHERE user_id = 1");
    if (rows.length) {
      assert.deepEqual(rows.map((r) => [r.client, r.ip, Number(r.has_hwid)]), [["Clash Verge v2.3.0", "8.8.8.8", 0]]);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("拉取订阅后没有写入拉取记录");
});
