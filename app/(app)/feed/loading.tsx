import { Skeleton } from "@/components/ui/skeleton";
import { RecipeCardSkeletonGrid } from "@/components/recipe/RecipeCardSkeleton";

export default function FeedLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="mt-6">
        <RecipeCardSkeletonGrid count={10} compact />
      </div>
    </div>
  );
}
