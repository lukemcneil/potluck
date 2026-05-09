import "server-only";

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";

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
  },
  callbacks: {
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
