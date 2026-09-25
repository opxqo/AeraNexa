import "server-only";

import { getDbPool } from "./db";

/**
 * 给用户排队一条 Telegram 通知（由 bot 进程的 deliverTelegramNotifications 实际发送）。
 * 单独成文件、只依赖数据库：tickets-admin 等模块要用它，若从 telegram.ts 引入会形成
 * telegram → telegram-admin → tickets-admin → telegram 的循环依赖，bot 进程启动即报错。
 */
export async function enqueueTelegramNotification(userId: number, key: string, kind: string) {
  await getDbPool().execute("INSERT IGNORE INTO telegram_notification_deliveries (user_id, notification_key, kind) VALUES (?, ?, ?)", [userId, key, kind]);
}
