import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  createTestDb,
  seedUser,
  seedRecipe,
  type TestDb,
} from "@/lib/actions/__tests__/_helpers";

let testDb: TestDb;
let testSqlite: ReturnType<typeof createTestDb>["sqlite"];

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
}));

const { logEvent } = await import("@/lib/insights/log");

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
});

describe("logEvent", () => {
  it("inserts a row with the given kind, userId, and recipeId", async () => {
    const user = seedUser(testDb);
    const recipe = seedRecipe(testDb, user.id);

    await logEvent({
      kind: "recipe.viewed",
      userId: user.id,
      recipeId: recipe.id,
    });

    const rows = testDb
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, "recipe.viewed"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect(rows[0].recipeId).toBe(recipe.id);
    expect(rows[0].metadata).toBeNull();
    // createdAt is auto-populated, must be a valid Date within the
    // last second.
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(Date.now() - (rows[0].createdAt?.getTime() ?? 0)).toBeLessThan(2000);
  });

  it("JSON-encodes metadata into the metadata column", async () => {
    const user = seedUser(testDb);
    await logEvent({
      kind: "recipe.imported.url",
      userId: user.id,
      metadata: { model: "gemini-2.5-flash", costUsd: 0.0023 },
    });
    const row = testDb
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, "recipe.imported.url"))
      .get();
    expect(row?.metadata).toBe(
      '{"model":"gemini-2.5-flash","costUsd":0.0023}',
    );
  });

  it("accepts events with no userId and no recipeId (e.g. anonymous views)", async () => {
    await logEvent({ kind: "recipe.viewed", recipeId: null });
    const rows = testDb.select().from(schema.events).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].recipeId).toBeNull();
  });

  it("swallows DB errors instead of throwing — analytics must never break callers", async () => {
    // Drop the events table to force the next insert to fail.
    testSqlite.exec("DROP TABLE events");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must NOT throw, even though the underlying DB call will fail.
    await expect(
      logEvent({ kind: "user.signedin", userId: "u1" }),
    ).resolves.toBeUndefined();

    // And it should at least leave a breadcrumb in console.error for
    // the operator to find.
    expect(errSpy).toHaveBeenCalledWith(
      "[insights] logEvent failed",
      expect.objectContaining({ kind: "user.signedin" }),
    );

    errSpy.mockRestore();
  });
});
