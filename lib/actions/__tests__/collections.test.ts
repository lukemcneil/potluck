import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  createTestDb,
  seedUser,
  seedRecipe,
  seedCollection,
  type TestDb,
} from "./_helpers";

let testDb: TestDb;
let testSqlite: ReturnType<typeof createTestDb>["sqlite"];

const mockAuth = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
  PHOTOS_DIR: "/tmp/test-photos",
}));

const {
  createCollectionAction,
  updateCollectionAction,
  deleteCollectionAction,
  addRecipeToCollectionAction,
  removeRecipeFromCollectionAction,
} = await import("@/lib/actions/collections");

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
  mockAuth.mockReset();
  mockRevalidatePath.mockClear();
});

function signInAs(user: { id: string; handle: string | null }) {
  mockAuth.mockResolvedValue({
    user: { id: user.id, handle: user.handle ?? null },
  });
}

describe("createCollectionAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await createCollectionAction({ name: "Faves" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign in/i);
  });

  it("returns field errors for an empty name", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    const res = await createCollectionAction({ name: "" });
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.name?.[0]).toMatch(/required/i);
    expect(testDb.select().from(schema.collections).all()).toHaveLength(0);
  });

  it("creates the collection with a unique slug per owner", async () => {
    const user = seedUser(testDb, { handle: "luke" });
    signInAs(user);
    seedCollection(testDb, user.id, { name: "Faves", slug: "faves" });

    const res = await createCollectionAction({ name: "Faves" });
    expect(res.ok).toBe(true);
    expect(res.data?.slug).toBe("faves-1");

    const all = testDb.select().from(schema.collections).all();
    expect(all).toHaveLength(2);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/u/luke");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/cookbook");
  });

  it("defaults visibility to public when not specified", async () => {
    const user = seedUser(testDb);
    signInAs(user);

    const res = await createCollectionAction({ name: "Default Vis" });
    expect(res.ok).toBe(true);
    const row = testDb.select().from(schema.collections).get();
    expect(row?.visibility).toBe("public");
    expect(row?.isDefaultSaves).toBe(false);
  });
});

describe("updateCollectionAction", () => {
  it("rejects edits from non-owners", async () => {
    const owner = seedUser(testDb);
    const intruder = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, { name: "Owner's" });
    signInAs(intruder);

    const res = await updateCollectionAction(c.id, { name: "Hijacked" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not yours/i);
    const after = testDb.select().from(schema.collections).get();
    expect(after?.name).toBe("Owner's");
  });

  it("blocks renaming the All Saves collection", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, {
      name: "All Saves",
      slug: "all-saves",
      isDefaultSaves: true,
    });
    signInAs(owner);

    const res = await updateCollectionAction(c.id, { name: "Anything" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/all saves/i);
  });

  it("allows visibility-only updates on the default saves collection", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, {
      name: "All Saves",
      slug: "all-saves",
      isDefaultSaves: true,
      visibility: "private",
    });
    signInAs(owner);

    const res = await updateCollectionAction(c.id, { visibility: "unlisted" });
    expect(res.ok).toBe(true);
    const after = testDb.select().from(schema.collections).get();
    expect(after?.visibility).toBe("unlisted");
    expect(after?.name).toBe("All Saves");
  });

  it("returns ok with no DB write when nothing changes", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, { name: "Stable" });
    signInAs(owner);

    const res = await updateCollectionAction(c.id, {});
    expect(res.ok).toBe(true);
    // No revalidation when nothing changed.
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("trims whitespace from updated names", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, { name: "Old" });
    signInAs(owner);

    await updateCollectionAction(c.id, { name: "  Tidied   " });
    const after = testDb.select().from(schema.collections).get();
    expect(after?.name).toBe("Tidied");
  });
});

describe("deleteCollectionAction", () => {
  it("rejects non-owner deletes", async () => {
    const owner = seedUser(testDb);
    const intruder = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    signInAs(intruder);

    const res = await deleteCollectionAction(c.id);
    expect(res.ok).toBe(false);
    expect(testDb.select().from(schema.collections).all()).toHaveLength(1);
  });

  it("blocks deleting the All Saves collection", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id, {
      name: "All Saves",
      slug: "all-saves",
      isDefaultSaves: true,
    });
    signInAs(owner);

    const res = await deleteCollectionAction(c.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/all saves/i);
    expect(testDb.select().from(schema.collections).all()).toHaveLength(1);
  });

  it("deletes the row + cascades junction rows", async () => {
    const owner = seedUser(testDb, { handle: "luke" });
    const c = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    testDb
      .insert(schema.collectionRecipes)
      .values({
        collectionId: c.id,
        recipeId: recipe.id,
        position: 0,
        addedAt: new Date(),
      })
      .run();
    signInAs(owner);

    const res = await deleteCollectionAction(c.id);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.collections).all()).toHaveLength(0);
    expect(
      testDb.select().from(schema.collectionRecipes).all(),
    ).toHaveLength(0);
    // Recipe itself is untouched.
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/u/luke");
  });
});

describe("addRecipeToCollectionAction", () => {
  it("rejects when the user doesn't own the collection", async () => {
    const owner = seedUser(testDb);
    const other = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    signInAs(other);

    const res = await addRecipeToCollectionAction(c.id, recipe.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("rejects adding a private recipe owned by someone else", async () => {
    const author = seedUser(testDb);
    const collector = seedUser(testDb);
    const c = seedCollection(testDb, collector.id);
    const recipe = seedRecipe(testDb, author.id, { visibility: "private" });
    signInAs(collector);

    const res = await addRecipeToCollectionAction(c.id, recipe.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/i);
  });

  it("lets the author add their OWN private recipe to their collection", async () => {
    const author = seedUser(testDb);
    const c = seedCollection(testDb, author.id);
    const recipe = seedRecipe(testDb, author.id, { visibility: "private" });
    signInAs(author);

    const res = await addRecipeToCollectionAction(c.id, recipe.id);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      1,
    );
  });

  it("appends with a fresh position when other recipes already exist", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    const recipe1 = seedRecipe(testDb, owner.id);
    const recipe2 = seedRecipe(testDb, owner.id);
    testDb
      .insert(schema.collectionRecipes)
      .values({
        collectionId: c.id,
        recipeId: recipe1.id,
        position: 0,
        addedAt: new Date(),
      })
      .run();
    signInAs(owner);

    await addRecipeToCollectionAction(c.id, recipe2.id);

    const positions = testDb
      .select({ p: schema.collectionRecipes.position })
      .from(schema.collectionRecipes)
      .where(eq(schema.collectionRecipes.collectionId, c.id))
      .all()
      .map((r) => r.p)
      .sort();
    expect(positions).toEqual([0, 1]);
  });

  it("is idempotent — second add of the same recipe is a no-op", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    signInAs(owner);

    await addRecipeToCollectionAction(c.id, recipe.id);
    await addRecipeToCollectionAction(c.id, recipe.id);

    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      1,
    );
  });
});

describe("removeRecipeFromCollectionAction", () => {
  it("rejects when the user doesn't own the collection", async () => {
    const owner = seedUser(testDb);
    const other = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    testDb
      .insert(schema.collectionRecipes)
      .values({
        collectionId: c.id,
        recipeId: recipe.id,
        position: 0,
        addedAt: new Date(),
      })
      .run();
    signInAs(other);

    const res = await removeRecipeFromCollectionAction(c.id, recipe.id);
    expect(res.ok).toBe(false);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      1,
    );
  });

  it("removes the junction row without touching the recipe", async () => {
    const owner = seedUser(testDb);
    const c = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    testDb
      .insert(schema.collectionRecipes)
      .values({
        collectionId: c.id,
        recipeId: recipe.id,
        position: 0,
        addedAt: new Date(),
      })
      .run();
    signInAs(owner);

    const res = await removeRecipeFromCollectionAction(c.id, recipe.id);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      0,
    );
    expect(testDb.select().from(schema.recipes).all()).toHaveLength(1);
  });

  it("only deletes the row for the SPECIFIED collection", async () => {
    const owner = seedUser(testDb);
    const c1 = seedCollection(testDb, owner.id);
    const c2 = seedCollection(testDb, owner.id);
    const recipe = seedRecipe(testDb, owner.id);
    testDb
      .insert(schema.collectionRecipes)
      .values([
        { collectionId: c1.id, recipeId: recipe.id, position: 0, addedAt: new Date() },
        { collectionId: c2.id, recipeId: recipe.id, position: 0, addedAt: new Date() },
      ])
      .run();
    signInAs(owner);

    await removeRecipeFromCollectionAction(c1.id, recipe.id);

    const remaining = testDb
      .select({ collectionId: schema.collectionRecipes.collectionId })
      .from(schema.collectionRecipes)
      .where(
        and(
          eq(schema.collectionRecipes.recipeId, recipe.id),
        ),
      )
      .all();
    expect(remaining).toEqual([{ collectionId: c2.id }]);
  });
});
