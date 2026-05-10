import { Skeleton } from "@/components/ui/skeleton";

export default function AddLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
