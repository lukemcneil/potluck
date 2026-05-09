import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

const dataDir = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "potluck.db");

declare global {
  // eslint-disable-next-line no-var
  var __potluckSqlite: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __potluckDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

const sqlite =
  globalThis.__potluckSqlite ??
  new Database(dbPath, { fileMustExist: false });

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

if (!globalThis.__potluckSqlite) {
  globalThis.__potluckSqlite = sqlite;
}

export const db =
  globalThis.__potluckDb ?? drizzle(sqlite, { schema, casing: "camelCase" });

if (!globalThis.__potluckDb) {
  globalThis.__potluckDb = db;
}

export { sqlite };

export async function runMigrations() {
  const migrationsFolder = path.resolve("./db/migrations");
  if (!fs.existsSync(migrationsFolder)) return;
  migrate(db, { migrationsFolder });
}

export const PHOTOS_DIR = path.join(dataDir, "uploads");
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}
