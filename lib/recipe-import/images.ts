import "server-only";

import { processUpload, makePlaceholder } from "@/lib/images";
import { storage } from "@/lib/storage";
import { fetchRecipePage, isLocalOrPrivateHost } from "@/lib/recipe-import/fetch";

/**
 * Image importer for URL-based recipe imports.
 *
 * When a user pastes a recipe URL we run AI extraction on the text,
 * but the page itself almost always has at least one hero image (the
 * dish, plated). It would be silly to make the user separately
 * download-and-reupload that photo — so this module:
 *
 *   1. Parses the page HTML for likely hero image URLs (og:image,
 *      twitter:image, JSON-LD `Recipe.image`).
 *   2. Fetches each candidate (with SSRF + timeout + size guards).
 *   3. Runs them through the same sharp pipeline /api/upload uses so
 *      the recipe's image set is uniform regardless of provenance.
 *   4. Stores them via the disk adapter and returns
 *      `UploadedPhoto`-shaped objects the client can hand to
 *      RecipeForm as `initialPhotos`.
 *
 * Everything is best-effort: any failure (network, decode error,
 * wrong content type, oversized) drops the offending image silently.
 * `importPageImages` never throws and is safe to use behind
 * `Promise.allSettled` next to the AI call.
 *
 * Constants live module-local rather than env-configurable —
 * importing 8 huge images from a single page is never what we want;
 * the limits are about safety, not personalization.
 */

const PER_IMAGE_TIMEOUT_MS = 8_000;
/** Pre-normalization byte cap. Post-normalize we always end up <1 MB. */
const PER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 3;
/**
 * Minimum dimension (smaller of width/height) we'll keep as a recipe
 * cover. WordPress recipe blogs commonly emit JSON-LD with the
 * headline shot AND its own auto-generated thumbnails (e.g.
 * `hero-225x225.jpg`, `hero-500x375.jpg`); blindly keeping all three
 * means a single dish import floods the picker with three near-
 * identical photos. 600 px is a happy medium: catches every obvious
 * thumbnail from major recipe-blog plugins without rejecting hero
 * shots from smaller indie sites (which still tend to be ≥800 px).
 */
const MIN_HERO_DIM = 600;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export type ImportedImage = {
  publicPath: string;
  width: number;
  height: number;
  placeholder: string;
};

/**
 * Pure parser: scrapes likely hero image URLs out of a page HTML
 * string. Combines:
 *
 *  - `og:image`, `og:image:secure_url`, `og:image:url` (Open Graph)
 *  - `twitter:image` (Twitter Card, used as fallback when og is absent)
 *  - JSON-LD blocks of type `Recipe` (string, array, ImageObject, or
 *    `@graph`-nested forms)
 *
 * URLs are resolved against `baseUrl` so relative paths
 * (`/wp-content/uploads/hero.jpg`) become absolute. Output is deduped
 * and capped at `MAX_IMAGES`. Order preserves discovery — og:image
 * tends to be the "headline" image so it lands first.
 *
 * Pure (no I/O); safe to unit test against snippet HTML.
 */
export function findPageImageUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const tryAdd = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    let abs: string;
    try {
      abs = new URL(trimmed, baseUrl).toString();
    } catch {
      return;
    }
    // Normalize on the string so two URLs differing only in trailing
    // whitespace collapse. (URL.toString() already does the rest.)
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  // Open Graph + Twitter Card.
  //
  // We run TWO regexes because the meta tag attributes can appear in
  // either order (`property=... content=...` or `content=...
  // property=...`). A single regex with backreferences would be
  // shorter but less readable; meta-tag parsers are notoriously
  // hostile to clever regex.
  //
  // The match must be ANCHORED (`^…$`) — otherwise `og:image:width`
  // matches "og:image" as a substring and the page's hero width
  // value gets interpreted as a relative image path. Same for
  // `og:image:height`, `og:image:alt`, `og:image:type`.
  const META_PROPS = /^(og:image(?::secure_url|:url)?|twitter:image)$/;

  for (const m of html.matchAll(
    /<meta\b[^>]*?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    if (META_PROPS.test(m[1])) tryAdd(m[2]);
  }
  for (const m of html.matchAll(
    /<meta\b[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    if (META_PROPS.test(m[2])) tryAdd(m[1]);
  }

  // JSON-LD. We non-greedily scoop everything between the tags and
  // try to parse — malformed blocks (some sites concatenate two
  // JSON objects in one script) are silently skipped.
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    walkLdForRecipeImages(data, tryAdd);
  }

  return out.slice(0, MAX_IMAGES);
}

/**
 * Depth-first walk of a JSON-LD payload looking for `Recipe` nodes
 * (top-level, in arrays, or under `@graph`) and emitting whatever
 * shape their `image` field takes.
 */
function walkLdForRecipeImages(
  node: unknown,
  emit: (url: unknown) => void,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkLdForRecipeImages(child, emit);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  // `@graph` is the WordPress / Yoast / RankMath bundling convention:
  // one big JSON-LD object whose `@graph` is an array of typed nodes.
  if (obj["@graph"]) walkLdForRecipeImages(obj["@graph"], emit);

  const type = obj["@type"];
  const isRecipe =
    type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
  if (isRecipe && obj["image"] != null) {
    emitImage(obj["image"], emit);
  }
}

function emitImage(node: unknown, emit: (url: unknown) => void): void {
  if (typeof node === "string") {
    emit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) emitImage(child, emit);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // schema.org's `ImageObject` uses `url`; `contentUrl` is also
    // legal and Pinterest-flavored.
    if (typeof obj["url"] === "string") emit(obj["url"]);
    if (typeof obj["contentUrl"] === "string") emit(obj["contentUrl"]);
  }
}

/**
 * Fetch one candidate image URL, normalize it via the same sharp
 * pipeline `/api/upload` uses, and persist it. Returns `null` on any
 * failure (bad URL, SSRF reject, 404, wrong content type, oversized,
 * broken decode, storage error) — image import is best-effort and
 * the caller treats `null` as "skip this one".
 */
async function importOne(rawUrl: string): Promise<ImportedImage | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isLocalOrPrivateHost(url.hostname)) return null;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
      headers: {
        // CDNs sometimes serve different bytes to default Node UAs.
        "User-Agent":
          "Mozilla/5.0 (compatible; PotluckBot/1.0; +recipe-image-import)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return null;

  // Trust content-length when present; many CDNs send it. When it's
  // missing we re-check after reading the body.
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > 0 && declaredLength > PER_IMAGE_MAX_BYTES) return null;

  let buffer: Buffer;
  try {
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > PER_IMAGE_MAX_BYTES) return null;
    buffer = Buffer.from(arrayBuf);
  } catch {
    return null;
  }

  let processed: Awaited<ReturnType<typeof processUpload>>;
  try {
    processed = await processUpload(buffer);
  } catch {
    return null;
  }

  // Drop obvious thumbnails before they hit disk. processUpload only
  // DOWNSCALES (`withoutEnlargement: true`), so its returned dims
  // equal the source dims for anything smaller than 2048 px — i.e.
  // we're filtering on the source's real resolution here, not on
  // post-normalize clamps.
  if (Math.min(processed.width, processed.height) < MIN_HERO_DIM) return null;

  let stored: Awaited<ReturnType<typeof storage.put>>;
  try {
    stored = await storage.put({
      buffer: processed.buffer,
      ext: processed.ext,
      mimeType: processed.mimeType,
    });
  } catch {
    return null;
  }

  // Placeholder is nice-to-have, not load-bearing. A failure here
  // just means the thumbnail won't have a blur fade-in.
  let placeholder = "";
  try {
    placeholder = await makePlaceholder(processed.buffer);
  } catch {
    /* swallow */
  }

  return {
    publicPath: stored.publicPath,
    width: processed.width,
    height: processed.height,
    placeholder,
  };
}

/**
 * Best-effort: fetch the page, discover up to `MAX_IMAGES` hero
 * candidates, and download / normalize / store them in parallel.
 *
 * NEVER throws. Empty return means "nothing useable", which the
 * caller treats as a graceful no-op (the recipe just won't have
 * auto-imported photos).
 */
export async function importPageImages(url: string): Promise<ImportedImage[]> {
  let page: Awaited<ReturnType<typeof fetchRecipePage>>;
  try {
    page = await fetchRecipePage(url);
  } catch {
    return [];
  }

  const candidates = findPageImageUrls(page.html, page.finalUrl);
  if (candidates.length === 0) return [];

  const results = await Promise.allSettled(candidates.map((u) => importOne(u)));
  const photos: ImportedImage[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) photos.push(r.value);
  }
  return photos;
}
