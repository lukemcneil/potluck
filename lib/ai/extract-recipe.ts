import "server-only";

import { generateObject, type UserContent } from "ai";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

import {
  extractedRecipeSchema,
  extractedRecipeWireSchema,
  type ExtractedRecipe,
} from "@/lib/validators";
import { storage } from "@/lib/storage";
import { computeCost, formatUsd, type CostBreakdown } from "@/lib/ai/pricing";
import { fetchRecipePage } from "@/lib/recipe-import/fetch";
import {
  diffExtractions,
  type Discrepancy,
} from "@/lib/ai/discrepancies";

export type ExtractOk = {
  kind: "ok";
  recipe: ExtractedRecipe;
  cost: CostBreakdown;
};
export type ExtractNoRecipe = {
  kind: "no-recipe";
  reason: string;
  cost: CostBreakdown;
};
export type ExtractResult = ExtractOk | ExtractNoRecipe;

/**
 * Result of {@link extractAndVerifyRecipe}: the primary extraction
 * plus a deterministic diff against an independent second pass over
 * the same source. Use this from the API route — `cost` is the SUM of
 * both passes so the caller can charge / cap on a single number.
 *
 * `verificationFailed` means the second pass errored or timed out and
 * we fell back to a no-discrepancies result. The UI surfaces a
 * "verification unavailable" banner so importers know the safety net
 * isn't there for this one.
 */
export type ExtractWithVerificationResult = ExtractResult & {
  discrepancies: Discrepancy[];
  primaryCost: CostBreakdown;
  verificationCost: CostBreakdown | null;
  verificationFailed: boolean;
};

// AI provider selection. `google` (default) uses Gemini Flash, which
// has a real free tier and is great for both vision and text — no
// credit card required if you stay inside the free quota. `openai` is
// retained as a paid alternative; set AI_PROVIDER=openai if you have
// reasons to prefer it.
//
// Each provider has independent image/url model env overrides so you
// can use a fancier model for vision without changing the URL path.
export type AiProvider = "openai" | "google";

export function aiProvider(): AiProvider {
  const v = (process.env.AI_PROVIDER ?? "google").toLowerCase();
  return v === "openai" ? "openai" : "google";
}

const OPENAI_IMAGE_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
const OPENAI_URL_MODEL_DEFAULT = process.env.OPENAI_URL_MODEL ?? "gpt-4o-mini";
// `gemini-2.5-flash` is the current "fast + smart + free tier"
// workhorse. `gemini-2.0-flash` is older and on some accounts has its
// free-tier quota set to 0 — switching to 2.5 avoids that footgun.
const GOOGLE_IMAGE_MODEL = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
const GOOGLE_URL_MODEL = process.env.GOOGLE_URL_MODEL ?? "gemini-2.5-flash";

// Model used for the SECOND (verification) pass. We deliberately pick a
// smaller/cheaper model than the primary so:
//   (a) it actually finishes within VERIFICATION_TIMEOUT_MS — the
//       primary URL pass on Gemini Flash routinely takes 15–30s, which
//       blew up our old 10s budget,
//   (b) the verifier reads the source independently of the primary's
//       biases (different size / training mix = independent failure
//       modes), which is the whole point of cross-checking.
// OpenAI: gpt-4o-mini is the established cheap counterpart.
// Google: gemini-2.5-flash-lite is ~3x faster + cheaper than 2.5-flash.
const OPENAI_VERIFY_MODEL =
  process.env.OPENAI_VERIFY_MODEL ?? "gpt-4o-mini";
const GOOGLE_VERIFY_MODEL =
  process.env.GOOGLE_VERIFY_MODEL ?? "gemini-2.5-flash-lite";

/**
 * Cheaper text-only model used for the soft-cap downgrade in
 * /api/extract (image extraction routes to this when the user is
 * over ~⅔ of their monthly USD cap).
 */
export const URL_MODEL =
  aiProvider() === "openai" ? OPENAI_URL_MODEL_DEFAULT : GOOGLE_URL_MODEL;

function verifyModelFor(provider: AiProvider): string {
  return provider === "openai" ? OPENAI_VERIFY_MODEL : GOOGLE_VERIFY_MODEL;
}

function defaultModelFor(
  provider: AiProvider,
  kind: ExtractInput["kind"],
): string {
  if (provider === "openai") {
    return kind === "url" ? OPENAI_URL_MODEL_DEFAULT : OPENAI_IMAGE_MODEL;
  }
  return kind === "url" ? GOOGLE_URL_MODEL : GOOGLE_IMAGE_MODEL;
}

function modelHandle(provider: AiProvider, modelId: string) {
  return provider === "openai" ? openai(modelId) : google(modelId);
}

function ensureApiKey(provider: AiProvider) {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Either set AI_PROVIDER=google and add a free GOOGLE_GENERATIVE_AI_API_KEY, or add an OPENAI_API_KEY to .env.local.",
    );
  }
  if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Get one free (no credit card) at https://aistudio.google.com/apikey and add it to .env.local.",
    );
  }
}

// We don't trust the model to actually browse, so for URL imports we
// fetch the HTML ourselves and hand it to the model. This is the cap
// on how much HTML we'll feed it after stripping scripts/styles. ~150K
// characters is roughly 35-40K input tokens worst case (~$0.10 at
// gpt-4o), which comfortably fits any real recipe page.
const HTML_CHAR_BUDGET = 150_000;

const SYSTEM_PROMPT = `You are a careful recipe transcription assistant.
You convert photos and webpages into clean, structured recipes.

NOT-A-RECIPE GUARDRAIL (most important rule):
- If the input does NOT contain a real recipe (e.g. a news article, a login wall, a screenshot of email, a generic food photo with no instructions, a landing/category page that just lists recipe links, an error page, or any image with no readable recipe content), set "notARecipe": true and write a one-sentence "reason" explaining what you saw. Do NOT invent ingredients or steps to fill the schema.
- Only set "notARecipe": false when you can extract at least a title, ingredients, and ordered steps grounded in the input.

When a recipe IS present:
- For webpages, you'll be given the page's raw HTML. Look for a JSON-LD <script type="application/ld+json"> block with a Recipe schema first — if present, prefer those values exactly. Otherwise, extract from the visible content. Ignore navigation, ads, comments, and unrelated articles.
- Combine information across all provided images: a multi-page recipe may span them.
- Preserve quantities exactly as written (fractions like "1 1/2" stay as text).
- Split each ingredient into quantity, unit, name, and an optional note (e.g. "sifted", "chopped").
- Steps must be ordered, action-oriented sentences. Do not number them — that's done by the UI.
- If a value is unknown, set it to null. Do not invent times, servings, or ingredients.
- For mealType, choose ONE of: breakfast, brunch, lunch, dinner, appetizer, side, dessert, snack, drink.
- Cuisine should be a short common label like "italian" or "thai" if obvious; otherwise null.
- For diets, only include labels you can confidently infer: vegetarian, vegan, gluten-free, dairy-free, nut-free, keto, paleo, low-carb, pescatarian.
- Tags are 1-2 word lowercase descriptors useful for filtering (e.g. "weeknight", "one-pan", "make-ahead").

NOTES (free-form context that is NOT ingredients or steps):
- Capture things like: chef's notes / headnotes, "make-ahead" guidance, substitution suggestions, storage instructions, serving suggestions, equipment tips, history or family context ("from my grandmother's kitchen"), and any prose the author wrote that doesn't belong in description / ingredients / steps.
- Keep the wording close to the source. Combine multiple call-out boxes with blank lines between them. Preserve line breaks where they're meaningful.
- Do NOT pad with generic cooking advice the source didn't include. If there's nothing of this kind in the input, set notes to null.
- The short marketing blurb at the top of a blog post belongs in "description", not "notes". "description" is the one-paragraph summary; "notes" is the longer prose tips/context.

CONFIDENCE (per ingredient and per step):
- Mark "confidence": "low" when ANY of: the source text is smudged, partially cropped, ambiguous, hard to read, abbreviated in a way that could mean two units (e.g. "T" for tbsp vs tsp), or when you had to guess between two plausible readings. The reviewer will be forced to confirm "low" rows before saving.
- Mark "confidence": "high" only when the field is unambiguous in the source.
- When in doubt, mark "low". Over-flagging is cheap; under-flagging means a mistake gets cooked.`;

export type ExtractInput =
  | { kind: "imageIds"; imageIds: string[] }
  | { kind: "imageDataUrls"; imageDataUrls: string[] }
  | { kind: "url"; url: string };

/**
 * Extract a structured recipe from a set of images (by stored id) or a URL.
 * Returns either { kind:"ok", recipe, cost } when a recipe was found, or
 * { kind:"no-recipe", reason, cost } when the model concluded the input
 * isn't a recipe. The cost is reported in both cases (the call still
 * burned tokens). Logs a structured `[ai.extract]` line either way.
 *
 * `options.modelOverride` forces a specific model (e.g. callers downgrade
 * to `gpt-4o-mini` when the user is approaching their monthly cap).
 *
 * Throws if OPENAI_API_KEY is missing or the upstream HTTP call fails.
 */
export async function extractRecipe(
  input: ExtractInput,
  options: { modelOverride?: string } = {},
): Promise<ExtractResult> {
  const provider = aiProvider();
  ensureApiKey(provider);

  const userParts = await buildExtractUserContent(input);
  const model = options.modelOverride ?? defaultModelFor(provider, input.kind);
  return runExtraction(userParts, model, input);
}

/**
 * Verification-aware orchestrator: runs the primary extraction and a
 * second independent extraction in parallel against the same prepared
 * source content, then aligns the two with `diffExtractions`. Returns
 * the primary result enriched with a typed `discrepancies` list and
 * the SUM of both calls' cost.
 *
 * The verification pass uses a deliberately smaller model than the
 * primary (gpt-4o-mini on OpenAI; gemini-2.5-flash-lite on Google)
 * because:
 * (a) it's much cheaper, so even on image imports we barely move the
 *     needle on the user's monthly cap,
 * (b) using a different model than the primary makes it more likely
 *     to "see" the source independently rather than parrot the
 *     primary's biases,
 * (c) it actually finishes within VERIFICATION_TIMEOUT_MS — the
 *     primary URL pass on Gemini Flash routinely takes 15–30s; running
 *     the same model again would just time out.
 *
 * Soft-fails on verification errors / timeouts / no-recipe — the
 * primary result still ships, just with `verificationFailed: true` and
 * an empty `discrepancies` array. We never block an import on a flaky
 * second pass.
 */
const VERIFICATION_TIMEOUT_MS = 30_000;

export async function extractAndVerifyRecipe(
  input: ExtractInput,
  options: { modelOverride?: string } = {},
): Promise<ExtractWithVerificationResult> {
  const provider = aiProvider();
  ensureApiKey(provider);

  // Build the user content ONCE so we don't double-fetch the URL or
  // re-base64 the same image bytes twice.
  const userParts = await buildExtractUserContent(input);
  const primaryModel =
    options.modelOverride ?? defaultModelFor(provider, input.kind);
  const verifyModel = verifyModelFor(provider);

  const primaryPromise = runExtraction(userParts, primaryModel, input);
  // Race the verification call against a hard timeout so a slow second
  // pass can't hold the whole import hostage.
  const verifyPromise = withTimeout(
    runExtraction(userParts, verifyModel, input).catch(
      (err): ExtractResult & { __failed: true } => ({
        kind: "no-recipe",
        reason: err instanceof Error ? err.message : String(err),
        cost: zeroCost(verifyModel),
        __failed: true,
      }),
    ),
    VERIFICATION_TIMEOUT_MS,
  );

  const [primary, verifyOrTimeout] = await Promise.all([
    primaryPromise,
    verifyPromise,
  ]);

  // Verification soft-fail cases:
  //  1. timeout   -> verifyOrTimeout === TIMEOUT_SENTINEL
  //  2. throw     -> __failed: true (cost is zero — we never heard back)
  //  3. no-recipe -> verification disagreed about whether it's a recipe
  //                  at all; we don't know who's right, so don't block.
  let verifyResult: ExtractResult | null = null;
  let verifyFailed = false;
  let verifyCost: CostBreakdown | null = null;

  if (verifyOrTimeout === TIMEOUT_SENTINEL) {
    verifyFailed = true;
  } else if ("__failed" in verifyOrTimeout) {
    verifyFailed = true;
  } else {
    verifyResult = verifyOrTimeout;
    verifyCost = verifyOrTimeout.cost;
    if (verifyOrTimeout.kind !== "ok") {
      // Treat as soft-fail rather than emitting "everything is missing"
      // discrepancies — the second pass might just be wrong.
      verifyFailed = true;
    }
  }

  const discrepancies: Discrepancy[] =
    primary.kind === "ok" && verifyResult?.kind === "ok"
      ? diffExtractions(primary.recipe, verifyResult.recipe)
      : [];

  const totalCost = sumCost(primary.cost, verifyCost);

  if (primary.kind === "no-recipe") {
    return {
      ...primary,
      cost: totalCost,
      primaryCost: primary.cost,
      verificationCost: verifyCost,
      verificationFailed: verifyFailed,
      discrepancies: [],
    };
  }

  return {
    ...primary,
    cost: totalCost,
    primaryCost: primary.cost,
    verificationCost: verifyCost,
    verificationFailed: verifyFailed,
    discrepancies,
  };
}

const TIMEOUT_SENTINEL = Symbol("verification-timeout");

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT_SENTINEL> {
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SENTINEL), ms),
    ),
  ]);
}

function zeroCost(modelId: string): CostBreakdown {
  return {
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    billedInputTokens: 0,
    inputCost: 0,
    cachedInputCost: 0,
    outputCost: 0,
    totalCost: 0,
  };
}

function sumCost(
  a: CostBreakdown,
  b: CostBreakdown | null,
): CostBreakdown {
  if (!b) return a;
  return {
    // Reporting the primary's modelId — it's what determined the
    // recipe quality. The verification pass is an internal cost.
    modelId: a.modelId,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    billedInputTokens: a.billedInputTokens + b.billedInputTokens,
    inputCost: a.inputCost + b.inputCost,
    cachedInputCost: a.cachedInputCost + b.cachedInputCost,
    outputCost: a.outputCost + b.outputCost,
    totalCost: a.totalCost + b.totalCost,
  };
}

/**
 * Single LLM call against an already-built user content payload. Pulled
 * out of `extractRecipe` so {@link extractAndVerifyRecipe} can run two
 * calls (primary + verification) over the same prepared payload.
 */
async function runExtraction(
  userParts: UserContent,
  model: string,
  input: ExtractInput,
): Promise<ExtractResult> {
  const imageCount =
    input.kind === "imageIds"
      ? input.imageIds.length
      : input.kind === "imageDataUrls"
        ? input.imageDataUrls.length
        : 0;

  const provider = aiProvider();
  const startedAt = Date.now();
  const { object, usage } = await generateObject({
    model: modelHandle(provider, model),
    schema: extractedRecipeWireSchema,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userParts }],
  });
  const elapsedMs = Date.now() - startedAt;

  const cost = computeCost(model, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens,
  });

  const looksEmpty =
    !object.title.trim() ||
    object.ingredients.length === 0 ||
    object.steps.length === 0;
  const isNoRecipe = object.notARecipe || looksEmpty;
  const outcome = isNoRecipe ? "no-recipe" : "ok";

  console.log(
    `[ai.extract] provider=${provider} model=${model} kind=${input.kind} images=${imageCount} ` +
      `outcome=${outcome} ` +
      `tokens=${cost.inputTokens}+${cost.outputTokens}=${cost.inputTokens + cost.outputTokens} ` +
      `cached=${cost.cachedInputTokens} cost=${formatUsd(cost.totalCost)} ` +
      `latency=${(elapsedMs / 1000).toFixed(2)}s`,
  );

  if (isNoRecipe) {
    const reason =
      object.reason?.trim() ||
      (looksEmpty
        ? "The input didn't have enough recipe content to extract."
        : "The input doesn't appear to contain a recipe.");
    return { kind: "no-recipe", reason, cost };
  }

  const parsed = extractedRecipeSchema.safeParse({
    title: object.title,
    description: object.description,
    notes: object.notes,
    ingredients: object.ingredients,
    steps: object.steps,
    prepMinutes: object.prepMinutes,
    cookMinutes: object.cookMinutes,
    servings: object.servings,
    mealType: object.mealType,
    cuisine: object.cuisine,
    suggestedDiets: object.suggestedDiets,
    suggestedTags: object.suggestedTags,
  });
  // `looksEmpty` already filtered out the empty case, so any safeParse
  // failure here is a malformed payload (e.g. a 0-length ingredient
  // name) — surface as no-recipe rather than crash.
  if (!parsed.success) {
    return {
      kind: "no-recipe",
      reason: "Extracted recipe was malformed; please try again or type it in.",
      cost,
    };
  }
  return { kind: "ok", recipe: parsed.data, cost };
}

/**
 * Build the user-message content (text + optional image data URLs)
 * from a raw `ExtractInput`. Exposed so the verification orchestrator
 * can run two LLM calls against the same prepared payload without
 * re-fetching the URL or re-encoding image bytes.
 */
export async function buildExtractUserContent(
  input: ExtractInput,
): Promise<UserContent> {
  if (input.kind === "url") {
    const page = await fetchRecipePage(input.url);
    const html = trimHtmlForLlm(page.html);
    return [
      {
        type: "text" as const,
        text:
          `The user wants to import a recipe from this page: ${page.finalUrl}\n\n` +
          `Below is the page's HTML. Extract the primary recipe. If the page lists ` +
          `several recipes, pick the most prominent one.\n\n` +
          `--- BEGIN HTML ---\n${html}\n--- END HTML ---`,
      },
    ];
  }

  const dataUrls: string[] =
    input.kind === "imageIds"
      ? await Promise.all(input.imageIds.map(async (id) => imageIdToDataUrl(id)))
      : input.imageDataUrls;

  return [
    {
      type: "text" as const,
      text:
        dataUrls.length === 1
          ? "Here is a photo of a recipe. Extract a complete, structured version of it."
          : `Here are ${dataUrls.length} photos of one recipe (different pages, sides, or angles). Combine them into a single complete, structured recipe.`,
    },
    ...dataUrls.map((url) => ({
      type: "image" as const,
      image: url,
    })),
  ];
}

async function imageIdToDataUrl(id: string): Promise<string> {
  const obj = await storage.read(id);
  if (!obj) {
    throw new Error(`Image not found: ${id}`);
  }
  const b64 = obj.buffer.toString("base64");
  return `data:${obj.mimeType};base64,${b64}`;
}

/**
 * Strip the obvious noise out of fetched HTML before paying tokens for it.
 * We deliberately keep this minimal — the LLM is good at ignoring nav/ads
 * but `<script>` and `<style>` blobs are huge and pure waste. Anything
 * else (including JSON-LD `<script type="application/ld+json">`) is left
 * intact so the model can use it.
 *
 * Truncates to HTML_CHAR_BUDGET characters as a final cost guard.
 */
function trimHtmlForLlm(html: string): string {
  const cleaned = html
    // Drop <script>...</script> EXCEPT JSON-LD, which usually contains the
    // structured Recipe schema we'd love the model to read verbatim.
    .replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      (_match, attrs: string, body: string) => {
        if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) {
          return `<script${attrs}>${body}</script>`;
        }
        return "";
      },
    )
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= HTML_CHAR_BUDGET) return cleaned;
  return cleaned.slice(0, HTML_CHAR_BUDGET) + "\n<!-- truncated -->";
}
