import { describe, expect, it } from "vitest";

import { deriveNumeric } from "@/lib/cooking/numerics";

describe("deriveNumeric", () => {
  it("returns null for null / undefined / empty", () => {
    expect(deriveNumeric(null)).toBe(null);
    expect(deriveNumeric(undefined)).toBe(null);
    expect(deriveNumeric("")).toBe(null);
    expect(deriveNumeric("   ")).toBe(null);
  });

  it("parses plain integers and decimals", () => {
    expect(deriveNumeric("4")).toBe(4);
    expect(deriveNumeric("12")).toBe(12);
    expect(deriveNumeric("1.5")).toBe(1.5);
  });

  it("parses ASCII fractions", () => {
    expect(deriveNumeric("1/2")).toBe(0.5);
    expect(deriveNumeric("3/4")).toBe(0.75);
  });

  it("parses ASCII mixed numbers", () => {
    expect(deriveNumeric("1 1/2")).toBe(1.5);
    expect(deriveNumeric("2 3/4")).toBe(2.75);
  });

  it("parses Unicode vulgar fractions", () => {
    expect(deriveNumeric("\u00BD")).toBe(0.5); // ½
    expect(deriveNumeric("\u00BC")).toBe(0.25); // ¼
    expect(deriveNumeric("\u2153")).toBeCloseTo(1 / 3, 5); // ⅓
  });

  it("parses Unicode mixed numbers (1½)", () => {
    expect(deriveNumeric("1\u00BD")).toBe(1.5); // 1½
    expect(deriveNumeric("2\u00BE")).toBe(2.75); // 2¾
  });

  it("returns the midpoint of a range", () => {
    // "4-6 servings" → store 5 so the stepper anchors at the middle
    // and renders the user-facing "4-6" text un-mangled.
    expect(deriveNumeric("4-6")).toBe(5);
    expect(deriveNumeric("1-2")).toBe(1.5);
    // En-dash is also a legal range separator.
    expect(deriveNumeric("4\u20136")).toBe(5);
  });

  it("returns null for free-form non-numeric quantities", () => {
    expect(deriveNumeric("a pinch")).toBe(null);
    expect(deriveNumeric("to taste")).toBe(null);
    expect(deriveNumeric("1 loaf")).toBe(null);
    expect(deriveNumeric("a dozen")).toBe(null);
  });

  it("never throws on garbage input", () => {
    expect(() => deriveNumeric("¯\\_(ツ)_/¯")).not.toThrow();
    expect(deriveNumeric("¯\\_(ツ)_/¯")).toBe(null);
  });
});
