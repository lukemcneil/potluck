import { Skeleton } from "@/components/ui/skeleton";
import { RecipeCardSkeletonGrid } from "@/components/recipe/RecipeCardSkeleton";

export default function CollectionLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 aspect-3/2 w-full max-w-2xl rounded-2xl" />
      <Skeleton className="mt-6 h-9 w-2/3 max-w-md" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-4 h-4 w-32" />
      <div className="mt-8">
        <RecipeCardSkeletonGrid count={6} />
      </div>
    </div>
  );
}
