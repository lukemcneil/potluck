import "server-only";

/**
 * Server-side HTML fetcher for recipe URLs.
 *
 * Important properties:
 *   - 10 second timeout (AbortSignal.timeout)
 *   - 4 MB body cap (large enough for any recipe page, small enough to
 *     bound LLM input cost)
 *   - Real-browser User-Agent; many sites 403 the default Node UA
 *   - Throws nice user-facing errors (the API route surfaces them)
 *   - Refuses non-http(s) and IP-literal URLs (basic SSRF guard;
 *     /api/extract is auth-gated, so this is defense-in-depth, not
 *     primary protection)
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 4 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15 PotluckBot/1.0";

export type FetchedPage = {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
  bytes: number;
};

export class RecipeFetchError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RecipeFetchError";
  }
}

export async function fetchRecipePage(rawUrl: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RecipeFetchError(
      "That doesn't look like a valid URL. Make sure it includes https://",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RecipeFetchError("Only http and https URLs are supported.");
  }

  // Reject IP literals and obvious internal hosts as a cheap SSRF guard.
  // The route is auth-only, so this isn't critical, but free.
  if (isLocalOrPrivateHost(url.hostname)) {
    throw new RecipeFetchError("That host isn't allowed.");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new RecipeFetchError(
        "That page took too long to load (>10s). Try again, or paste the recipe in by hand.",
      );
    }
    throw new RecipeFetchError(
      "We couldn't reach that URL. Check the link and your connection.",
      err,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    throw new RecipeFetchError(
      `That page returned ${res.status} ${res.statusText || ""}.`.trim(),
    );
  }
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new RecipeFetchError(
      `That URL doesn't return HTML (got ${contentType.split(";")[0] || "unknown"}).`,
    );
  }

  // Stream and cap the body so a misbehaving page doesn't OOM the dev
  // server. fetch() in Node already buffers, but iterating the stream
  // lets us bail early.
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return finalize(res, contentType, text, Buffer.byteLength(text, "utf8"));
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new RecipeFetchError(
          `That page is larger than ${MAX_BYTES / 1024 / 1024} MB; we only import smaller pages.`,
        );
      }
      chunks.push(value);
    }
  }

  const buf = Buffer.concat(chunks);
  // Honour declared charset if it's in the content-type; fall back to UTF-8.
  const charset = parseCharset(contentType) ?? "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }

  return finalize(res, contentType, html, total);
}

function finalize(
  res: Response,
  contentType: string,
  html: string,
  bytes: number,
): FetchedPage {
  return {
    finalUrl: res.url,
    status: res.status,
    contentType,
    html,
    bytes,
  };
}

function parseCharset(contentType: string): string | null {
  const m = contentType.match(/charset=([^;]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function isLocalOrPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  // Block IPv4 literals in the common private ranges.
  const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}
