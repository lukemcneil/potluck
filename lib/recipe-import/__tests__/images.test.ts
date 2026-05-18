import { describe, expect, it, vi } from "vitest";

// `lib/recipe-import/images.ts` is annotated `import "server-only"`,
// which throws at module load outside a Next bundler. Neutralize it
// the same way the action tests do.
vi.mock("server-only", () => ({}));

import { findPageImageUrls } from "../images";

const BASE = "https://example.com/recipes/pad-thai";

describe("findPageImageUrls", () => {
  it("returns empty when the page has no image hints at all", () => {
    expect(findPageImageUrls("<html><body>no images</body></html>", BASE)).toEqual([]);
  });

  it("picks up a single og:image", () => {
    const html = `
      <head>
        <meta property="og:image" content="https://cdn.example.com/dish.jpg" />
      </head>
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/dish.jpg",
    ]);
  });

  it("handles og:image:secure_url and og:image:url variants", () => {
    const html = `
      <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg" />
      <meta property="og:image:url" content="https://cdn.example.com/url-variant.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/secure.jpg",
      "https://cdn.example.com/url-variant.jpg",
    ]);
  });

  it("accepts content-before-property attribute order", () => {
    // Some templating engines emit attrs in the inverted order.
    const html = `
      <meta content="https://cdn.example.com/swapped.jpg" property="og:image" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/swapped.jpg",
    ]);
  });

  it("falls back to twitter:image when og:image is absent", () => {
    const html = `
      <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/twitter.jpg",
    ]);
  });

  it("ignores non-image meta tags (e.g. og:title, og:url)", () => {
    const html = `
      <meta property="og:title" content="not an image" />
      <meta property="og:url" content="https://example.com/page" />
      <meta property="og:image" content="https://cdn.example.com/real.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/real.jpg",
    ]);
  });

  it("does NOT match og:image:width / og:image:height / og:image:alt as image URLs", () => {
    // Real-world bug: WordPress sites emit a whole block of og:image
    // sub-properties and the 'og:image' substring inside og:image:width
    // would incorrectly slurp the width VALUE ("1200") as a relative
    // path against the page URL.
    const html = `
      <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="The dish, plated" />
      <meta property="og:image:type" content="image/jpeg" />
    `;
    // Only the real og:image URL comes through — none of the
    // sub-property values resolved as relative URLs.
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/hero.jpg",
    ]);
  });

  it("resolves relative paths against the page's base URL", () => {
    const html = `
      <meta property="og:image" content="/wp-content/uploads/2024/hero.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://example.com/wp-content/uploads/2024/hero.jpg",
    ]);
  });

  it("dedupes when the same URL appears in multiple places", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/x.jpg" />
      <meta property="og:image:secure_url" content="https://cdn.example.com/x.jpg" />
      <meta name="twitter:image" content="https://cdn.example.com/x.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/x.jpg",
    ]);
  });

  it("extracts Recipe.image when JSON-LD ships a single string", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      image: "https://cdn.example.com/from-ld.jpg",
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/from-ld.jpg",
    ]);
  });

  it("extracts every URL when Recipe.image is an array of strings", () => {
    const ld = JSON.stringify({
      "@type": "Recipe",
      image: [
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/b.jpg",
      ],
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
  });

  it("walks an ImageObject's `url` and `contentUrl`", () => {
    const ld = JSON.stringify({
      "@type": "Recipe",
      image: {
        "@type": "ImageObject",
        url: "https://cdn.example.com/obj-url.jpg",
        contentUrl: "https://cdn.example.com/obj-content-url.jpg",
      },
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/obj-url.jpg",
      "https://cdn.example.com/obj-content-url.jpg",
    ]);
  });

  it("recurses into @graph and finds the Recipe node among siblings", () => {
    // The WordPress / Yoast / RankMath flavor: one big JSON-LD with
    // a @graph array of typed nodes, only ONE of which is the Recipe.
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Food Blog" },
        { "@type": "WebPage", name: "Pad Thai" },
        {
          "@type": "Recipe",
          name: "Pad Thai",
          image: ["https://cdn.example.com/graph-hero.jpg"],
        },
      ],
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/graph-hero.jpg",
    ]);
  });

  it("handles @type as an array containing 'Recipe'", () => {
    const ld = JSON.stringify({
      "@type": ["Thing", "Recipe"],
      image: "https://cdn.example.com/array-type.jpg",
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/array-type.jpg",
    ]);
  });

  it("ignores non-Recipe JSON-LD blocks (Article, Person, etc.)", () => {
    const ld = JSON.stringify({
      "@type": "Article",
      image: "https://cdn.example.com/article.jpg",
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    expect(findPageImageUrls(html, BASE)).toEqual([]);
  });

  it("skips malformed JSON-LD blocks silently", () => {
    const html = `
      <script type="application/ld+json">{ this is not valid json }</script>
      <meta property="og:image" content="https://cdn.example.com/still-works.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/still-works.jpg",
    ]);
  });

  it("caps the output at 3 images (MAX_IMAGES)", () => {
    const ld = JSON.stringify({
      "@type": "Recipe",
      image: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
        "https://cdn.example.com/3.jpg",
        "https://cdn.example.com/4.jpg",
        "https://cdn.example.com/5.jpg",
      ],
    });
    const html = `<script type="application/ld+json">${ld}</script>`;
    const out = findPageImageUrls(html, BASE);
    expect(out).toHaveLength(3);
    expect(out).toEqual([
      "https://cdn.example.com/1.jpg",
      "https://cdn.example.com/2.jpg",
      "https://cdn.example.com/3.jpg",
    ]);
  });

  it("combines og:image and JSON-LD without duplicating", () => {
    const ld = JSON.stringify({
      "@type": "Recipe",
      image: [
        "https://cdn.example.com/hero.jpg",
        "https://cdn.example.com/plated.jpg",
      ],
    });
    const html = `
      <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
      <script type="application/ld+json">${ld}</script>
    `;
    // og:image comes first because the meta tag is parsed first; the
    // JSON-LD duplicate is dropped, the unique plated shot is kept.
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/hero.jpg",
      "https://cdn.example.com/plated.jpg",
    ]);
  });

  it("ignores empty content / whitespace-only image values", () => {
    const html = `
      <meta property="og:image" content="" />
      <meta property="og:image" content="   " />
      <meta property="og:image" content="https://cdn.example.com/real.jpg" />
    `;
    expect(findPageImageUrls(html, BASE)).toEqual([
      "https://cdn.example.com/real.jpg",
    ]);
  });
});
