import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { processUpload } from "@/lib/images";
import { canonicalUrl } from "@/lib/server/canonical-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PWA Web Share Target endpoint.
 *
 * Browsers (Android Chrome today, more soon) POST a shared payload to
 * this route when the user picks "Potluck" from the OS share sheet.
 * The payload mirrors the `share_target.params` block in
 * `app/manifest.ts`:
 *
 *   - `title`, `text` — strings the source app provided
 *   - `url`           — a single URL when the source is a webpage
 *   - `photos[]`      — image File objects when the source shared images
 *
 * We translate that into a redirect to `/add` with `?shared=...` query
 * params that `AddRecipeFlow` understands (URL flow vs photos flow vs
 * empty-with-text-hint).
 *
 * Auth: signed-out users get bounced to `/signin?next=/add` and lose
 * the share payload — accepted as v1 friction. The alternative
 * (stashing in a cookie + replaying after sign-in) is doable but
 * carries non-trivial privacy + cleanup work for a rare edge case.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // CRITICAL: every redirect below MUST be built via `canonicalUrl`,
  // not `new URL(path, req.url)`. When the app is behind Cloudflare
  // Tunnel / nginx / any reverse proxy, `req.url`'s authority is the
  // INTERNAL bind address (e.g. `http://localhost:PORT`). Using it
  // in a `Location` header points the client at that internal URL,
  // and on a phone "localhost" means "the phone itself", which has
  // nothing on that port — every share intent ends up on a broken
  // localhost URL. This was the actual root cause of the "share to
  // Potluck lands on localhost:8086" bug, NOT a stale PWA install.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(canonicalUrl(req, "/signin?next=/add"), 303);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(canonicalUrl(req, "/add"), 303);
  }

  const url = String(form.get("url") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();

  // 1. URL share — most common path (Instagram link, Safari page, etc.)
  // The browser usually puts the URL in `url`, but Chrome has been known
  // to drop it into `text` instead, so probe both.
  const candidate = url || extractFirstUrl(text);
  if (candidate) {
    const target = canonicalUrl(req, "/add");
    target.searchParams.set("shared", "url");
    target.searchParams.set("url", candidate);
    if (title) target.searchParams.set("title", title);
    return NextResponse.redirect(target, 303);
  }

  // 2. Photo share — write each accepted image into our normal upload
  // store and pass the ids to /add so the photo extractor can pick them
  // up exactly like the in-app PhotoPicker would.
  const files = form.getAll("photos").filter(isImageFile);
  if (files.length > 0) {
    const ids: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      // Hard cap at 25 MB per file — matches /api/upload — and fail
      // open (skip + continue) if a single file is too big or unreadable.
      if (buffer.byteLength > 25 * 1024 * 1024) continue;
      try {
        // Run through the same normalization pipeline as /api/upload
        // so the photos look identical regardless of source.
        const processed = await processUpload(buffer);
        const stored = await storage.put({
          buffer: processed.buffer,
          ext: processed.ext,
          mimeType: processed.mimeType,
        });
        ids.push(stored.id);
      } catch (err) {
        console.warn("[share-receive] upload-failed", err);
      }
    }

    if (ids.length > 0) {
      const target = canonicalUrl(req, "/add");
      target.searchParams.set("shared", "photos");
      target.searchParams.set("ids", ids.join(","));
      if (title) target.searchParams.set("title", title);
      return NextResponse.redirect(target, 303);
    }
  }

  // 3. Text-only share — drop into /add as a hint and let the user
  // pick a path manually.
  const target = canonicalUrl(req, "/add");
  if (text || title) {
    target.searchParams.set("shared", "text");
    if (title) target.searchParams.set("title", title);
    if (text) target.searchParams.set("text", text);
  }
  return NextResponse.redirect(target, 303);
}

function isImageFile(v: FormDataEntryValue): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    "arrayBuffer" in v &&
    typeof (v as File).type === "string" &&
    (v as File).type.startsWith("image/")
  );
}

/**
 * Find the first http(s) URL inside a free-form string. Mirrors what
 * Chrome's share sheet looks for when a source app stuffs the URL into
 * `text` instead of `url`.
 */
function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"]+/i);
  return match ? match[0] : null;
}
