import { describe, it, expect } from "vitest";

import { consolidate } from "@/lib/shopping/consolidate";

describe("consolidate", () => {
  it("returns an empty list for empty input", () => {
    expect(consolidate([])).toEqual([]);
  });

  it("preserves first-seen order across distinct items", () => {
    const out = consolidate([
      { name: "milk", quantity: "1", unit: "cup", sourceRecipeId: "r1" },
      { name: "salt", quantity: "1", unit: "tsp", sourceRecipeId: "r1" },
      { name: "flour", quantity: "2", unit: "cups", sourceRecipeId: "r1" },
    ]);
    expect(out.map((o) => o.name)).toEqual(["milk", "salt", "flour"]);
  });

  it("merges (name, unit) case-insensitively and sums numeric quantities", () => {
    const out = consolidate([
      { name: "Flour", quantity: "1", unit: "cup", sourceRecipeId: "r1" },
      { name: "flour", quantity: "2", unit: "cup", sourceRecipeId: "r2" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe("3");
    expect(out[0].name).toBe("Flour"); // first-seen casing wins
    expect(out[0].sourceRecipeIds.sort()).toEqual(["r1", "r2"]);
  });

  it("does NOT merge across different units", () => {
    const out = consolidate([
      { name: "flour", quantity: "1", unit: "cup", sourceRecipeId: "r1" },
      { name: "flour", quantity: "1", unit: "tbsp", sourceRecipeId: "r2" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge across different ingredient names (no fuzzy)", () => {
    const out = consolidate([
      { name: "flour", quantity: "1", unit: "cup", sourceRecipeId: "r1" },
      {
        name: "all-purpose flour",
        quantity: "1",
        unit: "cup",
        sourceRecipeId: "r2",
      },
    ]);
    expect(out).toHaveLength(2);
  });

  it("formats common fractions as glyphs", () => {
    const out = consolidate([
      { name: "x", quantity: "0.5", unit: "cup", sourceRecipeId: null },
      { name: "x", quantity: "0.25", unit: "cup", sourceRecipeId: null },
    ]);
    expect(out[0].quantity).toBe("¾");
  });

  it("renders >1 sums as `<whole> <glyph>`", () => {
    const out = consolidate([
      { name: "x", quantity: "1", unit: "cup", sourceRecipeId: null },
      { name: "x", quantity: "0.5", unit: "cup", sourceRecipeId: null },
    ]);
    expect(out[0].quantity).toBe("1 ½");
  });

  it("falls back to a `+`-joined verbatim string when one quantity is unparseable", () => {
    const out = consolidate([
      { name: "x", quantity: "1", unit: "cup", sourceRecipeId: null },
      { name: "x", quantity: "a pinch", unit: "cup", sourceRecipeId: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe("1 + a pinch");
  });

  it("handles ranges by averaging their midpoint", () => {
    const out = consolidate([
      { name: "x", quantity: "1-3", unit: "tsp", sourceRecipeId: null },
      { name: "x", quantity: "1", unit: "tsp", sourceRecipeId: null },
    ]);
    // midpoint of 1-3 is 2, plus 1, => 3
    expect(out[0].quantity).toBe("3");
  });

  it("treats null/blank quantities as 'some' without breaking the numeric tally", () => {
    const out = consolidate([
      { name: "x", quantity: null, unit: "cup", sourceRecipeId: null },
      { name: "x", quantity: "1", unit: "cup", sourceRecipeId: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe("1");
  });

  it("dedupes sourceRecipeIds in the output", () => {
    const out = consolidate([
      { name: "x", quantity: "1", unit: null, sourceRecipeId: "r1" },
      { name: "x", quantity: "1", unit: null, sourceRecipeId: "r1" },
    ]);
    expect(out[0].sourceRecipeIds).toEqual(["r1"]);
  });

  it("strips empty-name rows", () => {
    const out = consolidate([
      { name: "  ", quantity: "1", unit: "cup", sourceRecipeId: null },
      { name: "salt", quantity: null, unit: null, sourceRecipeId: null },
    ]);
    expect(out.map((o) => o.name)).toEqual(["salt"]);
  });
});
