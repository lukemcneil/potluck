import { describe, expect, it } from "vitest";

import { repairLlmJson } from "@/lib/ai/repair-json";

describe("repairLlmJson", () => {
  it("returns valid JSON unchanged (trimmed)", () => {
    const json = `{"title":"Soup","servings":4}`;
    expect(repairLlmJson(json)).toBe(json);
  });

  it("trims surrounding whitespace", () => {
    const json = `   \n {"title":"Soup"}  \n `;
    expect(repairLlmJson(json)).toBe(`{"title":"Soup"}`);
  });

  it("strips ```json fences", () => {
    const text = '```json\n{"title":"Soup"}\n```';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup"}`);
  });

  it("strips plain ``` fences (no language tag)", () => {
    const text = '```\n{"title":"Soup"}\n```';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup"}`);
  });

  it("strips uppercase JSON fences", () => {
    const text = '```JSON\n{"title":"Soup"}\n```';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup"}`);
  });

  it("strips leading conversational preamble", () => {
    const text =
      'Sure! Here is the recipe in JSON:\n{"title":"Soup","servings":4}';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup","servings":4}`);
  });

  it("strips trailing conversational text", () => {
    const text =
      '{"title":"Soup","servings":4}\nLet me know if you need anything else!';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup","servings":4}`);
  });

  it("handles fences + preamble together", () => {
    const text =
      'Sure thing!\n\n```json\n{"title":"Soup"}\n```\n\nHope that helps.';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup"}`);
  });

  it("preserves braces inside string literals", () => {
    const json = `{"note":"Use { brackets } in the syntax","title":"Soup"}`;
    expect(repairLlmJson(json)).toBe(json);
  });

  it("preserves escaped quotes inside string literals", () => {
    const json = `{"title":"He said \\"hi\\"","servings":4}`;
    expect(repairLlmJson(json)).toBe(json);
  });

  it("handles nested objects", () => {
    const json = `{"meta":{"a":1,"b":{"c":[1,2,3]}},"title":"Soup"}`;
    expect(repairLlmJson(json)).toBe(json);
  });

  it("returns null for completely unparseable garbage", () => {
    expect(repairLlmJson("not json at all")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(repairLlmJson("")).toBeNull();
    expect(repairLlmJson("   ")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(repairLlmJson(undefined as unknown as string)).toBeNull();
    expect(repairLlmJson(null as unknown as string)).toBeNull();
  });

  it("returns null when extracted object is syntactically invalid", () => {
    // Trailing comma — we deliberately don't try to fix syntax-level
    // bugs because the auto-repair could silently mangle meaning.
    const text = '```json\n{"title":"Soup","servings":4,}\n```';
    expect(repairLlmJson(text)).toBeNull();
  });

  it("ignores text after the first balanced top-level object", () => {
    const text =
      '{"title":"Soup"}\n\nP.S. Here is a second object: {"oops":true}';
    expect(repairLlmJson(text)).toBe(`{"title":"Soup"}`);
  });

  it("returns null when no { is present", () => {
    expect(repairLlmJson("[1, 2, 3]")).toBeNull();
  });

  it("handles unicode characters inside strings", () => {
    const json = `{"title":"Crème brûlée","emoji":"\\u00e9"}`;
    expect(repairLlmJson(json)).toBe(json);
  });
});
