import "server-only";

import {
  generateObject,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
  type LanguageModel,
  type UserContent,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { z } from "zod";

import {
  extractedRecipeSchema,
  extractedRecipeWireSchema,
  extractionIssuesWireSchema,
  type ExtractedRecipe,
  type ExtractionIssues,
} from "@/lib/validators";
import { storage } from "@/lib/storage";
import { computeCost, formatUsd, type CostBreakdown } from "@/lib/ai/pricing";
import { fetchRecipePage } from "@/lib/recipe-import/fetch";
import {
  issuesToDiscrepancies,
  type Discrepancy,
} from "@/lib/ai/discrepancies";
import { repairLlmJson } from "@/lib/ai/repair-json";

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
 * plus a list of mistakes a sequential audit pass found in it. Use
 * this from the API route — `cost` is the SUM of both calls so the
 * caller can charge / cap on a single number.
 *
 * `verificationFailed` means the audit pass errored or timed out and
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
// Gemini 3.1 Flash-Lite (GA May 2026) is dramatically faster than
// 2.5-flash for our use case — 6–8s on long blog URLs vs 25–55s, with
// equally good extraction quality. The lite tier also gets a much
// larger free-tier RPD than full 2.5-flash (which is currently
// throttled to 20 RPD on some accounts), so this is a substantial UX
// + quota win. Override per-deployment with `GOOGLE_MODEL` /
// `GOOGLE_URL_MODEL` if you want the slower but slightly stronger
// `gemini-2.5-flash` or `gemini-2.5-pro`.
const GOOGLE_IMAGE_MODEL = process.env.GOOGLE_MODEL ?? "gemini-3.1-flash-lite";
const GOOGLE_URL_MODEL =
  process.env.GOOGLE_URL_MODEL ?? "gemini-3.1-flash-lite";

// Model used for the SECOND (verification) pass. We deliberately pick a
// smaller/cheaper model than the primary so:
//   (a) it actually finishes within VERIFICATION_TIMEOUT_MS — the
//       primary URL pass on Gemini Flash routinely takes 15–30s, which
//       blew up our old 10s budget,
//   (b) the verifier reads the source independently of the primary's
//       biases (different size / training mix = independent failure
//       modes), which is the whole point of cross-checking.
// OpenAI: gpt-4o-mini is the established cheap counterpart.
// Google: gemini-3.1-flash-lite. We use the SAME model for primary
// and audit because (a) flash-lite is fast enough that the audit
// doesn't push us out of the user's latency budget even when both
// passes run sequentially, (b) using the same model keeps free-tier
// quota usage on a single bucket, (c) the lite tier's RPD is high
// enough that we don't burn through it in a normal day.
const OPENAI_VERIFY_MODEL =
  process.env.OPENAI_VERIFY_MODEL ?? "gpt-4o-mini";
const GOOGLE_VERIFY_MODEL =
  process.env.GOOGLE_VERIFY_MODEL ?? "gemini-3.1-flash-lite";

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

/**
 * Hard cap on how big a single structured response can grow. 8192 is
 * comfortably above what any real recipe needs (the worst Simply
 * Recipes / Sally's-Baking-Addiction outputs we've seen with notes
 * capture turned on land around 5-6K tokens). Setting this explicitly
 * does two things:
 *   1. Stops the model from silently truncating mid-JSON and emitting
 *      a fragment that won't parse — instead, the SDK signals "ran
 *      out of room" and we retry.
 *   2. Keeps cost bounded if a prompt accidentally invites the model
 *      to ramble.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Same model handle is used both for the primary extraction and for
 * the inline JSON-repair retry inside generateObjectResilient, so we
 * pass it through rather than re-resolving it from the env each time.
 */
type ResilientCallOptions<S extends z.ZodTypeAny> = {
  model: LanguageModel;
  schema: S;
  system: string;
  messages: Array<{ role: "user"; content: UserContent }>;
  /**
   * Total attempts including the first one. The first attempt does
   * the SDK's built-in `experimental_repairText` self-heal; subsequent
   * attempts start a brand-new call with a slightly tougher system
   * prompt. Defaults to 2.
   */
  maxAttempts?: number;
  /** Bytes/tokens cap. Defaults to MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /** For log lines. */
  label: string;
};

const RETRY_REMINDER = `

IMPORTANT: Your previous attempt did not return valid JSON matching the schema. Respond ONLY with the raw JSON object — no markdown code fences, no preamble, no trailing commentary. Every required field must be present.`;

/**
 * Wraps `generateObject` with two layers of protection against the
 * "the LLM forgot to emit valid JSON" failure mode:
 *
 *   1. Inline repair (single call, no extra latency in the happy
 *      path): the SDK's `experimental_repairText` hook runs our
 *      `repairLlmJson` helper when the model's first response fails
 *      JSON parsing or schema validation. That handles the most
 *      common Gemini Flash-Lite hiccup — wrapping the response in
 *      ```json ... ``` fences or adding "Here's your recipe:"
 *      preamble despite a strict responseSchema.
 *
 *   2. Whole-call retry (one extra latency penalty when triggered):
 *      if the repair pass STILL can't produce valid JSON, the SDK
 *      throws `NoObjectGeneratedError` / `JSONParseError` /
 *      `TypeValidationError`. We catch those and start a fresh call
 *      with a tougher reminder in the system prompt. Other errors
 *      (rate limits, network blips, model unavailable) re-throw so
 *      the caller can handle them appropriately — there's no point
 *      retrying a 429.
 *
 * Returns the same shape `generateObject` does. Throws if all
 * attempts are exhausted.
 */
async function generateObjectResilient<S extends z.ZodTypeAny>(
  opts: ResilientCallOptions<S>,
): Promise<{
  object: z.infer<S>;
  usage: Awaited<ReturnType<typeof generateObject>>["usage"];
}> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const system =
      attempt === 1 ? opts.system : `${opts.system}${RETRY_REMINDER}`;

    try {
      const result = await generateObject({
        model: opts.model,
        schema: opts.schema,
        system,
        messages: opts.messages,
        maxOutputTokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        // Run on every parse/validation failure before throwing. We
        // only attempt safe textual repairs (fences / preamble);
        // returning null gives up and lets the SDK throw, which our
        // outer loop then handles via a fresh call.
        experimental_repairText: async ({ text }) => repairLlmJson(text),
      });
      if (attempt > 1) {
        console.log(
          `[ai.${opts.label}] recovered on attempt ${attempt}/${maxAttempts}`,
        );
      }
      // The AI SDK's `object` type widens to `unknown`/`any` depending
      // on the schema shape; cast back to the inferred Zod output.
      return {
        object: result.object as z.infer<S>,
        usage: result.usage,
      };
    } catch (err) {
      lastError = err;
      const retryable =
        NoObjectGeneratedError.isInstance(err) ||
        JSONParseError.isInstance(err) ||
        TypeValidationError.isInstance(err);
      if (!retryable || attempt >= maxAttempts) throw err;
      console.warn(
        `[ai.${opts.label}] structured-output failure on attempt ${attempt}/${maxAttempts}; retrying. cause=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Short backoff. We're not throttle-bound here (this is a
      // schema-shape problem, not a rate-limit one), but a small
      // gap avoids hammering the provider in pathological cases.
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  throw lastError;
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
 * Verification-aware orchestrator: runs the primary extraction and
 * then, sequentially, an AUDIT pass that's shown both the original
 * source AND the primary's structured output, and asked to flag any
 * mistakes. Returns the primary result enriched with a typed
 * `discrepancies` list translated from the auditor's issue report,
 * plus the SUM of both calls' cost.
 *
 * Why sequential instead of two independent passes in parallel? We
 * tried parallel-and-diff first; the user prefers the auditor
 * mental model ("did the primary get this right?") because:
 *   (a) the verifier's output reads as "primary said X, source
 *       actually says Y" rather than "two AIs disagreed", which
 *       makes review-strip wording clearer;
 *   (b) the auditor only needs to emit DIFFs (the issues), not a
 *       fresh full re-extraction, so it runs against a smaller
 *       output budget and stays fast (~5–10s on flash-lite);
 *   (c) anchoring bias is real but the audit prompt mitigates by
 *       explicitly listing common failure modes (tsp↔tbsp, dropped
 *       finishing salt, swapped fractions) and telling the model to
 *       be paranoid.
 *
 * The audit pass uses a deliberately smaller model than the primary
 * (gpt-4o-mini on OpenAI; gemini-2.5-flash-lite on Google).
 *
 * Soft-fails on audit errors / timeouts — the primary result still
 * ships, just with `verificationFailed: true` and an empty
 * `discrepancies` array. We never block an import on a flaky audit.
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

  const primary = await runExtraction(userParts, primaryModel, input);

  // Audit only makes sense when the primary actually returned a
  // recipe. If primary bailed (no-recipe), there's nothing to audit;
  // emit the unchanged no-recipe result with no discrepancies.
  if (primary.kind !== "ok") {
    return {
      ...primary,
      primaryCost: primary.cost,
      verificationCost: null,
      verificationFailed: false,
      discrepancies: [],
    };
  }

  // Race the audit call against a hard timeout so a slow second pass
  // can't hold the whole import hostage. Throw / timeout both
  // soft-fail to `verificationFailed: true` with an empty discrepancy
  // list — the primary still ships.
  const auditPromise = withTimeout(
    runAuditPass(userParts, verifyModel, primary.recipe, input).catch(
      (err): AuditResult & { __failed: true } => {
        // Surface the upstream error in server logs so we can debug
        // schema-validation / rate-limit / quota failures without
        // the user seeing anything but the soft-fail banner.
        console.warn(
          `[ai.audit] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          issues: { looksCorrect: true, ingredientIssues: [], stepIssues: [] },
          cost: zeroCost(verifyModel),
          __failed: true,
        };
      },
    ),
    VERIFICATION_TIMEOUT_MS,
  );

  const auditOrTimeout = await auditPromise;

  let verifyCost: CostBreakdown | null = null;
  let verifyFailed = false;
  let discrepancies: Discrepancy[] = [];

  if (auditOrTimeout === TIMEOUT_SENTINEL) {
    verifyFailed = true;
  } else if ("__failed" in auditOrTimeout) {
    verifyFailed = true;
    // We never heard back, so audit cost is zero — don't bill for it.
  } else {
    verifyCost = auditOrTimeout.cost;
    discrepancies = issuesToDiscrepancies(auditOrTimeout.issues, primary.recipe);
  }

  const totalCost = sumCost(primary.cost, verifyCost);

  return {
    ...primary,
    cost: totalCost,
    primaryCost: primary.cost,
    verificationCost: verifyCost,
    verificationFailed: verifyFailed,
    discrepancies,
  };
}

/**
 * One audit-pass LLM call. Shown the SAME source content the primary
 * saw, plus the primary's structured recipe rendered as JSON, plus
 * the audit system prompt that lists common failure modes the model
 * should look for. Returns a typed issues object + cost.
 */
type AuditResult = {
  issues: ExtractionIssues;
  cost: CostBreakdown;
};

async function runAuditPass(
  primaryUserParts: UserContent,
  model: string,
  primaryRecipe: ExtractedRecipe,
  input: ExtractInput,
): Promise<AuditResult> {
  const provider = aiProvider();
  const auditParts = buildAuditUserContent(primaryUserParts, primaryRecipe);

  const startedAt = Date.now();
  const { object, usage } = await generateObjectResilient({
    model: modelHandle(provider, model),
    schema: extractionIssuesWireSchema,
    system: AUDIT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: auditParts }],
    label: "audit",
  });
  const elapsedMs = Date.now() - startedAt;

  const cost = computeCost(model, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens,
  });

  const totalIssues =
    object.ingredientIssues.length + object.stepIssues.length;
  console.log(
    `[ai.audit] provider=${provider} model=${model} kind=${input.kind} ` +
      `looksCorrect=${object.looksCorrect} issues=${totalIssues} ` +
      `tokens=${cost.inputTokens}+${cost.outputTokens}=${cost.inputTokens + cost.outputTokens} ` +
      `cost=${formatUsd(cost.totalCost)} ` +
      `latency=${(elapsedMs / 1000).toFixed(2)}s`,
  );

  return { issues: object, cost };
}

/**
 * Build the audit pass's user content: the source content the primary
 * saw (HTML text part for URLs, image parts for photos), plus a final
 * text block describing the primary's extracted recipe as JSON and
 * asking the model to audit it.
 */
function buildAuditUserContent(
  primaryUserParts: UserContent,
  primaryRecipe: ExtractedRecipe,
): UserContent {
  // The first user-content part of an extraction is always a text
  // intro ("Here is a photo of a recipe..." or "The user wants to
  // import a recipe from this page..."). Drop that and keep the
  // payload (HTML body or image attachments), then append the audit
  // intro + primary recipe JSON.
  const sourceParts = Array.isArray(primaryUserParts)
    ? primaryUserParts.slice(1)
    : [];

  const recipeJson = JSON.stringify(
    {
      title: primaryRecipe.title,
      description: primaryRecipe.description ?? null,
      notes: primaryRecipe.notes ?? null,
      prepMinutes: primaryRecipe.prepMinutes ?? null,
      cookMinutes: primaryRecipe.cookMinutes ?? null,
      servings: primaryRecipe.servings ?? null,
      mealType: primaryRecipe.mealType ?? null,
      cuisine: primaryRecipe.cuisine ?? null,
      ingredients: primaryRecipe.ingredients.map((ing, i) => ({
        index: i,
        quantity: ing.quantity ?? null,
        unit: ing.unit ?? null,
        name: ing.name,
        note: ing.note ?? null,
      })),
      steps: primaryRecipe.steps.map((s, i) => ({
        index: i,
        body: s.body,
      })),
    },
    null,
    2,
  );

  return [
    {
      type: "text" as const,
      text:
        "Below is the SOURCE the previous extractor read (HTML page or photos). After it, you'll see the EXTRACTED recipe that extractor produced. Your job is to audit the extracted recipe against the source and report any mistakes.",
    },
    ...sourceParts,
    {
      type: "text" as const,
      text:
        `EXTRACTED RECIPE (in JSON, indices match arrays):\n\n${recipeJson}\n\n` +
        `Now compare it against the source above and emit a structured list of issues. ` +
        `Be paranoid about quantity/unit mismatches — those are the most common AI mistakes ` +
        `and the most likely to ruin a dish. If the extraction looks correct, set ` +
        `"looksCorrect": true and return empty arrays.`,
    },
  ];
}

const AUDIT_SYSTEM_PROMPT = `You are a recipe extraction auditor. A previous AI agent has extracted a structured recipe from a source (a webpage's HTML or a photo). Your job is to compare the agent's output against the source and find mistakes.

Common mistakes the previous extractor makes (be paranoid about these):
- Misreading "tsp" as "tbsp" or vice versa (the single most common safety-critical error).
- Swapping fractions: 1/2 ↔ 1/4, 1/3 ↔ 3/4, etc.
- Confusing similar units: cup vs c., lb vs lbs, oz (weight) vs fl oz (volume).
- Dropping a small ingredient: a pinch of salt, sea salt for finishing, a pat of butter, a splash of lemon.
- Misreading numbers in handwriting: 3 ↔ 8, 6 ↔ 9.
- Merging two steps into one (or splitting one step into two).
- Slight rewordings of steps that lose a constraint (e.g. "until golden" becoming just "until done").
- Hallucinating an ingredient or step that isn't in the source.

For each mistake, emit a structured issue:
- For a wrong ingredient field, use kind "wrong_quantity" / "wrong_unit" / "wrong_name", reference the ingredient by its primaryIndex (the "index" field in the EXTRACTED recipe), and put what the source ACTUALLY says into the corrected* fields.
- For an ingredient the previous extractor hallucinated, use kind "should_be_removed" with primaryIndex pointing to the bogus row.
- For an ingredient in the source the previous extractor MISSED, use kind "missing" with primaryIndex=null, and put the full corrected ingredient into the corrected* fields.
- Same scheme for steps: text_wrong / should_be_removed / missing.

Rules:
- Only flag mistakes you can support by re-reading the source. Don't speculate.
- Don't flag cosmetic differences (capitalization, ordering of equivalent phrasing, trailing punctuation, "tablespoons" vs "tbsp" when both are unambiguous).
- "reason" should be a one-sentence explanation grounded in the source — quote the source if helpful.
- If everything looks correct, set "looksCorrect": true and return empty arrays. Don't invent issues to fill space.`;

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
  const { object, usage } = await generateObjectResilient({
    model: modelHandle(provider, model),
    schema: extractedRecipeWireSchema,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userParts }],
    label: "extract",
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
