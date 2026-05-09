import Link from "next/link";
import { Search as SearchIcon, Users, ChefHat } from "lucide-react";

import { searchUsers } from "@/lib/queries/users";
import { searchRecipes, listRecipeCards } from "@/lib/queries/recipes";
import { UserCard } from "@/components/user/UserCard";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { SearchBox } from "@/components/search/SearchBox";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const rawQ = sp.q;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ ?? "").trim();

  const isEmpty = q.length === 0;

  const [people, recipeResults, browseRecipes] = await Promise.all([
    searchUsers(q, { limit: isEmpty ? 24 : 12 }),
    isEmpty ? Promise.resolve([]) : searchRecipes(q, { limit: 48 }),
    isEmpty ? listRecipeCards({ publicOnly: true, limit: 12 }) : Promise.resolve([]),
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

      {isEmpty ? (
        <BrowseEmptyState people={people} recipes={browseRecipes} />
      ) : (
        <SearchResults q={q} people={people} recipes={recipeResults} />
      )}
    </div>
  );
}

function SearchResults({
  q,
  people,
  recipes,
}: {
  q: string;
  people: Awaited<ReturnType<typeof searchUsers>>;
  recipes: Awaited<ReturnType<typeof searchRecipes>>;
}) {
  const totalHits = people.length + recipes.length;

  if (totalHits === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <SearchIcon className="size-9 text-muted-foreground" />
        <h2 className="mt-3 font-display text-lg font-semibold">
          No results for &ldquo;{q}&rdquo;
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Try a different name, ingredient, or cuisine.
        </p>
      </div>
    );
  }

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
