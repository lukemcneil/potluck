import { Skeleton } from "@/components/ui/skeleton";

export function CollectionCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <Skeleton className="aspect-3/2 w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3 sm:p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function CollectionCardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <CollectionCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
