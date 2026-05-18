import { describe, expect, it } from "vitest";

import {
  MULTIPLIER_LADDER,
  deriveScalingMode,
  nextMultiplier,
  prevMultiplier,
} from "@/components/recipe/ServingsControl";

describe("deriveScalingMode", () => {
  it("picks servings mode for a numeric yield", () => {
    expect(deriveScalingMode(12)).toEqual({ mode: "servings", base: 12 });
    expect(deriveScalingMode(4)).toEqual({ mode: "servings", base: 4 });
  });

  it("falls back to multiplier mode at base 1× for non-numeric yields", () => {
    expect(deriveScalingMode(null)).toEqual({ mode: "multiplier", base: 1 });
  });

  it("treats zero / negative servings as non-numeric", () => {
    // Defensive: stored values that came from broken parses shouldn't
    // make the stepper divide by zero.
    expect(deriveScalingMode(0)).toEqual({ mode: "multiplier", base: 1 });
    expect(deriveScalingMode(-3)).toEqual({ mode: "multiplier", base: 1 });
  });
});

describe("multiplier ladder", () => {
  it("is sorted ascending and contains 1× as the anchor", () => {
    expect(MULTIPLIER_LADDER).toContain(1);
    for (let i = 1; i < MULTIPLIER_LADDER.length; i++) {
      expect(MULTIPLIER_LADDER[i]).toBeGreaterThan(MULTIPLIER_LADDER[i - 1]);
    }
  });

  it("nextMultiplier walks up the ladder", () => {
    expect(nextMultiplier(1)).toBe(1.5);
    expect(nextMultiplier(1.5)).toBe(2);
    expect(nextMultiplier(2)).toBe(3);
    expect(nextMultiplier(0.5)).toBe(2 / 3);
  });

  it("nextMultiplier clamps at the top of the ladder", () => {
    const top = MULTIPLIER_LADDER[MULTIPLIER_LADDER.length - 1];
    expect(nextMultiplier(top)).toBe(top);
    expect(nextMultiplier(top + 1)).toBe(top);
  });

  it("prevMultiplier walks down the ladder", () => {
    expect(prevMultiplier(2)).toBe(1.5);
    expect(prevMultiplier(1.5)).toBe(1);
    expect(prevMultiplier(1)).toBe(3 / 4);
    expect(prevMultiplier(1 / 2)).toBe(1 / 3);
  });

  it("prevMultiplier clamps at the bottom of the ladder", () => {
    const bottom = MULTIPLIER_LADDER[0];
    expect(prevMultiplier(bottom)).toBe(bottom);
    expect(prevMultiplier(bottom - 1)).toBe(bottom);
  });

  it("handles tiny floating-point deltas without infinite-looping", () => {
    // 1 + epsilon should still pick "next > 1" cleanly.
    expect(nextMultiplier(1 + 1e-12)).toBe(1.5);
    expect(prevMultiplier(1 - 1e-12)).toBe(3 / 4);
  });
});
