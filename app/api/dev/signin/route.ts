import "server-only";

import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { collections, sessions, users } from "@/db/schema";
import { canonicalUrl } from "@/lib/server/canonical-url";

/**
 * Dev-only fake-signin endpoint.
 *
 * GET /api/dev/signin?email=foo@bar.com[&name=Foo&days=30&next=/feed]
 *
 * Mints a real Auth.js database session for the given email (creating
 * the user + default "All Saves" collection if needed), sets the
 * `authjs.session-token` cookie, and redirects to `next` (default
 * `/feed`).
 *
 * SAFETY: returns 404 in production. This endpoint must never be
 * reachable from a deployed environment — it lets anyone log in as
 * any user just by knowing an email.
 */
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "authjs.session-token";
const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const name = url.searchParams.get("name")?.trim() || null;
  const daysRaw = url.searchParams.get("days");
  const days = daysRaw ? Math.max(1, Math.min(365, Number(daysRaw))) : 30;
  const next = sanitizeNext(url.searchParams.get("next"));

  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json(
      { error: "Pass ?email=<address>" },
      { status: 400 },
    );
  }


  let user = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      handle: users.handle,
    })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    const id = crypto.randomUUID();
    const displayName = name ?? email.split("@")[0];
    const handle = await ensureUniqueHandle(slugify(displayName) || "cook");
    const now = new Date();
    db.insert(users)
      .values({
        id,
        name: displayName,
        email,
        emailVerified: now,
        handle,
        createdAt: now,
      })
      .run();
    db.insert(collections)
      .values({
        ownerId: id,
        name: "All Saves",
        slug: "all-saves",
        visibility: "private",
        isDefaultSaves: true,
      })
      .onConflictDoNothing()
      .run();
    user = { id, name: displayName, email, handle };
  } else if (name && name !== user.name) {
    db.update(users).set({ name }).where(eq(users.id, user.id)).run();
  }

  const sessionToken = crypto.randomUUID();
  const expiresMs = Date.now() + days * 24 * 60 * 60 * 1000;
  db.insert(sessions)
    .values({
      sessionToken,
      userId: user.id,
      expires: new Date(expiresMs),
    })
    .run();

  // Mirror Auth.js v5: the `__Secure-` cookie-name prefix and the
  // Secure flag are decided from AUTH_URL/NEXTAUTH_URL, not the
  // incoming request — so a localhost dev request still expects
  // `__Secure-authjs.session-token` if AUTH_URL points at an https
  // tunnel like ngrok.
  //
  // The `__Secure-` prefix REQUIRES the Secure attribute to be honored
  // by browsers. That normally rules out http origins, but Chrome,
  // Firefox, and Safari all treat http://localhost as a secure context
  // for cookies, so a Secure cookie set there still sticks. Result:
  // setting `Secure: true` here works for both real https origins and
  // local dev — and is what Auth.js will read on the next request.
  const useSecureCookies = configuredAuthUrl()?.protocol === "https:";
  const cookieName = useSecureCookies ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  // Use the canonical (proxy-aware) URL so the redirect after a
  // dev sign-in lands on the same hostname the dev tunnel is
  // serving from, instead of the internal bind localhost.
  const res = NextResponse.redirect(canonicalUrl(req, next));
  res.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    path: "/",
    expires: new Date(expiresMs),
  });
  return res;
}

function configuredAuthUrl(): URL | null {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/feed";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/feed";
  return raw;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function ensureUniqueHandle(base: string): Promise<string> {
  let candidate = base || "cook";
  for (let i = 0; i < 50; i++) {
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, candidate))
      .get();
    if (!existing) return candidate;
    candidate = `${base}-${i + 1}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}
