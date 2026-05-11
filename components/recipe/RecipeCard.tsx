import Link from "next/link";
import Image from "next/image";
import { Clock, Users, ChefHat } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  className?: string;
};

export function RecipeCard({ recipe, hideAuthor, priority, className }: Props) {
  const total = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  // The card is a single big <Link> wrapping a photo, badges, title, time,
  // servings, cuisine, and an author chip. Screen readers compute the
  // accessible name by smashing all the descendant text together, which
  // produces noise like "dinnerMarry Me Chicken Orzo Bake4-5AmericanMby
  // Meredith Crosier". Explicit aria-label keeps the announcement focused
  // on the title with a short, comma-separated context tail.
  const authorLabel =
    !hideAuthor && recipe.author
      ? `by ${recipe.author.name ?? `@${recipe.author.handle ?? ""}`}`
      : null;
  const ariaLabel = [
    recipe.title,
    authorLabel,
    recipe.cuisine,
    recipe.mealType,
  ]
    .filter(Boolean)
    .join(", ");

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
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            placeholder={recipe.photoBlurhash ? "blur" : undefined}
            blurDataURL={recipe.photoBlurhash ?? undefined}
            priority={priority}
            loading={priority ? "eager" : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/15 to-accent/10">
            <ChefHat className="size-10 text-primary/60" />
          </div>
        )}

        {recipe.visibility !== "public" && (
          <span className="absolute top-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            {recipe.visibility}
          </span>
        )}

        <div className="pointer-events-none absolute right-2 bottom-2 flex flex-wrap justify-end gap-1">
          {recipe.mealType && (
            <Badge className="border-0 bg-black/65 text-white capitalize">
              {recipe.mealType}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <h3 className="line-clamp-2 font-display text-base font-semibold tracking-tight sm:text-lg">
          {recipe.title}
        </h3>

        {recipe.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {recipe.description}
          </p>
        )}

        <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
          {total > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatMinutes(total)}
            </span>
          )}
          {recipe.servings && (
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {recipe.servings}
            </span>
          )}
          {recipe.cuisine && (
            <span className="capitalize">{recipe.cuisine}</span>
          )}
        </div>

        {!hideAuthor && recipe.author && (
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
