import { getDbPool } from "../lib/server/db";
import type { RowDataPacket } from "mysql2";
import { deliverTelegramNotifications, getTelegramSettings, handleTelegramUpdate, telegramApiBase } from "../lib/server/telegram";
import { scanAdminEvents } from "../lib/server/telegram-admin";
import { drainRuntimeLogs, emitRuntimeLog, safeError } from "../lib/server/runtime-logs";

const LOCK = "aeranexa:telegram-bot";
let stopping = false;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function poll() {
  await emitRuntimeLog({ service: "bot", category: "bot", level: "info", eventCode: "bot.started", message: "Telegram Bot started" });
  const connection = await getDbPool().getConnection();
  try {
    const [cursorRows] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(update_id), 0) AS update_id FROM telegram_updates");
    let offset = Number(cursorRows[0]?.update_id || 0) + 1;
    while (!stopping) {
      const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [LOCK]);
      if (Number(lock[0]?.acquired) !== 1) { await sleep(5000); continue; }
      try {
        while (!stopping) {
          // 单轮出错（Telegram 网络抖动、数据库短暂不可用）只记警告、稍后重试，不让整个进程退出
          try {
            const settings = await getTelegramSettings();
            // 管理员通知（新订单、新工单、系统告警）：自带 30 秒节流；Bot 停用时不扫描，避免积压后刷屏
            if (settings.enabled) {
              await scanAdminEvents().catch((error: unknown) => emitRuntimeLog({ service: "bot", category: "bot", level: "error", eventCode: "bot.admin_scan_failed", message: safeError(error) }));
            }
            await deliverTelegramNotifications();
            if (!settings.enabled || settings.mode !== "polling" || !settings.token) { await sleep(5000); continue; }
            const response = await fetch(`${telegramApiBase()}/bot${settings.token}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
            const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown[] } | null;
            if (!body?.ok || !Array.isArray(body.result)) {
              await emitRuntimeLog({ service: "bot", category: "bot", level: "warn", eventCode: "bot.poll_failed", message: "Telegram getUpdates returned an invalid response" });
              await sleep(3000); continue;
            }
            for (const update of body.result) {
              const updateId = Number((update as { update_id?: number }).update_id);
              // 单条消息处理失败只影响这一条；offset 照常前进，否则会卡在这条上反复重试
              try {
                await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
                await emitRuntimeLog({ service: "bot", category: "bot", level: "info", eventCode: "bot.update_processed", message: "Telegram update processed", details: { updateId } });
              } catch (error) {
                await emitRuntimeLog({ service: "bot", category: "bot", level: "error", eventCode: "bot.update_failed", message: safeError(error), details: { updateId } });
              }
              if (Number.isSafeInteger(updateId)) offset = Math.max(offset, updateId + 1);
            }
          } catch (error) {
            await emitRuntimeLog({ service: "bot", category: "bot", level: "warn", eventCode: "bot.loop_error", message: safeError(error) });
            await sleep(3000);
          }
        }
      } finally { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK]); }
    }
  } finally { connection.release(); }
}
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
poll().catch(async (error) => {
  await emitRuntimeLog({ service: "bot", category: "bot", level: "error", eventCode: "bot.fatal", message: safeError(error) });
  process.exitCode = 1;
}).finally(async () => { await drainRuntimeLogs(); await getDbPool().end().catch(() => {}); });
