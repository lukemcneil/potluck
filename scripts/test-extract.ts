/**
 * End-to-end smoke test for the recipe-image -> AI -> structured-recipe
 * pipeline. No HTTP server, no auth, no client. Generates a realistic
 * recipe-card image with sharp, writes it to data/uploads/, then calls
 * the same `extractRecipe()` function the /api/extract endpoint uses.
 *
 *   pnpm test:extract
 *
 * Requires OPENAI_API_KEY in .env.local.
 *
 * Optionally pass a path to an existing recipe image (jpg/png/heic):
 *   pnpm test:extract path/to/recipe.jpg
 *
 * Or pass a recipe URL to exercise the URL-import path (HTML fetched
 * server-side and handed to the model):
 *   pnpm test:extract https://www.example.com/some-recipe
 *
 * Or run a negative test with a synthetic non-recipe image to verify
 * the model returns notARecipe=true:
 *   pnpm test:extract --no-recipe-image
 */

// Load .env.local first (Next.js convention for local-only secrets),
// then fall back to .env. `tsx` scripts don't get Next's env loader so
// we have to do this ourselves.
import * as dotenv from "dotenv";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

import { storage } from "../lib/storage";
import {
  aiProvider,
  extractRecipe,
  extractAndVerifyRecipe,
} from "../lib/ai/extract-recipe";
import {
  findPageImageUrls,
  importPageImages,
} from "../lib/recipe-import/images";
import { fetchRecipePage } from "../lib/recipe-import/fetch";

async function main() {
  const provider = aiProvider();
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    console.error(
      "AI_PROVIDER=openai but OPENAI_API_KEY isn't set. Either set it or switch to AI_PROVIDER=google.",
    );
    process.exit(1);
  }
  if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error(
      "AI_PROVIDER=google but GOOGLE_GENERATIVE_AI_API_KEY isn't set. Get a free key at https://aistudio.google.com/apikey.",
    );
    process.exit(1);
  }

  // `--verify` flag exercises extractAndVerifyRecipe (primary + second
  // pass + discrepancy diff) instead of the plain single-pass
  // extractRecipe. Lets us smoke-test that the verification model and
  // 30 s timeout actually fit together in practice.
  const args = process.argv.slice(2);
  const withVerify = args.includes("--verify");
  const arg = args.find((a) => a !== "--verify");

  // URL mode: skip the image pipeline entirely and exercise the
  // server-side HTML fetch -> LLM extraction path.
  if (arg && /^https?:\/\//i.test(arg)) {
    await runUrlMode(arg, withVerify);
    return;
  }

  // Negative-test mode: render an obviously-not-a-recipe image (a fake
  // email screenshot) and verify the model returns notARecipe=true.
  const isNoRecipeMode = arg === "--no-recipe-image";
  const customPath = isNoRecipeMode ? undefined : arg;

  let imageBuffer: Buffer;
  let mimeType: string;
  let ext: string;
  let label: string;

  if (isNoRecipeMode) {
    imageBuffer = await renderSyntheticNonRecipeImage();
    mimeType = "image/jpeg";
    ext = "jpg";
    label = "synthetic non-recipe image (fake email screenshot)";
  } else if (customPath) {
    const abs = path.resolve(customPath);
    imageBuffer = await fs.readFile(abs);
    const fileExt = path.extname(abs).toLowerCase().replace(/^\./, "");
    ext = fileExt || "jpg";
    mimeType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "heic"
            ? "image/heic"
            : "image/jpeg";
    label = `provided file ${path.basename(abs)}`;
  } else {
    imageBuffer = await renderSyntheticRecipeCard();
    mimeType = "image/jpeg";
    ext = "jpg";
    label = "synthetic recipe-card image";
  }

  console.log(`\n→ Using ${label} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

  // Put it through the same Storage adapter the /api/upload route uses.
  const stored = await storage.put({
    buffer: imageBuffer,
    mimeType,
    ext,
  });
  console.log(`→ Saved to disk: ${stored.publicPath} (id: ${stored.id})`);

  console.log(
    `→ Calling ${withVerify ? "extractAndVerifyRecipe()" : "extractRecipe()"} on the image...\n`,
  );
  const startedAt = Date.now();
  const result = withVerify
    ? await extractAndVerifyRecipe({ kind: "imageIds", imageIds: [stored.id] })
    : await extractRecipe({ kind: "imageIds", imageIds: [stored.id] });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`✓ Got result in ${elapsed}s\n`);
  console.log("---- COST ----");
  console.log({
    model: result.cost.modelId,
    inputTokens: result.cost.inputTokens,
    outputTokens: result.cost.outputTokens,
    cachedInputTokens: result.cost.cachedInputTokens,
    totalUsd: round(result.cost.totalCost, 6),
  });

  if (withVerify) {
    const v = result as Awaited<
      ReturnType<typeof extractAndVerifyRecipe>
    >;
    console.log("\n---- VERIFICATION ----");
    console.log({
      verificationFailed: v.verificationFailed,
      discrepancyCount: v.discrepancies.length,
      primaryCostUsd: round(v.primaryCost.totalCost, 6),
      verificationCostUsd:
        v.verificationCost == null
          ? null
          : round(v.verificationCost.totalCost, 6),
    });
  }

  if (result.kind === "no-recipe") {
    console.log("\n---- OUTCOME ----");
    console.log(`NO RECIPE FOUND`);
    console.log(`Reason: ${result.reason}`);
    if (isNoRecipeMode) {
      console.log(`\n→ Negative-test sanity check: PASS (model correctly bailed).`);
    } else if (!customPath) {
      console.log(`\n→ Synthetic test sanity check: FAIL (expected a recipe).`);
      process.exitCode = 1;
    }
    return;
  }

  if (isNoRecipeMode) {
    console.log(
      `\n→ Negative-test sanity check: FAIL (model invented a recipe from a non-recipe image).`,
    );
    process.exitCode = 1;
  }

  const recipe = result.recipe;
  console.log("\n---- TITLE ----");
  console.log(recipe.title);
  if (recipe.description) {
    console.log("\n---- DESCRIPTION ----");
    console.log(recipe.description);
  }
  console.log("\n---- META ----");
  console.log({
    prepMinutes: recipe.prepMinutes ?? null,
    cookMinutes: recipe.cookMinutes ?? null,
    servings: recipe.servings ?? null,
    mealType: recipe.mealType ?? null,
    cuisine: recipe.cuisine ?? null,
    diets: recipe.suggestedDiets ?? [],
    tags: recipe.suggestedTags ?? [],
  });
  console.log("\n---- INGREDIENTS ----");
  for (const ing of recipe.ingredients) {
    const head = [ing.quantity, ing.unit].filter(Boolean).join(" ");
    const note = ing.note ? `, ${ing.note}` : "";
    console.log(`  • ${head ? `${head} ` : ""}${ing.name}${note}`);
  }
  console.log("\n---- STEPS ----");
  recipe.steps.forEach((s, i) =>
    console.log(`  ${i + 1}. [${s.confidence}] ${s.body}`),
  );

  // Sanity-check: a synthetic recipe card mentions "Roasted Tomato Soup"
  // by design. Surface a friendly pass/fail indicator without being
  // strict (the model occasionally rephrases the title).
  if (!customPath) {
    const titleOk = /tomato/i.test(recipe.title);
    const ingredientsOk = recipe.ingredients.length >= 5;
    const stepsOk = recipe.steps.length >= 3;
    console.log(`\n→ Synthetic test sanity check:`);
    console.log(`    title contains "tomato":      ${titleOk ? "PASS" : "FAIL"}`);
    console.log(`    ≥ 5 ingredients (${recipe.ingredients.length}):              ${ingredientsOk ? "PASS" : "FAIL"}`);
    console.log(`    ≥ 3 steps (${recipe.steps.length}):                       ${stepsOk ? "PASS" : "FAIL"}`);
    if (!titleOk || !ingredientsOk || !stepsOk) process.exitCode = 1;
  }
}

async function runUrlMode(url: string, withVerify = false) {
  console.log(`\n→ Importing recipe from URL: ${url}`);
  console.log(
    `→ Fetching HTML server-side and calling ${withVerify ? "extractAndVerifyRecipe()" : "extractRecipe()"}...\n`,
  );

  // Page-image discovery: parse the HTML for og:image / JSON-LD
  // Recipe.image hints WITHOUT actually downloading them. This is the
  // cheap, fast piece of the importer — useful smoke check that's
  // independent of the LLM call. We do this BEFORE timing the AI so
  // its latency doesn't dirty the wall-clock number printed for the
  // extraction.
  try {
    const page = await fetchRecipePage(url);
    const hints = findPageImageUrls(page.html, page.finalUrl);
    console.log(`---- PAGE IMAGES (hints) ----`);
    if (hints.length === 0) {
      console.log("(no og:image or Recipe.image found — importer will return empty)");
    } else {
      for (const h of hints) console.log(`  • ${h}`);
    }
    console.log();
  } catch (err) {
    console.log(
      `(image hint scan failed: ${err instanceof Error ? err.message : "unknown"})\n`,
    );
  }

  const startedAt = Date.now();
  const [result, importedPhotos] = await Promise.all([
    withVerify
      ? extractAndVerifyRecipe({ kind: "url", url })
      : extractRecipe({ kind: "url", url }),
    // Run the real download/normalize/store path in parallel so we
    // also measure the importer end-to-end. It's best-effort so we
    // just log whatever comes back.
    importPageImages(url).catch(() => []),
  ]);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (importedPhotos.length > 0) {
    console.log(`---- IMPORTED PHOTOS (${importedPhotos.length}) ----`);
    for (const p of importedPhotos) {
      console.log(`  • ${p.publicPath} (${p.width}×${p.height})`);
    }
    console.log();
  } else {
    console.log(`---- IMPORTED PHOTOS ----\n(none — see hints above for why)\n`);
  }

  console.log(`✓ Got result in ${elapsed}s\n`);
  console.log("---- COST ----");
  console.log({
    model: result.cost.modelId,
    inputTokens: result.cost.inputTokens,
    outputTokens: result.cost.outputTokens,
    cachedInputTokens: result.cost.cachedInputTokens,
    totalUsd: round(result.cost.totalCost, 6),
  });

  if (withVerify) {
    // The branch is `extractAndVerifyRecipe` → result is the
    // verification-aware union. Cast to that here so we get typed
    // access to the extra fields without leaking the parameter type
    // pollution into the non-verify branch above.
    const v = result as Awaited<
      ReturnType<typeof extractAndVerifyRecipe>
    >;
    console.log("\n---- VERIFICATION ----");
    console.log({
      verificationFailed: v.verificationFailed,
      discrepancyCount: v.discrepancies.length,
      primaryCostUsd: round(v.primaryCost.totalCost, 6),
      verificationCostUsd:
        v.verificationCost == null
          ? null
          : round(v.verificationCost.totalCost, 6),
    });
    if (v.discrepancies.length > 0) {
      for (const d of v.discrepancies) {
        console.log(`  - ${d.kind}${"reason" in d ? `: ${d.reason}` : ""}`);
      }
    }
  }

  if (result.kind === "no-recipe") {
    console.log("\n---- OUTCOME ----");
    console.log("NO RECIPE FOUND");
    console.log(`Reason: ${result.reason}`);
    return;
  }

  const recipe = result.recipe;
  console.log("\n---- TITLE ----");
  console.log(recipe.title);
  if (recipe.description) {
    console.log("\n---- DESCRIPTION ----");
    console.log(recipe.description);
  }
  if (recipe.notes) {
    console.log("\n---- NOTES ----");
    console.log(recipe.notes);
  }
  console.log("\n---- META ----");
  console.log({
    prepMinutes: recipe.prepMinutes ?? null,
    cookMinutes: recipe.cookMinutes ?? null,
    servings: recipe.servings ?? null,
    mealType: recipe.mealType ?? null,
    cuisine: recipe.cuisine ?? null,
    diets: recipe.suggestedDiets ?? [],
    tags: recipe.suggestedTags ?? [],
  });
  console.log("\n---- INGREDIENTS ----");
  for (const ing of recipe.ingredients) {
    const head = [ing.quantity, ing.unit].filter(Boolean).join(" ");
    const note = ing.note ? `, ${ing.note}` : "";
    console.log(`  • ${head ? `${head} ` : ""}${ing.name}${note}`);
  }
  console.log("\n---- STEPS ----");
  recipe.steps.forEach((s, i) =>
    console.log(`  ${i + 1}. [${s.confidence}] ${s.body}`),
  );
}

/**
 * Builds a 1200x1600 cream-colored "recipe card" via SVG and rasterizes it
 * to JPEG. The text is unambiguous so we can verify the round-trip.
 */
async function renderSyntheticRecipeCard(): Promise<Buffer> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#FAF6EF" />
  <rect x="40" y="40" width="1120" height="1520" fill="none" stroke="#C2462C" stroke-width="3" />
  <text x="600" y="160" font-family="Georgia, serif" font-size="64" fill="#9C2A0E" text-anchor="middle" font-style="italic">Roasted Tomato Soup</text>
  <text x="600" y="220" font-family="Georgia, serif" font-size="24" fill="#6B3410" text-anchor="middle">A cozy autumn classic — serves 4</text>

  <text x="600" y="280" font-family="Georgia, serif" font-size="22" fill="#6B3410" text-anchor="middle">Prep 15 min   |   Cook 35 min   |   Servings 4</text>

  <text x="100" y="370" font-family="Georgia, serif" font-size="36" fill="#9C2A0E" font-style="italic">Ingredients</text>
  <text x="120" y="430" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">3 lbs ripe tomatoes, halved</text>
  <text x="120" y="470" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">1 yellow onion, quartered</text>
  <text x="120" y="510" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">4 cloves garlic, peeled</text>
  <text x="120" y="550" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">3 tbsp olive oil</text>
  <text x="120" y="590" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">1 tsp kosher salt</text>
  <text x="120" y="630" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">1/2 tsp black pepper</text>
  <text x="120" y="670" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">2 cups vegetable broth</text>
  <text x="120" y="710" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">1/4 cup heavy cream</text>
  <text x="120" y="750" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#3A2C20">1/4 cup fresh basil leaves, plus more for garnish</text>

  <text x="100" y="850" font-family="Georgia, serif" font-size="36" fill="#9C2A0E" font-style="italic">Method</text>
  <text x="120" y="910" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">1. Preheat oven to 425°F. Toss tomatoes, onion, and garlic with</text>
  <text x="120" y="940" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">   olive oil, salt, and pepper on a sheet pan.</text>
  <text x="120" y="990" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">2. Roast 30-35 minutes until everything is jammy and lightly</text>
  <text x="120" y="1020" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">   charred at the edges.</text>
  <text x="120" y="1070" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">3. Transfer to a blender with broth and basil. Blend until smooth.</text>
  <text x="120" y="1120" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">4. Return to a pot, stir in cream, and warm over medium heat for</text>
  <text x="120" y="1150" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">   3-4 minutes. Taste and adjust salt.</text>
  <text x="120" y="1200" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#3A2C20">5. Ladle into bowls and top with extra basil. Serve with crusty bread.</text>

  <text x="600" y="1500" font-family="Georgia, serif" font-size="20" fill="#9C2A0E" text-anchor="middle" font-style="italic">— from the Potluck test kitchen —</text>
</svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Renders an SVG that visually resembles an email/forum screenshot — no
 * ingredients or instructions in sight. Used to verify the "no recipe
 * found" guardrail. We deliberately avoid food words.
 */
async function renderSyntheticNonRecipeImage(): Promise<Buffer> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#FFFFFF" />
  <rect x="0" y="0" width="1200" height="80" fill="#E8EAED" />
  <text x="40" y="50" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#202124" font-weight="bold">Inbox — Personal</text>

  <text x="40" y="140" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124" font-weight="bold">From: Sarah Chen &lt;sarah@example.com&gt;</text>
  <text x="40" y="172" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#5F6368">To: me</text>
  <text x="40" y="200" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#5F6368">Subject: Quarterly planning notes</text>

  <line x1="40" y1="230" x2="1160" y2="230" stroke="#DADCE0" stroke-width="1" />

  <text x="40" y="280" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">Hi team,</text>
  <text x="40" y="320" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">Just confirming the agenda for Thursday's meeting. We'll review</text>
  <text x="40" y="350" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">the deck, walk through Q3 numbers, and sync on hiring plans.</text>
  <text x="40" y="400" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">Please reply with any topics you'd like to add.</text>

  <text x="40" y="460" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">Thanks,</text>
  <text x="40" y="490" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#202124">Sarah</text>

  <text x="40" y="600" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#9AA0A6">Sent from my computer</text>
</svg>
  `;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

main().catch((err) => {
  console.error("\n✗ Test failed:");
  console.error(err);
  process.exit(1);
});
