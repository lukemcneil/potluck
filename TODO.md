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
- [ ] Seed script `db/seed.ts` (a couple of demo users + recipes for dev)

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

- [ ] `app/(app)/add/page.tsx` — entry: choose **Take photos** | **Pick from library** | **Paste URL**
- [ ] `components/upload/PhotoPicker.tsx` — `<input capture="environment" multiple>` + drag-drop on desktop, reorder, delete
- [ ] On submit: upload images → return URLs → choose **Extract recipe** (default) or **Just save photos**
- [ ] If extract: progress UI → call `/api/extract` → show editable form pre-filled
- [ ] `components/recipe/RecipeForm.tsx` — RHF + Zod, all fields, live ingredient/step add/remove/reorder
- [ ] Server action `createRecipe` (with auth + author binding) + redirect to `/r/[id]`
- [ ] Failure mode: "couldn't parse — fill in manually?" with photos preserved

## Phase 6 — Recipe view + cook mode

- [ ] `app/(app)/r/[id]/page.tsx` — hero photo carousel, ingredients, numbered steps, time/servings badges
- [ ] `components/recipe/ServingsScaler.tsx` — slider that recomputes ingredient quantities (handles fractions)
- [ ] `app/(app)/r/[id]/cook/page.tsx` — cook mode (large text, dim chrome, **screen-wake-lock**)
- [ ] Print view (`@media print` styles)
- [ ] `app/(app)/r/[id]/edit/page.tsx` — author-only edit
- [ ] Server actions: `updateRecipe`, `deleteRecipe`

## Phase 7 — Profile + collections

- [ ] `app/(app)/u/[handle]/page.tsx` — tabs: **Recipes** | **Collections** | **Saved**
- [ ] `components/collection/CollectionCard.tsx` — cover photo, name, recipe count, visibility chip
- [ ] `app/(app)/u/[handle]/c/[slug]/page.tsx` — collection detail (grid of recipes)
- [ ] Server actions: `createCollection`, `updateCollection`, `deleteCollection`, `addRecipeToCollection`, `removeRecipeFromCollection`
- [ ] `components/collection/CollectionPicker.tsx` — multi-select dialog used during save / from recipe page
- [ ] Profile editor: change name, handle, avatar (small dialog)

## Phase 8 — Discover, search, save

- [ ] `app/(app)/feed/page.tsx` — public recipe feed, infinite scroll
- [ ] `components/filter/FilterChips.tsx` — meal type, cuisine, diet, max time, tag chips
- [ ] `app/(app)/search/page.tsx` — query box + filters, FTS5-backed query
- [ ] Save action: `saveRecipe(recipeId, collectionIds?)` — with auto "All Saves" collection
- [ ] `app/(app)/cookbook/page.tsx` — saved recipes grouped by collection

## Phase 9 — PWA + polish

- [ ] Service worker for app-shell caching + offline fallback
- [ ] Install prompt UX (browser-native + iOS instructions sheet)
- [ ] Loading states (`loading.tsx`) for every route
- [ ] Empty states everywhere (no recipes, no saves, no collections)
- [ ] `error.tsx` boundaries
- [ ] Accessibility pass (focus management, aria labels, keyboard nav, color contrast)
- [ ] Lighthouse mobile pass — perf > 90, a11y > 95
- [ ] Vitest coverage on validators, server actions, scaler math

## Phase 10 — Docs + deploy

- [ ] Update `README.md` with quickstart + screenshots
- [ ] `.env.example` with all required keys
- [ ] Document Fly.io deploy with persistent volume in `DEPLOY.md`
- [ ] Document Cloudflare Tunnel option
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
