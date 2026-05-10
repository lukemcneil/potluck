# Potluck — TODO

> Source of truth for the build-out plan. Check items as they ship. Each phase is independently shippable.
> See [DEVELOPMENT.md](DEVELOPMENT.md) for context, conventions, and decisions already made with the user.

## Legend

- `[ ]` not started
- `[~]` in progress
- `[x]` done

---

## Phase 1 — Scaffold + UI shell

- [x] Scaffold Next.js 16 + TS + Tailwind v4 + pnpm
- [x] ESLint, Prettier, Vitest tooling
- [x] Install shadcn/ui (base-nova) + core primitives (button, card, input, dialog, sheet, drawer, tabs, dropdown, sonner, slider, etc.)
- [x] Theme tokens for warm cream/terracotta palette (light + dark) in `app/globals.css`
- [x] `theme-provider.tsx` with `next-themes`
- [x] Fraunces (display) + Inter (body) wired up via `next/font`
- [x] Landing page (`app/page.tsx`) with hero + 3 feature blurbs
- [x] DEVELOPMENT.md + TODO.md committed
- [x] **Mobile app shell**: `app/(app)/layout.tsx` with bottom tab bar (Home / Search / Add FAB / Cookbook / Profile) and top app bar
- [x] PWA manifest (`app/manifest.ts`) + app icons in `public/icons/`

## Phase 2 — Database

- [x] `drizzle.config.ts`
- [x] `db/client.ts` — better-sqlite3 + drizzle wrapper, lives at `data/potluck.db`
- [x] `db/schema.ts` — all tables per DEVELOPMENT.md data model
- [x] FTS5 virtual table + insert/update/delete triggers (raw SQL in a migration)
- [x] Generate initial migration into `db/migrations/`
- [x] Migration runner (`pnpm db:migrate`) using tsx + better-sqlite3 directly
- [x] Vitest coverage proving FTS works end-to-end
- [x] Seed script `scripts/seed-recipes.ts` (`pnpm db:seed`) — 6 demo recipes with sharp-generated hero photos, attaches to first user

## Phase 3 — Auth

- [x] `lib/auth.ts` — Auth.js v5 config with Google OAuth + Drizzle adapter
- [x] `app/api/auth/[...nextauth]/route.ts` handler
- [x] Per-page auth gate via `requireSession()` helper (no edge middleware — DB sessions don't work on edge)
- [x] `/signin` page (clean centered layout with Google button)
- [x] On first sign-in, generate unique `handle` (slug from name; collision → numeric suffix); auto-create default "All Saves" private collection
- [x] Helper `requireUser()` / `requireSession()` for server actions and pages
- [x] Type augmentation so `session.user.id` and `session.user.handle` are typed

## Phase 4 — Image storage + AI extraction

- [x] `lib/storage.ts` — `Storage` interface + local-disk implementation under `data/uploads/`
- [x] `lib/images.ts` — sharp-powered EXIF-correct resize (max 2048px) + tiny inline placeholder
- [x] `lib/validators.ts` — Zod schemas for Recipe, Ingredient, Step, Collection, handle, slugify
- [x] `lib/ai/extract-recipe.ts` — Vercel AI SDK + `gpt-4o` vision, `generateObject` with the recipe Zod schema, accepts image ids OR data URLs OR a URL
- [x] `app/api/upload/route.ts` — multipart upload with size/count limits, image normalization, placeholder generation
- [x] `app/api/extract/route.ts` — POST endpoint: accepts `imageIds[]` or `url`, returns extracted recipe JSON
- [x] `app/uploads/[...path]/route.ts` — serves stored images with long cache headers
- [x] Vitest covering the Zod schemas (20+ assertions)

## Phase 5 — Recipe create flow (mobile-first)

- [x] `app/(app)/add/page.tsx` — uses `<AddRecipeFlow>` orchestrator
- [x] Choose-source tile: Photos / URL / Type it in / Photos only
- [x] `components/upload/PhotoPicker.tsx` — native camera capture, multi-file, drag-drop, reorder, delete, /api/upload integration
- [x] On photos: choose **Extract recipe** (calls /api/extract) or **Just save photos**
- [x] On URL: paste link, hits same /api/extract endpoint
- [x] Extraction progress UI with friendly copy
- [x] `components/recipe/RecipeForm.tsx` — RHF + Zod, ingredients/steps add/remove with useFieldArray, taxonomy selectors, diet chips, tag input, visibility radio cards, sticky save bar
- [x] Server action `createRecipeAction` (auth-gated, slug uniqueness, transactional insert across recipes/photos/ingredients/steps/tags)
- [x] Failure mode: extract error keeps user on the photos/URL stage with photos preserved + error message; can also bypass extraction with "Type it in"

## Phase 6 — Recipe view + cook mode

- [x] `app/(app)/r/[id]/page.tsx` — hero photo, ingredients, numbered steps, time/servings/visibility badges, author link
- [x] Hero photo carousel (`components/recipe/PhotoCarousel.tsx` — scroll-snap, dot indicators, desktop arrows, single-photo fallback)
- [x] `lib/cooking/scale.ts` — fraction-aware quantity parser + scaler (handles `1 1/2`, `3/4`, `0.5`, `½`, `1-2` ranges); 20 vitest assertions
- [x] `components/recipe/IngredientsList.tsx` — servings stepper that rescales quantities live, snaps to eighths/thirds
- [x] `app/(app)/r/[id]/cook/page.tsx` — full-screen cook mode (large text, ingredient checkboxes, step-by-step nav, screen wake lock, exits to recipe)
- [ ] Print view (`@media print` styles)
- [x] `app/(app)/r/[id]/edit/page.tsx` — author-only edit, prefilled `RecipeForm` (mode=edit), preserves slug/URL
- [x] Server action: `updateRecipeAction` (transactional replace of ingredients/steps/photos/tags)
- [x] Server action: `deleteRecipeAction`

## Phase 7 — Profile + collections

- [x] `app/(app)/u/[handle]/page.tsx` — tabs: **Recipes** | **Collections** (+ collection count); `/cookbook` covers the viewer's own saved view
- [x] `components/collection/CollectionCard.tsx` — cover photo (explicit OR first-recipe hero), name, recipe count, visibility chip
- [x] `app/(app)/u/[handle]/c/[slug]/page.tsx` — collection detail (grid of recipes) with edit/delete menu for owner
- [x] Server actions: `createCollection`, `updateCollection`, `deleteCollection`, `addRecipeToCollection`, `removeRecipeFromCollection`, `saveRecipe`, `unsaveRecipe`
- [x] `components/recipe/SaveButton.tsx` — multi-select dialog with inline create-new collection (used on `/r/[id]` for non-author viewers)
- [x] **Profile editor** (`components/profile/ProfileEditDialog.tsx` + `lib/actions/profile.ts#updateProfileAction`) — change name, handle (with uniqueness check), bio. Avatar is still pulled from Google.

## Phase 8 — Discover, search, save

- [~] `app/(app)/feed/page.tsx` — public recipe feed (filter-aware grid live; infinite scroll TBD)
- [x] `components/filter/FilterChips.tsx` — URL-driven meal-type / cuisine / diet (multi) / max-time chips, wired into both `/feed` and `/search`
- [x] Cuisine filter populates from distinct values via `listAvailableCuisines()` so we never show empty options
- [x] `app/(app)/search/page.tsx` — debounced query box, **People + Recipes** results, FTS5-backed recipe match (title/description/ingredients), LIKE-based user match (name/handle/bio); empty-query state shows "Cooks on Potluck" + latest recipes; filters narrow recipe results even with empty query
- [x] Save action: `saveRecipeAction(recipeId, collectionIds?)` — auto-creates "All Saves" if missing
- [x] `app/(app)/cookbook/page.tsx` — recently saved + collections grid

## Phase 9 — PWA + polish

- [ ] Service worker for app-shell caching + offline fallback
- [ ] Install prompt UX (browser-native + iOS instructions sheet)
- [x] Loading states (`loading.tsx`) for every (app) route — feed, search, /r/[id], /r/[id]/edit, /r/[id]/cook, /cookbook, /u/[handle], /u/[handle]/c/[slug], /add, all using `RecipeCardSkeleton` / `CollectionCardSkeleton` primitives
- [x] Empty states on the surfaces that need them (feed, /search no-match, /search filter no-match, profile, collection, /add review)
- [x] `error.tsx` boundary at `(app)/error.tsx` with retry + "back to feed"; `(app)/not-found.tsx` for missing pages
- [ ] Accessibility pass (focus management, aria labels, keyboard nav, color contrast)
- [ ] Lighthouse mobile pass — perf > 90, a11y > 95
- [~] Vitest coverage on validators (20+ assertions), scaler math (20 assertions); server actions still TBD

## Phase 9.5 — AI cost & observability

> Per-call cost is now logged ($0.0067/extraction on `gpt-4o`, $0.0041 on `gpt-4o-mini`; see DEVELOPMENT.md). These items make spend visible and bounded.

- [x] `lib/ai/pricing.ts` — pricing table + `computeCost()`
- [x] `extractRecipe()` returns `{ recipe, cost }` and logs a structured `[ai.extract]` line
- [x] `/api/extract` includes cost in the JSON response body
- [x] Persist usage: `aiUsage` table (`userId`, `recipeId?`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `createdAt`) written from the API route on success
- [x] Per-user monthly spend cap (`POTLUCK_USER_MONTHLY_USD_CAP`, env-configurable) — `/api/extract` returns 402 with friendly copy when MTD spend ≥ cap
- [x] Surface "this extraction cost X¢" in the AddRecipeFlow review step (chip below the heading; renders cents when sub-dollar)
- [x] AI usage card on the owner's `/u/[handle]` — total spend MTD + breakdown by model + progress bar against the configured cap
- [ ] Auto-fallback to `gpt-4o-mini` when the user is over a soft threshold (~⅔ of cap)
- [ ] Show on AddRecipeFlow extracting screen if the user is approaching their cap

## Phase 10 — Docs + deploy

- [ ] Update `README.md` with quickstart + screenshots
- [x] `.env.example` with all required keys (incl. `POTLUCK_ALLOWED_EMAILS` for private deploys)
- [x] `DEPLOY.md` — home-server deploy via Cloudflare Tunnel + systemd + email allowlist + SQLite backups
- [x] `POTLUCK_ALLOWED_EMAILS` allowlist in `lib/auth.ts#signIn` callback (+ "not on the guest list" message on `/signin?error=AccessDenied`)
- [ ] Document Fly.io deploy with persistent volume (alternative to home-server path)
- [ ] Document Turso swap path

---

## Deferred (post-v1, do not build yet)

- Comments + ratings on recipes
- Follow / followers + "from people you follow" feed
- Shopping list generator
- Meal planner / calendar
- Fork-a-recipe (save with edits as your own)
- Web Share Target (receive shared images from iOS/Android share sheet)
- Push notifications
- Anthropic Claude as alternate AI provider
- S3/R2 image storage adapter (interface ready, just needs an implementation)
