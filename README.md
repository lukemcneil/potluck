# Potluck

> Snap a photo of any recipe, AI turns it into a clean recipe card, and your whole kitchen is in your pocket. Mobile-first PWA, single-file SQLite, Google sign-in.

## Quickstart

```bash
pnpm install
cp .env.example .env.local       # then fill in keys
pnpm db:push                     # create data/potluck.db
pnpm dev                         # http://localhost:3000
```

If pnpm asks you to approve build scripts (sharp, better-sqlite3, esbuild, msw), run `pnpm approve-builds --all`.

## Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md) — architecture, conventions, decisions, gotchas. Read this first if you're picking up the project.
- [TODO.md](TODO.md) — phased build-out checklist.
- `.cursor/plans/potluck_recipe_app_*.plan.md` — the full plan agreed with the user.

## Stack

Next.js 16 (App Router, RSC, Server Actions) · TypeScript · Tailwind v4 · shadcn/ui · SQLite (better-sqlite3) · Drizzle ORM · Auth.js v5 (Google) · Vercel AI SDK + OpenAI gpt-4o (vision)

## Scripts

| Command          | Purpose                              |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Run Next.js dev server (Turbopack)   |
| `pnpm build`     | Production build                     |
| `pnpm typecheck` | `tsc --noEmit`                       |
| `pnpm lint`      | ESLint                               |
| `pnpm test`      | Vitest                               |
| `pnpm format`    | Prettier write                       |
| `pnpm db:push`   | Apply schema to local SQLite (dev)   |
| `pnpm db:studio` | Drizzle Studio GUI                   |
