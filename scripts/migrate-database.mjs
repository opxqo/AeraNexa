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

try {
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
  await connection.end();
}
