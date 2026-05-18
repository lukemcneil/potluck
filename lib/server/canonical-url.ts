import "server-only";

import type { NextRequest } from "next/server";

/**
 * Build a URL against the *public-facing* origin of the current
 * request.
 *
 * Why this exists
 * ---------------
 * When the app runs behind a reverse proxy (Cloudflare Tunnel,
 * ngrok, an nginx in front, k8s ingress, etc), `req.url`'s authority
 * component reflects the INTERNAL bind address — e.g.
 * `http://localhost:8086` — NOT the public URL the client actually
 * requested. So `new URL(path, req.url)` builds a redirect target
 * pointing at the home server's localhost. The phone then dutifully
 * follows that `Location` header, can't reach localhost on the
 * phone itself, and the share intent silently fails.
 *
 * This bit Potluck in production specifically through the Web
 * Share Target endpoint: the manifest registers
 * `share_target.action: "/share-receive"`, Android resolves that
 * against the public manifest URL, cloudflared forwards the POST to
 * `localhost:PORT/share-receive`, our route returned
 * `Location: http://localhost:PORT/add`, the phone followed it,
 * and we got "shared to Potluck and it landed on localhost".
 *
 * Resolution order
 * ----------------
 * Mirror Auth.js's host-trust policy:
 *
 *   1. `X-Forwarded-Host` + `X-Forwarded-Proto` — set by every
 *      well-behaved reverse proxy. This is the authoritative
 *      "what host did the client actually request" signal.
 *   2. `AUTH_URL` — the canonical configured URL operators already
 *      set for Auth.js OAuth callbacks. Reused here so a single
 *      env-var pin covers both auth and sharing.
 *   3. `req.url` — only correct when no proxy is involved
 *      (i.e. direct localhost dev). Last-resort fallback.
 *
 * The `X-Forwarded-Proto` header defaults to `https` when absent
 * because in 2026 plain-HTTP-behind-a-proxy is rare enough to be a
 * deliberate operator choice (and they can set the header
 * explicitly). Mistakenly upgrading to https only causes a redirect
 * loop in one esoteric setup; mistakenly downgrading to http breaks
 * EVERY normal production deployment.
 */
export function canonicalUrl(req: NextRequest, path: string): URL {
  const fwdHost = req.headers.get("x-forwarded-host")?.trim();
  if (fwdHost) {
    const fwdProto = req.headers.get("x-forwarded-proto")?.trim();
    try {
      return new URL(path, `${fwdProto || "https"}://${fwdHost}`);
    } catch {
      // Malformed header (e.g. proxy injected garbage). Fall through.
    }
  }

  const authUrl = process.env.AUTH_URL?.trim();
  if (authUrl) {
    try {
      return new URL(path, authUrl);
    } catch {
      // Bad env var. Fall through rather than crash the request.
    }
  }

  return new URL(path, req.url);
}
