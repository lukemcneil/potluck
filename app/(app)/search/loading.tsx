import { Skeleton } from "@/components/ui/skeleton";
import { RecipeCardSkeletonGrid } from "@/components/recipe/RecipeCardSkeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Skeleton className="mt-6 h-10 w-full max-w-md rounded-md" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="mt-8">
        <RecipeCardSkeletonGrid count={6} />
      </div>
    </div>
  );
}
