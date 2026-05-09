import "server-only";

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

import {
  extractedRecipeSchema,
  type ExtractedRecipe,
} from "@/lib/validators";
import { storage } from "@/lib/storage";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

const SYSTEM_PROMPT = `You are a careful recipe transcription assistant.
You convert photos and webpages into clean, structured recipes.

Rules:
- Combine information across all provided images: a multi-page recipe may span them.
- Preserve quantities exactly as written (fractions like "1 1/2" stay as text).
- Split each ingredient into quantity, unit, name, and an optional note (e.g. "sifted", "chopped").
- Steps must be ordered, action-oriented sentences. Do not number them — that's done by the UI.
- If a value is unknown, omit it. Do not invent times, servings, or ingredients.
- For mealType, choose ONE of: breakfast, brunch, lunch, dinner, appetizer, side, dessert, snack, drink.
- Cuisine should be a short common label like "italian" or "thai" if obvious; otherwise omit.
- For diets, only include labels you can confidently infer: vegetarian, vegan, gluten-free, dairy-free, nut-free, keto, paleo, low-carb, pescatarian.
- Tags are 1-2 word lowercase descriptors useful for filtering (e.g. "weeknight", "one-pan", "make-ahead").`;

export type ExtractInput =
  | { kind: "imageIds"; imageIds: string[] }
  | { kind: "imageDataUrls"; imageDataUrls: string[] }
  | { kind: "url"; url: string };

/**
 * Extract a structured recipe from a set of images (by stored id) or a URL.
 * Throws if OPENAI_API_KEY is missing.
 */
export async function extractRecipe(input: ExtractInput): Promise<ExtractedRecipe> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local before using recipe extraction.",
    );
  }

  const userParts = await buildUserContent(input);

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: extractedRecipeSchema,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userParts }],
  });

  return object;
}

async function buildUserContent(input: ExtractInput) {
  if (input.kind === "url") {
    return [
      {
        type: "text" as const,
        text: `Fetch and parse the recipe at this URL: ${input.url}\n\nIf the page is a recipe, extract it. If it links to multiple recipes, pick the primary one.`,
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
