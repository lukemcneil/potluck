import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  createTestDb,
  seedUser,
  seedRecipe,
  type TestDb,
} from "./_helpers";

let testDb: TestDb;
let testSqlite: ReturnType<typeof createTestDb>["sqlite"];

const mockAuth = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockNotifyRating = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/push/notify", () => ({
  notifyRatingForRecipeAuthor: mockNotifyRating,
  notifyCommentForRecipeAuthor: vi.fn(),
  notifySaveForRecipeAuthor: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
}));

const { setRatingAction, clearRatingAction } = await import(
  "@/lib/actions/ratings"
);

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
  mockAuth.mockReset();
  mockRevalidatePath.mockClear();
  mockNotifyRating.mockClear();
});

function signInAs(user: { id: string; name: string | null }) {
  mockAuth.mockResolvedValue({
    user: { id: user.id, name: user.name ?? null },
  });
}

describe("setRatingAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await setRatingAction("any", 4);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign in/i);
  });

  it("rejects values outside 1..5", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipe(testDb, author.id);

    for (const bad of [0, 6, 1.5, -1]) {
      const res = await setRatingAction(recipe.id, bad);
      expect(res.ok, `value=${bad}`).toBe(false);
      expect(res.error).toMatch(/1-5/);
    }
  });

  it("returns Recipe not found for an unknown id", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await setRatingAction(
      "00000000-0000-0000-0000-000000000000",
      3,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("rejects rating someone else's PRIVATE recipe", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id, { visibility: "private" });
    signInAs(rater);

    const res = await setRatingAction(recipe.id, 5);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/i);
  });

  it("inserts a new rating row and fires a push to the author", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb, { name: "Rater" });
    const recipe = seedRecipe(testDb, author.id);
    signInAs(rater);

    const res = await setRatingAction(recipe.id, 4);
    expect(res.ok).toBe(true);

    const row = testDb
      .select()
      .from(schema.recipeRatings)
      .where(
        and(
          eq(schema.recipeRatings.recipeId, recipe.id),
          eq(schema.recipeRatings.userId, rater.id),
        ),
      )
      .get();
    expect(row?.value).toBe(4);

    expect(mockNotifyRating).toHaveBeenCalledTimes(1);
    expect(mockNotifyRating).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: recipe.id,
        authorId: author.id,
        raterId: rater.id,
        value: 4,
      }),
    );
  });

  it("updates an existing rating instead of inserting a duplicate", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(rater);

    await setRatingAction(recipe.id, 3);
    await setRatingAction(recipe.id, 5);

    const rows = testDb
      .select()
      .from(schema.recipeRatings)
      .where(eq(schema.recipeRatings.recipeId, recipe.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(5);
  });

  it("does NOT push the author when the author rates their own recipe", async () => {
    const author = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(author);

    const res = await setRatingAction(recipe.id, 5);
    expect(res.ok).toBe(true);
    expect(mockNotifyRating).not.toHaveBeenCalled();
  });

  it("revalidates the recipe + feed paths on success", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(rater);

    await setRatingAction(recipe.id, 2);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/r/${recipe.id}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/feed");
  });
});

describe("clearRatingAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await clearRatingAction("any");
    expect(res.ok).toBe(false);
  });

  it("removes the viewer's rating when present", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(rater);

    await setRatingAction(recipe.id, 4);
    const res = await clearRatingAction(recipe.id);
    expect(res.ok).toBe(true);

    const remaining = testDb
      .select()
      .from(schema.recipeRatings)
      .where(eq(schema.recipeRatings.recipeId, recipe.id))
      .all();
    expect(remaining).toHaveLength(0);
  });

  it("is idempotent when the viewer hasn't rated", async () => {
    const author = seedUser(testDb);
    const rater = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(rater);

    const res = await clearRatingAction(recipe.id);
    expect(res.ok).toBe(true);
  });
});
