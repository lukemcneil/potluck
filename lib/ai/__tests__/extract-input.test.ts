import { describe, expect, it } from "vitest";

import { extractRequestSchema } from "../extract-input";

describe("extractRequestSchema", () => {
  describe("imageIds variant", () => {
    it("accepts a single id", () => {
      const r = extractRequestSchema.safeParse({
        kind: "imageIds",
        imageIds: ["abc123"],
      });
      expect(r.success).toBe(true);
    });

    it("accepts up to 8 ids", () => {
      const r = extractRequestSchema.safeParse({
        kind: "imageIds",
        imageIds: Array.from({ length: 8 }, (_, i) => `id-${i}`),
      });
      expect(r.success).toBe(true);
    });

    it("rejects an empty id array", () => {
      const r = extractRequestSchema.safeParse({
        kind: "imageIds",
        imageIds: [],
      });
      expect(r.success).toBe(false);
    });

    it("rejects more than 8 ids", () => {
      const r = extractRequestSchema.safeParse({
        kind: "imageIds",
        imageIds: Array.from({ length: 9 }, (_, i) => `id-${i}`),
      });
      expect(r.success).toBe(false);
    });

    it("rejects an empty id string", () => {
      const r = extractRequestSchema.safeParse({
        kind: "imageIds",
        imageIds: [""],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("url variant", () => {
    it("accepts a valid http(s) URL", () => {
      const r = extractRequestSchema.safeParse({
        kind: "url",
        url: "https://example.com/recipes/cake",
      });
      expect(r.success).toBe(true);
    });

    it("rejects a non-URL string", () => {
      const r = extractRequestSchema.safeParse({
        kind: "url",
        url: "not a url",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("text variant", () => {
    it("accepts a 20-char paste at the minimum", () => {
      const r = extractRequestSchema.safeParse({
        kind: "text",
        text: "x".repeat(20),
      });
      expect(r.success).toBe(true);
    });

    it("rejects pastes shorter than 20 chars", () => {
      const r = extractRequestSchema.safeParse({ kind: "text", text: "yum" });
      expect(r.success).toBe(false);
    });

    it("rejects empty text", () => {
      const r = extractRequestSchema.safeParse({ kind: "text", text: "" });
      expect(r.success).toBe(false);
    });

    it("treats leading/trailing whitespace as not counting toward the min", () => {
      // 10 chars of body surrounded by whitespace shouldn't pass the
      // 20-char minimum, because the schema trims first. Without the
      // .trim() step a single tab+newline padded paste would slip
      // through and burn a model call on nothing.
      const r = extractRequestSchema.safeParse({
        kind: "text",
        text: "   \n\t" + "x".repeat(10) + "   \n\t",
      });
      expect(r.success).toBe(false);
    });

    it("accepts exactly 50 000 chars at the maximum", () => {
      const r = extractRequestSchema.safeParse({
        kind: "text",
        text: "a".repeat(50_000),
      });
      expect(r.success).toBe(true);
    });

    it("rejects pastes over 50 000 chars", () => {
      const r = extractRequestSchema.safeParse({
        kind: "text",
        text: "a".repeat(50_001),
      });
      expect(r.success).toBe(false);
    });
  });

  describe("discriminated union", () => {
    it("rejects an unknown kind", () => {
      const r = extractRequestSchema.safeParse({
        kind: "audio",
        audio: "data:...",
      });
      expect(r.success).toBe(false);
    });

    it("rejects a request missing the kind", () => {
      const r = extractRequestSchema.safeParse({
        text: "a".repeat(30),
      });
      expect(r.success).toBe(false);
    });
  });
});
