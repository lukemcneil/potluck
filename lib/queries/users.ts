import "server-only";

import { and, asc, desc, eq, isNotNull, like, or, sql } from "drizzle-orm";
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
 * of public recipes the user has authored.
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
      recipeCount: sql<number>`(
        SELECT COUNT(*) FROM ${recipes}
        WHERE ${recipes.authorId} = ${users.id}
          AND ${recipes.visibility} = 'public'
      )`,
    })
    .from(users)
    .where(and(...conds))
    .orderBy(
      // Recent + most-recipes float to the top of empty-query browsing.
      desc(sql`(SELECT COUNT(*) FROM ${recipes}
        WHERE ${recipes.authorId} = ${users.id} AND ${recipes.visibility} = 'public')`),
      asc(users.handle),
    )
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? null,
    handle: r.handle as string,
    image: r.image ?? null,
    bio: r.bio ?? null,
    recipeCount: r.recipeCount ?? 0,
  }));
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
