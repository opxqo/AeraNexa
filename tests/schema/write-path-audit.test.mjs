/**
 * Schema 读写路径审计
 *
 * 为什么要有这个测试
 * ------------------
 * 本项目已经连续出现三次同一类缺口：表建好了、读路径也写好了，但**没有任何写入方**，
 * 于是功能从用户角度看完全是死的，却能长期不被发现：
 *
 *   1. `user_traffic_records` / `node_traffic_records` —— 门户「流量明细」永远空着；
 *   2. `commission_logs` —— 邀请页佣金恒为 0、划转恒报「佣金余额不足」；
 *   3. `node_traffic_records` —— 补了写入后又长期没有任何读取方。
 *
 * 这类缺口肉眼看不见：单看 SQL 是完整的，单看页面是「暂时没数据」，
 * 只有把「谁读」和「谁写」放在一起比才能发现。
 *
 * 因此把审计固化成测试。它保证两件事：
 *
 *   - **新增缺口会被抓住**：新表若只有读没有写，且不在下方清单里，测试直接失败；
 *   - **清单不会腐坏**：清单里的表一旦被补上写入路径，测试反过来要求把它删掉
 *     （否则这条缺口会永远躺在清单里假装是「已知问题」，实际早就修好了）。
 *
 * 清单必须写明原因。它的作用不是让测试变绿，而是让缺口**可见、可评审**。
 * 运行不需要数据库与服务，纯静态分析。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = new URL("../../", import.meta.url);
const srcDir = fileURLToPath(new URL("src", repoRoot));

/** 有读取方但没有写入方。这些功能对用户而言是死的。 */
const WRITE_GAP_ALLOWLIST = {};

/** 全项目零引用：连读都没有，等于没实现。 */
const UNUSED_ALLOWLIST = {
  password_reset_tokens: "验证码式找回密码已落地；此表只为未来链接式重置预留，当前没有读取方。",
  // 注意：schema.sql 末尾确实会往这张表 INSERT 版本记录，但守卫只扫 src/，
  // 因此这里指的是**应用侧**零引用——没有任何地方读取它，
  // 运行时无法知道当前库处于哪个迁移版本。
  schema_migrations: "应用侧零引用：schema.sql 会写入版本记录，但没有任何代码读取它，运行时查不到当前迁移状态。",
};

/** 只写不读。审计流水暂时没有读取方，属于可接受但需留痕。 */
const WRITE_ONLY_ALLOWLIST = {
  payment_events: "支付事件流水，目前只写不读。",
};

async function collectSourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectSourceFiles(full)));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 统计每张表在源码里的读 / 写引用次数。
 *
 * 用「捕获 FROM/JOIN/INSERT/UPDATE/DELETE 后面的标识符」而不是按表名拼正则：
 * 后者会被反引号（`FROM \`users\``）和多行模板字符串打乱，前者不会。
 */
function countReferences(source) {
  const reads = new Map();
  const writes = new Map();
  const bump = (map, name) => map.set(name, (map.get(name) ?? 0) + 1);

  const patterns = [
    [/\b(?:FROM|JOIN)\s+`?(\w+)`?/gi, reads],
    // `INSERT IGNORE INTO t` / `INSERT INTO t` / `INSERT t` 都要算作 t 的写入方。
    // 早先只写了 `INSERT\s+(?:INTO\s+)?`，于是 `INSERT IGNORE INTO` 会把 IGNORE
    // 当成表名，telegram_updates 这类幂等去重写入被误判成「只读不写」。
    [/\bINSERT\s+(?:IGNORE\s+)?(?:INTO\s+)?`?(\w+)`?/gi, writes],
    [/\bREPLACE\s+(?:INTO\s+)?`?(\w+)`?/gi, writes],
    [/\bUPDATE\s+`?(\w+)`?/gi, writes],
    [/\bDELETE\s+FROM\s+`?(\w+)`?/gi, writes],
  ];
  for (const [pattern, map] of patterns) {
    for (const match of source.matchAll(pattern)) bump(map, match[1]);
  }
  return { reads, writes };
}

async function audit() {
  const schema = await readFile(fileURLToPath(new URL("database/schema.sql", repoRoot)), "utf8");
  const tables = [
    ...new Set([...schema.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)].map((m) => m[1])),
  ].sort();

  const files = await collectSourceFiles(srcDir);
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const { reads, writes } = countReferences(sources.join("\n"));

  return {
    tables,
    writeGaps: tables.filter((t) => (reads.get(t) ?? 0) > 0 && (writes.get(t) ?? 0) === 0),
    unused: tables.filter((t) => (reads.get(t) ?? 0) === 0 && (writes.get(t) ?? 0) === 0),
    writeOnly: tables.filter((t) => (reads.get(t) ?? 0) === 0 && (writes.get(t) ?? 0) > 0),
  };
}

test("schema 中每张表都能被解析到（审计本身没有失效）", async () => {
  const { tables } = await audit();
  assert.ok(tables.length >= 25, `应至少解析出 25 张表，实际 ${tables.length} 张`);
});

test("没有新的「只读不写」缺口", async () => {
  const { writeGaps } = await audit();
  const unexpected = writeGaps.filter((table) => !(table in WRITE_GAP_ALLOWLIST));
  assert.deepEqual(
    unexpected,
    [],
    `以下表有读取方但没有写入方，功能对用户是死的：${unexpected.join(", ")}。\n` +
      "请补上写入路径，或（仅在确认为已知缺口时）把它加进 WRITE_GAP_ALLOWLIST 并写明原因。",
  );
});

test("「只读不写」清单里没有已经修好的表", async () => {
  const { writeGaps } = await audit();
  const stale = Object.keys(WRITE_GAP_ALLOWLIST).filter((table) => !writeGaps.includes(table));
  assert.deepEqual(
    stale,
    [],
    `以下表已经在清单里，但实际已有写入路径了：${stale.join(", ")}。\n` +
      "说明缺口已被补上——请把它从 WRITE_GAP_ALLOWLIST 删掉，否则这条会永远假装是未修问题。",
  );
});

test("没有新的完全零引用表", async () => {
  const { unused } = await audit();
  const unexpected = unused.filter((table) => !(table in UNUSED_ALLOWLIST));
  assert.deepEqual(
    unexpected,
    [],
    `以下表全项目零引用：${unexpected.join(", ")}。\n` +
      "请接线，或把它加进 UNUSED_ALLOWLIST 并写明原因。",
  );
});

test("零引用清单里没有已经被接线的表", async () => {
  const { unused } = await audit();
  const stale = Object.keys(UNUSED_ALLOWLIST).filter((table) => !unused.includes(table));
  assert.deepEqual(stale, [], `以下表已不再是零引用，请从 UNUSED_ALLOWLIST 删除：${stale.join(", ")}`);
});

test("只写不读的表都在清单里且未失效", async () => {
  const { writeOnly } = await audit();
  const unexpected = writeOnly.filter((table) => !(table in WRITE_ONLY_ALLOWLIST));
  assert.deepEqual(
    unexpected,
    [],
    `以下表只写不读，数据存了却没人看：${unexpected.join(", ")}。\n` +
      "请补上读取方，或把它加进 WRITE_ONLY_ALLOWLIST 并写明原因。",
  );
  const stale = Object.keys(WRITE_ONLY_ALLOWLIST).filter((table) => !writeOnly.includes(table));
  assert.deepEqual(stale, [], `以下表已不再是只写不读，请从 WRITE_ONLY_ALLOWLIST 删除：${stale.join(", ")}`);
});
