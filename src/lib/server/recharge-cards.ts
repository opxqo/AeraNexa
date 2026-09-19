import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { badRequest, conflict, notFound } from "./errors";
import { getDbPool } from "./db";

const CARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CARD_PREFIX = "ANX";
// 单条 INSERT 携带的行数。500 行 × 4 个占位符 = 2000 个参数，远低于 MySQL 65535 的上限，
// 同时把 5000 张卡密的往返次数从 5000 次压到 10 次。
const CARD_INSERT_CHUNK_SIZE = 500;

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cardSecret(): string {
  // AUTH_SESSION_SECRET 已是本项目生产环境的必填服务端密钥；允许部署时单独轮换卡密密钥。
  return process.env.RECHARGE_CARD_SECRET?.trim()
    || process.env.AUTH_SESSION_SECRET?.trim()
    || "aeranexa-local-recharge-card-secret";
}

export function normalizeRechargeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

function hashRechargeCode(code: string): string {
  return createHmac("sha256", cardSecret()).update(normalizeRechargeCode(code)).digest("hex");
}

function randomCode(): string {
  const bytes = randomBytes(20);
  let body = "";
  for (const byte of bytes) body += CARD_ALPHABET[byte % CARD_ALPHABET.length];
  return `${CARD_PREFIX}-${body.match(/.{1,4}/g)?.join("-")}`;
}

function newBatchNo(): string {
  return `RC${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`.slice(0, 24);
}

export type CreatedRechargeBatch = {
  id: number;
  batchNo: string;
  name: string;
  amount: number;
  expiresAt: string | null;
  cards: string[];
};

export async function createRechargeCardBatch(
  adminId: number,
  input: { name: string; amount: number; quantity: number; expiresAt: string | null },
): Promise<CreatedRechargeBatch> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw badRequest("请填写批次名称");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw badRequest("卡密面额不正确");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 5_000) {
    throw badRequest("单次生成数量需在 1 到 5000 之间");
  }

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const batchNo = newBatchNo();
    const [batch] = await connection.execute<ResultSetHeader>(
      `INSERT INTO recharge_card_batches (batch_no, name, amount, quantity, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [batchNo, name, input.amount, input.quantity, input.expiresAt, adminId],
    );
    const batchId = Number(batch.insertId);

    // 预生成全部卡密。20 个安全字符的随机码碰撞概率极低，唯一索引仍作为最终保护；
    // 先在内存里去重，避免同一批次内的自碰撞把整块 INSERT 打成唯一索引错误。
    const cards: string[] = [];
    const seen = new Set<string>();
    while (cards.length < input.quantity) {
      const code = randomCode();
      const normalized = normalizeRechargeCode(code);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      cards.push(code);
    }

    // 逐行 INSERT 最多产生 5000 次往返（实测 5000 张耗时 555ms），改为分块多值 INSERT 后
    // 往返降到 10 次（真实函数实测 5000 张 94ms）。整批仍在同一事务内，原子性不变。
    for (let offset = 0; offset < cards.length; offset += CARD_INSERT_CHUNK_SIZE) {
      const chunk = cards.slice(offset, offset + CARD_INSERT_CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      const params = chunk.flatMap((code) => [
        batchId,
        hashRechargeCode(code),
        normalizeRechargeCode(code).slice(-4),
        input.amount,
      ]);
      try {
        await connection.execute(
          `INSERT INTO recharge_cards (batch_id, code_hash, code_tail, amount) VALUES ${placeholders}`,
          params,
        );
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
        // 命中唯一索引（极罕见，例如与历史卡密撞码）：整块回退为逐行插入，保留原有的重试语义。
        for (let index = 0; index < chunk.length; index += 1) {
          let inserted = false;
          for (let attempts = 0; attempts < 5 && !inserted; attempts += 1) {
            const candidate = attempts === 0 ? chunk[index] : randomCode();
            try {
              await connection.execute(
                `INSERT INTO recharge_cards (batch_id, code_hash, code_tail, amount)
                 VALUES (?, ?, ?, ?)`,
                [batchId, hashRechargeCode(candidate), normalizeRechargeCode(candidate).slice(-4), input.amount],
              );
              // 重试时实际落库的是新码，返回值必须跟着改，否则返回的明文与库内哈希对不上。
              cards[offset + index] = candidate;
              inserted = true;
            } catch (innerError) {
              if (!(innerError instanceof Error) || !("code" in innerError) || (innerError as { code?: string }).code !== "ER_DUP_ENTRY") {
                throw innerError;
              }
            }
          }
          if (!inserted) throw conflict("生成卡密时出现重复，请重试");
        }
      }
    }
    await connection.commit();
    return { id: batchId, batchNo, name, amount: input.amount, expiresAt: input.expiresAt, cards };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function disableRechargeCard(cardId: number): Promise<boolean> {
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE recharge_cards SET status = 'disabled', disabled_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'unused'`,
    [cardId],
  );
  if (result.affectedRows === 1) return true;
  const [rows] = await getDbPool().execute<RowDataPacket[]>("SELECT status FROM recharge_cards WHERE id = ? LIMIT 1", [cardId]);
  if (!rows[0]) throw notFound("卡密不存在");
  throw conflict("只有未使用的卡密可以停用");
}

/** 恢复一张尚未兑换且未过期的卡密；已兑换记录不可逆。 */
export async function enableRechargeCard(cardId: number): Promise<boolean> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT c.status, b.expires_at
         FROM recharge_cards c INNER JOIN recharge_card_batches b ON b.id = c.batch_id
        WHERE c.id = ? LIMIT 1 FOR UPDATE`,
      [cardId],
    );
    const card = rows[0];
    if (!card) throw notFound("卡密不存在");
    if (String(card.status) !== "disabled") throw conflict("只有已停用的卡密可以恢复启用");
    if (card.expires_at && new Date(card.expires_at as Date).getTime() < Date.now()) throw conflict("该卡密已过期，无法恢复启用");
    await connection.execute(
      "UPDATE recharge_cards SET status = 'unused', disabled_at = NULL WHERE id = ? AND status = 'disabled'",
      [cardId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function redeemRechargeCard(userId: number, rawCode: string) {
  const code = normalizeRechargeCode(rawCode);
  if (!new RegExp(`^${CARD_PREFIX}[${CARD_ALPHABET}]{20}$`).test(code)) {
    throw badRequest("卡密格式不正确");
  }

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [cards] = await connection.execute<RowDataPacket[]>(
      `SELECT c.id, c.amount, c.status, b.name AS batch_name, b.expires_at
         FROM recharge_cards c INNER JOIN recharge_card_batches b ON b.id = c.batch_id
        WHERE c.code_hash = ? LIMIT 1 FOR UPDATE`,
      [hashRechargeCode(code)],
    );
    const card = cards[0];
    if (!card) throw notFound("卡密不存在");
    if (String(card.status) === "redeemed") throw conflict("该卡密已被使用");
    if (String(card.status) === "disabled") throw conflict("该卡密已被停用");
    if (card.expires_at && new Date(card.expires_at as Date).getTime() < Date.now()) throw conflict("该卡密已过期");

    const [users] = await connection.execute<RowDataPacket[]>(
      "SELECT balance, is_active FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
      [userId],
    );
    const user = users[0];
    if (!user) throw notFound("用户不存在");
    if (!user.is_active) throw conflict("账户已被停用，无法充值");

    const amount = asNumber(card.amount);
    const nextBalance = asNumber(user.balance) + amount;
    await connection.execute("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextBalance, userId]);
    const [wallet] = await connection.execute<ResultSetHeader>(
      `INSERT INTO wallet_transactions
        (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
       VALUES (?, 'balance', 'recharge_card', ?, ?, 'recharge_card', ?, ?)`,
      [userId, amount, nextBalance, card.id, `卡密充值 · ${String(card.batch_name).slice(0, 100)}`],
    );
    await connection.execute(
      `UPDATE recharge_cards SET status = 'redeemed', redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'unused'`,
      [userId, card.id],
    );
    await connection.commit();
    return { balance: nextBalance, credited_amount: amount, transaction_id: Number(wallet.insertId) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listWalletTransactions(userId: number, page?: number, pageSize?: number) {
  const safePage = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const safeSize = Math.min(Number.isInteger(pageSize) && (pageSize as number) > 0 ? (pageSize as number) : 20, 100);
  const offset = (safePage - 1) * safeSize;
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description, created_at
       FROM wallet_transactions WHERE user_id = ? AND wallet_type = 'balance'
      ORDER BY id DESC LIMIT ${safeSize} OFFSET ${offset}`,
    [userId],
  );
  const [count] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = ? AND wallet_type = 'balance'",
    [userId],
  );
  return {
    items: rows.map((row) => ({
      id: asNumber(row.id), wallet_type: "balance", transaction_type: String(row.transaction_type),
      amount: asNumber(row.amount), balance_after: asNumber(row.balance_after),
      reference_type: row.reference_type ? String(row.reference_type) : null,
      reference_id: row.reference_id === null ? null : asNumber(row.reference_id),
      description: row.description ? String(row.description) : null,
      created_at: Math.floor(new Date(row.created_at as Date).getTime() / 1000),
    })),
    total: asNumber(count[0]?.total), page: safePage, pageSize: safeSize,
  };
}

export async function adjustUserBalance(
  connection: PoolConnection,
  userId: number,
  previousBalance: number,
  nextBalance: number,
  adminId: number,
): Promise<void> {
  const delta = nextBalance - previousBalance;
  if (!delta) return;
  await connection.execute(
    `INSERT INTO wallet_transactions
      (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
     VALUES (?, 'balance', 'admin_adjustment', ?, ?, 'admin_user', ?, '管理员调整账户余额')`,
    [userId, delta, nextBalance, adminId],
  );
}
