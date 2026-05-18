import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalUrl } from "../canonical-url";

/**
 * Build the smallest possible NextRequest-shaped stub for these
 * tests. We only need `.url` and `.headers.get(name)`, so we hand
 * the helper a plain object with those — no need to instantiate
 * the real class (which would require Node's web platform shims
 * to be initialized and brings in unwanted MIME-parsing).
 */
function makeReq(opts: {
  url: string;
  headers?: Record<string, string>;
}): Parameters<typeof canonicalUrl>[0] {
  const lower = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    url: opts.url,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] ?? null,
    },
  } as unknown as Parameters<typeof canonicalUrl>[0];
}

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

afterEach(() => {
  // Don't leak env mutations across cases.
  if (ORIGINAL_AUTH_URL === undefined) {
    delete process.env.AUTH_URL;
  } else {
    process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  }
});

describe("canonicalUrl", () => {
  it("uses X-Forwarded-Host + X-Forwarded-Proto when both are present", () => {
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "potluck.example.com",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "https://potluck.example.com/add",
    );
  });

  it("defaults X-Forwarded-Proto to https when only host is provided", () => {
    // Belt-and-suspenders: getting the host right matters more
    // than the proto, so a host-only proxy still wins over the
    // bind URL.
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "potluck.example.com",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "https://potluck.example.com/add",
    );
  });

  it("respects an explicit http X-Forwarded-Proto", () => {
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "internal.example.com",
        "X-Forwarded-Proto": "http",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "http://internal.example.com/add",
    );
  });

  it("preserves the path's query string", () => {
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "potluck.example.com",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(
      canonicalUrl(req, "/add?shared=url&url=https%3A%2F%2Fexample.com").toString(),
    ).toBe(
      "https://potluck.example.com/add?shared=url&url=https%3A%2F%2Fexample.com",
    );
  });

  it("falls back to AUTH_URL when no forwarded headers are present", () => {
    process.env.AUTH_URL = "https://potluck.example.com";
    const req = makeReq({ url: "http://localhost:8086/share-receive" });
    expect(canonicalUrl(req, "/signin?next=/add").toString()).toBe(
      "https://potluck.example.com/signin?next=/add",
    );
  });

  it("prefers X-Forwarded-Host over AUTH_URL when both exist", () => {
    // AUTH_URL is a *fallback*, not an override. If the proxy is
    // emitting a host header, that's the most precise signal.
    process.env.AUTH_URL = "https://stale.example.com";
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "potluck.example.com",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "https://potluck.example.com/add",
    );
  });

  it("falls back to req.url when nothing else is set (direct localhost dev)", () => {
    delete process.env.AUTH_URL;
    const req = makeReq({ url: "http://localhost:3000/share-receive" });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "http://localhost:3000/add",
    );
  });

  it("ignores a malformed AUTH_URL and falls through to req.url", () => {
    process.env.AUTH_URL = "not a valid url";
    const req = makeReq({ url: "http://localhost:3000/share-receive" });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "http://localhost:3000/add",
    );
  });

  it("ignores an empty AUTH_URL", () => {
    process.env.AUTH_URL = "   ";
    const req = makeReq({ url: "http://localhost:3000/share-receive" });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "http://localhost:3000/add",
    );
  });

  it("ignores a malformed X-Forwarded-Host and falls through to AUTH_URL", () => {
    process.env.AUTH_URL = "https://potluck.example.com";
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        // Some hostile / misconfigured proxy might inject garbage.
        // A leading space here breaks URL parsing.
        "X-Forwarded-Host": " not a valid host : 99999",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "https://potluck.example.com/add",
    );
  });

  it("handles a host header with an explicit port", () => {
    // Less common, but k8s ingresses sometimes preserve port info.
    const req = makeReq({
      url: "http://localhost:8086/share-receive",
      headers: {
        "X-Forwarded-Host": "potluck.example.com:8443",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(canonicalUrl(req, "/add").toString()).toBe(
      "https://potluck.example.com:8443/add",
    );
  });
});
