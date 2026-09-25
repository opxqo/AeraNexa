/**
 * 一键迁移的命令行入口（与后台「数据迁移」页共用 src/lib/server/backup.ts）。
 *
 *   pnpm backup:export [--logs] [-o 文件]     # 导出整站数据 + 加密主密钥（明文，gzip）
 *   pnpm backup:restore <文件> [--yes] [--env-file 路径]
 *   pnpm backup:restore --from <迁移码> [--yes] [--env-file 路径]   # 直接从旧面板在线拉取
 *   AERANEXA_MIGRATION_CODE=<迁移码> pnpm backup:restore --from-env …   # 同上，迁移码不出现在命令行里
 *   pnpm backup:code --origin https://旧面板域名 [--logs]              # 本机作为旧面板，生成一次性迁移码
 *
 * restore 会先建库建表，再清空当前库写入备份，最后把备份里的密钥合并进 .env.local（默认）。
 * 文件不加密：拿到备份等于拿到整站，用完请删除。
 */
import "./ts-register.mjs";

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pipeline } from "node:stream/promises";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const backup = await import(new URL("../src/lib/server/backup.ts", import.meta.url).href);
const migration = await import(new URL("../src/lib/server/migration.ts", import.meta.url).href);
const { getDbPool } = await import(new URL("../src/lib/server/db.ts", import.meta.url).href);

/** 合并写入 env 文件：已有的键原地替换，缺的追加；有值被覆盖时先备份原文件。 */
async function mergeEnvFile(path, env) {
  const original = existsSync(path) ? await readFile(path, "utf8") : "";
  const lines = original ? original.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(env));
  let overwritten = 0;
  const format = (key, value) => `${key}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`;
  const merged = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    const current = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (current === value) return line;
    overwritten += 1;
    return format(match[1], value);
  });
  if (!pending.size && !overwritten) return { added: 0, overwritten: 0 };
  if (overwritten && original) await copyFile(path, `${path}.bak`);
  if (pending.size) {
    if (merged.length && merged.at(-1) !== "") merged.push("");
    merged.push("# 由 pnpm backup:restore 从迁移备份写入");
    for (const [key, value] of pending) merged.push(format(key, value));
  }
  await writeFile(path, `${merged.join("\n").replace(/\n*$/, "")}\n`, { mode: 0o600 });
  return { added: pending.size, overwritten };
}

async function runExport() {
  const includeLogs = flag("--logs");
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const output = resolve(option("-o") ?? `aeranexa-backup-${stamp}.ndjson.gz`);
  await pipeline(backup.createBackupStream({ includeLogs }), createWriteStream(output, { mode: 0o600 }));
  console.log(`已导出到 ${output}${includeLogs ? "（含日志）" : ""}`);
  console.log("注意：文件未加密，包含全部用户数据与加密主密钥，传输完成后请删除。");
}

async function runRestore() {
  // --from-env：从环境变量读迁移码，避免它出现在进程列表和 pnpm 回显的命令行里（安装脚本用这种方式）
  const code = option("--from") || (flag("--from-env") ? process.env.AERANEXA_MIGRATION_CODE?.trim() : undefined);
  if (flag("--from-env") && !code) throw new Error("--from-env 需要设置环境变量 AERANEXA_MIGRATION_CODE");
  const file = args.find((arg) => !arg.startsWith("-") && arg !== option("--env-file") && arg !== code);
  if (!code && (!file || !existsSync(file))) {
    throw new Error("用法：pnpm backup:restore <备份文件> | --from <迁移码>  [--yes] [--env-file 路径]");
  }
  const envFile = resolve(option("--env-file") ?? ".env.local");

  // 先确认来源有效，再动数据库：文件读首行校验；迁移码先解析（地址、格式），真正连接在确认之后。
  let source;
  if (code) {
    source = `旧面板 ${migration.parseMigrationCode(code).origin}`;
  } else {
    await backup.readBackupEnv(createReadStream(file));
    source = file;
  }

  if (!flag("--yes")) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`将清空数据库「${process.env.DB_NAME || "aeranexa"}」并用 ${source} 的数据覆盖，输入 yes 继续：`);
    prompt.close();
    if (answer.trim() !== "yes") {
      console.log("已取消");
      return;
    }
  }

  await import("./migrate-database.mjs");
  if (code) console.log(`正在从 ${source} 拉取数据…`);
  // 在线迁移传「用时再打开」的函数：确认 worker 已停之后才连接旧面板，避免迁移码白白作废
  const input = code ? () => migration.openRemoteBackup(code) : createReadStream(file);
  let env = {};
  const result = await backup.restoreBackup(input, { onMeta: (meta) => { env = meta.env; } });
  const total = result.tables.reduce((sum, item) => sum + item.rows, 0);
  console.log(`已恢复 ${result.tables.length} 张表、${total} 行（备份时间 ${result.createdAt}）`);
  for (const item of result.tables) if (item.rows) console.log(`  ${item.name}: ${item.rows}`);
  if (!result.complete) console.warn("警告：数据末尾不完整（可能传输中断），部分数据可能缺失，建议重新迁移。");

  const merged = await mergeEnvFile(envFile, env);
  if (merged.added || merged.overwritten) {
    console.log(`已写入 ${envFile}：新增 ${merged.added} 项，覆盖 ${merged.overwritten} 项${merged.overwritten ? `（原文件备份为 ${envFile}.bak）` : ""}`);
  }
  console.log("完成。请重启 web / worker / bot；托管平台（如 Zeabur）请把备份里的密钥设到服务的环境变量中。");
}

async function runCode() {
  const origin = option("--origin");
  if (!origin) throw new Error("用法：pnpm backup:code --origin https://本站对外地址 [--logs]");
  const { recordAudit } = await import(new URL("../src/lib/server/audit.ts", import.meta.url).href);
  const created = await migration.createMigrationCode(null, { origin, includeLogs: flag("--logs") });
  await recordAudit({ action: "admin.migration_token_created", resourceType: "migration", context: { origin: created.origin, includeLogs: flag("--logs"), source: "cli" } });
  const expires = new Date(Date.now() + created.expiresInSeconds * 1000).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  console.log(`迁移码（${expires} 前有效，只能使用一次；新面板将连接 ${created.origin}）：`);
  console.log(created.code);
}

try {
  if (command === "export") await runExport();
  else if (command === "code") await runCode();
  else if (command === "restore") await runRestore();
  else throw new Error("用法：backup.mjs export [--logs] [-o 文件] | restore <文件> | restore --from <迁移码>  [--yes] [--env-file 路径] | code --origin <地址> [--logs]");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await getDbPool().end().catch(() => {});
}
