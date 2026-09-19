import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const databaseName = process.env.DB_NAME;

if (databaseName !== "aeranexa") {
  throw new Error(`Refusing to migrate unexpected database: ${databaseName || "<missing>"}`);
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
  await connection.query(schema);
  const [tables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [databaseName],
  );
  console.log(`AeraNexa database is ready (${tables.length} tables).`);
} finally {
  await connection.end();
}
