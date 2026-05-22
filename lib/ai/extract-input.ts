import { z } from "zod";

/**
 * Wire-level validator for `POST /api/extract`. Lives in `lib/ai/` (not
 * inline on the route file) so it can be unit-tested without spinning
 * up a request and so the route handler stays focused on auth, cap,
 * and orchestration.
 *
 * The discriminated union mirrors {@link ExtractInput}'s public shape.
 * Bounds here are deliberately stricter than the extractor's internal
 * caps — we want bad input to bounce at the HTTP boundary with a clear
 * 400, not eat a model call:
 *
 *   - `imageIds`: 1–8 items (matches the upload pipeline's per-batch
 *     limit; the AI model also degrades past ~6 images so we'd be
 *     setting the user up for a bad extraction anyway).
 *   - `url`: must be a syntactically valid URL. We don't pre-flight
 *     the fetch here — the extractor does that with a friendlier
 *     error.
 *   - `text`: 20–50 000 chars. 20 fails fast on accidental "yum"
 *     pastes; 50 000 mirrors `TEXT_CHAR_BUDGET` in extract-recipe.ts
 *     (~12K tokens worst case) so the server never accepts something
 *     it would have to silently truncate. `.trim()` first so a
 *     20-char paste with leading whitespace doesn't slip through.
 */
export const extractRequestSchema = z.union([
  z.object({
    kind: z.literal("imageIds"),
    imageIds: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(20).max(50_000),
  }),
]);

export type ExtractRequest = z.infer<typeof extractRequestSchema>;
