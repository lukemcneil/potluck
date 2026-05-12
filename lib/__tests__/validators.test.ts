import { describe, expect, it } from "vitest";

import {
  recipeFormSchema,
  extractedRecipeSchema,
  extractedRecipeWireSchema,
  collectionFormSchema,
  handleSchema,
  slugify,
} from "../validators";

describe("recipeFormSchema", () => {
  it("accepts a minimal valid recipe", () => {
    const r = recipeFormSchema.parse({
      title: "Pancakes",
      ingredients: [{ name: "flour" }],
      steps: [{ body: "mix" }],
    });
    expect(r.title).toBe("Pancakes");
    expect(r.visibility).toBe("public");
    expect(r.kind).toBe("structured");
    expect(r.diets).toEqual([]);
  });

  it("rejects empty title", () => {
    const result = recipeFormSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("accepts numeric prep / cook minutes", () => {
    const r = recipeFormSchema.parse({
      title: "Soup",
      prepMinutes: 10,
      cookMinutes: 30,
    });
    expect(r.prepMinutes).toBe(10);
    expect(r.cookMinutes).toBe(30);
  });

  it("rejects an invalid sourceUrl", () => {
    const result = recipeFormSchema.safeParse({
      title: "x",
      sourceUrl: "not a url",
    });
    expect(result.success).toBe(false);
  });
});

describe("extractedRecipeSchema (strict content shape)", () => {
  // This is the post-validation shape used everywhere downstream of
  // extractRecipe(). It does NOT include the wire-level `notARecipe`
  // discriminator — see the wire-schema tests below for that.
  const baseValid = {
    title: "Banana Bread",
    description: "A warm classic.",
    ingredients: [
      {
        quantity: "3",
        unit: null,
        name: "ripe bananas",
        note: "mashed",
        confidence: "high" as const,
      },
      {
        quantity: "1/2",
        unit: "cup",
        name: "butter",
        note: "melted",
        confidence: "high" as const,
      },
    ],
    steps: [
      { body: "Mash bananas.", confidence: "high" as const },
      { body: "Mix dry and wet.", confidence: "high" as const },
      { body: "Bake at 350F for 1 hour.", confidence: "high" as const },
    ],
    prepMinutes: 10,
    cookMinutes: 60,
    servings: "1 loaf",
    mealType: "dessert" as const,
    cuisine: "american",
    suggestedDiets: ["vegetarian"],
    suggestedTags: ["make-ahead", "freezer-friendly"],
  };

  it("requires at least one ingredient and one step", () => {
    expect(
      extractedRecipeSchema.safeParse({ ...baseValid, ingredients: [] })
        .success,
    ).toBe(false);
    expect(extractedRecipeSchema.safeParse({ ...baseValid, steps: [] }).success)
      .toBe(false);
  });

  it("accepts a realistic AI output", () => {
    const parsed = extractedRecipeSchema.parse(baseValid);
    expect(parsed.ingredients.length).toBe(2);
    expect(parsed.mealType).toBe("dessert");
  });

  it("accepts null in place of optional values", () => {
    const parsed = extractedRecipeSchema.parse({
      ...baseValid,
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      mealType: null,
      cuisine: null,
    });
    expect(parsed.title).toBe("Banana Bread");
    expect(parsed.mealType).toBeNull();
  });

  it("rejects an unknown mealType", () => {
    expect(
      extractedRecipeSchema.safeParse({ ...baseValid, mealType: "elevenses" })
        .success,
    ).toBe(false);
  });
});

describe("extractedRecipeWireSchema (OpenAI strict-mode wire shape)", () => {
  const baseWire = {
    notARecipe: false,
    reason: null,
    title: "Banana Bread",
    description: "Warm classic.",
    ingredients: [
      {
        quantity: "3",
        unit: null,
        name: "ripe bananas",
        note: "mashed",
        confidence: "high" as const,
      },
    ],
    steps: [
      { body: "Mash.", confidence: "high" as const },
      { body: "Mix.", confidence: "high" as const },
      { body: "Bake.", confidence: "high" as const },
    ],
    prepMinutes: 10,
    cookMinutes: 60,
    servings: "1 loaf",
    mealType: "dessert" as const,
    cuisine: "american",
    suggestedDiets: ["vegetarian"],
    suggestedTags: ["make-ahead"],
  };

  it("accepts the recipe-found shape", () => {
    expect(extractedRecipeWireSchema.safeParse(baseWire).success).toBe(true);
  });

  it("accepts the no-recipe shape with empty content arrays", () => {
    const r = extractedRecipeWireSchema.parse({
      ...baseWire,
      notARecipe: true,
      reason: "This is a news article, not a recipe.",
      title: "",
      description: null,
      ingredients: [],
      steps: [],
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      mealType: null,
      cuisine: null,
      suggestedDiets: [],
      suggestedTags: [],
    });
    expect(r.notARecipe).toBe(true);
    expect(r.reason).toMatch(/news article/);
  });

  it("requires every key to be present (strict-mode contract)", () => {
    const { description: _omit, ...withoutDescription } = baseWire;
    void _omit;
    expect(
      extractedRecipeWireSchema.safeParse(withoutDescription).success,
    ).toBe(false);
  });

  it("rejects an unknown mealType", () => {
    expect(
      extractedRecipeWireSchema.safeParse({
        ...baseWire,
        mealType: "elevenses",
      }).success,
    ).toBe(false);
  });
});

describe("collectionFormSchema", () => {
  it("defaults visibility to public", () => {
    const c = collectionFormSchema.parse({ name: "Mom's Recipes" });
    expect(c.visibility).toBe("public");
  });
});

describe("handleSchema", () => {
  it.each(["wife", "anna-1", "alex42"])("accepts %s", (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });

  it.each(["-bad", "bad-", "Bad", "a", "x".repeat(33), "with space"])(
    "rejects %s",
    (h) => {
      expect(handleSchema.safeParse(h).success).toBe(false);
    },
  );
});

describe("slugify", () => {
  it("normalizes accented characters", () => {
    expect(slugify("Mom's Crème Brûlée!")).toBe("mom-s-creme-brulee");
  });

  it("trims and collapses dashes", () => {
    expect(slugify("  multiple   spaces---and-stuff  ")).toBe(
      "multiple-spaces-and-stuff",
    );
  });

  it("caps length", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
