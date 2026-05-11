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
}));

const {
  createShoppingListAction,
  addRecipesToShoppingListAction,
  addShoppingItemAction,
  toggleShoppingItemAction,
  deleteShoppingItemAction,
  setShoppingListArchivedAction,
  deleteShoppingListAction,
} = await import("@/lib/actions/shopping");

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
  mockAuth.mockReset();
  mockRevalidatePath.mockClear();
});

function signInAs(user: { id: string }) {
  mockAuth.mockResolvedValue({ user: { id: user.id } });
}

function seedRecipeWithIngredients(
  authorId: string,
  ingredients: Array<{ name: string; quantity?: string; unit?: string }>,
  overrides: Partial<typeof schema.recipes.$inferInsert> = {},
) {
  const recipe = seedRecipe(testDb, authorId, overrides);
  for (let i = 0; i < ingredients.length; i++) {
    testDb
      .insert(schema.recipeIngredients)
      .values({
        recipeId: recipe.id,
        position: i,
        name: ingredients[i].name,
        quantity: ingredients[i].quantity ?? null,
        unit: ingredients[i].unit ?? null,
      })
      .run();
  }
  return recipe;
}

describe("createShoppingListAction", () => {
  it("rejects unsigned-in callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await createShoppingListAction({ name: "x" });
    expect(res.ok).toBe(false);
  });

  it("rejects empty names", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await createShoppingListAction({ name: "   " });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/required/i);
  });

  it("creates a list owned by the signed-in user", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await createShoppingListAction({ name: "  Saturday  " });
    expect(res.ok).toBe(true);

    const rows = testDb.select().from(schema.shoppingLists).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe(user.id);
    expect(rows[0].name).toBe("Saturday");
  });
});

describe("addRecipesToShoppingListAction", () => {
  it("rejects empty recipe lists", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await addRecipesToShoppingListAction({
      targetListId: null,
      recipeIds: [],
    });
    expect(res.ok).toBe(false);
  });

  it("creates a new list when targetListId is null", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipeWithIngredients(author.id, [
      { name: "flour", quantity: "2", unit: "cups" },
    ]);

    const res = await addRecipesToShoppingListAction({
      targetListId: null,
      newListName: "Test list",
      recipeIds: [recipe.id],
    });
    expect(res.ok).toBe(true);
    expect(res.data?.addedCount).toBe(1);

    const lists = testDb.select().from(schema.shoppingLists).all();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("Test list");

    const items = testDb.select().from(schema.shoppingListItems).all();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("flour");
    expect(items[0].quantity).toBe("2");
    expect(items[0].unit).toBe("cups");
    expect(items[0].sourceRecipeId).toBe(recipe.id);
  });

  it("consolidates identical (name, unit) across recipes by summing quantities", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const r1 = seedRecipeWithIngredients(author.id, [
      { name: "flour", quantity: "1", unit: "cup" },
      { name: "salt", quantity: "1", unit: "tsp" },
    ]);
    const r2 = seedRecipeWithIngredients(author.id, [
      { name: "Flour", quantity: "2", unit: "cup" }, // case-insensitive match
      { name: "sugar", quantity: "1", unit: "cup" },
    ]);

    const res = await addRecipesToShoppingListAction({
      targetListId: null,
      recipeIds: [r1.id, r2.id],
    });
    expect(res.ok).toBe(true);
    expect(res.data?.addedCount).toBe(3);

    const items = testDb
      .select()
      .from(schema.shoppingListItems)
      .all();

    const flour = items.find((i) => i.name.toLowerCase() === "flour");
    expect(flour).toBeDefined();
    expect(flour?.quantity).toBe("3"); // 1 + 2
    expect(flour?.unit).toBe("cup");

    const salt = items.find((i) => i.name === "salt");
    expect(salt?.quantity).toBe("1");

    const sugar = items.find((i) => i.name === "sugar");
    expect(sugar?.quantity).toBe("1");
  });

  it("appends after the highest existing position when given a target list", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipeWithIngredients(author.id, [
      { name: "milk", quantity: "1", unit: "cup" },
    ]);
    const created = await createShoppingListAction({ name: "Trip" });
    expect(created.ok).toBe(true);
    const listId = created.data!.id;

    // Pre-seed an existing item at position 7 to verify we append after it.
    testDb
      .insert(schema.shoppingListItems)
      .values({
        listId,
        name: "eggs",
        position: 7,
        addedAt: new Date(),
        checked: false,
      })
      .run();

    const res = await addRecipesToShoppingListAction({
      targetListId: listId,
      recipeIds: [recipe.id],
    });
    expect(res.ok).toBe(true);

    const items = testDb
      .select()
      .from(schema.shoppingListItems)
      .where(eq(schema.shoppingListItems.listId, listId))
      .all();
    const milk = items.find((i) => i.name === "milk");
    expect(milk?.position).toBe(8);
  });

  it("refuses to add to a list owned by someone else", async () => {
    const owner = seedUser(testDb);
    const intruder = seedUser(testDb);
    signInAs(owner);
    const created = await createShoppingListAction({ name: "Mine" });
    const listId = created.data!.id;

    signInAs(intruder);
    const recipe = seedRecipeWithIngredients(intruder.id, [
      { name: "milk", quantity: "1", unit: "cup" },
    ]);

    const res = await addRecipesToShoppingListAction({
      targetListId: listId,
      recipeIds: [recipe.id],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/your lists/i);
  });

  it("filters out PRIVATE recipes the user can't read", async () => {
    const author = seedUser(testDb);
    const other = seedUser(testDb);
    const visible = seedRecipeWithIngredients(author.id, [
      { name: "salt", quantity: "1", unit: "tsp" },
    ]);
    const hidden = seedRecipeWithIngredients(
      other.id,
      [{ name: "secret", quantity: "1", unit: "cup" }],
      { visibility: "private" },
    );
    signInAs(author);

    const res = await addRecipesToShoppingListAction({
      targetListId: null,
      recipeIds: [visible.id, hidden.id],
    });
    expect(res.ok).toBe(true);
    const items = testDb.select().from(schema.shoppingListItems).all();
    expect(items.map((i) => i.name).sort()).toEqual(["salt"]);
  });

  it("returns an error when the chosen recipes have no ingredients", async () => {
    const author = seedUser(testDb);
    signInAs(author);
    const recipe = seedRecipe(testDb, author.id); // no ingredients

    const res = await addRecipesToShoppingListAction({
      targetListId: null,
      recipeIds: [recipe.id],
    });
    expect(res.ok).toBe(false);
  });
});

describe("addShoppingItemAction + toggle/delete", () => {
  it("adds an ad-hoc item to the user's list", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const created = await createShoppingListAction({ name: "L" });
    const listId = created.data!.id;

    const res = await addShoppingItemAction(listId, { name: "  apples  " });
    expect(res.ok).toBe(true);
    const items = testDb
      .select()
      .from(schema.shoppingListItems)
      .where(eq(schema.shoppingListItems.listId, listId))
      .all();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("apples");
    expect(items[0].sourceRecipeId).toBeNull();
  });

  it("rejects adding to someone else's list", async () => {
    const owner = seedUser(testDb);
    const intruder = seedUser(testDb);
    signInAs(owner);
    const created = await createShoppingListAction({ name: "L" });
    const listId = created.data!.id;

    signInAs(intruder);
    const res = await addShoppingItemAction(listId, { name: "milk" });
    expect(res.ok).toBe(false);
  });

  it("toggles checked state and is owner-restricted", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const created = await createShoppingListAction({ name: "L" });
    const item = await addShoppingItemAction(created.data!.id, { name: "x" });
    const itemId = item.data!.id;

    const t1 = await toggleShoppingItemAction(itemId);
    expect(t1.ok).toBe(true);
    expect(t1.data?.checked).toBe(true);
    const t2 = await toggleShoppingItemAction(itemId);
    expect(t2.data?.checked).toBe(false);

    const intruder = seedUser(testDb);
    signInAs(intruder);
    const t3 = await toggleShoppingItemAction(itemId);
    expect(t3.ok).toBe(false);
  });

  it("deletes a single item", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const created = await createShoppingListAction({ name: "L" });
    const item = await addShoppingItemAction(created.data!.id, { name: "x" });

    const del = await deleteShoppingItemAction(item.data!.id);
    expect(del.ok).toBe(true);
    const remaining = testDb.select().from(schema.shoppingListItems).all();
    expect(remaining).toHaveLength(0);
  });
});

describe("setShoppingListArchivedAction + deleteShoppingListAction", () => {
  it("toggles archivedAt", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const created = await createShoppingListAction({ name: "L" });
    const listId = created.data!.id;

    await setShoppingListArchivedAction(listId, true);
    const archived = testDb
      .select()
      .from(schema.shoppingLists)
      .where(eq(schema.shoppingLists.id, listId))
      .get();
    expect(archived?.archivedAt).not.toBeNull();

    await setShoppingListArchivedAction(listId, false);
    const restored = testDb
      .select()
      .from(schema.shoppingLists)
      .where(eq(schema.shoppingLists.id, listId))
      .get();
    expect(restored?.archivedAt).toBeNull();
  });

  it("hard-deletes a list and cascades its items", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const created = await createShoppingListAction({ name: "L" });
    const listId = created.data!.id;
    await addShoppingItemAction(listId, { name: "x" });
    expect(testDb.select().from(schema.shoppingListItems).all()).toHaveLength(1);

    const res = await deleteShoppingListAction(listId);
    expect(res.ok).toBe(true);
    expect(testDb.select().from(schema.shoppingLists).all()).toHaveLength(0);
    expect(testDb.select().from(schema.shoppingListItems).all()).toHaveLength(0);
  });

  it("delete is a no-op (ok=true) when the list isn't yours / doesn't exist", async () => {
    const user = seedUser(testDb);
    signInAs(user);
    const res = await deleteShoppingListAction(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(res.ok).toBe(true);
  });
});
