import "server-only";

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

import {
  extractedRecipeSchema,
  extractedRecipeWireSchema,
  type ExtractedRecipe,
} from "@/lib/validators";
import { storage } from "@/lib/storage";
import { computeCost, formatUsd, type CostBreakdown } from "@/lib/ai/pricing";
import { fetchRecipePage } from "@/lib/recipe-import/fetch";

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

// Image extraction needs vision and benefits from gpt-4o's stronger
// OCR / layout understanding. URL extraction is just text on text, so
// gpt-4o-mini is ~17x cheaper and good enough.
const IMAGE_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
const URL_MODEL = process.env.OPENAI_URL_MODEL ?? "gpt-4o-mini";

function modelFor(kind: ExtractInput["kind"]): string {
  return kind === "url" ? URL_MODEL : IMAGE_MODEL;
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
- Tags are 1-2 word lowercase descriptors useful for filtering (e.g. "weeknight", "one-pan", "make-ahead").`;

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
 * Throws if OPENAI_API_KEY is missing or the upstream HTTP call fails.
 */
export async function extractRecipe(input: ExtractInput): Promise<ExtractResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local before using recipe extraction.",
    );
  }

  const userParts = await buildUserContent(input);
  const imageCount =
    input.kind === "imageIds"
      ? input.imageIds.length
      : input.kind === "imageDataUrls"
        ? input.imageDataUrls.length
        : 0;

  const model = modelFor(input.kind);
  const startedAt = Date.now();
  const { object, usage } = await generateObject({
    model: openai(model),
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

  // The model can either say "this isn't a recipe" via the discriminator
  // or, occasionally, claim it's a recipe but produce an empty/sparse
  // body. Treat both as no-recipe so the caller has a single failure
  // mode to handle.
  const looksEmpty =
    !object.title.trim() ||
    object.ingredients.length === 0 ||
    object.steps.length === 0;
  const isNoRecipe = object.notARecipe || looksEmpty;
  const outcome = isNoRecipe ? "no-recipe" : "ok";

  console.log(
    `[ai.extract] model=${model} kind=${input.kind} images=${imageCount} ` +
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

  // Re-validate against the stricter content schema. If this throws
  // it means the model claimed `notARecipe=false` AND filled in
  // title/ingredients/steps, but something else (e.g. a 0-character
  // ingredient name) tripped a constraint — treat it as no-recipe.
  const parsed = extractedRecipeSchema.safeParse({
    title: object.title,
    description: object.description,
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
  if (!parsed.success) {
    return {
      kind: "no-recipe",
      reason: "Extracted recipe was malformed; please try again or type it in.",
      cost,
    };
  }
  return { kind: "ok", recipe: parsed.data, cost };
}

async function buildUserContent(input: ExtractInput) {
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
