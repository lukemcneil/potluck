import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Expose the VAPID public key to the browser so `pushManager.subscribe`
 * can pin its subscription to our server. Returns `{ key: null }` when
 * push isn't configured — callers use that as the "push is disabled"
 * signal and hide the opt-in UI.
 */
export async function GET(): Promise<Response> {
  const key = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  return NextResponse.json({ key });
}
