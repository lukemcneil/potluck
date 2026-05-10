import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the shape of `<RecipeCard>` so loading.tsx renders a stable
 * grid layout while data streams in.
 */
export function RecipeCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <Skeleton className="aspect-4/3 w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/6" />
        <div className="mt-2 flex items-center gap-3">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

export function RecipeCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <RecipeCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
