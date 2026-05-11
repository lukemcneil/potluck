import Link from "next/link";
import Image from "next/image";
import { BookmarkCheck, Globe, Lock, EyeOff, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollectionSummary } from "@/lib/queries/collections";

type Props = {
  collection: CollectionSummary;
  /**
   * `viewerHandle` controls where the card links: when present we send the
   * viewer to /u/<handle>/c/<slug>. If null, the card isn't linked
   * (rare — used when rendered standalone).
   */
  viewerHandle?: string | null;
  className?: string;
};

export function CollectionCard({ collection, viewerHandle, className }: Props) {
  const handle = viewerHandle ?? collection.ownerHandle ?? null;
  const href = handle ? `/u/${handle}/c/${collection.slug}` : "#";

  // Without an explicit label, the card's accessible name is the smushed
  // concatenation of descendant text (e.g. "Test collection1 recipePublic").
  // We synthesize a clean comma-separated label.
  const recipeWord = collection.recipeCount === 1 ? "recipe" : "recipes";
  const ariaLabel = [
    collection.name,
    `${collection.recipeCount} ${recipeWord}`,
    collection.visibility === "public"
      ? "public"
      : collection.visibility === "unlisted"
        ? "unlisted"
        : "private",
  ].join(", ");

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:shadow-md",
        className,
      )}
    >
      <div className="relative aspect-3/2 w-full overflow-hidden bg-muted">
        {collection.coverPhoto ? (
          <Image
            src={collection.coverPhoto}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/10 to-accent/10">
            <Folder className="size-10 text-primary/50" />
          </div>
        )}
        {collection.isDefaultSaves && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            <BookmarkCheck className="size-3" />
            Saves
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        <h3 className="line-clamp-1 font-display text-base font-semibold tracking-tight sm:text-lg">
          {collection.name}
        </h3>
        {collection.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {collection.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {`${collection.recipeCount} recipe${collection.recipeCount === 1 ? "" : "s"}`}
          </span>
          <VisibilityChip visibility={collection.visibility} />
        </div>
      </div>
    </Link>
  );
}

function VisibilityChip({ visibility }: { visibility: "public" | "unlisted" | "private" }) {
  if (visibility === "public") {
    return (
      <span className="inline-flex items-center gap-1">
        <Globe className="size-3" />
        Public
      </span>
    );
  }
  if (visibility === "unlisted") {
    return (
      <span className="inline-flex items-center gap-1">
        <EyeOff className="size-3" />
        Unlisted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Lock className="size-3" />
      Private
    </span>
  );
}
