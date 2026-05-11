import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

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
const mockNotifyComment = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/push/notify", () => ({
  notifyCommentForRecipeAuthor: mockNotifyComment,
  notifyRatingForRecipeAuthor: vi.fn(),
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

const { addCommentAction, deleteCommentAction } = await import(
  "@/lib/actions/comments"
);

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
  mockAuth.mockReset();
  mockRevalidatePath.mockClear();
  mockNotifyComment.mockClear();
});

function signInAs(user: { id: string; name: string | null }) {
  mockAuth.mockResolvedValue({
    user: { id: user.id, name: user.name ?? null },
  });
}

describe("addCommentAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await addCommentAction("any", "hi");
    expect(res.ok).toBe(false);
  });

  it("rejects empty (whitespace-only) bodies", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipe(testDb, author.id);

    const res = await addCommentAction(recipe.id, "    ");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/say something/i);
  });

  it("rejects bodies past the max length", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipe(testDb, author.id);

    const res = await addCommentAction(recipe.id, "x".repeat(2001));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/under 2000/i);
  });

  it("rejects commenting on someone else's PRIVATE recipe", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id, { visibility: "private" });
    signInAs(commenter);

    const res = await addCommentAction(recipe.id, "yum");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/i);
  });

  it("inserts the trimmed body and pings the recipe author", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb, { name: "Commenter" });
    const recipe = seedRecipe(testDb, author.id);
    signInAs(commenter);

    const res = await addCommentAction(recipe.id, "  great recipe!  ");
    expect(res.ok).toBe(true);
    expect(res.data?.id).toBeDefined();

    const stored = testDb
      .select()
      .from(schema.recipeComments)
      .where(eq(schema.recipeComments.recipeId, recipe.id))
      .all();
    expect(stored).toHaveLength(1);
    expect(stored[0].body).toBe("great recipe!");
    expect(stored[0].authorId).toBe(commenter.id);

    expect(mockNotifyComment).toHaveBeenCalledTimes(1);
    expect(mockNotifyComment).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: recipe.id,
        authorId: author.id,
        commenterId: commenter.id,
        body: "great recipe!",
        recipeTitle: recipe.title,
      }),
    );
  });

  it("revalidates the recipe page on success", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);
    signInAs(commenter);

    await addCommentAction(recipe.id, "hi");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/r/${recipe.id}`);
  });
});

describe("deleteCommentAction", () => {
  async function seedComment(
    authorId: string,
    recipeId: string,
    commenterId: string,
  ) {
    signInAs({ id: commenterId, name: null });
    const res = await addCommentAction(recipeId, "to be deleted");
    expect(res.ok).toBe(true);
    return res.data!.id;
  }

  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await deleteCommentAction("anything");
    expect(res.ok).toBe(false);
  });

  it("is a no-op (ok=true) for an unknown id", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const res = await deleteCommentAction(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(res.ok).toBe(true);
  });

  it("lets the comment author delete their own comment", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);

    const commentId = await seedComment(author.id, recipe.id, commenter.id);
    signInAs(commenter);

    const res = await deleteCommentAction(commentId);
    expect(res.ok).toBe(true);

    const remaining = testDb
      .select()
      .from(schema.recipeComments)
      .all();
    expect(remaining).toHaveLength(0);
  });

  it("lets the recipe owner delete a comment they didn't write (moderation)", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);

    const commentId = await seedComment(author.id, recipe.id, commenter.id);
    signInAs(author);

    const res = await deleteCommentAction(commentId);
    expect(res.ok).toBe(true);
    const remaining = testDb
      .select()
      .from(schema.recipeComments)
      .all();
    expect(remaining).toHaveLength(0);
  });

  it("rejects deletion by a third-party (not author, not owner)", async () => {
    const author = seedUser(testDb);
    const commenter = seedUser(testDb);
    const lurker = seedUser(testDb);
    const recipe = seedRecipe(testDb, author.id);

    const commentId = await seedComment(author.id, recipe.id, commenter.id);
    signInAs(lurker);

    const res = await deleteCommentAction(commentId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not allowed/i);
  });
});
