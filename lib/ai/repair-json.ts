/**
 * Programmatic repair for malformed JSON coming out of an LLM.
 *
 * Vercel AI SDK's `generateObject` constrains the model with a JSON
 * schema (OpenAI's strict `response_format`, Gemini's `responseSchema`),
 * which gets us 95%+ of the way there. The remaining ~5% are these
 * stubborn cases the model still ships occasionally:
 *
 *   1. Markdown code fences around the JSON ("```json\n{...}\n```").
 *      Most common Gemini Flash-Lite failure mode — even with
 *      responseSchema set, it sometimes prefers to "explain" its
 *      output with markdown formatting.
 *   2. Leading conversational preamble ("Here's the recipe in JSON:")
 *      before the actual object.
 *   3. Trailing prose ("Let me know if you need any clarification!")
 *      after the closing brace.
 *
 * This helper applies a series of conservative rewrites and returns
 * the result if it parses. We deliberately don't try to "fix" the
 * JSON structure itself (no auto-quoting strings, no removing trailing
 * commas, no closing unbalanced braces) — those repairs are risky and
 * can silently turn a wrong-but-recoverable response into a
 * wrong-and-now-misleading one. If the rewrites don't produce parseable
 * JSON, we return `null` and let the AI SDK throw, which our retry
 * wrapper then handles by trying the whole call again.
 */
export function repairLlmJson(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text) return null;

  // 1) Strip a single leading/trailing markdown code fence.
  //    Matches ```, ```json, ```JSON, optionally with a trailing
  //    newline. We do NOT use a global match — multiple fences are a
  //    red flag (probably nested or worse), bail out and let the
  //    caller retry.
  const fenceOpen = /^```(?:json)?\s*\n?/i;
  const fenceClose = /\n?```\s*$/;
  text = text.replace(fenceOpen, "").replace(fenceClose, "").trim();

  // 2) If there's still leading or trailing prose, try to extract the
  //    first balanced top-level JSON object. We track brace depth
  //    while respecting string literals (so a "}" inside a value
  //    doesn't close the object). If we find a balanced range, slice
  //    to it.
  const objectRange = findFirstBalancedObject(text);
  if (objectRange) {
    text = text.slice(objectRange.start, objectRange.end + 1);
  }

  // 3) Final sanity check: does it parse AND is it a JSON object?
  //    All our extraction schemas are `z.object(...)`, so anything
  //    that parses as an array / number / string / null isn't useful
  //    to the SDK's Zod validation anyway. Anything cleverer than
  //    "trim and check" risks producing a syntactically valid object
  //    that doesn't match what the model meant to say.
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Find the first balanced top-level `{...}` object in `text`,
 * respecting string literals and escape sequences. Returns the
 * inclusive [start, end] indices of the object, or null if no
 * balanced object is present.
 *
 * Doesn't validate that the contents are well-formed JSON — that's
 * left to `JSON.parse`. We only care that braces match so we can
 * trim conversational prose around an otherwise-fine object.
 */
function findFirstBalancedObject(
  text: string,
): { start: number; end: number } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i };
      }
    }
  }

  return null;
}
