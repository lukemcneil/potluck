import { Skeleton } from "@/components/ui/skeleton";

export default function RecipeLoading() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16 sm:px-6">
      <Skeleton className="aspect-4/3 w-full rounded-2xl" />
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-9 w-3/4" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1 h-4 w-2/3" />
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <div className="my-8 h-px bg-border" />
      <Skeleton className="h-6 w-32" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>

      <div className="my-8 h-px bg-border" />
      <Skeleton className="h-6 w-20" />
      <div className="mt-3 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
