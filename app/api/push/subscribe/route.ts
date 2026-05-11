import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persist (or refresh) a Web Push subscription for the signed-in user.
 * Idempotent on `endpoint`: if we already have this subscription we
 * just bump `lastSeenAt` so we can prune long-dead browsers later.
 *
 * Body shape matches `PushSubscription.toJSON()`:
 *   { endpoint, keys: { p256dh, auth } }
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req
    .json()
    .catch(() => null) as null | {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const now = new Date();
  const existing = db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint))
    .get();

  if (existing) {
    db.update(pushSubscriptions)
      .set({
        // Re-bind to the current user — handles the "same browser, new
        // sign-in" case where the previous owner switched accounts.
        userId: session.user.id,
        p256dhKey: body.keys.p256dh,
        authKey: body.keys.auth,
        userAgent: body.userAgent ?? null,
        lastSeenAt: now,
      })
      .where(eq(pushSubscriptions.id, existing.id))
      .run();
    return NextResponse.json({ ok: true, refreshed: true });
  }

  db.insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      endpoint: body.endpoint,
      p256dhKey: body.keys.p256dh,
      authKey: body.keys.auth,
      userAgent: body.userAgent ?? null,
      createdAt: now,
      lastSeenAt: now,
    })
    .run();

  return NextResponse.json({ ok: true, created: true });
}
