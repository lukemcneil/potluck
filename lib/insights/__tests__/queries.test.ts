import { describe, it, expect, beforeEach, vi } from "vitest";

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

const {
  fetchDailyActivity,
  fetchEventBreakdown,
  fetchTopRecipes,
  fetchSignupTimeline,
  fetchTotals,
  padDailySeries,
} = await import("@/lib/insights/queries");

beforeEach(() => {
  const env = createTestDb();
  testDb = env.db;
  testSqlite = env.sqlite;
});

// Tiny helper so tests stay readable. We insert directly via Drizzle
// rather than going through logEvent so we can pin createdAt to a
// known point in time and exercise day-bucketing.
function insertEvent(opts: {
  kind: string;
  userId?: string | null;
  recipeId?: string | null;
  createdAt: Date;
  metadata?: string | null;
}) {
  testDb
    .insert(schema.events)
    .values({
      kind: opts.kind,
      userId: opts.userId ?? null,
      recipeId: opts.recipeId ?? null,
      metadata: opts.metadata ?? null,
      createdAt: opts.createdAt,
    })
    .run();
}

function utcDay(day: string, hour = 12): Date {
  // day is YYYY-MM-DD; build a midday timestamp so it can't accidentally
  // bucket into the previous/next day regardless of the test machine's
  // timezone.
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
}

describe("fetchDailyActivity", () => {
  it("buckets events by UTC day and counts distinct users", async () => {
    const u1 = seedUser(testDb);
    const u2 = seedUser(testDb);

    // 3 events on 2026-05-20 from 2 distinct users.
    insertEvent({ kind: "recipe.viewed", userId: u1.id, createdAt: utcDay("2026-05-20", 8) });
    insertEvent({ kind: "recipe.viewed", userId: u1.id, createdAt: utcDay("2026-05-20", 9) });
    insertEvent({ kind: "recipe.viewed", userId: u2.id, createdAt: utcDay("2026-05-20", 10) });
    // 1 anonymous event on 2026-05-21.
    insertEvent({ kind: "recipe.viewed", userId: null, createdAt: utcDay("2026-05-21", 14) });

    const rows = await fetchDailyActivity(365);
    const may20 = rows.find((r) => r.day === "2026-05-20");
    const may21 = rows.find((r) => r.day === "2026-05-21");

    expect(may20).toEqual({ day: "2026-05-20", totalEvents: 3, activeUsers: 2 });
    // Anonymous events count toward totalEvents but not distinct users.
    expect(may21).toEqual({ day: "2026-05-21", totalEvents: 1, activeUsers: 0 });
  });

  it("respects the daysBack window", async () => {
    const u = seedUser(testDb);
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    insertEvent({ kind: "recipe.viewed", userId: u.id, createdAt: old });
    insertEvent({ kind: "recipe.viewed", userId: u.id, createdAt: recent });

    const rows = await fetchDailyActivity(7);
    // Only the recent event should appear in a 7-day window.
    const total = rows.reduce((acc, r) => acc + r.totalEvents, 0);
    expect(total).toBe(1);
  });
});

describe("fetchEventBreakdown", () => {
  it("counts events by kind, ordered descending", async () => {
    const u = seedUser(testDb);
    const r = seedRecipe(testDb, u.id);
    const now = new Date();
    insertEvent({ kind: "recipe.viewed", userId: u.id, recipeId: r.id, createdAt: now });
    insertEvent({ kind: "recipe.viewed", userId: u.id, recipeId: r.id, createdAt: now });
    insertEvent({ kind: "recipe.viewed", userId: u.id, recipeId: r.id, createdAt: now });
    insertEvent({ kind: "rating.set", userId: u.id, recipeId: r.id, createdAt: now });

    const rows = await fetchEventBreakdown(30);
    // Sorted by count desc — most-frequent kind first.
    expect(rows[0]).toEqual({ kind: "recipe.viewed", count: 3 });
    expect(rows[1]).toEqual({ kind: "rating.set", count: 1 });
  });
});

describe("fetchTopRecipes", () => {
  it("ranks recipes by view count and includes author handle", async () => {
    const author = seedUser(testDb, { handle: "the-chef" });
    const viewer = seedUser(testDb);
    const r1 = seedRecipe(testDb, author.id, { title: "Popular" });
    const r2 = seedRecipe(testDb, author.id, { title: "Mid" });
    const now = new Date();

    for (let i = 0; i < 5; i += 1) {
      insertEvent({ kind: "recipe.viewed", userId: viewer.id, recipeId: r1.id, createdAt: now });
    }
    insertEvent({ kind: "recipe.viewed", userId: viewer.id, recipeId: r2.id, createdAt: now });

    const rows = await fetchTopRecipes(30, 10);
    expect(rows.map((r) => r.title)).toEqual(["Popular", "Mid"]);
    expect(rows[0].views).toBe(5);
    expect(rows[0].authorHandle).toBe("the-chef");
  });

  it("ignores non-view event kinds", async () => {
    const author = seedUser(testDb);
    const r1 = seedRecipe(testDb, author.id);
    const now = new Date();
    // 10 ratings shouldn't push this recipe up the views chart.
    for (let i = 0; i < 10; i += 1) {
      insertEvent({ kind: "rating.set", userId: author.id, recipeId: r1.id, createdAt: now });
    }
    const rows = await fetchTopRecipes(30, 10);
    expect(rows).toEqual([]);
  });

  it("skips orphan events where the recipe has been deleted", async () => {
    // Insert an event referencing a recipe that doesn't exist. The
    // INNER JOIN should silently drop it (vs leaking a null title to
    // the dashboard).
    const u = seedUser(testDb);
    insertEvent({
      kind: "recipe.viewed",
      userId: u.id,
      recipeId: null, // schema allows null — represents post-deletion
      createdAt: new Date(),
    });
    const rows = await fetchTopRecipes(30, 10);
    expect(rows).toEqual([]);
  });
});

describe("fetchSignupTimeline", () => {
  it("counts user.signedup events only", async () => {
    const u = seedUser(testDb);
    insertEvent({ kind: "user.signedup", userId: u.id, createdAt: utcDay("2026-05-22") });
    insertEvent({ kind: "user.signedup", userId: u.id, createdAt: utcDay("2026-05-22") });
    insertEvent({ kind: "user.signedin", userId: u.id, createdAt: utcDay("2026-05-22") });

    const rows = await fetchSignupTimeline(365);
    const day = rows.find((r) => r.day === "2026-05-22");
    expect(day).toEqual({ day: "2026-05-22", signups: 2 });
  });
});

describe("fetchTotals", () => {
  it("returns user/recipe/event totals plus 7d and 30d actives", async () => {
    const u1 = seedUser(testDb);
    const u2 = seedUser(testDb);
    const u3 = seedUser(testDb);
    seedRecipe(testDb, u1.id);
    seedRecipe(testDb, u2.id);

    const now = new Date();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    insertEvent({ kind: "recipe.viewed", userId: u1.id, createdAt: now });
    insertEvent({ kind: "recipe.viewed", userId: u2.id, createdAt: sixDaysAgo });
    insertEvent({ kind: "recipe.viewed", userId: u3.id, createdAt: twentyDaysAgo });

    const totals = await fetchTotals();
    expect(totals.totalUsers).toBe(3);
    expect(totals.totalRecipes).toBe(2);
    expect(totals.totalEvents).toBe(3);
    expect(totals.activeUsers7d).toBe(2); // u1, u2
    expect(totals.activeUsers30d).toBe(3); // all of them
  });
});

describe("padDailySeries", () => {
  it("fills missing days with the provided fill row, preserving present ones", () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const todayKey = today.toISOString().slice(0, 10);
    const yKey = yesterday.toISOString().slice(0, 10);

    const rows = [{ day: todayKey, signups: 3 }];
    const padded = padDailySeries(rows, 2, (day) => ({ day, signups: 0 }));

    expect(padded).toHaveLength(2);
    expect(padded[0]).toEqual({ day: yKey, signups: 0 });
    expect(padded[1]).toEqual({ day: todayKey, signups: 3 });
  });
});
