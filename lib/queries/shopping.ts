import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  recipes,
  shoppingListItems,
  shoppingLists,
} from "@/db/schema";

export type ShoppingListSummary = {
  id: string;
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
  itemCount: number;
  checkedCount: number;
};

/**
 * Lists owned by a user. `activeOnly` (default false) hides archived
 * lists — useful for "Add to shopping list" pickers where we only want
 * lists the user is currently shopping against.
 */
export function listShoppingListsForUser(
  userId: string,
  opts: { activeOnly?: boolean } = {},
): ShoppingListSummary[] {
  const conditions = [eq(shoppingLists.ownerId, userId)];
  if (opts.activeOnly) conditions.push(isNull(shoppingLists.archivedAt));

  const rows = db
    .select({
      id: shoppingLists.id,
      name: shoppingLists.name,
      createdAt: shoppingLists.createdAt,
      archivedAt: shoppingLists.archivedAt,
      itemCount: sql<number>`COUNT(${shoppingListItems.id})`,
      checkedCount: sql<number>`COALESCE(SUM(CASE WHEN ${shoppingListItems.checked} THEN 1 ELSE 0 END), 0)`,
    })
    .from(shoppingLists)
    .leftJoin(
      shoppingListItems,
      eq(shoppingListItems.listId, shoppingLists.id),
    )
    .where(and(...conditions))
    .groupBy(shoppingLists.id)
    .orderBy(desc(shoppingLists.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    archivedAt: r.archivedAt,
    itemCount: Number(r.itemCount),
    checkedCount: Number(r.checkedCount),
  }));
}

export type ShoppingListItem = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  position: number;
  checked: boolean;
  addedAt: Date;
  source: { recipeId: string; recipeTitle: string } | null;
};

export type ShoppingListDetail = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
  items: ShoppingListItem[];
};

/**
 * Fetch a list + every item, with the source recipe's title joined in.
 * Returns null when the list doesn't exist or the user doesn't own it.
 */
export function getShoppingListForUser(
  listId: string,
  userId: string,
): ShoppingListDetail | null {
  const list = db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.ownerId, userId),
      ),
    )
    .get();
  if (!list) return null;

  const itemRows = db
    .select({
      id: shoppingListItems.id,
      name: shoppingListItems.name,
      quantity: shoppingListItems.quantity,
      unit: shoppingListItems.unit,
      position: shoppingListItems.position,
      checked: shoppingListItems.checked,
      addedAt: shoppingListItems.addedAt,
      sourceRecipeId: shoppingListItems.sourceRecipeId,
      sourceRecipeTitle: recipes.title,
    })
    .from(shoppingListItems)
    .leftJoin(recipes, eq(recipes.id, shoppingListItems.sourceRecipeId))
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.position)
    .all();

  return {
    id: list.id,
    ownerId: list.ownerId,
    name: list.name,
    createdAt: list.createdAt,
    archivedAt: list.archivedAt,
    items: itemRows.map((r) => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      unit: r.unit,
      position: r.position,
      checked: r.checked,
      addedAt: r.addedAt,
      source:
        r.sourceRecipeId && r.sourceRecipeTitle
          ? { recipeId: r.sourceRecipeId, recipeTitle: r.sourceRecipeTitle }
          : null,
    })),
  };
}
