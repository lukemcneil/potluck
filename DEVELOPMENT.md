# Potluck — Development Guide

> Mobile-first recipe-sharing PWA. Snap a photo, AI extracts a recipe card, organize into Collections, browse other cooks' kitchens. Backed by a single SQLite file.

This file is the **source of truth for any future agent or human picking up this project**. Read this before changing anything. The high-level plan lives in `.cursor/plans/potluck_recipe_app_*.plan.md`. Open todos live in [`TODO.md`](TODO.md).

---

## TL;DR for a returning agent

1. `pnpm install` (approve build scripts if prompted: `pnpm approve-builds --all`)
2. Copy `.env.example` to `.env.local` and fill in keys (see [Environment](#environment-variables))
3. `pnpm db:push` to apply the SQLite schema (creates `data/potluck.db`)
4. `pnpm dev` to run the app on http://localhost:3000
5. Open `TODO.md`, find the first unchecked item, work on it, commit, repeat.

Always run `pnpm typecheck && pnpm build` before committing. Both must pass.

---

## Tech stack & rationale

| Concern        | Choice                                              | Why                                                                                            |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Framework      | **Next.js 16** (App Router, React 19, Turbopack, TS) | State of the art, RSC + Server Actions, great mobile output                                    |
| Database       | **SQLite** via `better-sqlite3` (`data/potluck.db`) | User explicitly wanted "one file" — easy to back up by copying                                 |
| ORM            | **Drizzle** + `drizzle-kit`                         | Type-safe, lightweight, excellent SQLite story, generates plain SQL migrations                 |
| Auth           | **Auth.js v5** (next-auth beta) + Google OAuth only | User asked for Google-only                                                                     |
| AI extraction  | **Vercel AI SDK** + OpenAI **gpt-4o** vision        | Multimodal LLM beats pure OCR for handwriting / magazine layouts; `generateObject` + Zod schema |
| Styling        | **Tailwind v4** + **shadcn/ui** (`base-nova`)       | shadcn 4.x default uses `@base-ui/react` (next-gen Radix). Tokens in `app/globals.css`         |
| Fonts          | **Fraunces** (display) + **Inter** (body)           | Warm, editorial feel for recipe titles; clean sans for body                                    |
| Forms          | **react-hook-form** + **zod**                       | Schemas shared between client form, server action, and AI extractor                            |
| Image storage  | Local disk (`data/uploads/`) behind `Storage` iface | Swap-in S3/R2 later without rewrites                                                           |
| Image proc.    | **sharp** + blurhash placeholders                   | Generate thumb/medium/full variants                                                            |
| Search         | **SQLite FTS5** virtual table                       | Fast full-text search baked into SQLite                                                        |
| Tests          | **Vitest** + Testing Library + jsdom                | Fast, ESM-native                                                                               |
| PWA            | Manifest + service worker (hand-rolled)             | Installable, offline app shell, native-feel mobile                                             |

**Things deliberately not chosen and why:**

- **Pure OCR (Tesseract / AWS Textract / Google Vision)** — fails on handwriting, won't structure ingredients vs. steps. Vision LLM solves this in one call.
- **Postgres** — overkill for the user's "one file" requirement. We can swap to Turso (libSQL, hosted SQLite) later if needed without code changes beyond the client driver.
- **Email magic link / Apple sign-in** — user explicitly said Google only.

---

## Project structure

```
potluck/
  app/
    (marketing)/page.tsx          landing page
    (app)/                         authenticated app shell (bottom tab bar)
      feed/                       public recipe feed
      search/                     search + filters
      add/                        upload flow (camera/library/url)
      cookbook/                   saved recipes
      me/                         redirect to own /u/[handle]
      u/[handle]/                 public profile (Recipes | Collections | Saved)
      u/[handle]/c/[slug]/        collection detail
      r/[id]/                     recipe detail
      r/[id]/cook/                cook mode (wake-lock, big text)
      r/[id]/edit/                edit (author only)
    api/
      auth/[...nextauth]/         Auth.js handler
      extract/                    POST images → structured recipe
    layout.tsx                     root layout, theme + toaster
    globals.css                    design tokens (light + dark)
    manifest.webmanifest           PWA manifest
  components/
    ui/                            shadcn primitives (do not edit by hand; re-add via `pnpm dlx shadcn@latest add <name>`)
    nav/                           BottomTabBar, AppBar
    recipe/                        RecipeCard, RecipeForm, IngredientList, StepList, ServingsScaler, CookMode
    upload/                        PhotoPicker, ExtractionPreview
    collection/                    CollectionCard, CollectionPicker
    filter/                        FilterChips
    theme-provider.tsx
  db/
    schema.ts                      drizzle schema (single source of truth for DB)
    client.ts                      better-sqlite3 + drizzle instance
    migrations/                    generated SQL — commit, never hand-edit
  lib/
    auth.ts                        Auth.js config + helpers
    actions/                       server actions (recipes, collections, saves)
    ai/extract-recipe.ts          AI SDK wrapper + Zod schema
    storage.ts                     image upload abstraction
    images.ts                      sharp resize + blurhash
    validators.ts                  zod schemas (shared client + server + AI)
    utils.ts                       cn() helper
  data/                            gitignored: potluck.db, uploads/
  drizzle.config.ts
  next.config.ts
  tailwind.config.ts (Tailwind v4 — config primarily in globals.css @theme block)
  postcss.config.mjs
```

---

## Data model

See `db/schema.ts` (when created). Tables:

- `users` — id, email, name, **handle** (unique, used in `/u/[handle]`), image, createdAt
- Auth.js: `accounts`, `sessions`, `verificationTokens`
- `recipes` — id, authorId, title, slug, description, prepMinutes, cookMinutes, servings, mealType, cuisine, diets (JSON), visibility (`public` | `unlisted` | `private`), kind (`structured` | `photos_only`), createdAt, updatedAt
- `recipePhotos` — id, recipeId, position, path, blurhash, width, height
- `recipeIngredients` — id, recipeId, position, quantity, unit, name, note
- `recipeSteps` — id, recipeId, position, body
- `tags` — id, name (unique, lowercased)
- `recipeTags` — recipeId, tagId (composite PK)
- `collections` — id, ownerId, name, slug, description, coverPhotoPath, visibility (default `public`), createdAt
- `collectionRecipes` — collectionId, recipeId, position, addedAt (composite PK)
- `saves` — userId, recipeId, savedAt (composite PK)
- `recipesFts` — FTS5 virtual table mirroring title/description/ingredients

---

## Environment variables

Create `.env.local` (gitignored). `.env.example` lists the keys.

```
# Auth.js
AUTH_SECRET="<generate with: openssl rand -base64 32>"
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."

# OpenAI (for recipe extraction)
OPENAI_API_KEY="sk-..."

# Optional — defaults to ./data
POTLUCK_DATA_DIR="./data"
```

To get Google OAuth credentials:
1. https://console.cloud.google.com/apis/credentials
2. Create OAuth client ID → Web application
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

---

## Common workflows

### Add a new shadcn component

```bash
pnpm dlx shadcn@latest add <component-name>
```

Components land in `components/ui/`. Don't hand-edit unless you know what you're doing — re-running `add` will overwrite.

### Schema change

1. Edit `db/schema.ts`
2. `pnpm db:generate` — generates SQL into `db/migrations/`
3. `pnpm db:migrate` — apply (or `pnpm db:push` for rapid dev)
4. Commit both schema and migration

### Add a page

- Authenticated routes go under `app/(app)/`
- Public marketing routes under `app/(marketing)/`
- Use Server Components by default; mark `"use client"` only when needed (forms, hooks, browser APIs)

### Run AI extraction in dev without burning credits

`lib/ai/extract-recipe.ts` (when written) will check `process.env.OPENAI_API_KEY`. If absent, it should fall back to a deterministic stub for tests/dev — wire this in when implementing.

---

## Conventions

- **Server Actions over API routes** for mutations. Reserve `app/api/` for OAuth callbacks and the AI extract endpoint (which streams).
- **Auth check pattern**: every mutating server action starts with
  ```ts
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  ```
- **Author check pattern** for edit/delete:
  ```ts
  const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, id) });
  if (recipe?.authorId !== session.user.id) throw new Error("Forbidden");
  ```
- **No comments narrating code**. Only comments that explain non-obvious intent or trade-offs.
- **Zod schemas live in `lib/validators.ts`** and are imported by the form, the server action, and (where relevant) the AI extractor.

---

## Decisions made (with the user, do not relitigate)

1. **Database**: SQLite, single file. ✅
2. **AI provider**: OpenAI `gpt-4o`. Not Anthropic (we may add as fallback later).
3. **Collection visibility default**: `public`.
4. **Auth providers**: **Google only**. No email magic link, no Apple, no GitHub.
5. **Mobile-first** with PWA installability. Desktop is fully supported but not the primary target.
6. **Recipe upload UX**: User chooses *Extract recipe* (default, AI-parsed, editable preview) or *Just save photos* (image-only recipe, no parsing).
7. **Categorization**: 3 layers — Collections (user folders) + structured taxonomy (mealType/cuisine/diet) + free-form tags.
8. **Hosting**: undecided. Code stays portable. Likely Fly.io with a persistent volume, or Cloudflare Tunnel from home.

---

## Build / lint / test

```bash
pnpm typecheck   # tsc --noEmit
pnpm build       # next build (also runs typecheck)
pnpm lint        # eslint
pnpm test        # vitest run
pnpm format      # prettier --write .
```

Always commit-ready means: typecheck passes + build passes.

---

## Gotchas

- **pnpm build approvals**: `sharp`, `better-sqlite3`, `unrs-resolver`, `esbuild`, `msw` need `pnpm approve-builds`. Configured in `package.json#pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml#allowBuilds`. If you see `[ERR_PNPM_IGNORED_BUILDS]`, run `pnpm approve-builds --all`.
- **next-auth v5 is beta**. Pin the version in `package.json`. Don't blindly upgrade.
- **shadcn 4.x default = `base-nova` style** (uses `@base-ui/react`, not radix). Components reference `@/lib/utils` for `cn()` — already created.
- **Tailwind v4** uses CSS-first config: theme tokens live in `app/globals.css` under `@theme inline`. There is no `tailwind.config.ts` (or it's empty).
- **Static SSG of pages that touch the DB** will fail at build time without a DB. Mark such pages `export const dynamic = "force-dynamic"` or use `noStore()`.

## Tunnel mode (testing on a phone)

Phones can hit the dev server two ways:

1. **Same-network LAN URL** (`http://192.168.x.x:3000`) — works for browsing but **not for sign-in** (Google rejects raw IPs as redirect URIs) and not for camera capture on iOS Safari (no HTTPS).
2. **Cloudflare Tunnel** (recommended) — gives you a real `https://xxx.trycloudflare.com` URL.

Steps:

```bash
brew install cloudflare/cloudflare/cloudflared   # one time
cloudflared tunnel --url http://localhost:3000   # starts the tunnel
```

Then in `.env.local`:

```
AUTH_TRUST_HOST="true"
AUTH_URL="https://<the-random-tunnel>.trycloudflare.com"
```

And in Google Cloud Console → Credentials → your OAuth client, add the same URL as an Authorized JavaScript origin and `<url>/api/auth/callback/google` as an Authorized redirect URI.

The `*.trycloudflare.com` host is already in `next.config.ts#allowedDevOrigins` so HMR works.

Caveats:

- Quick tunnels generate a **new URL each run**, which means re-pasting it into both `.env.local` and the Google OAuth client every time. For stability, set up a **named** Cloudflare Tunnel (free Cloudflare account, optional custom domain).
- When `AUTH_URL` is set, **localhost sign-in also redirects through the tunnel**. Comment it out for purely-local work.

## Useful scripts

- `pnpm db:inspect` — pretty-print users / accounts / sessions / collections from the local DB. Helpful when verifying sign-in worked or debugging the AI extraction pipeline.
