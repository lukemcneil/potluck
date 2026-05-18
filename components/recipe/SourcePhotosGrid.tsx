"use client";

import { useState } from "react";

import {
  PhotoLightbox,
  type LightboxPhoto,
} from "@/components/recipe/PhotoLightbox";

type Props = {
  photos: LightboxPhoto[];
};

/**
 * Thumbnail grid for "source" photos — the original paper recipe
 * card, magazine page, or whatever the recipe was lifted from. The
 * actual readable recipe text lives on these images (especially for
 * hand-typed family recipes), so the grid hands off to the
 * full-screen PhotoLightbox on tap rather than opening the raw file
 * in a new tab.
 *
 * Lives as a small client component so the lightbox state (which
 * photo is open, fit vs actual size) doesn't have to bubble up
 * through the server-rendered recipe page.
 */
export function SourcePhotosGrid({ photos }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <section
      className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-4 sm:p-5"
      aria-labelledby="source-materials-heading"
    >
      <h2
        id="source-materials-heading"
        className="font-display text-base font-semibold tracking-tight"
      >
        Source materials
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Original photos kept for reference — the paper card, the magazine
        page, or whatever this recipe was lifted from. Tap to view at full
        size; tap again to zoom in and read the printed text.
      </p>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {photos.map((p, i) => (
          <li
            key={p.id}
            className="group relative aspect-square overflow-hidden rounded-lg bg-muted"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={`Open source photo ${i + 1} at full size`}
              className="block size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.path}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
              />
            </button>
          </li>
        ))}
      </ul>

      <PhotoLightbox
        photos={photos}
        open={openIndex !== null}
        initialIndex={openIndex ?? 0}
        onOpenChange={(open) => {
          if (!open) setOpenIndex(null);
        }}
      />
    </section>
  );
}
