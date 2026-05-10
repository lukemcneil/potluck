import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  Clock,
  Users,
  ChefHat,
  Globe,
  Lock,
  EyeOff,
  Pencil,
  CookingPot,
} from "lucide-react";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getRecipe } from "@/lib/actions/recipes";
import { auth } from "@/lib/auth";
import {
  getSaveStateForRecipe,
  listCollectionsForUser,
} from "@/lib/queries/collections";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SaveButton } from "@/components/recipe/SaveButton";
import { PhotoCarousel } from "@/components/recipe/PhotoCarousel";
import { PrintButton } from "@/components/recipe/PrintButton";
import { RecipeBody } from "@/components/recipe/RecipeBody";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getRecipe(id);
  if (!data) return { title: "Recipe not found" };
  const desc = data.recipe.description?.trim();
  return {
    title: data.recipe.title,
    description: desc && desc.length > 0 ? desc : undefined,
  };
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getRecipe(id);
  if (!data) notFound();
  const { recipe, photos, ingredients, steps, tagNames } = data;

  const author = db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, recipe.authorId))
    .get();

  const session = await auth();
  const isAuthor = session?.user?.id === recipe.authorId;

  // Block private recipes from non-authors.
  if (recipe.visibility === "private" && !isAuthor) notFound();

  const totalMin =
    (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  // Pull save state + collection list when there's a viewer who isn't the
  // author. Authors don't need a save button on their own recipe.
  const viewerCollections =
    session?.user?.id && !isAuthor
      ? await listCollectionsForUser(session.user.id)
      : [];
  const saveState =
    session?.user?.id && !isAuthor
      ? await getSaveStateForRecipe(session.user.id, recipe.id)
      : null;

  return (
    <article
      data-recipe-detail
      className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16 sm:px-6"
    >
      {photos.length > 0 && (
        <PhotoCarousel
          alt={recipe.title}
          photos={photos.map((p) => ({
            id: p.id,
            path: p.path,
            blurhash: p.blurhash ?? null,
          }))}
        />
      )}

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {recipe.mealType && (
            <Badge variant="secondary" className="capitalize">
              {recipe.mealType}
            </Badge>
          )}
          {recipe.cuisine && (
            <Badge variant="outline" className="capitalize">
              {recipe.cuisine}
            </Badge>
          )}
          {(recipe.diets ?? []).map((d) => (
            <Badge key={d} variant="outline" className="capitalize">
              {d}
            </Badge>
          ))}
          <VisibilityBadge visibility={recipe.visibility} />
        </div>

        <h1 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          {recipe.title}
        </h1>

        {recipe.description && (
          <p className="mt-2 text-muted-foreground">{recipe.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {author && (
            <Link
              href={`/u/${author.handle ?? ""}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Avatar className="size-7">
                <AvatarImage src={author.image ?? undefined} alt="" />
                <AvatarFallback>
                  {(author.name ?? author.handle ?? "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span>by {author.name ?? `@${author.handle}`}</span>
            </Link>
          )}

          {totalMin > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-4" />
              {formatMinutes(totalMin)}
            </span>
          )}

          {recipe.servings && (
            <span className="flex items-center gap-1">
              <Users className="size-4" />
              {recipe.servings}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2" data-print="hide">
          {(ingredients.length > 0 || steps.length > 0) && (
            <Link href={`/r/${recipe.id}/cook`}>
              <Button size="sm" className="gap-1.5">
                <CookingPot className="size-3.5" />
                Cook
              </Button>
            </Link>
          )}
          <PrintButton />
          {isAuthor && (
            <Link href={`/r/${recipe.id}/edit`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </Link>
          )}
          {!isAuthor && saveState && (
            <SaveButton
              recipeId={recipe.id}
              initiallySaved={saveState.saved}
              initialCollectionIds={saveState.collectionIds}
              collections={viewerCollections.map((c) => ({
                id: c.id,
                name: c.name,
                isDefaultSaves: c.isDefaultSaves,
              }))}
              size="sm"
            />
          )}
        </div>
      </header>

      <RecipeBody
        ingredients={ingredients.map((ing) => ({
          id: ing.id,
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          name: ing.name,
          note: ing.note ?? null,
        }))}
        steps={steps.map((s) => ({ id: s.id, body: s.body }))}
        servings={recipe.servings ?? null}
      />

      {tagNames.length > 0 && (
        <>
          <Separator className="my-8" />
          <div className="flex flex-wrap gap-1.5">
            {tagNames.map((t) => (
              <Badge key={t} variant="outline" className="lowercase">
                #{t}
              </Badge>
            ))}
          </div>
        </>
      )}

      {recipe.kind === "photos_only" && ingredients.length === 0 && (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center">
          <ChefHat className="size-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            This recipe is photos only — no parsed ingredients or steps.
          </p>
        </div>
      )}
    </article>
  );
}

function VisibilityBadge({
  visibility,
}: {
  visibility: "public" | "unlisted" | "private";
}) {
  if (visibility === "public") {
    return (
      <Badge variant="outline" className="gap-1">
        <Globe className="size-3" />
        Public
      </Badge>
    );
  }
  if (visibility === "unlisted") {
    return (
      <Badge variant="outline" className="gap-1">
        <EyeOff className="size-3" />
        Unlisted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Lock className="size-3" />
      Private
    </Badge>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
