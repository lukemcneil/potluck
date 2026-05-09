import { describe, expect, it } from "vitest";

import {
  recipeFormSchema,
  extractedRecipeSchema,
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

describe("extractedRecipeSchema", () => {
  // Schema is strict (all fields required, optional ones are nullable)
  // because OpenAI structured-outputs strict mode demands every key to be
  // in `required[]` with `nullable: true` for omittable fields.
  const baseValid = {
    title: "Banana Bread",
    description: "A warm classic.",
    ingredients: [
      { quantity: "3", unit: null, name: "ripe bananas", note: "mashed" },
      { quantity: "1/2", unit: "cup", name: "butter", note: "melted" },
    ],
    steps: ["Mash bananas.", "Mix dry and wet.", "Bake at 350F for 1 hour."],
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
    const r = extractedRecipeSchema.parse(baseValid);
    expect(r.ingredients.length).toBe(2);
    expect(r.mealType).toBe("dessert");
  });

  it("requires every key to be present (strict-mode contract)", () => {
    // Drop a single optional-but-required-nullable field; should fail.
    const { description: _omit, ...withoutDescription } = baseValid;
    void _omit;
    expect(extractedRecipeSchema.safeParse(withoutDescription).success).toBe(
      false,
    );
  });

  it("accepts null in place of optional values", () => {
    const r = extractedRecipeSchema.parse({
      ...baseValid,
      description: null,
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      mealType: null,
      cuisine: null,
    });
    expect(r.title).toBe("Banana Bread");
    expect(r.mealType).toBeNull();
  });

  it("rejects an unknown mealType", () => {
    expect(
      extractedRecipeSchema.safeParse({ ...baseValid, mealType: "elevenses" })
        .success,
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
