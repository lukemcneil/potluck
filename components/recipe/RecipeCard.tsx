import Link from "next/link";
import Image from "next/image";
import { Clock, Users, ChefHat } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RatingChip } from "@/components/recipe/RatingControl";

export type RecipeCardData = {
  id: string;
  title: string;
  description: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: string | null;
  mealType: string | null;
  cuisine: string | null;
  visibility: "public" | "unlisted" | "private";
  photoPath: string | null;
  photoBlurhash: string | null;
  author: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  } | null;
  /** Public average (excludes the author's self-rating). Null when 0 ratings. */
  avgRating?: number | null;
  /** Count of NON-author ratings — see above. */
  ratingCount?: number;
};

type Props = {
  recipe: RecipeCardData;
  /** Hide the author block (e.g. when shown on the author's own profile). */
  hideAuthor?: boolean;
  /**
   * Render the photo with `priority` (and skip lazy loading) so it can be
   * the LCP element. Set this on the first card or two of an above-the-fold
   * grid; everything else should stay default-lazy.
   */
  priority?: boolean;
  /**
   * Compact mode trades the description and author chip for density.
   * Used by the feed to fit more recipes per screen on mobile.
   */
  compact?: boolean;
  /**
   * Heading level for the card title. Defaults to `h2` so the typical
   * "page H1 → cards H2" structure (feed, search, profile) passes
   * axe-core's `heading-order` rule. Pages that already nest the cards
   * under an H2 (e.g. a tabbed section with its own heading) can pass
   * `"h3"` to keep the document outline tidy.
   */
  headingLevel?: "h2" | "h3";
  className?: string;
};

export function RecipeCard({
  recipe,
  hideAuthor,
  priority,
  compact,
  headingLevel = "h2",
  className,
}: Props) {
  const total = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  const showAuthor = !hideAuthor && !compact && recipe.author;

  // The card is a single big <Link> that wraps a photo + title + a few
  // metadata strips. axe-core's `label-content-name-mismatch` rule
  // requires every piece of *visible* text to also appear in the
  // accessible name, so we build the aria-label from the same fields
  // we render — in the same visible order. (Without an aria-label the
  // SR would smash them all together with no separators, producing
  // "dinnerMarry Me Chicken Orzo Bake4-5American…".)
  const totalLabel = total > 0 ? formatMinutes(total) : null;
  const servingsLabel = recipe.servings;
  const authorLabel = recipe.author
    ? `by ${recipe.author.name ?? `@${recipe.author.handle ?? ""}`}`
    : null;
  const visibilityLabel =
    recipe.visibility !== "public" ? recipe.visibility : null;
  const ratingLabel =
    recipe.ratingCount && recipe.avgRating != null
      ? recipe.avgRating.toFixed(1)
      : null;
  const ariaLabel = [
    visibilityLabel,
    recipe.title,
    !compact && recipe.description ? recipe.description : null,
    totalLabel,
    servingsLabel,
    !compact && recipe.cuisine ? recipe.cuisine : null,
    !compact && recipe.mealType ? recipe.mealType : null,
    ratingLabel,
    showAuthor ? authorLabel : null,
  ]
    .filter(Boolean)
    .join(", ");

  const Heading = headingLevel;

  // Tighter sizes hint for compact mode: up to 5 cols on xl screens.
  const photoSizes = compact
    ? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
    : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

  return (
    <Link
      href={`/r/${recipe.id}`}
      aria-label={ariaLabel}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:shadow-md",
        className,
      )}
    >
      <div className="relative aspect-4/3 w-full overflow-hidden bg-muted">
        {recipe.photoPath ? (
          <Image
            src={recipe.photoPath}
            alt=""
            fill
            sizes={photoSizes}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            placeholder={recipe.photoBlurhash ? "blur" : undefined}
            blurDataURL={recipe.photoBlurhash ?? undefined}
            priority={priority}
            loading={priority ? "eager" : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/15 to-accent/10">
            <ChefHat className={cn(compact ? "size-7" : "size-10", "text-primary/60")} />
          </div>
        )}

        {recipe.visibility !== "public" && (
          <span className="absolute top-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            {recipe.visibility}
          </span>
        )}

        {!compact && (
          <div className="pointer-events-none absolute right-2 bottom-2 flex flex-wrap justify-end gap-1">
            {recipe.mealType && (
              <Badge className="border-0 bg-black/65 text-white capitalize">
                {recipe.mealType}
              </Badge>
            )}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-1 flex-col",
          compact ? "gap-1 p-2.5" : "gap-2 p-3 sm:p-4",
        )}
      >
        <Heading
          className={cn(
            "line-clamp-2 font-display font-semibold tracking-tight",
            compact ? "text-sm" : "text-base sm:text-lg",
          )}
        >
          {recipe.title}
        </Heading>

        {!compact && recipe.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {recipe.description}
          </p>
        )}

        <div
          className={cn(
            "mt-auto flex items-center text-muted-foreground",
            compact ? "gap-2 text-[11px]" : "gap-3 text-xs",
          )}
        >
          {total > 0 && (
            <span className="flex items-center gap-1">
              <Clock className={compact ? "size-3" : "size-3.5"} />
              {formatMinutes(total)}
            </span>
          )}
          {recipe.servings && (
            <span className="flex items-center gap-1">
              <Users className={compact ? "size-3" : "size-3.5"} />
              {recipe.servings}
            </span>
          )}
          {!compact && recipe.cuisine && (
            <span className="capitalize">{recipe.cuisine}</span>
          )}
          {recipe.ratingCount && recipe.avgRating != null ? (
            <RatingChip
              avg={recipe.avgRating}
              count={recipe.ratingCount}
            />
          ) : null}
        </div>

        {showAuthor && recipe.author && (
          <div className="flex items-center gap-2 border-t border-border pt-2 text-xs">
            <Avatar className="size-5">
              <AvatarImage src={recipe.author.image ?? undefined} alt="" />
              <AvatarFallback>
                {(recipe.author.name ?? recipe.author.handle ?? "?")
                  .charAt(0)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-muted-foreground">
              by{" "}
              <span className="text-foreground">
                {recipe.author.name ?? `@${recipe.author.handle}`}
              </span>
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
