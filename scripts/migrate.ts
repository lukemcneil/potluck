import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "potluck.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);
const migrationsFolder = path.resolve("./db/migrations");

console.log(`Applying migrations from ${migrationsFolder} to ${dbPath}`);

try {
  migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
