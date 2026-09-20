import { getDbPool } from "../lib/server/db";
import type { RowDataPacket } from "mysql2";
import { deliverTelegramNotifications, getTelegramSettings, handleTelegramUpdate } from "../lib/server/telegram";

const LOCK = "aeranexa:telegram-bot";
let stopping = false;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function poll() {
  const connection = await getDbPool().getConnection();
  try {
    const [cursorRows] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(update_id), 0) AS update_id FROM telegram_updates");
    let offset = Number(cursorRows[0]?.update_id || 0) + 1;
    while (!stopping) {
      const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [LOCK]);
      if (Number(lock[0]?.acquired) !== 1) { await sleep(5000); continue; }
      try {
        while (!stopping) {
          const settings = await getTelegramSettings();
          await deliverTelegramNotifications();
          if (!settings.enabled || settings.mode !== "polling" || !settings.token) { await sleep(5000); continue; }
          const response = await fetch(`https://api.telegram.org/bot${settings.token}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
          const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown[] } | null;
          if (!body?.ok || !Array.isArray(body.result)) { await sleep(3000); continue; }
          for (const update of body.result) {
            const updateId = Number((update as { update_id?: number }).update_id);
            await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
            if (Number.isSafeInteger(updateId)) offset = Math.max(offset, updateId + 1);
          }
        }
      } finally { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK]); }
    }
  } finally { connection.release(); await getDbPool().end(); }
}
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
poll().catch((error) => { console.error("[aeranexa-bot] fatal", error); process.exitCode = 1; });
