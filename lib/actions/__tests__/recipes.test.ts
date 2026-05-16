import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  createTestDb,
  seedUser,
  seedRecipe,
  makeRecipePayload,
  makeFormData,
  type TestDb,
} from "./_helpers";

// Module-level state that the mocks below reach into via getters. Tests
// reassign `testDb` in beforeEach so `import { db } from "@/db/client"`
// resolves to a fresh in-memory connection per test.
let testDb: TestDb;
let testSqlite: ReturnType<typeof createTestDb>["sqlite"];

const mockAuth = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    // next/navigation#redirect throws to abort rendering; mirror that
    // so the action's `redirect(...)` call surfaces as a rejection in
    // the test instead of "successful return undefined".
    throw new (class extends Error {
      digest = `NEXT_REDIRECT;replace;${url}`;
      constructor() {
        super(`NEXT_REDIRECT;replace;${url}`);
      }
    })();
  }),
);
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/db/client", () => ({
  // Getter so the action gets *this test's* DB rather than a snapshot
  // taken at import time.
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
  PHOTOS_DIR: "/tmp/test-photos",
}));

// Importing the action AFTER the mocks are declared so it picks them
// up. Vitest hoists vi.mock calls, but explicit ordering keeps intent
// readable.
const {
  createRecipeAction,
  updateRecipeAction,
  deleteRecipeAction,
  getRecipe,
} = await import("@/lib/actions/recipes");

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
  mockAuth.mockReset();
  mockRedirect.mockClear();
  mockRevalidatePath.mockClear();
});

function signInAs(user: { id: string; handle: string | null }) {
  mockAuth.mockResolvedValue({
    user: { id: user.id, handle: user.handle ?? null },
  });
}

describe("createRecipeAction", () => {
  it("rejects unsigned-in callers without touching the DB", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await createRecipeAction(
      {},
      makeFormData(makeRecipePayload()),
    );

    expect(result.error).toMatch(/signed in/i);
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(0);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns field errors when the payload fails validation", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    const result = await createRecipeAction(
      {},
      makeFormData(makeRecipePayload({ title: "" })),
    );

    expect(result.error).toMatch(/fields/i);
    expect(result.fieldErrors?.title?.[0]).toMatch(/required/i);
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(0);
  });

  it("inserts the recipe with ingredients, steps, and tags then redirects", async () => {
    const user = seedUser(testDb, { handle: "luke" });
    signInAs(user);

    const payload = makeRecipePayload({
      title: "Pad Thai",
      tags: ["weeknight", "Quick", "weeknight"], // duplicates + casing
    });

    await expect(
      createRecipeAction({}, makeFormData(payload)),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const recipes = testDb.select().from(schema.recipes).all();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].title).toBe("Pad Thai");
    expect(recipes[0].slug).toBe("pad-thai");
    expect(recipes[0].authorId).toBe(user.id);

    const ingredients = testDb.select().from(schema.recipeIngredients).all();
    expect(ingredients).toHaveLength(2);
    expect(ingredients.map((i) => i.position).sort()).toEqual([0, 1]);

    const steps = testDb.select().from(schema.recipeSteps).all();
    expect(steps).toHaveLength(2);

    // Tags are deduped + lowercased; "Quick" → "quick", duplicate
    // "weeknight" collapses to one row.
    const tagNames = testDb
      .select({ name: schema.tags.name })
      .from(schema.tags)
      .all()
      .map((t) => t.name)
      .sort();
    expect(tagNames).toEqual(["quick", "weeknight"]);

    const recipeTagRows = testDb.select().from(schema.recipeTags).all();
    expect(recipeTagRows).toHaveLength(2);

    expect(mockRedirect).toHaveBeenCalledWith(`/r/${recipes[0].id}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/feed");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/u/luke");
  });

  it("makes the slug unique per author when the title collides", async () => {
    const user = seedUser(testDb, { handle: "alex" });
    signInAs(user);
    seedRecipe(testDb, user.id, { title: "Pancakes", slug: "pancakes" });

    const payload = makeRecipePayload({ title: "Pancakes" });
    await expect(
      createRecipeAction({}, makeFormData(payload)),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const slugs = testDb
      .select({ slug: schema.recipes.slug })
      .from(schema.recipes)
      .all()
      .map((r) => r.slug)
      .sort();
    expect(slugs).toEqual(["pancakes", "pancakes-1"]);
  });

  it("falls back to a generic slug for emoji-only titles", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    await expect(
      createRecipeAction({}, makeFormData(makeRecipePayload({ title: "🍕" }))),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const recipe = testDb.select().from(schema.recipes).get();
    expect(recipe?.slug).toBe("recipe");
    expect(recipe?.title).toBe("🍕");
  });

  it("returns a friendly error when the form payload is missing", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    const fd = new FormData();
    // payload key intentionally missing
    const result = await createRecipeAction({}, fd);

    expect(result.error).toMatch(/payload/i);
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(0);
  });

  it("persists per-photo roles (cover vs source) ordered by submission", async () => {
    // The point of role: writes from the form land in recipePhotos
    // in the order the user arranged them, with the role they chose
    // for each one. A user who marks the paper-card scan as source
    // and the plated shot as cover must get exactly that back.
    const user = seedUser(testDb, { handle: "wife" });
    signInAs(user);

    const payload = makeRecipePayload({
      title: "Mom's chili",
      photos: [
        { path: "/uploads/card-front.jpg", role: "source" },
        { path: "/uploads/card-back.jpg", role: "source" },
        { path: "/uploads/plated.jpg", role: "cover" },
      ],
    });

    await expect(
      createRecipeAction({}, makeFormData(payload)),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const rows = testDb
      .select()
      .from(schema.recipePhotos)
      .orderBy(schema.recipePhotos.position)
      .all();

    expect(rows.map((r) => ({ path: r.path, role: r.role }))).toEqual([
      { path: "/uploads/card-front.jpg", role: "source" },
      { path: "/uploads/card-back.jpg", role: "source" },
      { path: "/uploads/plated.jpg", role: "cover" },
    ]);
  });
});

describe("updateRecipeAction", () => {
  it("rejects unsigned-in callers", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id);
    mockAuth.mockResolvedValue(null);

    const result = await updateRecipeAction(
      recipe.id,
      {},
      makeFormData(makeRecipePayload({ title: "Updated" })),
    );

    expect(result.error).toMatch(/signed in/i);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("rejects edits from non-authors with a clear error", async () => {
    const author = seedUser(testDb, { handle: "author" });
    const intruder = seedUser(testDb, { handle: "intruder" });
    const recipe = seedRecipe(testDb, author.id, { title: "Mine" });
    signInAs(intruder);

    const result = await updateRecipeAction(
      recipe.id,
      {},
      makeFormData(makeRecipePayload({ title: "Yours now" })),
    );

    expect(result.error).toMatch(/not your recipe/i);
    const after = testDb
      .select({ title: schema.recipes.title })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipe.id))
      .get();
    expect(after?.title).toBe("Mine");
  });

  it("returns Not found for a non-existent recipe", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    const result = await updateRecipeAction(
      "00000000-0000-0000-0000-000000000000",
      {},
      makeFormData(makeRecipePayload()),
    );

    expect(result.error).toMatch(/not found/i);
  });

  it("preserves the slug even when the title changes", async () => {
    const user = seedUser(testDb, { handle: "luke" });
    const recipe = seedRecipe(testDb, user.id, {
      title: "Original",
      slug: "original",
    });
    signInAs(user);

    await expect(
      updateRecipeAction(
        recipe.id,
        {},
        makeFormData(
          makeRecipePayload({ title: "Wildly different name" }),
        ),
      ),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const after = testDb
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipe.id))
      .get();
    expect(after?.slug).toBe("original");
    expect(after?.title).toBe("Wildly different name");
  });

  it("replaces ingredient + step rows wholesale", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id);
    // Pre-existing children that should be wiped.
    testDb
      .insert(schema.recipeIngredients)
      .values({
        recipeId: recipe.id,
        position: 0,
        name: "old ingredient",
      })
      .run();
    testDb
      .insert(schema.recipeSteps)
      .values({
        recipeId: recipe.id,
        position: 0,
        body: "old step",
      })
      .run();
    signInAs(user);

    await expect(
      updateRecipeAction(
        recipe.id,
        {},
        makeFormData(
          makeRecipePayload({
            ingredients: [
              { quantity: null, unit: null, name: "new ingredient", note: null },
            ],
            steps: [{ body: "new step" }],
          }),
        ),
      ),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const ingredients = testDb
      .select()
      .from(schema.recipeIngredients)
      .where(eq(schema.recipeIngredients.recipeId, recipe.id))
      .all();
    expect(ingredients).toHaveLength(1);
    expect(ingredients[0].name).toBe("new ingredient");

    const steps = testDb
      .select()
      .from(schema.recipeSteps)
      .where(eq(schema.recipeSteps.recipeId, recipe.id))
      .all();
    expect(steps).toHaveLength(1);
    expect(steps[0].body).toBe("new step");
  });

  it("lets an author demote an old cover photo to source and add a new cover", async () => {
    // The original user flow this exists for: upload paper recipe
    // photos, AI extracts the recipe, save it. Later you realise the
    // paper photos shouldn't be the public cover, so you edit and
    // flip them to `source` while uploading a beauty shot as the
    // new cover.
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id, { title: "Mom's Chili" });
    testDb
      .insert(schema.recipePhotos)
      .values([
        {
          recipeId: recipe.id,
          position: 0,
          path: "/uploads/card-front.jpg",
          role: "cover",
        },
        {
          recipeId: recipe.id,
          position: 1,
          path: "/uploads/card-back.jpg",
          role: "cover",
        },
      ])
      .run();
    signInAs(user);

    await expect(
      updateRecipeAction(
        recipe.id,
        {},
        makeFormData(
          makeRecipePayload({
            title: "Mom's Chili",
            photos: [
              { path: "/uploads/card-front.jpg", role: "source" },
              { path: "/uploads/card-back.jpg", role: "source" },
              { path: "/uploads/plated.jpg", role: "cover" },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(/^NEXT_REDIRECT/);

    const after = testDb
      .select()
      .from(schema.recipePhotos)
      .where(eq(schema.recipePhotos.recipeId, recipe.id))
      .orderBy(schema.recipePhotos.position)
      .all();

    expect(after.map((r) => ({ path: r.path, role: r.role }))).toEqual([
      { path: "/uploads/card-front.jpg", role: "source" },
      { path: "/uploads/card-back.jpg", role: "source" },
      { path: "/uploads/plated.jpg", role: "cover" },
    ]);
  });
});

describe("deleteRecipeAction", () => {
  it("throws UNAUTHENTICATED when no session", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id);
    mockAuth.mockResolvedValue(null);

    await expect(deleteRecipeAction(recipe.id)).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    // Recipe untouched.
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(1);
  });

  it("throws FORBIDDEN when called by a non-author", async () => {
    const author = seedUser(testDb);
    const intruder = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(intruder);

    await expect(deleteRecipeAction(recipe.id)).rejects.toThrow("FORBIDDEN");
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(1);
  });

  it("silently no-ops on a missing recipe (idempotent delete)", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    await expect(
      deleteRecipeAction("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });

  it("deletes the recipe + cascades to children + revalidates paths", async () => {
    const user = seedUser(testDb, { handle: "luke" });
    const recipe = seedRecipe(testDb, user.id);
    testDb
      .insert(schema.recipeIngredients)
      .values({ recipeId: recipe.id, position: 0, name: "salt" })
      .run();
    testDb
      .insert(schema.recipeSteps)
      .values({ recipeId: recipe.id, position: 0, body: "stir" })
      .run();
    signInAs(user);

    await deleteRecipeAction(recipe.id);

    expect(testDb.select().from(schema.recipes).all()).toHaveLength(0);
    expect(testDb.select().from(schema.recipeIngredients).all()).toHaveLength(0);
    expect(testDb.select().from(schema.recipeSteps).all()).toHaveLength(0);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/feed");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/u/luke");
  });
});

describe("getRecipe", () => {
  it("returns null for a missing id", async () => {
    expect(await getRecipe("missing")).toBeNull();
  });

  it("hydrates a full recipe with photos, ingredients, steps, and tags", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id, { title: "Salad" });
    testDb
      .insert(schema.recipeIngredients)
      .values([
        { recipeId: recipe.id, position: 0, name: "lettuce" },
        { recipeId: recipe.id, position: 1, name: "tomato" },
      ])
      .run();
    testDb
      .insert(schema.recipeSteps)
      .values({ recipeId: recipe.id, position: 0, body: "Toss." })
      .run();
    const tagId = crypto.randomUUID();
    testDb.insert(schema.tags).values({ id: tagId, name: "fresh" }).run();
    testDb
      .insert(schema.recipeTags)
      .values({ recipeId: recipe.id, tagId })
      .run();

    const result = await getRecipe(recipe.id);
    expect(result).not.toBeNull();
    expect(result?.recipe.title).toBe("Salad");
    expect(result?.ingredients.map((i) => i.name)).toEqual([
      "lettuce",
      "tomato",
    ]);
    expect(result?.steps.map((s) => s.body)).toEqual(["Toss."]);
    expect(result?.tagNames).toEqual(["fresh"]);
  });
});
