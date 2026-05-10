import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { aiUsage } from "@/db/schema";

/**
 * Returns the start of the current month (UTC) so all spend math
 * lines up with calendar months across timezones. Using UTC keeps the
 * cap stable for users who travel.
 */
export function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type MonthlySpend = {
  totalUsd: number;
  totalCalls: number;
  byModel: Array<{
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
};

/**
 * Sums a user's MTD AI spend, broken down by model. Returns a
 * zero-spend object when the user has no usage yet.
 */
export async function monthlySpendForUser(userId: string): Promise<MonthlySpend> {
  const since = startOfCurrentMonthUtc();
  const rows = db
    .select({
      model: aiUsage.model,
      calls: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${aiUsage.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${aiUsage.outputTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${aiUsage.costUsd}), 0)`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
    .groupBy(aiUsage.model)
    .all();

  let totalUsd = 0;
  let totalCalls = 0;
  for (const r of rows) {
    totalUsd += Number(r.costUsd);
    totalCalls += Number(r.calls);
  }

  return {
    totalUsd,
    totalCalls,
    byModel: rows.map((r) => ({
      model: r.model,
      calls: Number(r.calls),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
    })),
  };
}

/**
 * Append a usage row. Called from /api/extract after a successful (or
 * billable failed) extraction. We never throw out of this — usage
 * persistence failing should not break the user's flow.
 */
export async function recordAiUsage(input: {
  userId: string;
  recipeId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): Promise<void> {
  try {
    db.insert(aiUsage)
      .values({
        userId: input.userId,
        recipeId: input.recipeId ?? null,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.inputTokens + input.outputTokens,
        costUsd: input.costUsd,
      })
      .run();
  } catch (err) {
    console.error("[ai.usage] failed to record:", err);
  }
}

/** Recent usage rows for a user (most recent first). */
export async function recentUsageForUser(
  userId: string,
  limit = 25,
): Promise<
  Array<{
    id: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    createdAt: Date;
  }>
> {
  const rows = db
    .select({
      id: aiUsage.id,
      model: aiUsage.model,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      costUsd: aiUsage.costUsd,
      createdAt: aiUsage.createdAt,
    })
    .from(aiUsage)
    .where(eq(aiUsage.userId, userId))
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: Number(r.costUsd),
    createdAt: r.createdAt,
  }));
}
