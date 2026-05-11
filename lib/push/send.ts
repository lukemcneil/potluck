import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";

export type PushPayload = {
  title: string;
  body: string;
  /** Path inside the app, e.g. "/r/abc#comments". */
  url: string;
  /**
   * Lets the OS coalesce duplicate alerts (e.g. five rating updates in
   * a minute should collapse into one). Use `event:resourceId`.
   */
  tag?: string;
  /** Optional icon URL; defaults to the app icon. */
  icon?: string;
};

/**
 * Send `payload` to every push subscription a user has registered.
 *
 * - When VAPID is unconfigured (no env vars) this is a logged no-op so
 *   local dev doesn't have to set up keys.
 * - 404/410 responses from the push service mean the subscription is
 *   gone (browser uninstalled, user disabled push); we delete the row.
 * - Every other error is swallowed and logged — push must never break
 *   the user-facing action that triggered it.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const config = readVapidConfig();
  if (!config) {
    console.info("[push.skip]", { userId, title: payload.title });
    return;
  }

  // Lazy-import so production callers that never trigger a push don't
  // pay the web-push module-load cost.
  let webpush: typeof import("web-push");
  try {
    webpush = await import("web-push");
  } catch (err) {
    console.warn("[push.module-missing] install `web-push` to enable", err);
    return;
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subs = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          db.delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint))
            .run();
        } else {
          console.warn("[push.send-failed]", {
            endpoint: sub.endpoint,
            status,
            err,
          });
        }
      }
    }),
  );
}

type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

function readVapidConfig(): VapidConfig | null {
  const subject = process.env.VAPID_SUBJECT?.trim();
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}
