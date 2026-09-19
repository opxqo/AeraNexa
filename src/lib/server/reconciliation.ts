import "server-only";

import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { badRequest, conflict, notFound } from "./errors";
import { getDbPool } from "./db";

const REQUIRED_COLUMNS = ["provider_trade_no", "amount_cents", "status", "paid_at", "currency"];

type ImportedRow = { providerTradeNo: string; amount: number; status: string; paidAt: string; currency: string };

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quote && text[index + 1] === '"') { value += '"'; index += 1; } else quote = !quote;
    } else if (char === "," && !quote) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += char;
  }
  if (quote) throw badRequest("CSV 引号未闭合");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCsv(source: string): ImportedRow[] {
  const rows = csvRows(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw badRequest("CSV 至少需要表头和一条数据");
  const header = rows[0].map((column) => column.toLowerCase());
  if (header.length !== REQUIRED_COLUMNS.length || REQUIRED_COLUMNS.some((column, index) => header[index] !== column)) {
    throw badRequest(`CSV 表头必须为：${REQUIRED_COLUMNS.join(",")}`);
  }
  return rows.slice(1).map((row, index) => {
    if (row.length !== REQUIRED_COLUMNS.length) throw badRequest(`第 ${index + 2} 行列数不正确`);
    const amount = Number(row[1]);
    const status = row[2].toLowerCase();
    const paidAt = row[3];
    const currency = row[4].toUpperCase();
    if (!row[0] || !Number.isSafeInteger(amount) || amount <= 0 || !["paid", "succeeded"].includes(status) || currency !== "CNY" || Number.isNaN(Date.parse(paidAt))) {
      throw badRequest(`第 ${index + 2} 行数据不符合模板要求`);
    }
    return { providerTradeNo: row[0].slice(0, 255), amount, status, paidAt, currency };
  });
}

export async function importReconciliationCsv(input: { provider: string; filename: string; csv: string; adminId: number }) {
  const provider = input.provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,50}$/.test(provider)) throw badRequest("渠道标识不正确");
  if (Buffer.byteLength(input.csv, "utf8") > 2_000_000) throw badRequest("CSV 文件不能超过 2MB");
  const records = parseCsv(input.csv);
  if (records.length > 10_000) throw badRequest("单次最多导入 10000 行");
  const checksum = createHash("sha256").update(input.csv).digest("hex");
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM reconciliation_batches WHERE provider = ? AND file_sha256 = ? LIMIT 1 FOR UPDATE",
      [provider, checksum],
    );
    if (existing[0]) throw conflict("该渠道的相同账单已导入，不能重复导入");
    const [batch] = await connection.execute<ResultSetHeader>(
      `INSERT INTO reconciliation_batches (provider, file_sha256, filename, imported_by_admin_id, total_rows)
       VALUES (?, ?, ?, ?, ?)`,
      [provider, checksum, input.filename.trim().slice(0, 255) || "reconciliation.csv", input.adminId, records.length],
    );
    const batchId = Number(batch.insertId);
    const seen = new Set<string>();
    let matched = 0, issues = 0;
    for (let offset = 0; offset < records.length; offset += 1) {
      const record = records[offset];
      let matchStatus = "missing_transaction";
      let transactionId: number | null = null;
      if (seen.has(record.providerTradeNo)) matchStatus = "duplicate_provider_trade";
      else {
        seen.add(record.providerTradeNo);
        const [transactions] = await connection.execute<RowDataPacket[]>(
          `SELECT pt.id, pt.amount, pt.currency, pt.status
             FROM payment_transactions pt
             INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
            WHERE pm.provider = ? AND pt.provider_trade_no = ? LIMIT 2`,
          [provider, record.providerTradeNo],
        );
        if (transactions.length > 1) matchStatus = "duplicate_provider_trade";
        else if (transactions[0]) {
          const transaction = transactions[0];
          transactionId = Number(transaction.id);
          if (Number(transaction.amount) !== record.amount || String(transaction.currency) !== record.currency) matchStatus = "amount_mismatch";
          else if (String(transaction.status) !== "completed") matchStatus = "status_mismatch";
          else matchStatus = "matched";
        }
      }
      if (matchStatus === "matched") matched += 1; else issues += 1;
      await connection.execute(
        `INSERT INTO reconciliation_rows
          (batch_id, line_number, provider_trade_no, amount_cents, currency, provider_status, paid_at, match_status, transaction_id, resolution_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchId, offset + 2, record.providerTradeNo, record.amount, record.currency, record.status, new Date(record.paidAt), matchStatus, transactionId, matchStatus === "matched" ? "not_needed" : "open"],
      );
    }
    await connection.execute("UPDATE reconciliation_batches SET matched_rows = ?, issue_rows = ? WHERE id = ?", [matched, issues, batchId]);
    await connection.commit();
    return { batchId, total: records.length, matched, issues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function resolveReconciliationRow(rowId: number, adminId: number, rawNote: string) {
  const note = rawNote.trim().slice(0, 500);
  if (!note) throw badRequest("请填写差异处理备注");
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE reconciliation_rows SET resolution_status = 'ignored', resolution_note = ?, resolved_by_admin_id = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND resolution_status = 'open'`,
    [note, adminId, rowId],
  );
  if (result.affectedRows !== 1) throw notFound("待处理对账差异不存在或已处理");
}

export const reconciliationCsvTemplate = `${REQUIRED_COLUMNS.join(",")}\nTRADE-EXAMPLE-001,1000,succeeded,2026-09-20T12:00:00Z,CNY\n`;
