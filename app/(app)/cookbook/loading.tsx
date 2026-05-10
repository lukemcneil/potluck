import { Skeleton } from "@/components/ui/skeleton";
import { RecipeCardSkeletonGrid } from "@/components/recipe/RecipeCardSkeleton";
import { CollectionCardSkeletonGrid } from "@/components/collection/CollectionCardSkeleton";

export default function CookbookLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="mt-2 h-4 w-72" />
      <section className="mt-8">
        <Skeleton className="h-6 w-40" />
        <div className="mt-3">
          <RecipeCardSkeletonGrid count={3} />
        </div>
      </section>
      <section className="mt-10">
        <Skeleton className="h-6 w-32" />
        <div className="mt-3">
          <CollectionCardSkeletonGrid count={3} />
        </div>
      </section>
    </div>
  );
}
