"use client";

import { useState, useTransition, useEffect } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { setRatingAction, clearRatingAction } from "@/lib/actions/ratings";

type Props = {
  recipeId: string;
  /** Current viewer's rating, 1..5, or null if they haven't rated. */
  initialValue: number | null;
  /** Public summary across all *non-author* ratings. */
  avg: number | null;
  count: number;
  /**
   * `false` for signed-out viewers — we show the static average and
   * disable interaction with a tooltip-y "Sign in to rate" hint.
   */
  canRate: boolean;
  className?: string;
};

/**
 * Five-star rating control. Hover (or arrow-key focus) previews the
 * value; click commits it via `setRatingAction`. Clicking the same
 * star you've already selected clears the rating.
 *
 * The component is optimistic: the chosen value is applied immediately
 * to the local state and the public summary, then rolled back on
 * server error. Server-driven `revalidatePath` provides the canonical
 * refresh on the next navigation.
 */
export function RatingControl({
  recipeId,
  initialValue,
  avg,
  count,
  canRate,
  className,
}: Props) {
  const [value, setValue] = useState<number | null>(initialValue);
  const [hover, setHover] = useState<number | null>(null);
  const [optAvg, setOptAvg] = useState<number | null>(avg);
  const [optCount, setOptCount] = useState<number>(count);
  const [isPending, startTransition] = useTransition();

  // Keep local state in sync if the parent re-fetches and passes new
  // values (e.g. after another viewer rates and we navigate away/back).
  // Deferred to a microtask so React 19's `set-state-in-effect` lint
  // is happy — this really is the "external prop changed, sync local
  // state" use case the rule allows for.
  useEffect(() => {
    queueMicrotask(() => {
      setValue(initialValue);
      setOptAvg(avg);
      setOptCount(count);
    });
  }, [initialValue, avg, count]);

  const display = hover ?? value ?? 0;
  const stars = [1, 2, 3, 4, 5];

  function commit(next: number) {
    if (!canRate) {
      toast.message("Sign in to rate");
      return;
    }
    const previous = value;
    const previousAvg = optAvg;
    const previousCount = optCount;

    if (previous === next) {
      // Toggle off.
      setValue(null);
      // Optimistic average rollback: subtract this user's contribution.
      if (previousCount > 0 && previousAvg != null) {
        const totalBefore = previousAvg * previousCount;
        const totalAfter = totalBefore - previous;
        const countAfter = previousCount - 1;
        setOptAvg(countAfter > 0 ? totalAfter / countAfter : null);
        setOptCount(countAfter);
      }
      startTransition(async () => {
        const res = await clearRatingAction(recipeId);
        if (!res.ok) {
          setValue(previous);
          setOptAvg(previousAvg);
          setOptCount(previousCount);
          toast.error(res.error ?? "Couldn't clear your rating.");
        }
      });
      return;
    }

    setValue(next);
    if (previous == null) {
      // Net new rating: add to average.
      const totalBefore = (previousAvg ?? 0) * previousCount;
      const countAfter = previousCount + 1;
      setOptAvg((totalBefore + next) / countAfter);
      setOptCount(countAfter);
    } else if (previousCount > 0 && previousAvg != null) {
      // Updated rating: swap the contribution in place.
      const totalBefore = previousAvg * previousCount;
      const totalAfter = totalBefore - previous + next;
      setOptAvg(totalAfter / previousCount);
    }

    startTransition(async () => {
      const res = await setRatingAction(recipeId, next);
      if (!res.ok) {
        setValue(previous);
        setOptAvg(previousAvg);
        setOptCount(previousCount);
        toast.error(res.error ?? "Couldn't save your rating.");
      }
    });
  }

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      role="radiogroup"
      aria-label={
        value
          ? `Your rating: ${value} of 5 stars. Tap a star to update.`
          : "Rate this recipe"
      }
    >
      <div
        className="flex items-center gap-0.5"
        onMouseLeave={() => setHover(null)}
      >
        {stars.map((star) => {
          const filled = star <= display;
          const isCurrent = value === star;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              aria-label={`${star} star${star > 1 ? "s" : ""}`}
              onClick={() => commit(star)}
              onMouseEnter={() => canRate && setHover(star)}
              onFocus={() => canRate && setHover(star)}
              onBlur={() => setHover(null)}
              disabled={isPending}
              className={cn(
                "rounded p-0.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                canRate ? "cursor-pointer" : "cursor-default",
                isPending && "opacity-60",
              )}
            >
              <Star
                className={cn(
                  "size-5 transition",
                  filled
                    ? "fill-yellow-400 text-yellow-400"
                    : "fill-transparent text-muted-foreground/40",
                )}
              />
            </button>
          );
        })}
      </div>

      <span className="text-xs tabular-nums text-muted-foreground">
        {optCount > 0 ? (
          <>
            <span className="font-semibold text-foreground">
              {optAvg?.toFixed(1) ?? "–"}
            </span>{" "}
            ({optCount})
          </>
        ) : (
          "no ratings yet"
        )}
      </span>
    </div>
  );
}

/**
 * Read-only inline star + number used inside RecipeCard. Compact: just
 * one star icon and a text average. Hidden by parent when count is 0.
 */
export function RatingChip({
  avg,
  count,
  className,
}: {
  avg: number | null;
  count: number;
  className?: string;
}) {
  if (avg == null || count === 0) return null;
  return (
    <span
      className={cn("flex items-center gap-1 tabular-nums", className)}
      aria-label={`${avg.toFixed(1)} stars from ${count} rating${
        count === 1 ? "" : "s"
      }`}
    >
      <Star
        className="size-3 fill-yellow-400 text-yellow-400"
        aria-hidden
      />
      {avg.toFixed(1)}
    </span>
  );
}
