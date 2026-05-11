import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Mirrors the shape of `<RecipeCard>` so loading.tsx renders a stable
 * grid layout while data streams in.
 */
export function RecipeCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <Skeleton className="aspect-4/3 w-full rounded-none" />
      <div
        className={cn(
          "flex flex-1 flex-col",
          compact ? "gap-1.5 p-2.5" : "gap-2 p-3 sm:p-4",
        )}
      >
        <Skeleton className={compact ? "h-4 w-3/4" : "h-5 w-3/4"} />
        {!compact && (
          <>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/6" />
          </>
        )}
        <div className={cn("flex items-center gap-2", compact ? "mt-1" : "mt-2 gap-3")}>
          {!compact && <Skeleton className="size-5 rounded-full" />}
          <Skeleton className={compact ? "h-3 w-1/2" : "h-3 w-1/3"} />
        </div>
      </div>
    </div>
  );
}

export function RecipeCardSkeletonGrid({
  count = 6,
  compact,
}: {
  count?: number;
  compact?: boolean;
}) {
  return (
    <ul
      className={cn(
        "grid",
        compact
          ? "grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
          : "grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <RecipeCardSkeleton compact={compact} />
        </li>
      ))}
    </ul>
  );
}
