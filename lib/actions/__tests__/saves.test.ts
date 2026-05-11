import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

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

const { saveRecipeAction, unsaveRecipeAction } = await import(
  "@/lib/actions/saves"
);

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

describe("saveRecipeAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await saveRecipeAction("any-id");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign in/i);
  });

  it("returns Recipe not found for an unknown id", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await saveRecipeAction("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("rejects saving someone else's PRIVATE recipe", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id, { visibility: "private" });
    signInAs(saver);

    const res = await saveRecipeAction(recipe.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/i);
  });

  it("creates an All Saves collection on first save and adds the recipe", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb, { handle: "saver" });
    const recipe = seedRecipe(testDb, author.id);
    signInAs(saver);

    const res = await saveRecipeAction(recipe.id);
    expect(res.ok).toBe(true);

    const allSaves = testDb
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.ownerId, saver.id))
      .get();
    expect(allSaves?.isDefaultSaves).toBe(true);
    expect(allSaves?.name).toBe("All Saves");

    const saveRow = testDb.select().from(schema.saves).get();
    expect(saveRow?.userId).toBe(saver.id);
    expect(saveRow?.recipeId).toBe(recipe.id);

    const junction = testDb.select().from(schema.collectionRecipes).all();
    expect(junction).toHaveLength(1);
    expect(junction[0].collectionId).toBe(allSaves?.id);

    expect(mockRevalidatePath).toHaveBeenCalledWith("/cookbook");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/u/saver");
  });

  it("is idempotent — saving twice doesn't create duplicate rows", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(saver);

    await saveRecipeAction(recipe.id);
    await saveRecipeAction(recipe.id);

    expect(testDb.select().from(schema.saves).all()).toHaveLength(1);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      1,
    );
  });

  it("adds the recipe to extra collections owned by the user", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    const extra = seedCollection(testDb, saver.id, { name: "Weeknight" });
    signInAs(saver);

    await saveRecipeAction(recipe.id, [extra.id]);

    const junctionByCollection = testDb
      .select({ collectionId: schema.collectionRecipes.collectionId })
      .from(schema.collectionRecipes)
      .all()
      .map((r) => r.collectionId);
    // 1 row for All Saves + 1 for the extra collection
    expect(junctionByCollection).toHaveLength(2);
    expect(junctionByCollection).toContain(extra.id);
  });

  it("silently ignores collection ids the user does NOT own", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb);
    const stranger = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    const someoneElses = seedCollection(testDb, stranger.id);
    signInAs(saver);

    const res = await saveRecipeAction(recipe.id, [someoneElses.id]);
    expect(res.ok).toBe(true);

    // Only the All Saves junction row should be present.
    const junction = testDb.select().from(schema.collectionRecipes).all();
    expect(junction).toHaveLength(1);
    expect(junction[0].collectionId).not.toBe(someoneElses.id);
  });

  it("lets the author save their OWN private recipe", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id, { visibility: "private" });
    signInAs(user);

    const res = await saveRecipeAction(recipe.id);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.saves).all()).toHaveLength(1);
  });
});

describe("unsaveRecipeAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await unsaveRecipeAction("any-id");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign in/i);
  });

  it("removes the save AND every junction row in the user's own collections", async () => {
    const author = seedUser(testDb);
    const saver = seedUser(testDb, { handle: "saver" });
    const recipe = seedRecipe(testDb, author.id);
    const extra = seedCollection(testDb, saver.id);
    signInAs(saver);

    await saveRecipeAction(recipe.id, [extra.id]);
    expect(testDb.select().from(schema.saves).all()).toHaveLength(1);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      2,
    );

    const res = await unsaveRecipeAction(recipe.id);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.saves).all()).toHaveLength(0);
    expect(testDb.select().from(schema.collectionRecipes).all()).toHaveLength(
      0,
    );
  });

  it("does NOT touch other users' collections that contain the recipe", async () => {
    const author = seedUser(testDb);
    const saverA = seedUser(testDb);
    const saverB = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    const collA = seedCollection(testDb, saverA.id);
    const collB = seedCollection(testDb, saverB.id);
    testDb
      .insert(schema.collectionRecipes)
      .values([
        { collectionId: collA.id, recipeId: recipe.id, position: 0, addedAt: new Date() },
        { collectionId: collB.id, recipeId: recipe.id, position: 0, addedAt: new Date() },
      ])
      .run();
    signInAs(saverA);

    await unsaveRecipeAction(recipe.id);

    const remaining = testDb.select().from(schema.collectionRecipes).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].collectionId).toBe(collB.id);
  });

  it("is a no-op when the user has nothing saved", async () => {
    const user = seedUser(testDb);
    const author = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(user);

    const res = await unsaveRecipeAction(recipe.id);
    expect(res.ok).toBe(true);
  });
});
