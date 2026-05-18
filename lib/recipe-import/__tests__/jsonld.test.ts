import { describe, expect, it, vi } from "vitest";

// `lib/recipe-import/jsonld.ts` is marked "server-only" so the
// import would fail in node-test environments; this mock no-ops it
// the same way the sibling images.test.ts does.
vi.mock("server-only", () => ({}));

import {
  findJsonLdRecipe,
  formatJsonLdAsText,
  stripTags,
} from "../jsonld";

/**
 * Wrap a raw JSON object in the canonical Yoast-flavored
 * `<script type="application/ld+json">…</script>` block so tests can
 * feed it through `findJsonLdRecipe` the same way the live HTML path
 * would.
 */
function wrapLd(obj: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

const SIMPLE_RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Banana Bread",
  description: "A warm family classic.",
  recipeIngredient: ["3 ripe bananas, mashed", "1/2 cup butter, melted"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mash bananas." },
    { "@type": "HowToStep", text: "Mix dry and wet." },
    { "@type": "HowToStep", text: "Bake at 350F for 1 hour." },
  ],
  prepTime: "PT10M",
  cookTime: "PT1H",
  totalTime: "PT1H10M",
  recipeYield: "1 loaf",
  recipeCategory: "Dessert",
  recipeCuisine: "American",
  keywords: "banana bread, make-ahead",
};

describe("findJsonLdRecipe", () => {
  it("returns null when no JSON-LD blocks are present", () => {
    expect(findJsonLdRecipe("<html><body>no schema here</body></html>")).toBe(
      null,
    );
  });

  it("returns null when JSON-LD is present but no Recipe node", () => {
    const html = wrapLd({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Some page",
    });
    expect(findJsonLdRecipe(html)).toBe(null);
  });

  it("extracts a top-level Recipe node", () => {
    const r = findJsonLdRecipe(wrapLd(SIMPLE_RECIPE));
    expect(r).not.toBeNull();
    expect(r?.name).toBe("Banana Bread");
    expect(r?.ingredients).toHaveLength(2);
    expect(r?.instructions).toHaveLength(3);
    expect(r?.prepTime).toBe("PT10M");
    expect(r?.cookTime).toBe("PT1H");
    expect(r?.totalTime).toBe("PT1H10M");
    expect(r?.yield).toBe("1 loaf");
    expect(r?.category).toBe("Dessert");
    expect(r?.cuisine).toBe("American");
    expect(r?.keywords).toEqual(["banana bread", "make-ahead"]);
  });

  it("unwraps a @graph-bundled Recipe (Yoast / RankMath shape)", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "Page" },
          { "@type": "BreadcrumbList", itemListElement: [] },
          SIMPLE_RECIPE,
        ],
      }),
    );
    expect(r?.name).toBe("Banana Bread");
    expect(r?.ingredients.length).toBe(2);
  });

  it("handles @type as an array containing 'Recipe'", () => {
    const r = findJsonLdRecipe(
      wrapLd({ ...SIMPLE_RECIPE, "@type": ["Recipe", "HowTo"] }),
    );
    expect(r?.name).toBe("Banana Bread");
  });

  it("returns null when the Recipe has a name but no ingredients or instructions", () => {
    // Pages sometimes tag an About section as Recipe — useless to us.
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "About this dish",
        description: "Nothing actionable here.",
      }),
    );
    expect(r).toBe(null);
  });

  it("accepts a Recipe with only ingredients (no instructions)", () => {
    // Mirrors the "ingredients-only" relaxation we just shipped on
    // the extraction path. Some pages legitimately have ingredient
    // lists without method.
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Ingredient list only",
        recipeIngredient: ["1 cup flour", "2 eggs"],
      }),
    );
    expect(r?.name).toBe("Ingredient list only");
    expect(r?.ingredients).toEqual(["1 cup flour", "2 eggs"]);
    expect(r?.instructions).toEqual([]);
  });

  it("accepts string-only instructions (newline-split)", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Quick blurb",
        recipeIngredient: ["1 tsp salt"],
        recipeInstructions:
          "Preheat oven to 350F.\nMix everything.\nBake for 30 minutes.",
      }),
    );
    expect(r?.instructions).toEqual([
      "Preheat oven to 350F.",
      "Mix everything.",
      "Bake for 30 minutes.",
    ]);
  });

  it("accepts an array of plain-string instructions", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Array-string steps",
        recipeIngredient: ["1 cup x"],
        recipeInstructions: ["Step one.", "Step two."],
      }),
    );
    expect(r?.instructions).toEqual(["Step one.", "Step two."]);
  });

  it("flattens HowToSection-wrapped instructions and tags steps with their section", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Sectioned bake",
        recipeIngredient: ["x"],
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "For the dough",
            itemListElement: [
              { "@type": "HowToStep", text: "Mix flour and water." },
              { "@type": "HowToStep", text: "Knead until smooth." },
            ],
          },
          {
            "@type": "HowToSection",
            name: "For the filling",
            itemListElement: [
              { "@type": "HowToStep", text: "Cook the apples." },
            ],
          },
        ],
      }),
    );
    // Every step inside a section carries the section label so the
    // LLM can preserve the recipe's section structure (or flatten it
    // intelligently). The verbosity is worth it — losing the section
    // boundary would conflate "knead the dough" with "cook the
    // apples" if the LLM tries to dedupe similar verbs.
    expect(r?.instructions).toEqual([
      "[For the dough] Mix flour and water.",
      "[For the dough] Knead until smooth.",
      "[For the filling] Cook the apples.",
    ]);
  });

  it("falls back to HowToStep.name when text is missing", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "name-fallback",
        recipeIngredient: ["x"],
        recipeInstructions: [
          { "@type": "HowToStep", name: "Just the heading." },
        ],
      }),
    );
    expect(r?.instructions).toEqual(["Just the heading."]);
  });

  it("strips HTML tags out of ingredient and instruction text", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Tag soup",
        recipeIngredient: [
          '<a href="#">1 cup</a> <strong>flour</strong>',
          "1 tsp <em>kosher</em> salt",
        ],
        recipeInstructions: [
          {
            "@type": "HowToStep",
            text: "Preheat <strong>oven</strong> to 350°F.<br>Mix together.",
          },
        ],
      }),
    );
    expect(r?.ingredients).toEqual([
      "1 cup flour",
      "1 tsp kosher salt",
    ]);
    expect(r?.instructions[0]).toMatch(/Preheat oven to 350°F\.\s*Mix together\./);
  });

  it("decodes common HTML entities including &frac12;", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Entities",
        recipeIngredient: ["&frac12; cup &amp; some flour"],
      }),
    );
    expect(r?.ingredients).toEqual(["1/2 cup & some flour"]);
  });

  it("accepts recipeYield as an array (takes the first usable string)", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        ...SIMPLE_RECIPE,
        recipeYield: ["12", "12 servings"],
      }),
    );
    expect(r?.yield).toBe("12");
  });

  it("accepts keywords as an array of strings", () => {
    const r = findJsonLdRecipe(
      wrapLd({ ...SIMPLE_RECIPE, keywords: ["quick", "vegan", "weeknight"] }),
    );
    expect(r?.keywords).toEqual(["quick", "vegan", "weeknight"]);
  });

  it("silently skips malformed JSON-LD blocks but uses a later valid one", () => {
    const html = `<html><head>
<script type="application/ld+json">{ not valid json }</script>
<script type="application/ld+json">${JSON.stringify(SIMPLE_RECIPE)}</script>
</head></html>`;
    const r = findJsonLdRecipe(html);
    expect(r?.name).toBe("Banana Bread");
  });

  it("ignores Recipe nodes nested deep in arbitrary @graph trees", () => {
    // Defensive: some sites bury the Recipe several layers down.
    const r = findJsonLdRecipe(
      wrapLd({
        "@graph": [
          { "@type": "WebSite" },
          {
            "@graph": [SIMPLE_RECIPE],
          },
        ],
      }),
    );
    expect(r?.name).toBe("Banana Bread");
  });

  it("schema.org's textual `value`/`name` wrapper on ingredient items is unwrapped", () => {
    const r = findJsonLdRecipe(
      wrapLd({
        "@type": "Recipe",
        name: "Object-wrapped ingredients",
        recipeIngredient: [
          { "@type": "Text", value: "1 cup flour" },
          { name: "2 eggs" },
        ],
        recipeInstructions: ["Mix."],
      }),
    );
    expect(r?.ingredients).toEqual(["1 cup flour", "2 eggs"]);
  });
});

describe("formatJsonLdAsText", () => {
  it("formats a fully-populated recipe into a readable text block", () => {
    const text = formatJsonLdAsText({
      name: "Banana Bread",
      description: "A warm classic.",
      ingredients: ["3 bananas", "1/2 cup butter"],
      instructions: ["Mash.", "Mix.", "Bake."],
      prepTime: "PT10M",
      cookTime: "PT1H",
      totalTime: "PT1H10M",
      yield: "1 loaf",
      category: "Dessert",
      cuisine: "American",
      keywords: ["make-ahead", "freezer-friendly"],
      suitableForDiet: ["https://schema.org/VegetarianDiet"],
      notes: [],
    });
    expect(text).toMatch(/^Title: Banana Bread$/m);
    expect(text).toMatch(/^Description: A warm classic\.$/m);
    expect(text).toMatch(/^Prep time: PT10M$/m);
    expect(text).toMatch(/^Yield: 1 loaf$/m);
    expect(text).toMatch(/^Category hint: Dessert$/m);
    expect(text).toMatch(/^Suitable for diet/m);
    expect(text).toMatch(/^- 3 bananas$/m);
    expect(text).toMatch(/^1\. Mash\.$/m);
    expect(text).toMatch(/^3\. Bake\.$/m);
  });

  it("omits optional sections when their data is missing", () => {
    const text = formatJsonLdAsText({
      name: "Bare",
      description: null,
      ingredients: ["1 thing"],
      instructions: [],
      prepTime: null,
      cookTime: null,
      totalTime: null,
      yield: null,
      category: null,
      cuisine: null,
      keywords: [],
      suitableForDiet: [],
      notes: [],
    });
    expect(text).not.toMatch(/Description/);
    expect(text).not.toMatch(/Prep time/);
    expect(text).not.toMatch(/Instructions/);
    expect(text).toMatch(/^- 1 thing$/m);
  });

  it("caps the formatted payload length and notes the truncation", () => {
    const longIngredients = Array(200).fill("1 cup of an absurdly long fake ingredient padded out to lots of bytes for testing");
    const text = formatJsonLdAsText({
      name: "Pathological",
      description: null,
      ingredients: longIngredients,
      instructions: [],
      prepTime: null,
      cookTime: null,
      totalTime: null,
      yield: null,
      category: null,
      cuisine: null,
      keywords: [],
      suitableForDiet: [],
      notes: [],
    });
    expect(text.length).toBeLessThanOrEqual(30_000 + "\n[truncated]".length);
  });
});

describe("stripTags", () => {
  it("returns null for null input", () => {
    expect(stripTags(null)).toBe(null);
  });

  it("strips simple tags and collapses whitespace", () => {
    expect(stripTags("  <em>hello</em>   world  ")).toBe("hello world");
  });

  it("decodes &amp; / &lt; / &gt; / &quot; / &#39;", () => {
    expect(stripTags("Tom &amp; Jerry &lt;3 &quot;quoted&quot;")).toBe(
      'Tom & Jerry <3 "quoted"',
    );
  });

  it("expands HTML fraction entities", () => {
    expect(stripTags("&frac12; cup, &frac14; tsp, &frac34; lb")).toBe(
      "1/2 cup, 1/4 tsp, 3/4 lb",
    );
  });

  it("returns null for an all-whitespace result", () => {
    expect(stripTags("   <br>  <br>  ")).toBe(null);
  });
});
