import { BookmarkCheck } from "lucide-react";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CookbookPage() {
  await requireSession("/cookbook");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        My Cookbook
      </h1>
      <p className="mt-1 text-muted-foreground">
        Recipes you&apos;ve saved, organized into collections.
      </p>

      <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <BookmarkCheck className="size-10 text-muted-foreground" />
        <h2 className="mt-4 font-display text-xl font-semibold">
          No saves yet
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          When you find a recipe you love, tap save and it&apos;ll show up here.
        </p>
      </div>
    </div>
  );
}
