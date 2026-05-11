import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drop a Web Push subscription by endpoint. We deliberately allow
 * unauthenticated calls (a user signing out can still tell the server
 * "stop pushing to this device") but we only delete the row when the
 * endpoint matches — no enumeration of other users' subscriptions.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req
    .json()
    .catch(() => null) as null | { endpoint?: string };
  if (!body?.endpoint) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  db.delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint))
    .run();

  return NextResponse.json({ ok: true });
}
