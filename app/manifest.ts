import type { MetadataRoute } from "next";

/**
 * Web App Manifest.
 *
 * Two PWA-only fields worth flagging:
 *
 * - `share_target` registers Potluck as a destination in the OS share
 *   sheet once installed. When the user taps "Share -> Potluck" from
 *   Instagram/Safari/Chrome, the browser POSTs the shared payload
 *   (title/text/url + any image files) to `/share-receive`, which
 *   turns it into the same flow as `/add`. Only available after
 *   install, on browsers that implement the spec (mainly Chrome on
 *   Android right now).
 *
 * - `shortcuts` give long-press app-icon menus for "New recipe" and
 *   "Open feed". Pure Android Chrome niceity; ignored elsewhere.
 *
 * Note: Next's `Manifest` type is missing `share_target` and
 * `shortcuts` at the root. We cast through `Record` so we can ship the
 * spec-compliant fields without losing type safety on the rest.
 */
export default function manifest(): MetadataRoute.Manifest {
  const base: MetadataRoute.Manifest = {
    // Stable app identity, independent of which host is serving the
    // manifest. Without `id`, Chrome derives identity from
    // `start_url`, which means an install from a dev URL (localhost,
    // ngrok, etc) and an install from prod look like the SAME app to
    // the platform — and a stale install can quietly intercept share
    // intents, sending the user to a localhost URL on Android. The
    // value here just has to be stable; "/" is the canonical choice.
    id: "/",
    name: "Potluck",
    short_name: "Potluck",
    description:
      "Snap a photo of any recipe and Potluck turns it into a beautiful, shareable recipe card.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF6EF",
    theme_color: "#C2462C",
    categories: ["food", "lifestyle", "social"],
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };

  const extras = {
    share_target: {
      action: "/share-receive",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "photos",
            accept: ["image/*"],
          },
        ],
      },
    },
    shortcuts: [
      {
        name: "New recipe",
        short_name: "Add",
        url: "/add",
        icons: [{ src: "/icons/icon-192.svg", sizes: "192x192" }],
      },
      {
        name: "Open feed",
        short_name: "Feed",
        url: "/feed",
        icons: [{ src: "/icons/icon-192.svg", sizes: "192x192" }],
      },
    ],
  };

  return { ...base, ...extras } as MetadataRoute.Manifest;
}
