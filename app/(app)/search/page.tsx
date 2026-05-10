import type { Metadata } from "next";
import Link from "next/link";
import { Search as SearchIcon, Users, ChefHat } from "lucide-react";

import { searchUsers } from "@/lib/queries/users";
import {
  searchRecipes,
  listRecipeCards,
  listAvailableCuisines,
} from "@/lib/queries/recipes";
import { UserCard } from "@/components/user/UserCard";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { SearchBox } from "@/components/search/SearchBox";
import { FilterChips } from "@/components/filter/FilterChips";
import { MEAL_TYPES, type MealType } from "@/db/schema";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function pick(sp: SP, key: string): string | undefined {
  const v = sp[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseRecipeFilters(sp: SP) {
  const meal = pick(sp, "meal");
  const cuisine = pick(sp, "cuisine");
  const dietParam = pick(sp, "diet");
  const maxParam = pick(sp, "max");
  const mealType = (MEAL_TYPES as readonly string[]).includes(meal ?? "")
    ? (meal as MealType)
    : undefined;
  const diets = dietParam
    ? dietParam
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    : undefined;
  const max = Number(maxParam);
  const maxMinutes = Number.isFinite(max) && max > 0 ? max : undefined;
  return {
    mealType,
    cuisine: cuisine?.trim() || undefined,
    diets,
    maxMinutes,
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const q = (pick(sp, "q") ?? "").trim();
  return {
    title: q ? `Search: ${q}` : "Search",
    description: "Find recipes and cooks across Potluck.",
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const q = (pick(sp, "q") ?? "").trim();
  const filters = parseRecipeFilters(sp);
  const hasFilters = !!(
    filters.mealType ||
    filters.cuisine ||
    (filters.diets && filters.diets.length) ||
    filters.maxMinutes
  );

  const isEmpty = q.length === 0;

  const [people, recipeResults, browseRecipes, cuisines] = await Promise.all([
    searchUsers(q, { limit: isEmpty ? 24 : 12 }),
    isEmpty
      ? hasFilters
        ? listRecipeCards({ publicOnly: true, limit: 48, ...filters })
        : Promise.resolve([])
      : searchRecipes(q, { limit: 48, ...filters }),
    isEmpty && !hasFilters
      ? listRecipeCards({ publicOnly: true, limit: 12 })
      : Promise.resolve([]),
    listAvailableCuisines(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Search
      </h1>
      <p className="mt-1 text-muted-foreground">
        Find cooks by name or handle, recipes by title, ingredient, or tag.
      </p>

      <div className="mt-6">
        <SearchBox initialValue={q} placeholder="Search cooks and recipes..." />
      </div>

      <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <FilterChips cuisines={cuisines} className="flex-nowrap sm:flex-wrap" />
      </div>

      {isEmpty && !hasFilters ? (
        <BrowseEmptyState people={people} recipes={browseRecipes} />
      ) : (
        <SearchResults
          q={q}
          people={people}
          recipes={recipeResults}
          hasFilters={hasFilters}
        />
      )}
    </div>
  );
}

function SearchResults({
  q,
  people,
  recipes,
  hasFilters,
}: {
  q: string;
  people: Awaited<ReturnType<typeof searchUsers>>;
  recipes: Awaited<ReturnType<typeof searchRecipes>>;
  hasFilters: boolean;
}) {
  const totalHits = people.length + recipes.length;

  if (totalHits === 0) {
    const headline = q
      ? `No results for \u201C${q}\u201D`
      : "No recipes match these filters";
    const sub = q
      ? "Try a different name, ingredient, or cuisine."
      : "Try clearing a filter or two.";
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <SearchIcon className="size-9 text-muted-foreground" />
        <h2 className="mt-3 font-display text-lg font-semibold">{headline}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{sub}</p>
      </div>
    );
  }
  void hasFilters;

  return (
    <>
      {people.length > 0 && (
        <section className="mt-8">
          <SectionHeading
            icon={<Users className="size-4" />}
            label="People"
            count={people.length}
          />
          <ul className="mt-3 space-y-2">
            {people.map((u) => (
              <li key={u.id}>
                <UserCard user={u} variant="row" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {recipes.length > 0 && (
        <section className="mt-10">
          <SectionHeading
            icon={<ChefHat className="size-4" />}
            label="Recipes"
            count={recipes.length}
          />
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <li key={r.id}>
                <RecipeCard recipe={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function BrowseEmptyState({
  people,
  recipes,
}: {
  people: Awaited<ReturnType<typeof searchUsers>>;
  recipes: Awaited<ReturnType<typeof listRecipeCards>>;
}) {
  return (
    <>
      <section className="mt-8">
        <SectionHeading
          icon={<Users className="size-4" />}
          label="Cooks on Potluck"
          count={people.length}
        />
        {people.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm text-muted-foreground">
            Nobody else is here yet. Share Potluck with a friend.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {people.map((u) => (
              <li key={u.id}>
                <UserCard user={u} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {recipes.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <SectionHeading
              icon={<ChefHat className="size-4" />}
              label="Latest recipes"
            />
            <Link
              href="/feed"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              See all
            </Link>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <li key={r.id}>
                <RecipeCard recipe={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SectionHeading({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
        {icon}
        {label}
      </h2>
      {typeof count === "number" && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </div>
  );
}
