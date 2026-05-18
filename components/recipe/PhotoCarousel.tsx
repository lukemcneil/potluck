"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { PhotoLightbox } from "@/components/recipe/PhotoLightbox";

export type CarouselPhoto = {
  id: string;
  path: string;
  blurhash: string | null;
};

type Props = {
  photos: CarouselPhoto[];
  alt: string;
  /** Set on the first slide so the LCP image loads eagerly. */
  priority?: boolean;
};

/**
 * Horizontal scroll-snap carousel with dot indicators and (on desktop)
 * arrow buttons. Single-photo input renders just the image with no
 * controls.
 */
export function PhotoCarousel({ photos, alt, priority = true }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Lightbox state: which photo to open, and whether it's open.
  // Tap-vs-drag is disambiguated below with a small pixel threshold
  // so dragging the carousel doesn't accidentally open the viewer.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  }
  function handlePointerUp(e: React.PointerEvent, index: number) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    // 8px feels right empirically — small enough that a stationary tap
    // is unambiguous, large enough that fingers shaking on a touchscreen
    // don't accidentally trigger the lightbox while scrolling the strip.
    if (dx < 8 && dy < 8) setLightboxIndex(index);
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (photos.length <= 1) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the slide with the largest intersection ratio. We can't
        // assume only one is intersecting because of partial overlap
        // mid-swipe.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length === 0) return;
        const target = visible[0].target as HTMLElement;
        const i = Number(target.dataset.index);
        if (Number.isFinite(i)) setActiveIndex(i);
      },
      {
        root: scroller,
        threshold: [0.5, 0.75, 1],
      },
    );

    for (const li of slideRefs.current) if (li) observer.observe(li);
    return () => observer.disconnect();
  }, [photos.length]);

  const scrollToIndex = (i: number) => {
    const target = slideRefs.current[i];
    if (target) target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  if (photos.length === 0) return null;

  if (photos.length === 1) {
    const p = photos[0];
    return (
      <>
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          aria-label="Open photo at full size"
          className="relative block w-full overflow-hidden rounded-2xl bg-muted cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <div className="relative aspect-4/3 w-full">
            <Image
              src={p.path}
              alt={alt}
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
              placeholder={p.blurhash ? "blur" : undefined}
              blurDataURL={p.blurhash ?? undefined}
              priority={priority}
            />
          </div>
        </button>
        <PhotoLightbox
          photos={photos}
          open={lightboxIndex !== null}
          initialIndex={lightboxIndex ?? 0}
          onOpenChange={(open) => {
            if (!open) setLightboxIndex(null);
          }}
        />
      </>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-muted">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={`${alt} photo carousel`}
      >
        <ul className="flex w-full">
          {photos.map((p, i) => (
            <li
              key={p.id}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              data-index={i}
              className="relative aspect-4/3 w-full shrink-0 snap-start"
              onPointerDown={handlePointerDown}
              onPointerUp={(e) => handlePointerUp(e, i)}
            >
              <Image
                src={p.path}
                alt={i === 0 ? alt : ""}
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover cursor-zoom-in"
                placeholder={p.blurhash ? "blur" : undefined}
                blurDataURL={p.blurhash ?? undefined}
                priority={priority && i === 0}
              />
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => scrollToIndex(Math.max(0, activeIndex - 1))}
        aria-label="Previous photo"
        className={cn(
          "absolute top-1/2 left-2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100 sm:flex",
          activeIndex === 0 && "pointer-events-none opacity-0",
        )}
      >
        <ChevronLeft className="size-5" />
      </button>
      <button
        type="button"
        onClick={() =>
          scrollToIndex(Math.min(photos.length - 1, activeIndex + 1))
        }
        aria-label="Next photo"
        className={cn(
          "absolute top-1/2 right-2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100 sm:flex",
          activeIndex === photos.length - 1 && "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight className="size-5" />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => scrollToIndex(i)}
              aria-label={`Go to photo ${i + 1}`}
              aria-current={i === activeIndex ? "true" : undefined}
              className={cn(
                "size-1.5 rounded-full transition",
                i === activeIndex
                  ? "w-4 bg-white"
                  : "bg-white/55 hover:bg-white/80",
              )}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
        {activeIndex + 1} / {photos.length}
      </div>

      <PhotoLightbox
        photos={photos}
        open={lightboxIndex !== null}
        initialIndex={lightboxIndex ?? 0}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null);
        }}
      />
    </div>
  );
}
