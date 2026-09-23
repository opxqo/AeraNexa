import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const databaseName = process.env.DB_NAME || "aeranexa";

// 库名会被直接拼进 DDL（CREATE DATABASE / USE），标识符在 mysql2 里不能用 ? 占位符转义，
// 所以这里自己校验字符集，而不是依赖 SQL 参数化。
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
  throw new Error(`Invalid DB_NAME (must match [A-Za-z_][A-Za-z0-9_]*): ${databaseName}`);
}

const schemaUrl = new URL("../database/schema.sql", import.meta.url);
const schema = await readFile(schemaUrl, "utf8");
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
});

// 滚动部署或多副本时可能有多个实例同时启动：schema.sql 里「先查 information_schema 再 ALTER」
// 不是原子的，并发执行会撞上重复加列等错误。用命名锁让迁移串行执行（锁不依赖具体库，库不存在时也可用）。
const MIGRATION_LOCK = "aeranexa:migrate";
const MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

try {
  const [[lock]] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
    MIGRATION_LOCK,
    MIGRATION_LOCK_TIMEOUT_SECONDS,
  ]);
  if (Number(lock?.acquired) !== 1) {
    throw new Error(`等待其他实例完成数据库迁移超时（${MIGRATION_LOCK_TIMEOUT_SECONDS} 秒）`);
  }
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.query(`USE \`${databaseName}\``);
  await connection.query(schema);
  const [tables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [databaseName],
  );
  console.log(`AeraNexa database "${databaseName}" is ready (${tables.length} tables).`);
} finally {
  // 连接关闭时锁也会自动释放，这里显式释放只是为了不依赖这一点。
  await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
  await connection.end();
}
