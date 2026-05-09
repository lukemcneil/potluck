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

  it("coerces numeric prep / cook minutes from strings", () => {
    const r = recipeFormSchema.parse({
      title: "Soup",
      prepMinutes: "10",
      cookMinutes: "30",
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
  it("requires at least one ingredient and one step", () => {
    expect(
      extractedRecipeSchema.safeParse({
        title: "x",
        ingredients: [],
        steps: ["a"],
      }).success,
    ).toBe(false);

    expect(
      extractedRecipeSchema.safeParse({
        title: "x",
        ingredients: [{ name: "a" }],
        steps: [],
      }).success,
    ).toBe(false);
  });

  it("accepts a realistic AI output", () => {
    const r = extractedRecipeSchema.parse({
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
      mealType: "dessert",
      cuisine: "american",
      suggestedDiets: ["vegetarian"],
      suggestedTags: ["make-ahead", "freezer-friendly"],
    });
    expect(r.ingredients.length).toBe(2);
    expect(r.mealType).toBe("dessert");
  });

  it("rejects an unknown mealType", () => {
    expect(
      extractedRecipeSchema.safeParse({
        title: "x",
        ingredients: [{ name: "a" }],
        steps: ["b"],
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
