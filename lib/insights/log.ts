import "server-only";

import { db } from "@/db/client";
import { events } from "@/db/schema";

/**
 * Closed taxonomy of analytics events. Adding a new kind is a deliberate
 * decision — keep it small so the owner dashboard doesn't drown in noise
 * and so we don't accidentally start tracking high-cardinality behavior
 * (clicks, scroll depth, etc.) that we never actually use.
 *
 * Naming convention: `<subject>.<verb>` in past tense for completed
 * actions, or `<subject>.<verb>.<variant>` when the variant carries
 * enough signal to deserve its own bucket (e.g. import source).
 *
 * Notably absent:
 * - Generic `pageview` — the per-action events below answer "how
 *   people use the app" more directly than path-level tracking, and
 *   dynamic routes (`/r/[id]`, `/u/[handle]`) make pageview counts
 *   misleading without normalization we don't yet have.
 * - Click / scroll tracking — that's PostHog's job, not this table's.
 */
export type EventKind =
  | "user.signedup"
  | "user.signedin"
  | "recipe.created"
  | "recipe.imported.url"
  | "recipe.imported.photo"
  | "recipe.imported.text"
  | "recipe.viewed"
  | "recipe.cooked"
  | "recipe.saved"
  | "rating.set"
  | "comment.added"
  | "shoppinglist.created";

export type LogEventInput = {
  kind: EventKind;
  userId?: string | null;
  recipeId?: string | null;
  /**
   * Arbitrary structured context, JSON-encoded into the `metadata`
   * column. The dashboard's aggregations don't read this — it's there
   * for ad-hoc SQLite queries during investigations (e.g. "which URLs
   * are people importing from?"). Keep payloads small; this column has
   * no length cap but unbounded values would bloat the table.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Append-only insert into the `events` ledger. ALWAYS fire-and-forget
 * from the caller's perspective: a failure here must never break a
 * user flow (you'd rather lose an analytics row than fail a recipe
 * save). Internally we still `await` so SQLite's microsecond-scale
 * local write completes before the request handler returns, which
 * matters for tests that read back what they just wrote.
 *
 * If the write fails (table missing during a migration window, disk
 * full, etc.) we log the error and swallow it. The dashboard will
 * simply show a smaller-than-truth picture.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await db.insert(events).values({
      kind: input.kind,
      userId: input.userId ?? null,
      recipeId: input.recipeId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  } catch (err) {
    console.error("[insights] logEvent failed", {
      kind: input.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
