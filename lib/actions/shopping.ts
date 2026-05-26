"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { consolidate } from "@/lib/shopping/consolidate";
import { deriveNumeric } from "@/lib/cooking/numerics";
import { logEvent } from "@/lib/insights/log";

type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  data?: T;
};

const NAME_MAX = 80;
const ITEM_NAME_MAX = 200;

/**
 * Create an empty shopping list. Used by the cookbook list-of-lists
 * page's "New list" button.
 */
export async function createShoppingListAction(input: {
  name: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > NAME_MAX) {
    return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  }

  const id = crypto.randomUUID();
  db.insert(shoppingLists)
    .values({
      id,
      ownerId: session.user.id,
      name,
      createdAt: new Date(),
    })
    .run();

  revalidatePath("/cookbook");
  revalidatePath("/cookbook/lists");
  await logEvent({
    kind: "shoppinglist.created",
    userId: session.user.id,
    metadata: { source: "empty" },
  });
  return { ok: true, data: { id } };
}

/**
 * Pull every ingredient from `recipeIds`, run them through the
 * consolidation pass, and append the results to `targetListId` (or a
 * brand-new list when `targetListId` is null). Items append at the end
 * of the existing positions so the user's existing items stay put.
 */
export async function addRecipesToShoppingListAction(args: {
  targetListId: string | null;
  /** Defaults to "Groceries — <date>" when creating a new list. */
  newListName?: string;
  recipeIds: string[];
}): Promise<ActionResult<{ listId: string; addedCount: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  const recipeIds = Array.from(new Set(args.recipeIds.filter(Boolean)));
  if (recipeIds.length === 0) {
    return { ok: false, error: "Pick at least one recipe." };
  }

  // Validate visibility: a recipe can be added to a list iff it's
  // public/unlisted OR owned by the user.
  const accessibleRecipes = db
    .select({
      id: recipes.id,
      authorId: recipes.authorId,
      visibility: recipes.visibility,
    })
    .from(recipes)
    .where(sql`${recipes.id} IN ${recipeIds}`)
    .all();

  const accessible = accessibleRecipes.filter(
    (r) => r.visibility !== "private" || r.authorId === userId,
  );
  if (accessible.length === 0) {
    return { ok: false, error: "Couldn't read those recipes." };
  }
  const accessibleIds = accessible.map((r) => r.id);

  const ingredients = db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(sql`${recipeIngredients.recipeId} IN ${accessibleIds}`)
    .all();

  const merged = consolidate(
    ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      // First-seen recipe wins for the displayed source — the merged
      // item carries the full set of recipes in `sourceRecipeIds`, but
      // the row in DB only keeps one for now (kept simple; we can
      // expand to a junction table when the UX needs "from 3 recipes").
      sourceRecipeId: i.recipeId,
    })),
  );
  if (merged.length === 0) {
    return { ok: false, error: "Those recipes don't have ingredients." };
  }

  let listId = args.targetListId;
  if (!listId) {
    listId = crypto.randomUUID();
    const fallbackName =
      args.newListName?.trim() ||
      `Groceries — ${new Date().toLocaleDateString()}`;
    db.insert(shoppingLists)
      .values({
        id: listId,
        ownerId: userId,
        name: fallbackName.slice(0, NAME_MAX),
        createdAt: new Date(),
      })
      .run();
  } else {
    const own = db
      .select({ id: shoppingLists.id })
      .from(shoppingLists)
      .where(
        and(
          eq(shoppingLists.id, listId),
          eq(shoppingLists.ownerId, userId),
        ),
      )
      .get();
    if (!own) return { ok: false, error: "Pick one of your lists." };
  }

  // Append after the highest existing position so we don't reshuffle
  // the user's in-progress check-off order.
  const startPos =
    (db
      .select({ n: sql<number>`COALESCE(MAX(${shoppingListItems.position}), -1) + 1` })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId))
      .get()?.n) ?? 0;

  const now = new Date();
  db.insert(shoppingListItems)
    .values(
      merged.map((m, i) => {
        const quantity = m.quantity?.slice(0, 40) ?? null;
        return {
          id: crypto.randomUUID(),
          listId: listId!,
          name: m.name.slice(0, ITEM_NAME_MAX),
          quantity,
          quantityNumeric: deriveNumeric(quantity),
          unit: m.unit?.slice(0, 40) ?? null,
          sourceRecipeId: m.sourceRecipeIds[0] ?? null,
          position: startPos + i,
          checked: false,
          addedAt: now,
        };
      }),
    )
    .run();

  revalidatePath("/cookbook");
  revalidatePath("/cookbook/lists");
  revalidatePath(`/cookbook/lists/${listId}`);
  // Log a `shoppinglist.created` only when this call actually created
  // a new list (i.e. `args.targetListId` was null). Appending to an
  // existing list is a different action and not worth its own bucket.
  if (!args.targetListId) {
    await logEvent({
      kind: "shoppinglist.created",
      userId,
      metadata: { source: "from_recipes", recipeCount: accessibleIds.length },
    });
  }
  return { ok: true, data: { listId, addedCount: merged.length } };
}

/**
 * Add a single ad-hoc item to a list (e.g. "milk").
 */
export async function addShoppingItemAction(
  listId: string,
  input: { name: string; quantity?: string; unit?: string },
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const own = db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.ownerId, session.user.id),
      ),
    )
    .get();
  if (!own) return { ok: false, error: "List not found." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const id = crypto.randomUUID();
  const startPos =
    (db
      .select({ n: sql<number>`COALESCE(MAX(${shoppingListItems.position}), -1) + 1` })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId))
      .get()?.n) ?? 0;

  const quantity = input.quantity?.trim()?.slice(0, 40) || null;
  db.insert(shoppingListItems)
    .values({
      id,
      listId,
      name: name.slice(0, ITEM_NAME_MAX),
      quantity,
      quantityNumeric: deriveNumeric(quantity),
      unit: input.unit?.trim()?.slice(0, 40) || null,
      sourceRecipeId: null,
      position: startPos,
      checked: false,
      addedAt: new Date(),
    })
    .run();

  revalidatePath(`/cookbook/lists/${listId}`);
  return { ok: true, data: { id } };
}

/**
 * Toggle the checked state of an item.
 */
export async function toggleShoppingItemAction(
  itemId: string,
): Promise<ActionResult<{ checked: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const row = db
    .select({
      id: shoppingListItems.id,
      listId: shoppingListItems.listId,
      checked: shoppingListItems.checked,
      ownerId: shoppingLists.ownerId,
    })
    .from(shoppingListItems)
    .innerJoin(
      shoppingLists,
      eq(shoppingLists.id, shoppingListItems.listId),
    )
    .where(eq(shoppingListItems.id, itemId))
    .get();
  if (!row) return { ok: false, error: "Item not found." };
  if (row.ownerId !== session.user.id) {
    return { ok: false, error: "Not your list." };
  }

  const next = !row.checked;
  db.update(shoppingListItems)
    .set({ checked: next })
    .where(eq(shoppingListItems.id, itemId))
    .run();

  revalidatePath(`/cookbook/lists/${row.listId}`);
  return { ok: true, data: { checked: next } };
}

/**
 * Delete a single item.
 */
export async function deleteShoppingItemAction(
  itemId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const row = db
    .select({
      id: shoppingListItems.id,
      listId: shoppingListItems.listId,
      ownerId: shoppingLists.ownerId,
    })
    .from(shoppingListItems)
    .innerJoin(
      shoppingLists,
      eq(shoppingLists.id, shoppingListItems.listId),
    )
    .where(eq(shoppingListItems.id, itemId))
    .get();
  if (!row) return { ok: true };
  if (row.ownerId !== session.user.id) {
    return { ok: false, error: "Not your list." };
  }

  db.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId)).run();
  revalidatePath(`/cookbook/lists/${row.listId}`);
  return { ok: true };
}

/**
 * Archive (`true`) or un-archive (`false`) a list. Archived lists hide
 * from active pickers but stay in the cookbook history.
 */
export async function setShoppingListArchivedAction(
  listId: string,
  archived: boolean,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const own = db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.ownerId, session.user.id),
      ),
    )
    .get();
  if (!own) return { ok: false, error: "List not found." };

  db.update(shoppingLists)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(shoppingLists.id, listId))
    .run();

  revalidatePath("/cookbook");
  revalidatePath("/cookbook/lists");
  revalidatePath(`/cookbook/lists/${listId}`);
  return { ok: true };
}

/**
 * Hard-delete a list (and all items via cascade).
 */
export async function deleteShoppingListAction(
  listId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const own = db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.ownerId, session.user.id),
      ),
    )
    .get();
  if (!own) return { ok: true };

  db.delete(shoppingLists).where(eq(shoppingLists.id, listId)).run();
  revalidatePath("/cookbook");
  revalidatePath("/cookbook/lists");
  return { ok: true };
}
