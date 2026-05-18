"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type LightboxPhoto = {
  id: string;
  path: string;
  blurhash: string | null;
};

type Props = {
  photos: LightboxPhoto[];
  open: boolean;
  initialIndex?: number;
  onOpenChange: (open: boolean) => void;
};

/**
 * Full-viewport modal photo viewer. Opens when the user taps a
 * thumbnail or carousel image, lets them flip through the recipe's
 * photos at large size, and toggles between "fit-to-viewport" and
 * "actual size" so they can actually read the handwritten/printed
 * recipe text on a paper card or magazine clipping.
 *
 * Why this exists at all: paper-recipe-card-as-source-photo is one
 * of the primary use cases of this app — the AI extraction is
 * approximate, and viewers want to consult the original card mid-cook
 * when something looks off. Previously source photos opened in a new
 * browser tab via plain `<a href>`, which (a) kicked the user out of
 * the PWA's controlled UX, and (b) on iOS Safari sometimes opened a
 * download prompt instead of a viewer.
 *
 * Zoom strategy:
 *   - Default: object-contain inside the viewport, so the whole
 *     image fits with no overflow scroll. Cursor / aria hint indicate
 *     it's tappable.
 *   - "Actual size" toggle: drops the size constraints and wraps the
 *     image in an overflow:auto container so the user can pan around
 *     it with a finger or mouse. This is enough to read the printed
 *     text on most photos at any reasonable phone resolution.
 *   - Browser pinch-to-zoom still works on top of either mode (the
 *     viewport meta in app/layout.tsx allows maximumScale: 5). That's
 *     the escape hatch for the cases where the user wants finer
 *     control.
 *
 * Keyboard:
 *   - Esc closes (handled by the Dialog primitive)
 *   - ←/→ navigates between photos when there are multiple
 */
export function PhotoLightbox({
  photos,
  open,
  initialIndex = 0,
  onOpenChange,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [actualSize, setActualSize] = useState(false);

  // Re-anchor to whichever photo the user actually tapped, and reset
  // back to fit-to-viewport so each new image starts at a sane size.
  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
      setActualSize(false);
    }
  }, [open, initialIndex]);

  // Arrow-key navigation. Bound to the document only while open so
  // we don't fight other keyboard handlers on the underlying page.
  useEffect(() => {
    if (!open || photos.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
        setActualSize(false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(photos.length - 1, i + 1));
        setActualSize(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, photos.length]);

  if (photos.length === 0) return null;
  const photo = photos[index];
  const hasMultiple = photos.length > 1;
  const atFirst = index === 0;
  const atLast = index === photos.length - 1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-60 bg-black/95",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-0 z-60 flex flex-col outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Photo viewer
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Use the actual-size button or pinch to zoom; arrow keys to switch
            photos.
          </DialogPrimitive.Description>

          {/*
            Top toolbar. Sits above the iOS notch / dynamic-island
            via the safe-area inset and stays on top of the image so
            the close button is always reachable, even when the image
            is "actual size" and the user has scrolled deep into it.
          */}
          <div
            className={cn(
              "flex items-center justify-between gap-2 px-3 py-2",
              "pt-[max(env(safe-area-inset-top),0.5rem)]",
            )}
          >
            <span className="text-xs font-medium text-white/80 tabular-nums">
              {hasMultiple ? `${index + 1} / ${photos.length}` : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActualSize((z) => !z)}
                aria-pressed={actualSize}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/20"
              >
                {actualSize ? (
                  <>
                    <Minimize2 className="size-3.5" aria-hidden />
                    Fit
                  </>
                ) : (
                  <>
                    <Maximize2 className="size-3.5" aria-hidden />
                    Actual size
                  </>
                )}
              </button>
              <DialogPrimitive.Close
                aria-label="Close photo viewer"
                className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/*
            Image container. Two layout modes:
              - !actualSize: image is object-contain inside the
                flex-1 fill, no scrolling — the whole thing fits and
                a tap toggles into actual-size.
              - actualSize: image gets its natural width, container
                becomes scrollable both axes, tap returns to fit.

            Using a plain <img> (not next/image) on purpose: we want
            the full-resolution stored file so users can actually
            read the printed/handwritten recipe. next/image would
            serve a downscaled variant via the optimizer.
          */}
          <div
            className={cn(
              "relative flex flex-1 items-center justify-center",
              actualSize ? "overflow-auto" : "overflow-hidden",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.path}
              alt=""
              onClick={() => setActualSize((z) => !z)}
              className={cn(
                "select-none transition-[max-width,max-height] duration-150",
                actualSize
                  ? "max-h-none max-w-none cursor-zoom-out"
                  : "max-h-full max-w-full cursor-zoom-in object-contain",
              )}
              // Render at full natural resolution; the browser handles
              // pinch-to-zoom on top of whichever mode we're in.
              draggable={false}
            />
          </div>

          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIndex((i) => Math.max(0, i - 1));
                  setActualSize(false);
                }}
                disabled={atFirst}
                aria-label="Previous photo"
                className={cn(
                  "absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur",
                  "hover:bg-white/25 active:scale-95",
                  "disabled:opacity-25",
                )}
              >
                <ChevronLeft className="size-6" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIndex((i) => Math.min(photos.length - 1, i + 1));
                  setActualSize(false);
                }}
                disabled={atLast}
                aria-label="Next photo"
                className={cn(
                  "absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur",
                  "hover:bg-white/25 active:scale-95",
                  "disabled:opacity-25",
                )}
              >
                <ChevronRight className="size-6" aria-hidden />
              </button>
            </>
          )}

          {/*
            Footer escape hatch: open the raw file in a new tab for
            cases where the modal's "actual size" still isn't enough
            (e.g. user wants to download / share the photo as a file).
            Keeps the previous behaviour from when source photos were
            plain anchor tags available as a deliberate option.
          */}
          <div className="flex justify-center pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
            <a
              href={photo.path}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2.5 py-1 text-xs text-white/70 hover:text-white"
            >
              Open original file
            </a>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
