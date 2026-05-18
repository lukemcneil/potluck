import "server-only";

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  authenticators,
  collections,
} from "@/db/schema";

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
  authenticatorsTable: authenticators,
});

/**
 * If POTLUCK_ALLOWED_EMAILS is set, only those addresses can sign in.
 * Comma- or whitespace-separated, case-insensitive. When unset, anyone
 * with a Google account can sign up — fine for local dev, NOT what
 * you want on a public host.
 *
 * Examples:
 *   POTLUCK_ALLOWED_EMAILS="me@gmail.com,wife@gmail.com,brother@gmail.com"
 */
function loadAllowedEmails(): Set<string> | null {
  const raw = process.env.POTLUCK_ALLOWED_EMAILS;
  if (!raw) return null;
  const list = raw
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 ? null : new Set(list);
}

const ALLOWED_EMAILS = loadAllowedEmails();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      const handle = await ensureUniqueHandle(seedHandle(user.email, user.name));
      await db.update(users).set({ handle }).where(eq(users.id, user.id));

      const slug = "all-saves";
      await db
        .insert(collections)
        .values({
          ownerId: user.id,
          name: "All Saves",
          slug,
          visibility: "private",
          isDefaultSaves: true,
        })
        .onConflictDoNothing();
    },
    /*
     * Force the (app) layout to re-render on sign-in / sign-out so
     * AppBar reflects the new session state on the very next
     * navigation. Without this, the Next.js client router cache (and
     * the service-worker page cache on a fresh install) can serve the
     * previously-rendered shell — so right after sign-in AppBar still
     * shows the "Sign in" button until the user manually refreshes.
     *
     * revalidatePath('/', 'layout') is a sledgehammer: it invalidates
     * the root layout AND every page under it. That's fine here —
     * every page in this app is `force-dynamic` already, so the only
     * thing we're throwing away is cached personalized data that the
     * old session can no longer see anyway.
     */
    async signIn() {
      revalidatePath("/", "layout");
    },
    async signOut() {
      revalidatePath("/", "layout");
    },
  },
  callbacks: {
    async signIn({ user }) {
      // No allowlist configured → behave like a public app.
      if (!ALLOWED_EMAILS) return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;
      // Auth.js will redirect rejected users to /signin?error=AccessDenied.
      return ALLOWED_EMAILS.has(email);
    },
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        const row = await db
          .select({ handle: users.handle })
          .from(users)
          .where(eq(users.id, user.id))
          .get();
        session.user.handle = row?.handle ?? null;
      }
      return session;
    },
  },
});

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("UNAUTHENTICATED");
  }
  return session.user as typeof session.user & { id: string; handle: string | null };
}

function seedHandle(email?: string | null, name?: string | null): string {
  const seed = (name ?? email?.split("@")[0] ?? "cook").toString();
  return slugify(seed) || "cook";
}

async function ensureUniqueHandle(base: string): Promise<string> {
  let candidate = base;
  let i = 0;
  while (true) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, candidate))
      .get();
    if (!existing) return candidate;
    i += 1;
    candidate = `${base}-${i}`;
    if (i > 50) {
      candidate = `${base}-${Math.random().toString(36).slice(2, 7)}`;
      return candidate;
    }
  }
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
