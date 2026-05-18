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
  ExternalLink,
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
import { ShareButton } from "@/components/recipe/ShareButton";
import { DeleteRecipeButton } from "@/components/recipe/DeleteRecipeButton";
import { SourcePhotosGrid } from "@/components/recipe/SourcePhotosGrid";
import { RecipeBody } from "@/components/recipe/RecipeBody";
import { RatingControl } from "@/components/recipe/RatingControl";
import { CommentsSection } from "@/components/recipe/CommentsSection";
import { AddToShoppingListButton } from "@/components/recipe/AddToShoppingListButton";
import {
  getRatingSummary,
  getViewerRating,
} from "@/lib/queries/ratings";
import { listCommentsForRecipe } from "@/lib/queries/comments";
import { listShoppingListsForUser } from "@/lib/queries/shopping";

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
  const coverPhotos = photos.filter((p) => p.role === "cover");
  const sourcePhotos = photos.filter((p) => p.role === "source");

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

  const rating = getRatingSummary(recipe.id);
  const viewerRating = getViewerRating(recipe.id, session?.user?.id ?? null);
  const comments = listCommentsForRecipe(recipe.id);
  const viewerLists =
    session?.user?.id && (ingredients.length > 0)
      ? listShoppingListsForUser(session.user.id, { activeOnly: true })
      : [];

  return (
    <article
      data-recipe-detail
      className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16 sm:px-6"
    >
      {coverPhotos.length > 0 && (
        <PhotoCarousel
          alt={recipe.title}
          photos={coverPhotos.map((p) => ({
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

        <SourceAttribution sourceUrl={recipe.sourceUrl ?? null} />


        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {author && (
            <Link
              href={`/u/${author.handle ?? ""}`}
              // The fallback "M" character inside the Avatar gets
              // smushed onto the visible "by Meredith Crosier" by the
              // accessible name algorithm ("M by Meredith Crosier").
              // Set the link name explicitly and hide the decorative
              // initial from a11y.
              aria-label={`by ${author.name ?? `@${author.handle}`}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Avatar className="size-7" aria-hidden>
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

        <div className="mt-4" data-print="hide">
          <RatingControl
            recipeId={recipe.id}
            initialValue={viewerRating}
            avg={rating.avg}
            count={rating.count}
            canRate={!!session?.user?.id}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2" data-print="hide">
          {(ingredients.length > 0 || steps.length > 0) && (
            <Button
              render={<Link href={`/r/${recipe.id}/cook`} />}
              size="sm"
              className="gap-1.5"
            >
              <CookingPot className="size-3.5" />
              Cook
            </Button>
          )}
          {recipe.visibility !== "private" && (
            <ShareButton
              title={recipe.title}
              description={recipe.description ?? null}
            />
          )}
          <PrintButton />
          {recipe.sourceUrl && (
            <Button
              render={
                <a
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              Open original
            </Button>
          )}
          {isAuthor && (
            <>
              <Button
                render={<Link href={`/r/${recipe.id}/edit`} />}
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <DeleteRecipeButton
                recipeId={recipe.id}
                authorHandle={author?.handle ?? null}
                recipeTitle={recipe.title}
              />
            </>
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
          {session?.user?.id && ingredients.length > 0 && (
            <AddToShoppingListButton
              recipeId={recipe.id}
              recipeTitle={recipe.title}
              lists={viewerLists.map((l) => ({ id: l.id, name: l.name }))}
            />
          )}
        </div>
      </header>

      <RecipeBody
        ingredients={ingredients.map((ing) => ({
          id: ing.id,
          quantity: ing.quantity ?? null,
          quantityNumeric: ing.quantityNumeric ?? null,
          unit: ing.unit ?? null,
          name: ing.name,
          note: ing.note ?? null,
        }))}
        steps={steps.map((s) => ({ id: s.id, body: s.body }))}
        servings={recipe.servings ?? null}
        servingsNumeric={recipe.servingsNumeric ?? null}
      />

      <RecipeNotes notes={recipe.notes ?? null} />

      <SourcePhotosGrid
        photos={sourcePhotos.map((p) => ({
          id: p.id,
          path: p.path,
          blurhash: p.blurhash ?? null,
        }))}
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

      <Separator className="my-10" data-print="hide" />

      <CommentsSection
        recipeId={recipe.id}
        comments={comments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          author: {
            id: c.authorId,
            name: c.authorName,
            handle: c.authorHandle,
            image: c.authorImage,
          },
          canDelete:
            !!session?.user?.id &&
            (session.user.id === c.authorId ||
              session.user.id === recipe.authorId),
        }))}
        recipeAuthorId={recipe.authorId}
        viewer={
          session?.user?.id
            ? {
                id: session.user.id,
                name: session.user.name ?? null,
                image: session.user.image ?? null,
              }
            : null
        }
      />
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

/**
 * Free-form author notes — tips, substitutions, family context. We
 * render below the body so cooks read the ingredients/steps first,
 * then the prose. Styled as a soft callout (not a destructive banner)
 * so it doesn't compete visually with the recipe content.
 *
 * Plain text only — we render with `whitespace-pre-line` to keep the
 * author's line breaks but stop short of full markdown to avoid
 * letting AI-extracted notes inject links / HTML.
 */
function RecipeNotes({ notes }: { notes: string | null }) {
  const trimmed = notes?.trim();
  if (!trimmed) return null;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
      <h2 className="font-display text-base font-semibold tracking-tight">
        Notes
      </h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {trimmed}
      </p>
    </section>
  );
}

/**
 * "Imported from cookingstuff.com" line under the recipe header. The
 * domain links out to the original; bare attribution helps cooks
 * sanity-check anything suspicious mid-recipe (the AI extractor isn't
 * always right, especially on units). Renders nothing for hand-typed
 * recipes that have no `sourceUrl`.
 */
function SourceAttribution({ sourceUrl }: { sourceUrl: string | null }) {
  if (!sourceUrl) return null;
  let domain = sourceUrl;
  try {
    domain = new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    // Bad URL — fall back to showing the raw string, the link still
    // works because we route to the raw href.
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Imported from{" "}
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        {domain}
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </p>
  );
}
