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
- `recipeRatings` — recipeId, userId (composite PK), value (1–5), createdAt, updatedAt. Author may rate their own recipe; the public average excludes their row.
- `recipeComments` — id, recipeId, authorId, body, createdAt, updatedAt. Flat (no threads); cascades on recipe delete; per-comment delete allowed for the author OR the recipe owner.
- `shoppingLists` — id, ownerId, name, createdAt, archivedAt (nullable). Archived lists hide from active pickers but stay browsable.
- `shoppingListItems` — id, listId, name, quantity, unit, sourceRecipeId (nullable, set null on recipe delete), position, checked, addedAt. Consolidation across recipes is exact-match on `(lower(name), unit)` — see `lib/shopping/consolidate.ts`.
- `pushSubscriptions` — id, userId, endpoint (unique), p256dhKey, authKey, userAgent, createdAt, lastSeenAt. One row per browser/device that opted in to Web Push; the SW deletes 404/410 endpoints.
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

# Optional — override the model for /api/extract (defaults to gpt-4o)
OPENAI_MODEL="gpt-4o-mini"

# Optional — per-user monthly USD cap on /api/extract spend.
# Defaults to $2.00. Set to "0" / "none" to disable. Enforced from the
# aiUsage ledger; image extraction silently downgrades to gpt-4o-mini
# once the user is past ~⅔ of the cap.
POTLUCK_USER_MONTHLY_USD_CAP="2.00"

# Optional — defaults to ./data
POTLUCK_DATA_DIR="./data"

# Optional — Web Push (notifies recipe authors on comments/ratings/saves).
# Generate with: pnpm push:keys
# Push silently disables itself when these are unset.
VAPID_PUBLIC_KEY="B..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:you@example.com"
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
   - **Saves model**: each user has an auto-created `All Saves` collection (`isDefaultSaves: true`, `private`) that's created on first sign-in (or lazily by `saveRecipeAction`). The flat `saves` table is the canonical "is this saved?" lookup; `All Saves` mirrors it. `saveRecipeAction(recipeId, [extraCollectionIds])` adds to both. `unsaveRecipeAction(recipeId)` removes from `saves` and from EVERY collection the user owns. Removing from a single non-default collection uses `removeRecipeFromCollectionAction` and does NOT clear the `saves` row.
8. **Hosting**: undecided. Code stays portable. Likely Fly.io with a persistent volume, or Cloudflare Tunnel from home.

---

## Build / lint / test

```bash
pnpm typecheck      # tsc --noEmit
pnpm build          # next build (also runs typecheck)
pnpm lint           # eslint
pnpm test           # vitest run
pnpm format         # prettier --write .

pnpm db:seed        # insert demo recipes (idempotent)
pnpm db:inspect     # pretty-print users/sessions/collections
pnpm test:extract   # end-to-end smoke test of image -> AI -> structured recipe
```

Always commit-ready means: typecheck passes + build passes.

### `pnpm test:extract`

Runs the same `extractRecipe()` function the `/api/extract` endpoint uses, against either:

- a synthetic recipe-card image (default — see `scripts/test-extract.ts`), or
- a path to your own image: `pnpm test:extract path/to/recipe.jpg`

A copy of the synthetic card lives at `test-fixtures/synthetic-tomato-soup.jpg`; you can also drag it into the `/add` flow in the browser to exercise the full UI path.

**Important contract**: `extractedRecipeSchema` (in `lib/validators.ts`) must stay strict-mode-compatible. OpenAI Responses API + structured outputs requires every property to be in `required[]`; optional fields are expressed with `.nullable()` (not `.optional()`). Adding a `.optional()` field there will surface as a 400 from the OpenAI API at runtime.

### AI cost per extraction (measured)

`extractRecipe()` logs a `[ai.extract]` line per call with token usage and cost. The `/api/extract` endpoint also includes a `cost` field in the response body. Pricing math lives in `lib/ai/pricing.ts`; bump it when OpenAI changes prices.

Measured against `test-fixtures/synthetic-tomato-soup.jpg` (1 image, ~140 KB, single page recipe card):

| Model         | Input tokens | Output tokens | Cost / call | Cost per 1k calls |
| ------------- | ------------:| -------------:| -----------:| -----------------:|
| `gpt-4o`      | ~1,300       | ~350          | **$0.0067** | **$6.73**         |
| `gpt-4o-mini` | ~26,000      | ~350          | **$0.0041** | **$4.11**         |

Notes:

- `gpt-4o-mini` bills images at much higher per-image token counts than `gpt-4o` (OpenAI does this to roughly normalize the dollar cost — so a `0.15 / 0.60` per-million rate doesn't translate into a 16× discount for vision workloads). For our use case, mini is **~40% cheaper**, not ~94% cheaper.
- Quality bias: `gpt-4o` is the better choice for messy real-world cards (handwriting, glare, multi-column magazine layouts). `gpt-4o-mini` does fine on clean printed text. Switch via the `OPENAI_MODEL` env var.
- Multi-image recipes (multi-page or front+back of a card) scale linearly in image tokens; expect ~$0.01 per 2-image extraction on `gpt-4o`.
- A `failed-validation` error from OpenAI structured outputs costs the same as a successful call (we still get billed for the input + output tokens).

---

## Editing recipes

- **`updateRecipeAction(recipeId, _, formData)`** lives in `lib/actions/recipes.ts`. It validates with the same `recipeFormSchema` used at create time, asserts ownership, then runs a transaction that:
  1. Updates the `recipes` row (slug is **not** regenerated — the URL stays stable).
  2. Wholesale replaces `recipeIngredients`, `recipeSteps`, `recipePhotos`, and `recipeTags` for the recipe.
  3. Inserts new tags as needed and links them.
  Photo files on disk are left alone — orphan cleanup is a separate concern.
- **`RecipeForm`** is dual-mode (`mode="create" | "edit"`). The edit page passes `mode="edit"` + `recipeId` and prefills `initial` / `initialPhotos`. The form chooses which server action to call internally.

## Filtering

- `components/filter/FilterChips.tsx` is the single source of truth for filter UI. It reads/writes URL search params with `useSearchParams` + `router.replace` (no scroll jump):
  - `?meal=` (single, must be a known `MealType`)
  - `?cuisine=` (single, lowercase compared via `LOWER(cuisine) = ?`)
  - `?diet=a,b,c` (multi-select; matched with one `LIKE '%"X"%'` per diet against the JSON-encoded `recipes.diets` column)
  - `?max=` (number; matched with `COALESCE(prepMinutes,0)+COALESCE(cookMinutes,0) <= ?`)
- `lib/queries/recipes.ts#buildFilterConditions` translates the parsed `RecipeFeedFilters` into a Drizzle `SQL[]` and is shared by `listRecipeCards`, `searchRecipes`, and `countRecipes`.
- The cuisine dropdown is populated from `listAvailableCuisines()` (distinct + non-empty cuisines on public recipes) so users only see options that actually return results.
- Search applies filters **after** the FTS5 step. We over-fetch ids by 4× then re-filter to keep ranking intact, finally slicing to `limit/offset`.

## Cook mode + servings scaling

- `lib/cooking/scale.ts` (20 vitest assertions in `lib/__tests__/scale.test.ts`):
  - `parseQuantity` handles integers, decimals, simple fractions (`3/4`), mixed numbers (`1 1/2`), unicode vulgar fractions (`½`, `1¼`, `⅔`, `⅛`–`⅞`), and ranges (`1-2`, `1 to 2`).
  - `formatQuantity` snaps to nearest 1/8 with special cases for thirds — so `1.5 × (2/3) = 1`, not `0.99999`.
  - `scaleQuantity(input, factor)` round-trips: parse → multiply → format. Unparseable strings (`"a pinch"`) are returned unchanged.
- `components/recipe/RecipeBody.tsx` hosts the servings stepper on the recipe detail page and applies a single scaling factor to both the ingredients list and the inline `<qty> <unit>` tokens inside step prose (via `scaleStepText`). If `recipe.servings` doesn't parse to a single number the stepper is hidden and the static list is rendered.
- `app/(app)/r/[id]/cook/page.tsx` + `components/recipe/CookMode.tsx` is the full-screen cooking view. It uses `screen.wakeLock.request("screen")` (best-effort, re-acquired on `visibilitychange`) so the device doesn't sleep mid-recipe. Layered at `z-50` so it sits above `AppBar` (z-30) and `BottomTabBar` (z-40) without needing a separate route group.

## Photo carousel

- `components/recipe/PhotoCarousel.tsx` is a CSS scroll-snap horizontal scroller with hidden scrollbar, dot indicators, desktop arrow buttons, and an `IntersectionObserver` to track the active slide. Single-photo input falls back to a plain `<Image>`. The first slide gets `priority` so LCP isn't regressed.

## Loading + error boundaries

Every (app) route has a `loading.tsx` skeleton tuned to match its real layout. Two reusable building blocks live in `components/recipe/RecipeCardSkeleton.tsx` and `components/collection/CollectionCardSkeleton.tsx` — both export `*Skeleton` and `*SkeletonGrid` variants.

The app shell catches uncaught render errors at `app/(app)/error.tsx` (with a "Try again" button bound to `reset()`) and unmatched routes at `app/(app)/not-found.tsx`. Both stay inside the AppBar / BottomTabBar shell so navigation still works after a page-level failure.

## Print

Recipe pages print as a clean single-column card. The styling is in `app/globals.css` under `@media print` and depends on a few data-attributes:

- `data-app-bar` on the top app bar header
- `data-bottom-tab-bar` on the mobile tab bar nav
- `data-recipe-detail` on the recipe `<article>`
- `data-print="hide"` on anything we want stripped (the action button row)

The "Print" button on `/r/[id]` is a tiny client-only `<PrintButton>` that calls `window.print()`. There's no PDF export — browsers handle "Save as PDF" out of the box.

## Profile editor

- `lib/actions/profile.ts#updateProfileAction` validates name / handle / bio with a Zod schema, checks for handle conflicts (case-insensitive thanks to the `handleSchema` enforcing lowercase), updates the row, and revalidates both the old and new `/u/<handle>` paths so the profile card refreshes after a handle change.
- `components/profile/ProfileEditDialog.tsx` is a controlled dialog that renders only for the profile owner. On a successful handle change it `router.replace`s to the new URL.
- The Google avatar (`users.image`) is intentionally not user-editable — it stays in sync with whatever the OAuth provider returns.

## AI usage ledger + spend cap

- `db/schema.ts#aiUsage` is a small append-only table (`userId`, `recipeId?`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `createdAt`) with a `(userId, createdAt)` index for fast MTD queries. Migration: `db/migrations/0002_cooing_sentry.sql`.
- `lib/queries/ai-usage.ts` exposes:
  - `monthlySpendForUser(userId)` — UTC-month-anchored aggregate, broken down by model.
  - `recordAiUsage({...})` — best-effort insert; failures are logged but never thrown so usage persistence can't break a successful extraction.
  - `recentUsageForUser(userId, limit)` — recent rows, used by future admin views.
- `lib/ai/cap.ts` is the single source of truth for the cap. `userMonthlyCapUsd()` defaults to **$2.00** when `POTLUCK_USER_MONTHLY_USD_CAP` is unset; `"0"` / `"none"` / `"off"` disables capping. `userMonthlySoftCapUsd()` returns the cap × ⅔.
- `app/api/extract/route.ts` reads spend before the call, hard-blocks with 402 at/above the cap, and silently downgrades image extraction to `gpt-4o-mini` (the URL model) once the user is past the soft cap. Successful responses include `spend: { totalUsd, capUsd, degraded }` so the client can react. `recordAiUsage` always runs on success — even when the model said "no recipe", because the call still burned tokens.
- `app/api/ai/spend/route.ts` is a tiny GET endpoint the AddRecipeFlow polls on mount to decide whether to show an "approaching your budget" hint before the user kicks off an extraction.
- `components/profile/AiUsageCard.tsx` shows the user their MTD spend on the owner's `/u/[handle]` (only when `isOwnProfile && spend.totalCalls > 0`). When a cap is set, a progress bar shows their burn-down.
- `components/upload/AddRecipeFlow.tsx` shows the per-extraction cost as a small pill on the review step ("AI extraction cost: 0.7¢ (gpt-4o, 1,652 tokens)"). Sub-dollar costs render in cents. When the user is at/over the soft cap, the extracting screen also shows a yellow "image extraction will use gpt-4o-mini for the rest of this month" notice.

## PWA + offline cooking

- `public/sw.js` is a hand-rolled service worker (no `next-pwa`). Caching strategy is split per request type:
  - `/uploads/*` → cache-first into `potluck-photos-vN`. Photos are immutable per id so once we have one, we never refetch.
  - `/_next/static/*`, `/icons/*`, `/manifest.webmanifest` → cache-first into `potluck-runtime-vN`. Hashed/static, also effectively immutable.
  - HTML navigations (and Accept: text/html responses) → stale-while-revalidate into `potluck-pages-vN`. Cached HTML is served immediately; a background fetch refreshes for next time. When neither cache nor network is available, the SW returns the pre-cached `/offline` page.
  - Anything else (RSC payloads, fonts) → network-first with cache fallback. This is what makes Next.js link-based navigation between cached recipes still work offline.
  - `/api/*`, `/_next/image*`, non-GET → passthrough; never cached.
  - Cache names embed `SW_VERSION`; bump it when caching behavior changes meaningfully and the `activate` handler will GC older caches.
- `components/pwa/ServiceWorkerRegistrar.tsx` registers the SW on `load` (so it doesn't compete with hydration). Registration rule: **always register, except on `localhost`/`127.0.0.1`/`::1` in dev**. That way `pnpm dev` over plain localhost stays SW-free (no stale-chunk pain), but `pnpm dev` exposed via ngrok / cloudflared / a real hostname does register the SW so you can actually test PWA install + offline on a phone without a full prod build. Set `NEXT_PUBLIC_DISABLE_SW=1` to force-disable.
- `app/offline/page.tsx` is a tiny static page (`/offline`) used as the SW's last-resort fallback. It points the user back at `/feed` and `/cookbook`, both of which work from cache when those have been visited online.
- `components/pwa/InstallPrompt.tsx` exports three pieces:
  - `<InstallPromptProvider>` — context provider mounted in `(app)/layout.tsx` that owns the deferred `beforeinstallprompt` event, platform detection (iOS / Android / desktop / other), `display-mode: standalone` detection, and the 14-day "not now" `localStorage` flag.
  - `<InstallPromptBanner>` — auto-showing floating banner above the bottom tab bar; only renders when we have a deferred prompt to fire OR we're on iOS (which has no deferred prompt). Suppressed on dev/desktop when `beforeinstallprompt` hasn't fired so we don't pester users with a banner that doesn't lead anywhere.
  - `<InstallMenuItem>` — drop-in `<DropdownMenuItem>` (with its own surrounding separator) that lives in the AppBar account dropdown. **This is the always-available install affordance** — even when Chrome hasn't fired the deferred prompt yet (low engagement, dev mode, second visit), tapping it opens a platform-specific instructions sheet ("Tap the menu → Install app" on Android, the Share/Add-to-Home-Screen walkthrough on iOS, address-bar install icon on desktop). Disappears once `display-mode: standalone` becomes true.
  - The dialog also fires on `appinstalled` to immediately hide install affordances after a successful install.
- `app/manifest.ts` declares `start_url: "/feed"`, standalone display, and the warm cream/terracotta theme colors. `app/layout.tsx#metadata.appleWebApp` enables iOS web-app behavior; `metadata.icons.apple` points iOS at `/icons/icon-512.svg` for the home-screen icon.
- The offline cooking flow concretely is: user visits `/r/[id]` while online → SW caches the HTML, the JS chunks, and the recipe photos. Later, offline, the user opens `/feed` (cached → served), taps the recipe (RSC payload → cached → served), and Cook mode (separate route, also cached if previously visited) all work. New recipes obviously can't be discovered offline.

## Ratings, comments, shopping lists

These three landed together in Phase 11 and share the same shape — a thin server action layer over Drizzle, with optimistic client UI:

- **Ratings** (`lib/actions/ratings.ts` + `lib/queries/ratings.ts`): 1–5 integers stored in `recipeRatings` with a composite `(recipeId, userId)` PK. Author *may* rate their own recipe; the public average computation explicitly excludes the author's row via `WHERE userId <> recipes.authorId`. `getRatingSummariesByRecipeId` does the bulk hydration that powers `RecipeCardData.{avgRating, ratingCount}`. The `<RatingControl>` component is fully optimistic: it re-derives the new public average locally, then rolls back on server error.
- **Comments** (`lib/actions/comments.ts` + `lib/queries/comments.ts`): flat thread, body trimmed and capped at 2000 chars, hard-deleted by either the comment author or the recipe owner. The recipe-detail page hydrates the full list eagerly (small N at our scale; no pagination yet). `<CommentsSection>` adds optimistically with a `temp-` id and swaps it for the server-assigned id once the action returns.
- **Shopping lists** (`lib/actions/shopping.ts` + `lib/queries/shopping.ts`): two-table model. `addRecipesToShoppingListAction` runs ingredients through `lib/shopping/consolidate.ts`, which merges by `(lower(name), unit)` *only* (no fuzzy name matching, no unit conversion — see `consolidate.ts` docstring for why). New items append after the highest existing position so an in-progress shopper isn't reshuffled. Quantities sum when every input parses cleanly via `lib/cooking/scale.ts#parseQuantity` (ranges average to their midpoint); otherwise the merged item shows the verbatim strings joined by `+` so we never silently lose information.

All three actions fan out to **push notifications** (see below) for the recipe author when the actor is someone else.

## Web Share Target

`app/manifest.ts` registers a `share_target` POST endpoint at `/share-receive`. When the user picks Potluck from the OS share sheet (Android Chrome today; spec is broader), the browser POSTs:

- `title`, `text`, `url` — strings the source app provided. Chrome sometimes drops a URL into `text` instead of `url`; we probe both.
- `photos[]` — File objects. We run them through the same `processUpload` pipeline `/api/upload` uses so shared photos look identical to picker photos.

`/share-receive`:

1. Requires sign-in (signed-out users get redirected to `/signin?next=/add` and the share is dropped — accepted v1 friction).
2. Branches on the payload: URL → `/add?shared=url&url=...`; photos → upload + `/add?shared=photos&ids=A,B,C`; text-only → `/add?shared=text&text=...`.
3. The `/add` page parses the search params into a `ShareIntent` and hands it to `<AddRecipeFlow initialShare={...}>`. The flow's mount-time effect (deferred to a microtask to keep React 19's `set-state-in-effect` lint happy) then skips the choose tile and calls the appropriate `startExtractionFrom*` directly.

`app/api/uploads/meta` is the small companion endpoint that re-derives `UploadedPhoto` thumbnails (width / height / inline placeholder) for shared photo ids — we couldn't stash that metadata in a cookie because mutating cookies from server components is restricted in Next 15+, and bloating URL params with placeholders felt worse.

The manifest also declares Android `shortcuts` for "New recipe" and "Open feed" so a long-press on the home-screen icon gives quick actions.

## Push notifications

VAPID-based Web Push, opt-in per-device.

- **Operator setup**: `pnpm push:keys` mints a VAPID key pair into stdout; paste the three lines into `.env.local` and restart. When `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` are unset, push is silently disabled (the menu opt-in hides itself, server-side `notify*` calls return without doing anything). This is intentional so local dev "just works" without any setup.
- **Client opt-in**: `<EnableNotificationsItem>` lives in the account dropdown next to the install affordance. It first GETs `/api/push/public-key` to confirm push is configured, then on click runs `Notification.requestPermission` → `pushManager.subscribe` → POSTs the subscription to `/api/push/subscribe`. Already-subscribed devices show "Turn off notifications" instead, which calls `unsubscribe()` locally and POSTs to `/api/push/unsubscribe`.
- **Server send pipeline** (`lib/push/send.ts`): one row per device in `pushSubscriptions`, one `webpush.sendNotification` per row, capped at TTL=24h. 404/410 responses (subscription gone) cause the row to be deleted; everything else is logged and swallowed so push can never break the user-facing action that triggered it.
- **Triggers** (`lib/push/notify.ts`): currently fires on **first save** of a recipe (`saveRecipeAction` checks for an existing row before the upsert), on every comment (`addCommentAction`), and on every rating (`setRatingAction`). All `void`-fired so the action that triggered them is never blocked on push latency. Self-actions (author rating/saving/commenting on their own recipe) skip the notify.
- **Service worker** (`public/sw.js` v2): adds `push` and `notificationclick` handlers. Payload shape is `{ title, body, url, tag?, icon? }`; `tag` lets the OS coalesce repeated alerts on the same resource (e.g. five rating bumps collapse into one banner). Click focuses an existing tab on the target URL when possible, otherwise opens a new window.

## AI extraction trust (verification gate)

The recipe-import flow runs every extraction through a deterministic
verification gate so a quietly-wrong AI reading (the canonical failure
mode is `1 tsp salt` quietly becoming `1 tbsp salt`) can't make it
into someone's pan without a human taking a look at it first.

- **Per-field confidence**: `extractedRecipeSchema` carries
  `confidence: "high" | "low"` on every ingredient and step. The
  system prompt asks the model to mark anything it had to guess
  (smudged photo, ambiguous abbreviation, partial OCR) as `low`.
  Over-flagging is cheap; under-flagging means a mistake gets cooked.
- **Self-check pass** (`lib/ai/extract-recipe.ts#extractAndVerifyRecipe`):
  every `/api/extract` call fans out to two parallel LLM calls against
  the same prepared source content. Verification always uses
  `gpt-4o-mini` (or `gemini-2.5-flash` on the Google provider) — the
  cheaper-and-different-from-primary combo is what makes the second
  pass meaningful rather than a model agreeing with itself. 10 s hard
  timeout; throws / timeouts / no-recipe disagreement all soft-fail to
  `{ verificationFailed: true, discrepancies: [] }`. We never block an
  import on a flaky second pass.
- **Discrepancy aligner** (`lib/ai/discrepancies.ts#diffExtractions`):
  pure deterministic function that diffs the two extractions and emits
  a typed list — `ingredient_mismatch`, `ingredient_only_in_original`,
  `ingredient_missing_from_original`, `step_text_diverges`,
  `step_only_in_original`, `step_missing_from_original`. Exact
  normalized-name matching for ingredients (lowercased, diacritics
  stripped, punctuation collapsed); positional + Levenshtein-ratio for
  steps (paraphrases pass the 30% threshold; wholesale rewrites
  trip). Notes are intentionally not diffed — they're free-form and
  would drown out high-stakes quantity/unit warnings.
- **Review payload builder** (`lib/ai/review.ts#buildReviewPayload`):
  splices `*_missing_from_original` rows into the form's initial
  ingredient/step arrays in place, attaches per-row flags so the form
  can render a yellow review strip above the affected rows.
- **Verification gate UX** (`components/recipe/RecipeForm.tsx`): the
  form takes an optional `verification` prop. When set, every flagged
  row gets a yellow review strip above its inputs with one of:
    - `Add to recipe` / `Skip` (verifier added it)
    - `Use "1 tbsp"` / `Use "1 tsp"` (qty/unit mismatch)
    - `Keep` / `Remove` (verifier didn't see it)
    - `Confirm` (low-confidence with no second opinion)
  Both options on a mismatch are AI guesses — the wording avoids
  "Keep mine" because the user didn't author either reading. Save
  reads `Save (N to verify first)` and is disabled while any flagged
  row is unresolved. Resolution state is keyed by RHF's stable
  `field.id` so removing/adding rows during review doesn't break the
  count.
- **Source pane** (`components/recipe/ReviewSourcePane.tsx`): sticky
  bar at the top of the review form. URL imports get
  "Imported from {domain} → Open original"; photo imports get a
  thumbnail strip. Either lets the importer eyeball the source
  without leaving the page.
- **`sourceUrl` on the recipe detail page** (`app/(app)/r/[id]/page.tsx`):
  surfaces as an "Imported from {domain}" line under the title and an
  "Open original" button in the action bar so cooks can verify any
  suspicious quantity mid-recipe, weeks after the import was approved.

What we deliberately did NOT do (per the May 2026 design discussion):

- No heuristic safety scanner (e.g. flag any salt over 1 tbsp). Felt
  brittle and noisy; the verification pass already catches the
  unit-substitution failure mode.
- No "AI-imported" badge on the recipe detail page. The sourceUrl
  attribution serves the same purpose for URL imports, and badging
  every photo import felt like noise.
- No `Keep mine` button on mismatches. Both passes are AI guesses, so
  the chooser uses neutral `Use "X"` / `Use "Y"` wording instead.

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
- **"The origin has been unregistered from Argo tunnel"** on the phone is usually transient — the local cloudflared lost its registration with Cloudflare's edge and the request hit during the gap. Refresh the page; it almost always recovers within seconds. If it doesn't, kill `cloudflared`, restart it, then update `AUTH_URL` + Google redirect URI to the new random hostname.

## Useful scripts

- `pnpm db:inspect` — pretty-print users / accounts / sessions / collections from the local DB. Helpful when verifying sign-in worked or debugging the AI extraction pipeline.
