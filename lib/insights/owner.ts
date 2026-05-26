import "server-only";

import { auth } from "@/lib/auth";

/**
 * Result of an owner-handle check. Distinct shapes so the caller can
 * decide what to render (404 page vs sign-in nudge vs friendly
 * "configure POTLUCK_OWNER_HANDLE" hint) without re-reading env.
 */
export type OwnerCheck =
  | { kind: "ok" }
  | { kind: "no-config" }
  | { kind: "no-session" }
  | { kind: "not-owner" };

/**
 * Read `POTLUCK_OWNER_HANDLE` and compare against the signed-in user's
 * handle. The handle is the same one rendered at `/u/<handle>` — it's
 * stable per-user (set at first sign-in, see `lib/auth.ts`).
 *
 * The deliberate design choice: the owner is a single human, named by
 * handle, not by email. Email would require either re-introducing the
 * allowlist plumbing or reading `users.email` for every check. Handle
 * is already on the session.
 *
 * When the env var is unset the dashboard is fully disabled — the
 * page 404s for everyone, including the only person who'd ever look
 * at it. That's a feature: deploys that don't set the var get zero
 * exposure, no surprise admin endpoint.
 */
export async function checkOwner(): Promise<OwnerCheck> {
  const configured = process.env.POTLUCK_OWNER_HANDLE?.trim().toLowerCase();
  if (!configured) return { kind: "no-config" };

  const session = await auth();
  const handle = session?.user?.handle?.toLowerCase();
  if (!session?.user) return { kind: "no-session" };
  if (!handle || handle !== configured) return { kind: "not-owner" };
  return { kind: "ok" };
}
