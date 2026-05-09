import { ChefHat } from "lucide-react";

export const dynamic = "force-dynamic";

export default function FeedPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        What&apos;s cooking
      </h1>
      <p className="mt-1 text-muted-foreground">
        A taste of what people are sharing on Potluck.
      </p>

      <EmptyState />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <ChefHat className="size-10 text-muted-foreground" />
      <h2 className="mt-4 font-display text-xl font-semibold">
        The feed is warming up
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Once people start sharing recipes you&apos;ll see them here. Be the first —
        snap a photo of a recipe card to add one.
      </p>
    </div>
  );
}
