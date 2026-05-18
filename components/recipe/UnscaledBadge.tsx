import { Info } from "lucide-react";

/**
 * Tiny inline pill that appears next to ingredients whose original
 * text isn't a parseable number ("a pinch", "to taste", "scant 1/2
 * cup"). Shown only when the user has actually rescaled — at the
 * base servings/factor everything is at its original amount, so
 * there's nothing to disclose.
 *
 * The badge resolves the silent-failure mode where a scaled recipe
 * looked correct but quietly left "a pinch" / "to taste" rows at
 * their original values, misleading cooks who'd doubled everything
 * else.
 *
 * Used by both `RecipeBody` (detail page) and `CookMode`
 * (full-screen cook view). Keep it presentational — all the "should
 * we show this?" logic lives in the parent and is driven by whether
 * the row's `quantityNumeric` companion is null at the time the
 * user has scaled away from 1×.
 */
export function UnscaledBadge({
  originalQuantity,
}: {
  originalQuantity: string | null;
}) {
  const label = originalQuantity
    ? `Stays at "${originalQuantity}" — couldn't scale automatically`
    : "Couldn't scale automatically";
  return (
    <span
      role="note"
      title={label}
      aria-label={label}
      className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground"
    >
      <Info className="size-2.5" aria-hidden />
      won&apos;t scale
    </span>
  );
}
