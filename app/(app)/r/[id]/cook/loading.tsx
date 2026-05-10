import { Skeleton } from "@/components/ui/skeleton";

export default function CookLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <Skeleton className="size-9 rounded-md" />
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-border px-4 py-4 sm:px-6 md:w-80 md:border-r md:border-b-0">
          <Skeleton className="h-3 w-24" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
            <Skeleton className="h-8 w-4/6" />
          </div>
        </main>
      </div>
    </div>
  );
}
