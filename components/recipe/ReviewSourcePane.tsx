"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type SourceUrlPane = {
  kind: "url";
  url: string;
};

type SourcePhotosPane = {
  kind: "photos";
  photos: { publicPath: string; width?: number | null; height?: number | null }[];
};

type SourceTextPane = {
  kind: "text";
  text: string;
};

export type ReviewSource = SourceUrlPane | SourcePhotosPane | SourceTextPane;

/**
 * Sticky source-preview strip rendered above the review form. Lets the
 * importer sanity-check any AI extraction against the original without
 * leaving the page (URLs open in a new tab, photo thumbnails open the
 * full asset).
 *
 * Sticks to the top of the scroll container with a small bottom shadow
 * so it always feels anchored even as the form scrolls behind it. We
 * deliberately stop short of a full drawer / split-screen layout —
 * mobile real estate is tight and a single-row strip is enough to
 * surface the affordance.
 */
export function ReviewSourcePane({ source }: { source: ReviewSource }) {
  if (source.kind === "text") {
    return <TextSourcePane text={source.text} />;
  }
  if (source.kind === "url") {
    let domain = source.url;
    try {
      domain = new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      // Bad URL — fall back to the raw string.
    }
    return (
      <Wrapper>
        <div className="flex items-center gap-2 min-w-0">
          <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground shrink-0">
            Imported from
          </span>
          <span className="truncate text-sm font-medium">{domain}</span>
        </div>
        <Link
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted"
        >
          Open original
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </Wrapper>
    );
  }

  const photos = source.photos.slice(0, 6);
  const overflow = source.photos.length - photos.length;
  return (
    <Wrapper>
      <div className="flex items-center gap-2 min-w-0">
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground shrink-0">
          Source photos
        </span>
      </div>
      <ul className="ml-auto flex shrink-0 items-center gap-1.5">
        {photos.map((p) => (
          <li key={p.publicPath}>
            {/*
              Thumbnails are clickable and open the underlying file in
              a new tab — good enough for verification without pulling
              in a full lightbox. We use plain <Image> with explicit
              size hints so Next can serve a cheap responsive variant.
            */}
            <a
              href={p.publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="block size-10 overflow-hidden rounded-md border border-border bg-muted hover:ring-2 hover:ring-primary/40"
              aria-label="Open source photo"
            >
              <Image
                src={p.publicPath}
                alt=""
                width={80}
                height={80}
                className="size-full object-cover"
              />
            </a>
          </li>
        ))}
        {overflow > 0 && (
          <li
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold text-muted-foreground"
            aria-label={`${overflow} more source photos`}
          >
            +{overflow}
          </li>
        )}
      </ul>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-border/60",
        "bg-background/95 px-4 py-2 backdrop-blur",
        "sm:-mx-6 sm:px-6",
      )}
      data-print="hide"
    >
      {children}
    </div>
  );
}

/**
 * Pasted-text imports don't have a URL to open or thumbnails to peek
 * at, so we offer an inline collapsible source pane: the row keeps the
 * "Imported from text" label and toggle, and expanding it reveals the
 * verbatim paste in a capped-height scrollable region underneath. This
 * lives in its own block instead of {@link Wrapper}'s flex row so the
 * expanded text can stack below the header on mobile without
 * stretching the sticky bar.
 */
function TextSourcePane({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 border-b border-border/60",
        "bg-background/95 px-4 py-2 backdrop-blur",
        "sm:-mx-6 sm:px-6",
      )}
      data-print="hide"
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground shrink-0">
          Imported from
        </span>
        <span className="truncate text-sm font-medium">pasted text</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="review-source-text"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted"
        >
          {open ? "Hide source" : "View source"}
          {open ? (
            <ChevronUp className="size-3" aria-hidden />
          ) : (
            <ChevronDown className="size-3" aria-hidden />
          )}
        </button>
      </div>
      {open && (
        <div
          id="review-source-text"
          className={cn(
            "mt-2 max-h-48 overflow-y-auto rounded-md border border-border/60",
            "bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground",
            "whitespace-pre-wrap font-mono",
          )}
        >
          {trimmed}
        </div>
      )}
    </div>
  );
}
