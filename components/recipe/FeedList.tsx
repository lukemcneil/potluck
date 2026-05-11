"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { RecipeCard, type RecipeCardData } from "@/components/recipe/RecipeCard";
import {
  loadMoreFeedAction,
  type LoadMoreFeedInput,
} from "@/lib/actions/feed";

type Filters = Pick<LoadMoreFeedInput, "meal" | "cuisine" | "diet" | "max">;

type Props = {
  /** First page rendered server-side. */
  initial: RecipeCardData[];
  /** Cursor for the next page; null when the first page was the tail. */
  initialNextOffset: number | null;
  /** Filters in URL-shape so we can re-issue them to the server action. */
  filters: Filters;
  /** Page size. Server clamps to 1..48. */
  pageSize?: number;
};

export function FeedList({
  initial,
  initialNextOffset,
  filters,
  pageSize = 24,
}: Props) {
  // Initial state seeds from the server-rendered first page. The parent
  // (/feed) keys this component on the URL params, so a filter change
  // remounts us with a fresh `initial` rather than us mirroring the
  // prop into state via a useEffect.
  const [items, setItems] = useState<RecipeCardData[]>(initial);
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || nextOffset == null) return;

    let inflight = false;
    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || inflight) return;
        inflight = true;
        setLoading(true);
        setError(null);
        try {
          const res = await loadMoreFeedAction({
            ...filters,
            offset: nextOffset,
            limit: pageSize,
          });
          setItems((prev) => dedupeById([...prev, ...res.recipes]));
          setNextOffset(res.nextOffset);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Couldn't load more recipes",
          );
        } finally {
          inflight = false;
          setLoading(false);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [filters, nextOffset, pageSize]);

  const hasMore = nextOffset != null;

  return (
    <>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((r, i) => (
          <li key={r.id}>
            <RecipeCard recipe={r} priority={i < 4} compact />
          </li>
        ))}
      </ul>

      {hasMore && (
        <div
          ref={sentinelRef}
          className="mt-6 flex items-center justify-center py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading more recipes…
            </span>
          ) : (
            // Visible placeholder so the sentinel has actual height for the
            // observer to track. Reads as nothing for screen readers.
            <span aria-hidden>&nbsp;</span>
          )}
        </div>
      )}

      {!hasMore && items.length >= 12 && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          You&apos;ve reached the end of the feed.
        </p>
      )}

      {error && (
        <p className="mt-3 text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Pagination cursors are by-offset, so a concurrent insert near the
 * head of the list could rarely repeat an id between pages. Drop dupes.
 */
function dedupeById(rows: RecipeCardData[]): RecipeCardData[] {
  const seen = new Set<string>();
  const out: RecipeCardData[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
