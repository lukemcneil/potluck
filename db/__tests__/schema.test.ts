import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import path from "node:path";

import * as schema from "../schema";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve("./db/migrations") });
  return { db, sqlite };
}

describe("Potluck schema", () => {
  let env: ReturnType<typeof freshDb>;

  beforeEach(() => {
    env = freshDb();
  });

  it("creates a user with a unique handle", () => {
    const { db } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "wife@example.com", name: "Wife", handle: "wife" })
      .returning()
      .all();

    expect(user.id).toBeTruthy();
    expect(user.handle).toBe("wife");

    expect(() =>
      db
        .insert(schema.users)
        .values({ email: "other@example.com", handle: "wife" })
        .run(),
    ).toThrow();
  });

  it("FTS index picks up recipes by title and ingredient", () => {
    const { db, sqlite } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "a@b.com", handle: "alice" })
      .returning()
      .all();

    const [recipe] = db
      .insert(schema.recipes)
      .values({
        authorId: user.id,
        title: "Grandma's Apple Pie",
        slug: "grandmas-apple-pie",
        description: "A flaky, buttery classic with cinnamon-spiced apples.",
      })
      .returning()
      .all();

    db.insert(schema.recipeIngredients)
      .values([
        { recipeId: recipe.id, position: 0, quantity: "6", unit: "cups", name: "granny smith apples", note: "peeled and sliced" },
        { recipeId: recipe.id, position: 1, quantity: "1", unit: "tbsp", name: "cinnamon" },
        { recipeId: recipe.id, position: 2, quantity: "2", unit: "cups", name: "all-purpose flour" },
      ])
      .run();

    const titleHits = sqlite
      .prepare("SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ?")
      .all("apple") as Array<{ recipe_id: string }>;
    expect(titleHits.map((r) => r.recipe_id)).toContain(recipe.id);

    const ingredientHits = sqlite
      .prepare("SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ?")
      .all("cinnamon") as Array<{ recipe_id: string }>;
    expect(ingredientHits.map((r) => r.recipe_id)).toContain(recipe.id);

    const noHits = sqlite
      .prepare("SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ?")
      .all("kimchi") as Array<{ recipe_id: string }>;
    expect(noHits).toEqual([]);
  });

  it("cascades photo deletions when a recipe is deleted", () => {
    const { db } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "x@y.com", handle: "xy" })
      .returning()
      .all();

    const [recipe] = db
      .insert(schema.recipes)
      .values({ authorId: user.id, title: "Tacos", slug: "tacos" })
      .returning()
      .all();

    db.insert(schema.recipePhotos)
      .values({ recipeId: recipe.id, path: "/uploads/a.jpg" })
      .run();

    db.delete(schema.recipes).where(eq(schema.recipes.id, recipe.id)).run();

    const photos = db.select().from(schema.recipePhotos).all();
    expect(photos).toEqual([]);
  });

  it("enforces collection (ownerId, slug) uniqueness", () => {
    const { db } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "c@d.com", handle: "cd" })
      .returning()
      .all();

    db.insert(schema.collections)
      .values({ ownerId: user.id, name: "Weeknight Dinners", slug: "weeknight-dinners" })
      .run();

    expect(() =>
      db
        .insert(schema.collections)
        .values({ ownerId: user.id, name: "Different Name", slug: "weeknight-dinners" })
        .run(),
    ).toThrow();
  });

  it("maxMinutes filter excludes recipes with no time data", () => {
    // Regression: COALESCE(prep,0)+COALESCE(cook,0) treats NULL as 0,
    // which made `total ≤ 20` also match recipes with no time set.
    // The runtime filter now requires at least one of prep/cook to be
    // non-null. This test mirrors that SQL so the behavior stays pinned.
    const { db } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "time@test.com", handle: "time" })
      .returning()
      .all();

    db.insert(schema.recipes)
      .values([
        {
          authorId: user.id,
          title: "Quick salad",
          slug: "quick-salad",
          prepMinutes: 10,
          cookMinutes: 5,
        },
        {
          authorId: user.id,
          title: "Slow stew",
          slug: "slow-stew",
          prepMinutes: 30,
          cookMinutes: 60,
        },
        {
          authorId: user.id,
          title: "Photos only",
          slug: "photos-only",
          prepMinutes: null,
          cookMinutes: null,
        },
        {
          authorId: user.id,
          title: "Just prep",
          slug: "just-prep",
          prepMinutes: 18,
          cookMinutes: null,
        },
      ])
      .run();

    const max = 20;
    const rows = db
      .select({ title: schema.recipes.title })
      .from(schema.recipes)
      .where(
        and(
          or(
            isNotNull(schema.recipes.prepMinutes),
            isNotNull(schema.recipes.cookMinutes),
          ),
          lte(
            sql`COALESCE(${schema.recipes.prepMinutes}, 0) + COALESCE(${schema.recipes.cookMinutes}, 0)`,
            max,
          ),
        ),
      )
      .all();

    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(["Just prep", "Quick salad"]);
  });

  it("touches updatedAt-style raw query and counts rows", () => {
    const { db } = env;
    const [user] = db
      .insert(schema.users)
      .values({ email: "e@f.com", handle: "ef" })
      .returning()
      .all();

    db.insert(schema.recipes)
      .values([
        { authorId: user.id, title: "One", slug: "one" },
        { authorId: user.id, title: "Two", slug: "two" },
      ])
      .run();

    const count = db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.recipes)
      .all()[0].n;
    expect(count).toBe(2);
  });
});
