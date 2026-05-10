import { Skeleton } from "@/components/ui/skeleton";
import { RecipeCardSkeletonGrid } from "@/components/recipe/RecipeCardSkeleton";

export default function ProfileLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex items-start gap-4">
        <Skeleton className="size-20 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="mt-8 flex gap-2 border-b border-border">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="mt-6">
        <RecipeCardSkeletonGrid count={6} />
      </div>
    </div>
  );
}
