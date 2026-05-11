import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import * as schema from "@/db/schema";
import type { RecipeFormInput } from "@/lib/validators";

/**
 * Pure helpers for the server-action tests. No `vi.mock` calls in here
 * — those have to live at the top of each test file because Vitest
 * hoists them per-module. This module is for things that don't care
 * which mocks are wired up: in-memory DB construction, seed builders,
 * and FormData factories that mirror what the client actually sends.
 */

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Spin up a fresh `:memory:` SQLite, apply migrations, return the
 * Drizzle handle plus the raw connection (some tests want to peek at
 * FTS5 rows directly).
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema, casing: "camelCase" });
  migrate(db, { migrationsFolder: path.resolve("./db/migrations") });
  return { db, sqlite };
}

/**
 * Insert a user with sensible defaults. Each test usually only needs
 * the id + handle, but everything else is filled in so the row matches
 * a real signed-in profile.
 */
export function seedUser(
  db: TestDb,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const seed = Math.random().toString(36).slice(2, 8);
  const [row] = db
    .insert(schema.users)
    .values({
      email: overrides.email ?? `user-${seed}@example.com`,
      name: overrides.name ?? `User ${seed}`,
      handle: overrides.handle ?? `user-${seed}`,
      ...overrides,
    })
    .returning()
    .all();
  return row;
}

/**
 * Insert a minimal recipe. Useful for action tests that need a target
 * recipe to update / save / collect against.
 */
export function seedRecipe(
  db: TestDb,
  authorId: string,
  overrides: Partial<typeof schema.recipes.$inferInsert> = {},
) {
  const seed = Math.random().toString(36).slice(2, 8);
  const [row] = db
    .insert(schema.recipes)
    .values({
      authorId,
      title: overrides.title ?? `Test Recipe ${seed}`,
      slug: overrides.slug ?? `test-recipe-${seed}`,
      visibility: overrides.visibility ?? "public",
      ...overrides,
    })
    .returning()
    .all();
  return row;
}

/**
 * Insert a collection. Mirrors the action's defaults.
 */
export function seedCollection(
  db: TestDb,
  ownerId: string,
  overrides: Partial<typeof schema.collections.$inferInsert> = {},
) {
  const seed = Math.random().toString(36).slice(2, 8);
  const [row] = db
    .insert(schema.collections)
    .values({
      ownerId,
      name: overrides.name ?? `Collection ${seed}`,
      slug: overrides.slug ?? `collection-${seed}`,
      visibility: overrides.visibility ?? "public",
      isDefaultSaves: false,
      createdAt: new Date(),
      ...overrides,
    })
    .returning()
    .all();
  return row;
}

/**
 * Build a recipe form payload with the same shape the client sends.
 * Defaults give you a valid, minimally-populated recipe so individual
 * tests only have to override what they're actually exercising.
 */
export function makeRecipePayload(
  overrides: Partial<RecipeFormInput> = {},
): RecipeFormInput {
  return {
    title: "Test Recipe",
    description: null,
    prepMinutes: 10,
    cookMinutes: 20,
    servings: "4",
    mealType: "dinner",
    cuisine: "italian",
    diets: [],
    tags: [],
    visibility: "public",
    kind: "structured",
    sourceUrl: null,
    ingredients: [
      { quantity: "2", unit: "cups", name: "flour", note: null },
      { quantity: "1", unit: "tsp", name: "salt", note: null },
    ],
    steps: [
      { body: "Mix the dry ingredients." },
      { body: "Bake at 350F for 20 minutes." },
    ],
    photoIds: [],
    ...overrides,
  };
}

/**
 * Wrap a payload in a `FormData` instance the way the client form
 * does. Server actions read `formData.get("payload")` as the JSON
 * blob.
 */
export function makeFormData(payload: unknown): FormData {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(payload));
  return fd;
}
