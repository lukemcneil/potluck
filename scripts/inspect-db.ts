import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data", "potluck.db");
const db = new Database(dbPath, { readonly: true });

function fmt(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

console.log("--- users ---");
const users = db
  .prepare("SELECT id, name, email, handle, image, createdAt FROM users")
  .all() as Array<{
    id: string;
    name: string | null;
    email: string | null;
    handle: string | null;
    image: string | null;
    createdAt: number;
  }>;
console.table(
  users.map((u) => ({
    id: u.id.slice(0, 8) + "…",
    name: u.name,
    email: u.email,
    handle: u.handle,
    image: u.image ? "✓" : "",
    created: fmt(u.createdAt),
  })),
);

console.log("\n--- accounts ---");
const accounts = db
  .prepare(
    "SELECT userId, provider, providerAccountId, scope FROM accounts",
  )
  .all() as Array<{
    userId: string;
    provider: string;
    providerAccountId: string;
    scope: string | null;
  }>;
console.table(
  accounts.map((a) => ({
    userId: a.userId.slice(0, 8) + "…",
    provider: a.provider,
    providerAccountId: a.providerAccountId.slice(0, 12) + "…",
    scope: a.scope,
  })),
);

console.log("\n--- sessions ---");
const sessions = db
  .prepare("SELECT userId, expires FROM sessions")
  .all() as Array<{ userId: string; expires: number }>;
console.table(
  sessions.map((s) => ({
    userId: s.userId.slice(0, 8) + "…",
    expires: fmt(s.expires),
  })),
);

console.log('\n--- collections (default "All Saves") ---');
const cols = db
  .prepare(
    "SELECT id, ownerId, name, slug, visibility, isDefaultSaves FROM collections",
  )
  .all() as Array<{
    id: string;
    ownerId: string;
    name: string;
    slug: string;
    visibility: string;
    isDefaultSaves: number;
  }>;
console.table(
  cols.map((c) => ({
    name: c.name,
    slug: c.slug,
    owner: c.ownerId.slice(0, 8) + "…",
    visibility: c.visibility,
    isDefaultSaves: !!c.isDefaultSaves,
  })),
);

db.close();
