import Link from "next/link";
import { ChefHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { listRecipeCards } from "@/lib/queries/recipes";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const recipes = await listRecipeCards({ publicOnly: true, limit: 48 });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            What&apos;s cooking
          </h1>
          <p className="mt-1 text-muted-foreground">
            Public recipes from the Potluck community.
          </p>
        </div>
        <Link href="/add" className="hidden sm:block">
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" />
            Add recipe
          </Button>
        </Link>
      </div>

      {recipes.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <li key={r.id}>
              <RecipeCard recipe={r} />
            </li>
          ))}
        </ul>
      )}
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
        Once people start sharing recipes you&apos;ll see them here. Be the
        first — snap a photo of a recipe card to add one.
      </p>
      <Link href="/add" className="mt-4">
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add recipe
        </Button>
      </Link>
    </div>
  );
}
