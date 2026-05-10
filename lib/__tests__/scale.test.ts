import { describe, expect, it } from "vitest";

import {
  parseQuantity,
  formatQuantity,
  pluralizeUnit,
  scaleQuantity,
  scaleStepText,
} from "@/lib/cooking/scale";

describe("parseQuantity", () => {
  it("parses integers and decimals", () => {
    expect(parseQuantity("2")).toMatchObject({ kind: "single", value: 2 });
    expect(parseQuantity("0.5")).toMatchObject({ kind: "single", value: 0.5 });
    expect(parseQuantity("1.25")).toMatchObject({ kind: "single", value: 1.25 });
  });

  it("parses simple fractions", () => {
    expect(parseQuantity("3/4")).toMatchObject({ kind: "single", value: 0.75 });
    expect(parseQuantity("1/2")).toMatchObject({ kind: "single", value: 0.5 });
  });

  it("parses mixed numbers", () => {
    expect(parseQuantity("1 1/2")).toMatchObject({ kind: "single", value: 1.5 });
    expect(parseQuantity("2 3/4")).toMatchObject({ kind: "single", value: 2.75 });
  });

  it("parses unicode vulgar fractions", () => {
    expect(parseQuantity("\u00BD")).toMatchObject({ kind: "single", value: 0.5 });
    expect(parseQuantity("1\u00BD")).toMatchObject({ kind: "single", value: 1.5 });
    expect(parseQuantity("\u00BE")).toMatchObject({ kind: "single", value: 0.75 });
  });

  it("parses ranges", () => {
    expect(parseQuantity("1-2")).toMatchObject({ kind: "range", low: 1, high: 2 });
    expect(parseQuantity("1 to 2")).toMatchObject({ kind: "range", low: 1, high: 2 });
  });

  it("returns null for non-numeric input", () => {
    expect(parseQuantity("a pinch")).toBeNull();
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
  });
});

describe("formatQuantity", () => {
  it("formats integers without a fraction", () => {
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(2)).toBe("2");
  });

  it("formats common fractions", () => {
    expect(formatQuantity(0.5)).toBe("1/2");
    expect(formatQuantity(0.75)).toBe("3/4");
    expect(formatQuantity(0.25)).toBe("1/4");
    expect(formatQuantity(0.125)).toBe("1/8");
  });

  it("formats mixed numbers", () => {
    expect(formatQuantity(1.5)).toBe("1 1/2");
    expect(formatQuantity(2.75)).toBe("2 3/4");
  });

  it("snaps thirds", () => {
    expect(formatQuantity(1 / 3)).toBe("1/3");
    expect(formatQuantity(2 / 3)).toBe("2/3");
    expect(formatQuantity(1 + 1 / 3)).toBe("1 1/3");
  });

  it("returns 0 for zero", () => {
    expect(formatQuantity(0)).toBe("0");
  });
});

describe("scaleQuantity", () => {
  it("doubles a mixed number", () => {
    expect(scaleQuantity("1 1/2", 2)).toBe("3");
  });

  it("halves a fraction", () => {
    expect(scaleQuantity("3/4", 0.5)).toBe("3/8");
  });

  it("scales by 2/3", () => {
    expect(scaleQuantity("1 1/2", 2 / 3)).toBe("1");
  });

  it("scales an integer", () => {
    expect(scaleQuantity("4", 1.5)).toBe("6");
  });

  it("scales a unicode vulgar fraction", () => {
    expect(scaleQuantity("\u00BD", 4)).toBe("2");
  });

  it("scales a range", () => {
    expect(scaleQuantity("1-2", 2)).toBe("2\u20134");
  });

  it("leaves unparseable strings unchanged", () => {
    expect(scaleQuantity("a pinch", 2)).toBe("a pinch");
  });

  it("handles factor === 1 as identity-ish", () => {
    expect(scaleQuantity("1 1/2", 1)).toBe("1 1/2");
  });

  it("rejects bad factors", () => {
    expect(scaleQuantity("1 1/2", 0)).toBe("1 1/2");
    expect(scaleQuantity("1 1/2", -1)).toBe("1 1/2");
    expect(scaleQuantity("1 1/2", Number.NaN)).toBe("1 1/2");
  });
});

describe("pluralizeUnit", () => {
  it("singularizes plural units when scaled <= 1", () => {
    expect(pluralizeUnit("cups", "1")).toBe("cup");
    expect(pluralizeUnit("cups", "1/2")).toBe("cup");
    expect(pluralizeUnit("cups", "3/4")).toBe("cup");
  });

  it("pluralizes singular units when scaled > 1", () => {
    expect(pluralizeUnit("cup", "2")).toBe("cups");
    expect(pluralizeUnit("cup", "1 1/2")).toBe("cups");
  });

  it("leaves abbreviation-style units alone", () => {
    expect(pluralizeUnit("tsp", "1")).toBe("tsp");
    expect(pluralizeUnit("tsp", "3")).toBe("tsp");
    expect(pluralizeUnit("g", "200")).toBe("g");
    expect(pluralizeUnit("oz", "5")).toBe("oz");
  });

  it("uses range upper bound", () => {
    expect(pluralizeUnit("cup", "1\u20132")).toBe("cups");
    expect(pluralizeUnit("cups", "1\u20131")).toBe("cup");
  });

  it("falls back to the original spelling for unknown units", () => {
    expect(pluralizeUnit("blorps", "2")).toBe("blorps");
    expect(pluralizeUnit("", "2")).toBe("");
  });

  it("returns the unit unchanged when quantity isn't a number", () => {
    expect(pluralizeUnit("cups", "a pinch")).toBe("cups");
    expect(pluralizeUnit("cups", null)).toBe("cups");
  });
});

describe("scaleStepText", () => {
  it("scales quantities with known units", () => {
    expect(scaleStepText("Add 3 cups broth and simmer.", 0.5)).toBe(
      "Add 1 1/2 cups broth and simmer.",
    );
    expect(scaleStepText("Add 2 cups broth.", 0.5)).toBe("Add 1 cup broth.");
  });

  it("handles fractions and mixed numbers", () => {
    expect(scaleStepText("Whisk in 1/2 tsp salt.", 2)).toBe("Whisk in 1 tsp salt.");
    expect(scaleStepText("Pour 1 1/2 cups milk.", 2)).toBe("Pour 3 cups milk.");
  });

  it("ignores temperatures and times", () => {
    expect(scaleStepText("Bake at 350\u00B0F for 30 minutes.", 0.5)).toBe(
      "Bake at 350\u00B0F for 30 minutes.",
    );
    expect(scaleStepText("Cook for 5 minutes, then rest 10.", 2)).toBe(
      "Cook for 5 minutes, then rest 10.",
    );
  });

  it("ignores raw counts with no unit", () => {
    expect(scaleStepText("Add 3 eggs and stir.", 2)).toBe("Add 3 eggs and stir.");
  });

  it("returns input unchanged for factor 1 / bad factors", () => {
    expect(scaleStepText("Add 2 cups broth.", 1)).toBe("Add 2 cups broth.");
    expect(scaleStepText("Add 2 cups broth.", 0)).toBe("Add 2 cups broth.");
    expect(scaleStepText("Add 2 cups broth.", -1)).toBe("Add 2 cups broth.");
  });

  it("handles tablespoons / teaspoons longer aliases", () => {
    expect(scaleStepText("Stir in 2 tablespoons honey.", 0.5)).toBe(
      "Stir in 1 tablespoon honey.",
    );
  });

  it("handles unicode vulgar fractions", () => {
    expect(scaleStepText("Add \u00BD cup oil.", 2)).toBe("Add 1 cup oil.");
  });
});
