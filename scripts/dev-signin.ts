/**
 * Dev-only "fake sign in".
 *
 * Mints a real database-backed Auth.js session for a given email,
 * bypassing the Google OAuth round-trip. Useful for:
 *   - testing authed flows without a Google account handy
 *   - browser-automation testing (Playwright, MCP, etc.)
 *
 * Usage:
 *   pnpm dev:signin <email> [--name "Display Name"] [--days 30]
 *
 * If the user doesn't exist yet, we create them — including the same
 * default `All Saves` collection that lib/auth.ts createUser event
 * provisions during a real Google sign-in, so the resulting account
 * is indistinguishable from one created via OAuth.
 *
 * Prints the cookie name + value to set in the browser. The cookie
 * name follows Auth.js v5 conventions:
 *   - http  -> authjs.session-token
 *   - https -> __Secure-authjs.session-token
 *
 * SAFETY: refuses to run when NODE_ENV=production. This script
 * fabricates valid sessions and must never reach a prod deployment.
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

if (process.env.NODE_ENV === "production") {
  console.error(
    "dev-signin refuses to run with NODE_ENV=production. " +
      "This script is a development helper only.",
  );
  process.exit(1);
}

type Args = {
  email: string;
  name: string | null;
  days: number;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let name: string | null = null;
  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") {
      name = argv[++i] ?? null;
    } else if (a === "--days") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--days expects a positive number, got: ${next}`);
      }
      days = n;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  const email = positional[0];
  if (!email || !/.+@.+\..+/.test(email)) {
    throw new Error(
      "Usage: pnpm dev:signin <email> [--name 'Display Name'] [--days 30]",
    );
  }
  return { email, name, days };
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

function ensureUniqueHandle(
  db: Database.Database,
  base: string,
): string {
  const get = db.prepare("SELECT id FROM users WHERE handle = ?");
  let candidate = base || "cook";
  for (let i = 0; i < 50; i++) {
    if (!get.get(candidate)) return candidate;
    candidate = `${base}-${i + 1}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

function main() {
  const { email, name, days } = parseArgs(process.argv.slice(2));

  const dataDir = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data");
  const dbPath = path.join(dataDir, "potluck.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}. Run 'pnpm db:migrate' first.`);
    process.exit(1);
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");

  try {
    let user = sqlite
      .prepare(
        "SELECT id, name, email, handle FROM users WHERE email = ? COLLATE NOCASE",
      )
      .get(email) as
      | { id: string; name: string | null; email: string | null; handle: string | null }
      | undefined;

    if (!user) {
      const id = crypto.randomUUID();
      const displayName = name ?? email.split("@")[0];
      const handleSeed = slugify(displayName) || "cook";
      const handle = ensureUniqueHandle(sqlite, handleSeed);
      const now = Date.now();

      const insertUser = sqlite.prepare(
        `INSERT INTO users (id, name, email, emailVerified, image, handle, bio, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertUser.run(id, displayName, email, now, null, handle, null, now);

      sqlite
        .prepare(
          `INSERT OR IGNORE INTO collections
             (id, ownerId, name, slug, description, visibility, isDefaultSaves, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          id,
          "All Saves",
          "all-saves",
          null,
          "private",
          1,
          now,
          now,
        );

      user = { id, name: displayName, email, handle };
      console.log(`Created new user ${displayName} <${email}> (id ${id})`);
    } else {
      if (name && name !== user.name) {
        sqlite
          .prepare("UPDATE users SET name = ? WHERE id = ?")
          .run(name, user.id);
        user.name = name;
      }
      console.log(
        `Found existing user ${user.name ?? "(no name)"} <${user.email}> (id ${user.id})`,
      );
    }

    const sessionToken = crypto.randomUUID();
    const expires = Date.now() + days * 24 * 60 * 60 * 1000;
    sqlite
      .prepare(
        "INSERT INTO sessions (sessionToken, userId, expires) VALUES (?, ?, ?)",
      )
      .run(sessionToken, user.id, expires);

    console.log("");
    console.log("Session created.");
    console.log(`  user:    ${user.email} (@${user.handle ?? "?"})`);
    console.log(`  expires: ${new Date(expires).toLocaleString()}`);
    console.log("");
    console.log("Set this cookie in your browser to sign in:");
    console.log("");
    console.log("  Cookie name (http):    authjs.session-token");
    console.log("  Cookie name (https):   __Secure-authjs.session-token");
    console.log(`  Cookie value:          ${sessionToken}`);
    console.log("");
    console.log("Quick DevTools snippet (run on a same-origin page):");
    console.log(
      `  document.cookie = "authjs.session-token=${sessionToken}; Path=/; Max-Age=${days * 24 * 60 * 60}; SameSite=Lax";`,
    );
  } finally {
    sqlite.close();
  }
}

main();
