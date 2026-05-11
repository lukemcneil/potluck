import type { Metadata } from "next";
import Link from "next/link";
import { ChefHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedList } from "@/components/recipe/FeedList";
import { FilterChips } from "@/components/filter/FilterChips";
import {
  listRecipeCards,
  listAvailableCuisines,
} from "@/lib/queries/recipes";
import { MEAL_TYPES, type MealType } from "@/db/schema";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "Feed",
  description: "Public recipes from the Potluck community.",
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    meal?: string;
    cuisine?: string;
    diet?: string;
    max?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [recipes, cuisines] = await Promise.all([
    listRecipeCards({ publicOnly: true, limit: PAGE_SIZE, ...filters }),
    listAvailableCuisines(),
  ]);

  const hasFilters = !!(
    filters.mealType ||
    filters.cuisine ||
    (filters.diets && filters.diets.length) ||
    filters.maxMinutes
  );

  // The first page may be a partial page (the only page); only set a
  // cursor when we actually filled the page so the client knows there
  // might be more.
  const initialNextOffset =
    recipes.length < PAGE_SIZE ? null : recipes.length;

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
        <Button
          render={<Link href="/add" />}
          size="sm"
          className="hidden gap-1.5 sm:inline-flex"
        >
          <Plus className="size-4" />
          Add recipe
        </Button>
      </div>

      <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <FilterChips cuisines={cuisines} className="flex-nowrap sm:flex-wrap" />
      </div>

      {recipes.length === 0 ? (
        hasFilters ? (
          <NoMatches />
        ) : (
          <EmptyState />
        )
      ) : (
        <FeedList
          // Re-key on filters so a filter change tears down the old paging
          // state and starts fresh on the new initial slice.
          key={JSON.stringify(sp)}
          initial={recipes}
          initialNextOffset={initialNextOffset}
          filters={{
            meal: sp.meal,
            cuisine: sp.cuisine,
            diet: sp.diet,
            max: sp.max,
          }}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}

function parseFilters(sp: {
  meal?: string;
  cuisine?: string;
  diet?: string;
  max?: string;
}) {
  const meal = (MEAL_TYPES as readonly string[]).includes(sp.meal ?? "")
    ? (sp.meal as MealType)
    : undefined;
  const cuisine = sp.cuisine?.trim() || undefined;
  const diets = sp.diet
    ? sp.diet
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    : undefined;
  const max = Number(sp.max);
  const maxMinutes = Number.isFinite(max) && max > 0 ? max : undefined;
  return { mealType: meal, cuisine, diets, maxMinutes };
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
      <Button render={<Link href="/add" />} className="mt-4 gap-1.5">
        <Plus className="size-4" />
        Add recipe
      </Button>
    </div>
  );
}

function NoMatches() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="font-display text-lg font-semibold">No matches</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Try clearing a filter or two.
      </p>
    </div>
  );
}
