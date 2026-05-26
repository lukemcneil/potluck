import "server-only";

import { and, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { events, recipes, users } from "@/db/schema";

/**
 * All read-side helpers for the owner dashboard at /admin/insights.
 *
 * Each function takes a `daysBack` window (default 30) and returns
 * already-aggregated rows ready to render. The dashboard renders a
 * small fixed set of panels, so we expose one query per panel rather
 * than one generic "events" query — keeps each call narrowly typed
 * and easy to test independently.
 *
 * Time bucketing uses SQLite's `strftime` against `createdAt / 1000`
 * (the timestamps are stored as millis via Drizzle's `timestamp_ms`
 * mode). All buckets are UTC; we don't try to render in the owner's
 * local timezone because a date-only granularity is fine for the
 * "when do people use my app" question and timezone math would just
 * add edge cases.
 */

function sinceMs(daysBack: number): Date {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
}

export type DailyActivityRow = {
  day: string;
  totalEvents: number;
  activeUsers: number;
};

/**
 * Events-per-day + distinct-users-per-day for the activity sparkline.
 * Anonymous events (userId IS NULL) count toward totalEvents but not
 * toward activeUsers.
 */
export async function fetchDailyActivity(
  daysBack = 30,
): Promise<DailyActivityRow[]> {
  const since = sinceMs(daysBack);
  const rows = db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch')`,
      totalEvents: sql<number>`COUNT(*)`,
      activeUsers: sql<number>`COUNT(DISTINCT ${events.userId})`,
    })
    .from(events)
    .where(gte(events.createdAt, since))
    .groupBy(sql`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch')`)
    .orderBy(sql`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch') ASC`)
    .all();

  return rows.map((r) => ({
    day: String(r.day),
    totalEvents: Number(r.totalEvents),
    activeUsers: Number(r.activeUsers),
  }));
}

export type EventBreakdownRow = { kind: string; count: number };

/**
 * Count by event kind across the window. Rendered as a horizontal bar
 * panel — "what are people actually doing in the app."
 */
export async function fetchEventBreakdown(
  daysBack = 30,
): Promise<EventBreakdownRow[]> {
  const since = sinceMs(daysBack);
  const rows = db
    .select({
      kind: events.kind,
      count: sql<number>`COUNT(*)`,
    })
    .from(events)
    .where(gte(events.createdAt, since))
    .groupBy(events.kind)
    .orderBy(sql`COUNT(*) DESC`)
    .all();
  return rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
}

export type TopRecipeRow = {
  recipeId: string;
  title: string;
  authorHandle: string | null;
  views: number;
};

/**
 * Top-viewed recipes in the window. We join through `recipes` so we
 * can skip rows where the recipe was deleted (the FK is ON DELETE SET
 * NULL on the events side, so historical events survive but become
 * un-joinable).
 */
export async function fetchTopRecipes(
  daysBack = 30,
  limit = 10,
): Promise<TopRecipeRow[]> {
  const since = sinceMs(daysBack);
  const rows = db
    .select({
      recipeId: recipes.id,
      title: recipes.title,
      authorHandle: users.handle,
      views: sql<number>`COUNT(${events.id})`,
    })
    .from(events)
    .innerJoin(recipes, sql`${recipes.id} = ${events.recipeId}`)
    .leftJoin(users, sql`${users.id} = ${recipes.authorId}`)
    .where(
      and(
        sql`${events.kind} = 'recipe.viewed'`,
        gte(events.createdAt, since),
      ),
    )
    .groupBy(recipes.id, recipes.title, users.handle)
    .orderBy(sql`COUNT(${events.id}) DESC`)
    .limit(limit)
    .all();
  return rows.map((r) => ({
    recipeId: String(r.recipeId),
    title: String(r.title),
    authorHandle: r.authorHandle ?? null,
    views: Number(r.views),
  }));
}

export type SignupRow = { day: string; signups: number };

/**
 * Signups-per-day. Drives a small "growth" sparkline so the owner
 * can see whether the app is gaining users.
 */
export async function fetchSignupTimeline(
  daysBack = 30,
): Promise<SignupRow[]> {
  const since = sinceMs(daysBack);
  const rows = db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch')`,
      signups: sql<number>`COUNT(*)`,
    })
    .from(events)
    .where(
      and(
        sql`${events.kind} = 'user.signedup'`,
        gte(events.createdAt, since),
      ),
    )
    .groupBy(sql`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch')`)
    .orderBy(sql`strftime('%Y-%m-%d', ${events.createdAt} / 1000, 'unixepoch') ASC`)
    .all();
  return rows.map((r) => ({
    day: String(r.day),
    signups: Number(r.signups),
  }));
}

export type TotalsSummary = {
  totalUsers: number;
  totalRecipes: number;
  totalEvents: number;
  activeUsers7d: number;
  activeUsers30d: number;
};

/**
 * Single-row at-a-glance summary for the header tiles. Cheap: five
 * count-style queries with index hits on (kind, createdAt) and
 * (userId, createdAt).
 */
export async function fetchTotals(): Promise<TotalsSummary> {
  const since7 = sinceMs(7);
  const since30 = sinceMs(30);

  const totalUsers = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(users)
    .get();
  const totalRecipes = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(recipes)
    .get();
  const totalEvents = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(events)
    .get();
  const active7 = db
    .select({ n: sql<number>`COUNT(DISTINCT ${events.userId})` })
    .from(events)
    .where(gte(events.createdAt, since7))
    .get();
  const active30 = db
    .select({ n: sql<number>`COUNT(DISTINCT ${events.userId})` })
    .from(events)
    .where(gte(events.createdAt, since30))
    .get();

  return {
    totalUsers: Number(totalUsers?.n ?? 0),
    totalRecipes: Number(totalRecipes?.n ?? 0),
    totalEvents: Number(totalEvents?.n ?? 0),
    activeUsers7d: Number(active7?.n ?? 0),
    activeUsers30d: Number(active30?.n ?? 0),
  };
}

/**
 * Fill missing days with zeros so the chart renders a continuous
 * timeline. Without this a quiet weekend collapses two visible bars
 * into one, which is misleading.
 */
export function padDailySeries<T extends { day: string }>(
  rows: T[],
  daysBack: number,
  fill: (day: string) => T,
): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: T[] = [];
  // We want `daysBack` distinct days ending today (UTC), inclusive.
  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? fill(key));
  }
  return out;
}
