import "server-only";

import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new DatabaseConfigError(`Missing database environment variable: ${name}`);
  }
  return value;
}

/** 连接参数；连接池与需要独立连接的场景（如备份时的流式读取）共用。 */
export function getDbConnectionOptions() {
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port <= 0) {
    throw new DatabaseConfigError("DB_PORT must be a positive integer");
  }
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port,
    database: process.env.DB_NAME || "aeranexa",
    user: process.env.DB_USER || "root",
    password: getRequiredEnv("DB_PASSWORD"),
    charset: "utf8mb4",
    timezone: "Z",
    supportBigNumbers: true,
  };
}

export function getDbPool(): Pool {
  if (pool) return pool;

  pool = mysql.createPool({
    ...getDbConnectionOptions(),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
    bigNumberStrings: false,
  });

  return pool;
}
