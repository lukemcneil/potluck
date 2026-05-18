import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

import { deriveNumeric } from "../lib/cooking/numerics";

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
  backfillNumericQuantities();
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  sqlite.close();
}

/**
 * Backfill `*.quantityNumeric` / `recipes.servingsNumeric` for any
 * row whose corresponding free-text column is set but whose numeric
 * companion is still NULL. Used to bring older recipes (created
 * before the numeric columns existed) into the new "every recipe is
 * scalable" contract — see lib/cooking/numerics.ts.
 *
 * Idempotent: we only touch rows where the numeric column is NULL,
 * so re-running the migration is a no-op once the backfill is done.
 * Cheap: parsing a quantity string is microseconds, and a household
 * deploy has maybe a few hundred ingredient rows total.
 */
function backfillNumericQuantities() {
  // We can't drop the work on better-sqlite3's SQL-only `UPDATE`
  // because `parseQuantity` understands stuff sqlite can't ("1 1/2",
  // "½", etc.). So we read the rows that need backfilling, parse in
  // JS, and write the result in a single transaction.
  const targets: Array<{
    table: "recipes" | "recipeIngredients" | "shoppingListItems";
    textCol: string;
    numericCol: string;
  }> = [
    { table: "recipes", textCol: "servings", numericCol: "servingsNumeric" },
    {
      table: "recipeIngredients",
      textCol: "quantity",
      numericCol: "quantityNumeric",
    },
    {
      table: "shoppingListItems",
      textCol: "quantity",
      numericCol: "quantityNumeric",
    },
  ];

  let totalUpdated = 0;
  for (const t of targets) {
    const rows = sqlite
      .prepare(
        `SELECT id, ${t.textCol} as txt FROM ${t.table}
         WHERE ${t.textCol} IS NOT NULL AND ${t.textCol} != ''
           AND ${t.numericCol} IS NULL`,
      )
      .all() as Array<{ id: string; txt: string }>;

    if (rows.length === 0) continue;
    const update = sqlite.prepare(
      `UPDATE ${t.table} SET ${t.numericCol} = ? WHERE id = ?`,
    );

    let tableUpdated = 0;
    const tx = sqlite.transaction(() => {
      for (const row of rows) {
        const numeric = deriveNumeric(row.txt);
        if (numeric == null) continue; // unparseable — leave as NULL
        update.run(numeric, row.id);
        tableUpdated += 1;
      }
    });
    tx();
    totalUpdated += tableUpdated;
    if (tableUpdated > 0) {
      console.log(
        `Backfilled ${tableUpdated}/${rows.length} numeric values on \`${t.table}\`.`,
      );
    }
  }

  if (totalUpdated === 0) {
    console.log("Numeric backfill: nothing to do.");
  }
}
