import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { findSettingDef, normalizeSettingValue, SETTING_DEFS, type SettingDef, type SettingGroup, type SettingKind } from "./settings-schema";

/**
 * 系统设置读写。取值优先级：后台保存的值 → 同名环境变量 → 默认值。
 *
 * Next.js 与节点 worker 是两个进程，各自缓存 CACHE_TTL_MS；保存时清掉本进程缓存，
 * 另一个进程最迟 CACHE_TTL_MS 后读到新值——worker 每轮都会重新取，无需重启。
 */

const CACHE_TTL_MS = 5_000;

type SettingRow = RowDataPacket & {
  setting_key: string;
  value_text: string | null;
  value_ciphertext: string | null;
  value_iv: string | null;
  value_auth_tag: string | null;
  updated_at: Date;
};

let cache: { rows: Map<string, SettingRow>; loadedAt: number } | null = null;

function encryptionKey(): Buffer | null {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!configured) return null;
  const key = Buffer.from(configured, "base64");
  return key.length === 32 ? key : null;
}

export function settingsEncryptionReady(): boolean {
  return encryptionKey() !== null;
}

function encrypt(plain: string): { ciphertext: string; iv: string; authTag: string } {
  const key = encryptionKey();
  if (!key) throw new Error("服务器未配置 SETTINGS_ENCRYPTION_KEY（Base64 编码的 32 字节），不能保存敏感设置");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decrypt(row: SettingRow): string | null {
  const key = encryptionKey();
  if (!key || !row.value_ciphertext || !row.value_iv || !row.value_auth_tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.value_iv, "base64"));
    decipher.setAuthTag(Buffer.from(row.value_auth_tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.value_ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // 主密钥被更换过：密文无法解开，按「未设置」处理并回退环境变量，而不是让整个功能崩掉。
    return null;
  }
}

async function loadRows(): Promise<Map<string, SettingRow>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const [rows] = await getDbPool().query<SettingRow[]>(
    "SELECT setting_key, value_text, value_ciphertext, value_iv, value_auth_tag, updated_at FROM system_settings",
  );
  cache = { rows: new Map(rows.map((row) => [row.setting_key, row])), loadedAt: Date.now() };
  return cache.rows;
}

type Resolved = { value: string; source: "admin" | "env" | "default" };

function resolve(def: SettingDef, row: SettingRow | undefined): Resolved {
  const stored = row ? (def.kind === "secret" ? decrypt(row) : row.value_text) : null;
  if (stored) return { value: stored, source: "admin" };
  const fromEnv = def.env ? process.env[def.env]?.trim() : "";
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: def.defaultValue, source: "default" };
}

function requireDef(key: string): SettingDef {
  const def = findSettingDef(key);
  if (!def) throw new Error(`未知的系统设置：${key}`);
  return def;
}

export async function getSetting(key: string): Promise<string> {
  const def = requireDef(key);
  return resolve(def, (await loadRows()).get(key)).value;
}

/** 数值设置：非法或越界时退回默认值，而不是把 NaN 带进业务逻辑。 */
export async function getNumberSetting(key: string): Promise<number> {
  const def = requireDef(key);
  const checked = normalizeSettingValue(def, await getSetting(key));
  return Number(checked.ok ? checked.value : def.defaultValue);
}

/** 订阅链接前缀（去掉末尾斜杠）。 */
export async function getSubscribeBaseUrl(): Promise<string> {
  return (await getSetting("subscribe.base_url")).replace(/\/+$/, "");
}

export type ClashSubscriptionProvider = "aeranexa" | "3x-ui";

/** Clash / Mihomo 内容的渲染来源；未知值安全回退到 AeraNexa。 */
export async function getClashSubscriptionProvider(): Promise<ClashSubscriptionProvider> {
  return (await getSetting("subscribe.clash_provider")) === "3x-ui" ? "3x-ui" : "aeranexa";
}

/** 系统设置「VLESS 流控」是否开启 Vision。Reconciler 与订阅必须用同一判定，否则 xray 会拒绝连接。 */
export async function isVisionFlowEnabled(): Promise<boolean> {
  return (await getSetting("panel.vless_flow")) === "xtls-rprx-vision";
}

export type AdminSettingView = {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  kind: SettingKind;
  env: string | null;
  unit: string | null;
  options: readonly { value: string; label: string }[] | null;
  min: number | null;
  max: number | null;
  defaultValue: string;
  /** 当前生效值；敏感项永远为空字符串，只通过 configured 表达是否已配置。 */
  value: string;
  configured: boolean;
  source: "admin" | "env" | "default";
  updatedAt: string | null;
};

export async function listSettingsForAdmin(): Promise<AdminSettingView[]> {
  cache = null;
  const rows = await loadRows();
  return SETTING_DEFS.map((def) => {
    const row = rows.get(def.key);
    const resolved = resolve(def, row);
    return {
      key: def.key,
      group: def.group,
      label: def.label,
      description: def.description,
      kind: def.kind,
      env: def.env ?? null,
      unit: def.unit ?? null,
      options: def.options ?? null,
      min: def.min ?? null,
      max: def.max ?? null,
      defaultValue: def.defaultValue,
      value: def.kind === "secret" ? "" : resolved.value,
      configured: resolved.value !== "",
      source: resolved.source,
      updatedAt: row && resolved.source === "admin" ? new Date(row.updated_at).toISOString() : null,
    };
  });
}

export type SettingsUpdate = {
  /** 要写入的值；敏感项传空字符串表示「保持不变」。非敏感项传空字符串表示「清除后台值」。 */
  values: Record<string, string>;
  /** 要清除后台值（回退到环境变量 / 默认值）的敏感项。 */
  clearSecrets: string[];
};

/** 校验全部输入后再写库；任一项不合法则整体不写。返回实际发生变化的 key。 */
export async function saveSettings(update: SettingsUpdate, adminId: number): Promise<string[]> {
  const writes: Array<{ def: SettingDef; value: string | null }> = [];
  for (const [key, raw] of Object.entries(update.values)) {
    const def = requireDef(key);
    const trimmed = raw.trim();
    if (def.kind === "secret") {
      if (!trimmed) continue;
      const checked = normalizeSettingValue(def, trimmed);
      if (!checked.ok) throw new Error(checked.error);
      writes.push({ def, value: checked.value });
      continue;
    }
    if (!trimmed) {
      writes.push({ def, value: null });
      continue;
    }
    const checked = normalizeSettingValue(def, trimmed);
    if (!checked.ok) throw new Error(checked.error);
    writes.push({ def, value: checked.value });
  }
  for (const key of update.clearSecrets) {
    const def = requireDef(key);
    if (def.kind !== "secret") continue;
    writes.push({ def, value: null });
  }

  cache = null;
  const current = await loadRows();
  const changed: string[] = [];
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const { def, value } of writes) {
      const row = current.get(def.key);
      if (value === null) {
        if (!row) continue;
        await connection.execute("DELETE FROM system_settings WHERE setting_key = ?", [def.key]);
        changed.push(def.key);
        continue;
      }
      if (def.kind === "secret") {
        if (row && decrypt(row) === value) continue;
        const sealed = encrypt(value);
        await connection.execute(
          `INSERT INTO system_settings (setting_key, value_text, value_ciphertext, value_iv, value_auth_tag, updated_by)
           VALUES (?, NULL, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value_text = NULL, value_ciphertext = VALUES(value_ciphertext), value_iv = VALUES(value_iv),
             value_auth_tag = VALUES(value_auth_tag), updated_by = VALUES(updated_by)`,
          [def.key, sealed.ciphertext, sealed.iv, sealed.authTag, adminId],
        );
      } else {
        if (row?.value_text === value) continue;
        await connection.execute(
          `INSERT INTO system_settings (setting_key, value_text, updated_by) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), value_ciphertext = NULL, value_iv = NULL,
             value_auth_tag = NULL, updated_by = VALUES(updated_by)`,
          [def.key, value, adminId],
        );
      }
      changed.push(def.key);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
    cache = null;
  }
  return changed;
}
