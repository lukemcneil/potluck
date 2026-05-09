import "server-only";

import { and, asc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, recipes } from "@/db/schema";

export type UserCardData = {
  id: string;
  name: string | null;
  handle: string;
  image: string | null;
  bio: string | null;
  recipeCount: number;
};

const PAGE_SIZE = 24;

/**
 * Search users by name OR handle OR bio. Case-insensitive substring match
 * (LIKE) — usernames are short and we don't index them in FTS5. Always
 * filters out users without a public handle. Recipe count is the number
 * of PUBLIC recipes the user has authored.
 *
 * Implemented as two queries (user list + single grouped COUNT) instead
 * of a correlated subquery, because Drizzle's `${users.id}` / `${recipes}`
 * interpolation inside a raw `sql\`\`` template doesn't reliably correlate
 * to the outer query — it produced 0s for users that did have recipes.
 */
export async function searchUsers(
  query: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<UserCardData[]> {
  const limit = opts.limit ?? PAGE_SIZE;
  const offset = opts.offset ?? 0;

  const trimmed = query.trim();
  const conds = [isNotNull(users.handle)];

  if (trimmed) {
    const pattern = `%${escapeLike(trimmed)}%`;
    conds.push(
      or(
        like(sql`LOWER(${users.name})`, pattern.toLowerCase()),
        like(sql`LOWER(${users.handle})`, pattern.toLowerCase()),
        like(sql`LOWER(${users.bio})`, pattern.toLowerCase()),
      )!,
    );
  }

  const rows = db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
      bio: users.bio,
    })
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.handle))
    .all();

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const counts = db
    .select({
      authorId: recipes.authorId,
      n: sql<number>`COUNT(*)`,
    })
    .from(recipes)
    .where(
      and(eq(recipes.visibility, "public"), inArray(recipes.authorId, ids)),
    )
    .groupBy(recipes.authorId)
    .all();
  const countByAuthor = new Map(counts.map((c) => [c.authorId, c.n]));

  // Order by public-recipe count desc, then handle asc, then page-slice
  // in JS. Cheap because the user list is small.
  const enriched: UserCardData[] = rows.map((r) => ({
    id: r.id,
    name: r.name ?? null,
    handle: r.handle as string,
    image: r.image ?? null,
    bio: r.bio ?? null,
    recipeCount: countByAuthor.get(r.id) ?? 0,
  }));
  enriched.sort((a, b) => {
    if (b.recipeCount !== a.recipeCount) return b.recipeCount - a.recipeCount;
    return a.handle.localeCompare(b.handle);
  });

  return enriched.slice(offset, offset + limit);
}

export async function getUserByHandle(handle: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.handle, handle))
    .get();
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
