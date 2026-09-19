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

export function getDbPool(): Pool {
  if (pool) return pool;

  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port <= 0) {
    throw new DatabaseConfigError("DB_PORT must be a positive integer");
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port,
    database: process.env.DB_NAME || "aeranexa",
    user: process.env.DB_USER || "root",
    password: getRequiredEnv("DB_PASSWORD"),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
    charset: "utf8mb4",
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

  return pool;
}
