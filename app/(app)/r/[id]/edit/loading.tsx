import { Skeleton } from "@/components/ui/skeleton";

export default function EditRecipeLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 sm:px-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-9 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-8 space-y-6">
        <div>
          <Skeleton className="h-5 w-24" />
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>

        <div className="space-y-2">
          <Skeleton className="h-5 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
