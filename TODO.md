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
- [x] `components/recipe/RecipeBody.tsx` — servings stepper that rescales ingredient quantities + inline `<qty> <unit>` tokens in step prose; snaps to eighths/thirds
- [x] `app/(app)/r/[id]/cook/page.tsx` — full-screen cook mode (large text, ingredient checkboxes, step-by-step nav, screen wake lock, exits to recipe)
- [x] Print view (`@media print` styles in `app/globals.css` + `components/recipe/PrintButton.tsx`)
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

- [x] `app/(app)/feed/page.tsx` — public recipe feed (compact 2/3/4/5-col grid, server-rendered first page, infinite scroll via `<FeedList>` + `loadMoreFeedAction`)
- [x] `components/filter/FilterChips.tsx` — URL-driven meal-type / cuisine / diet (multi) / max-time chips, wired into both `/feed` and `/search`
- [x] Cuisine filter populates from distinct values via `listAvailableCuisines()` so we never show empty options
- [x] `app/(app)/search/page.tsx` — debounced query box, **People + Recipes** results, FTS5-backed recipe match (title/description/ingredients), LIKE-based user match (name/handle/bio); empty-query state shows "Cooks on Potluck" + latest recipes; filters narrow recipe results even with empty query
- [x] Save action: `saveRecipeAction(recipeId, collectionIds?)` — auto-creates "All Saves" if missing
- [x] `app/(app)/cookbook/page.tsx` — recently saved + collections grid

## Phase 9 — PWA + polish

- [x] Service worker (`public/sw.js`): cache-first for `/uploads/*` + hashed `/_next/static/*`; stale-while-revalidate for HTML/RSC navigations; falls back to `/offline`. Cooking offline works for any recipe the user has visited while online.
- [x] Install prompt UX (`components/pwa/InstallPrompt.tsx`) — `beforeinstallprompt` for Android/desktop, iOS Safari "Add to Home Screen" instructions sheet, 14-day "not now" persistence
- [x] Loading states (`loading.tsx`) for every (app) route — feed, search, /r/[id], /r/[id]/edit, /r/[id]/cook, /cookbook, /u/[handle], /u/[handle]/c/[slug], /add, all using `RecipeCardSkeleton` / `CollectionCardSkeleton` primitives
- [x] Empty states on the surfaces that need them (feed, /search no-match, /search filter no-match, profile, collection, /add review)
- [x] `error.tsx` boundary at `(app)/error.tsx` with retry + "back to feed"; `(app)/not-found.tsx` for missing pages
- [x] Accessibility pass — heading-order on cards (configurable `headingLevel`), label-content-name-mismatch on RecipeCard / CollectionCard (visible text ⊂ accessible name), skip-to-content link in `(app)/layout.tsx`, AriaCard / Cook Mode `aria-current` cues
- [~] Lighthouse mobile pass — a11y 100 across landing/feed/recipe-detail; perf 81-93 (landing 93 ✓, feed 81, recipe 87). Remaining gap is render-delay LCP from React 19 hydration on the 24-card feed grid; needs deeper bundle work to clear 90.
- [x] Vitest coverage on validators (20+), scaler math (20+), server actions (47 across recipes/collections/saves)

## Phase 9.5 — AI cost & observability

> Per-call cost is now logged. With the default `google` provider (Gemini Flash) extractions are within the free tier; with `openai` they cost $0.0067/extraction on `gpt-4o`, $0.0041 on `gpt-4o-mini`. See DEVELOPMENT.md.

- [x] `lib/ai/pricing.ts` — pricing table + `computeCost()` (covers OpenAI + Gemini Flash)
- [x] `extractRecipe()` returns `{ recipe, cost }` and logs a structured `[ai.extract]` line (includes `provider=`)
- [x] `/api/extract` includes cost in the JSON response body
- [x] Persist usage: `aiUsage` table (`userId`, `recipeId?`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `createdAt`) written from the API route on success
- [x] Per-user monthly spend cap (`POTLUCK_USER_MONTHLY_USD_CAP`, env-configurable) — `/api/extract` returns 402 with friendly copy when MTD spend ≥ cap
- [x] Surface "this extraction cost X¢" in the AddRecipeFlow review step (chip below the heading; renders cents when sub-dollar)
- [x] AI usage card on the owner's `/u/[handle]` — total spend MTD + breakdown by model + progress bar against the configured cap
- [x] Auto-fallback to `gpt-4o-mini` when the user is over a soft threshold (~⅔ of cap) — `app/api/extract/route.ts`
- [x] Show on AddRecipeFlow extracting screen if the user is approaching their cap (amber banner with current MTD spend / cap)
- [x] **Pluggable AI provider** (`AI_PROVIDER` env, default `google`) — Gemini Flash free tier for personal use; `openai` retained for paid setups.
- [ ] **JSON-LD fast path for URL imports** (option B from the May 12 chat): parse `<script type="application/ld+json">` Recipe schema directly when present (covers ~80% of recipe blogs) and skip the LLM entirely for those. Falls back to LLM for sites without it. Cheap quality win even on the free tier (saves rate-limit budget).
- [ ] **Tame URL extraction latency / output verbosity**: with notes capture turned on, some pages (Simply Recipes, blog-heavy formats) push the model to ~11K output tokens and ~55s primary-pass latency. Output tokens are autoregressive so they directly drive wall-clock time. Worth investigating: a per-field length budget in the prompt, a `max_output_tokens` clamp on the API call, or splitting notes capture into a cheap second pass on flash-lite so the slow primary doesn't have to write everything. Image extraction is unaffected (stays at 9–12s).

## Phase 10 — Docs + deploy

- [x] Update `README.md` with quickstart + screenshots (`docs/screenshots/{feed-mobile,recipe-detail,cook-mode}.png` captured at mobile width, ~40 KB each)
- [x] `.env.example` with all required keys (incl. `POTLUCK_ALLOWED_EMAILS` for private deploys)
- [x] `DEPLOY.md` — home-server deploy via Cloudflare Tunnel + systemd + email allowlist + SQLite backups
- [x] `POTLUCK_ALLOWED_EMAILS` allowlist in `lib/auth.ts#signIn` callback (+ "not on the guest list" message on `/signin?error=AccessDenied`)
- _(Fly.io / Turso paths intentionally not pursued — deploys live on a self-hosted server.)_

## Phase 11 — Social + utility

- [x] **Ratings**: `recipeRatings` (1–5, composite PK), `setRatingAction` / `clearRatingAction`, optimistic 5-star `RatingControl` on `/r/[id]`, bulk-hydrated `avgRating` + `ratingCount` on every `RecipeCardData`, inline `RatingChip` on cards. Author's self-rating is excluded from the public average.
- [x] **Comments**: `recipeComments` (flat), `addCommentAction` (1–2000 chars) / `deleteCommentAction` (author OR recipe owner), `<CommentsSection>` on the recipe detail page with optimistic add + delete.
- [x] **Shopping list generator**: `shoppingLists` + `shoppingListItems`, exact-match `(name, unit)` consolidation in `lib/shopping/consolidate.ts` with quantity summing + glyph fractions, `<AddToShoppingListButton>` on recipe detail, `/cookbook/lists` (list of lists) and `/cookbook/lists/[id]` (tap-to-check + add ad-hoc + archive/delete).
- [x] **Web Share Target**: manifest `share_target` block + Android `shortcuts`, `/share-receive` route normalizes shared images via the existing /api/upload pipeline, hands off to `/add` via a new `ShareIntent` prop on `AddRecipeFlow`, `/api/uploads/meta` rebuilds UploadedPhoto thumbnails for shared photos.
- [x] **Push notifications**: VAPID-aware send pipeline (`lib/push/send.ts` — silent no-op when env missing), `/api/push/{subscribe,unsubscribe,public-key}` routes, sw.js push + notificationclick handlers, `<EnableNotificationsItem>` in the account dropdown that hides itself when push isn't configured. Triggers fire from `saveRecipeAction` (first-save only), comments, and ratings. `pnpm push:keys` mints VAPID keys.
- [x] Vitest coverage on the new server actions: ratings (12), comments (10), shopping (16), `consolidate` (11) = 49 new cases.

---

## Phase 12 — AI extraction trust

> Goal: stop bad AI extractions from making it into someone's pan. The
> common failure mode is unit substitution on high-stakes ingredients
> (1 tsp → 1 tbsp salt), which the original extractor has no way to
> notice. We attack it with a verification gate at the review step so
> the importer literally cannot save a flagged ingredient without
> picking a value, plus we surface the source on the recipe page so a
> cook mid-recipe can sanity-check anything that smells off.

- [x] **Per-ingredient confidence**: `extractedRecipeSchema` carries
  `confidence: "high" | "low"` on every ingredient + step. The system
  prompt asks the model to mark anything it had to guess (smudged
  photo, ambiguous abbreviation, partial OCR).
- [x] **Self-check pass**: `extractAndVerifyRecipe()` runs the primary
  + a second extraction (smaller/faster model per provider:
  `gpt-4o-mini` on OpenAI, `gemini-2.5-flash-lite` on Google; both
  env-overridable via `*_VERIFY_MODEL`) in parallel against the same
  prepared source content, then aligns them with `diffExtractions` to
  emit the typed discrepancy list. 30 s hard timeout (Gemini URL
  imports routinely take 15–30 s); throws / no-recipe disagreement /
  timeouts all soft-fail to `{ verificationFailed: true, discrepancies: [] }`.
  Cost is summed so the cap / billing logic stays a single number.
- [x] **Verification gate in the review step**: every flagged row
  shows a yellow strip with reason + a single action group (Add/Skip,
  Use X / Use Y, Keep/Remove, or Confirm). Save reads
  `Save (N to verify first)` and is disabled while any flagged row is
  unresolved. Resolution state is keyed by RHF's stable `field.id` so
  inserts/removes don't break the count.
- [x] **Side-by-side source preview**: sticky `<ReviewSourcePane>` at
  the top of the form. URL imports show
  "Imported from {domain} → Open original"; photo imports show a
  thumbnail strip clickable to open each in a new tab.
- [x] **`sourceUrl` on the recipe detail page**: surfaced as
  "Imported from {domain}" under the title and an "Open original"
  button in the action bar.
- [x] **Tests**: 19 cases on `diffExtractions` (`lib/ai/__tests__/discrepancies.test.ts`)
  + 9 cases on `buildReviewPayload` (`lib/ai/__tests__/review.test.ts`).
- [x] **Docs**: DEVELOPMENT.md "AI extraction trust" section covers
  the gate end-to-end, including what we deliberately did NOT build
  (heuristic safety scanner, AI-imported badge, "Keep mine" button).
- [x] **Free-form notes on recipes**: new `recipes.notes` column +
  Notes section in `RecipeForm` + soft callout below the body on the
  detail page. AI extraction prompt instructed to capture chef's
  notes / headnotes / "make-ahead" guidance / substitutions / family
  context — anything that isn't an ingredient count or a step.
  Plain-text only; `whitespace-pre-line` preserves the author's line
  breaks.

## Investigations (audit, not yet a task)

- **Fractions vs decimals across the app**: audit how quantities are
  parsed, scaled, displayed, consolidated, and round-tripped.
  - Extractor stores raw text ("1 1/2", "0.5", "½").
  - `lib/cooking/scale.ts` accepts all three forms but renders back to
    fraction glyphs.
  - Shopping-list `consolidate` uses its own parse + glyph format.
  - Cook-mode + recipe body show scaled values; the seam between
    scaled (decimal) and displayed (fraction) is worth checking for
    drift, especially around values like 1/3 cup × 2 servings → 0.666
    → "⅔" vs "0.67".
  - Decide on a single canonical representation in storage and a
    single render path.

---

## Deferred (post-v1, do not build yet)

- Follow / followers + "from people you follow" feed
- Meal planner / calendar
- Fork-a-recipe (save with edits as your own)
- Threaded replies on comments + comment notifications digest
- Smart-merge shopping lists (unit conversion, fuzzy ingredient names)
- Anthropic Claude as alternate AI provider
- S3/R2 image storage adapter (interface ready, just needs an implementation)
