import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, ChefHat, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { CreateCollectionDialog } from "@/components/collection/CreateCollectionDialog";
import { requireSession } from "@/lib/session";
import { listCollectionsForUser, getCollectionByHandleSlug } from "@/lib/queries/collections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cookbook",
  description: "Your saved recipes and collections.",
};

export default async function CookbookPage() {
  const session = await requireSession("/cookbook");
  const userId = session.user.id;
  const handle = session.user.handle ?? "";

  const collections = await listCollectionsForUser(userId);
  const allSaves = collections.find((c) => c.isDefaultSaves);
  const otherCollections = collections.filter((c) => !c.isDefaultSaves);

  // Pull All Saves recipes for the top-of-page strip.
  const savesData = allSaves
    ? await getCollectionByHandleSlug(handle, allSaves.slug, userId)
    : null;
  const recentSaves = savesData?.recipes.slice(0, 6) ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Cookbook
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your saved recipes and collections.
          </p>
        </div>
        <CreateCollectionDialog />
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <Bookmark className="size-5" />
            Recently saved
          </h2>
          {allSaves && allSaves.recipeCount > 0 && (
            <Link
              href={`/u/${handle}/c/${allSaves.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              See all
            </Link>
          )}
        </div>
        {recentSaves.length === 0 ? (
          <EmptySaves />
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentSaves.map((r, i) => (
              <li key={r.id}>
                <RecipeCard recipe={r} priority={i < 3} headingLevel="h3" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold">Collections</h2>
        {otherCollections.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
            <ChefHat className="size-7 text-muted-foreground" />
            <h3 className="mt-3 font-display text-base font-semibold">
              No collections yet
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Group recipes any way you like — by occasion, season, or who they
              came from.
            </p>
            <div className="mt-3">
              <CreateCollectionDialog
                trigger={
                  <Button size="sm" className="gap-1.5">
                    <Plus className="size-4" />
                    New collection
                  </Button>
                }
              />
            </div>
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherCollections.map((c) => (
              <li key={c.id}>
                <CollectionCard collection={c} viewerHandle={handle} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmptySaves() {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <Bookmark className="size-7 text-muted-foreground" />
      <h3 className="mt-3 font-display text-base font-semibold">
        Nothing saved yet
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Browse the feed and tap Save on recipes you want to come back to.
      </p>
      <Button
        render={<Link href="/feed" />}
        size="sm"
        variant="outline"
        className="mt-3"
      >
        Open feed
      </Button>
    </div>
  );
}
