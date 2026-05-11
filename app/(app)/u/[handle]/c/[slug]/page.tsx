import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ChefHat, ChevronLeft, Globe, Lock, EyeOff, Folder } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { auth } from "@/lib/auth";
import { getCollectionByHandleSlug } from "@/lib/queries/collections";
import { CollectionMenu } from "@/components/collection/CollectionMenu";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}): Promise<Metadata> {
  const { handle, slug } = await params;
  const session = await auth();
  const data = await getCollectionByHandleSlug(
    handle,
    slug,
    session?.user?.id ?? null,
  );
  if (!data) return { title: "Collection not found" };
  return {
    title: `${data.collection.name} · @${handle}`,
    description: data.collection.description?.trim() || undefined,
  };
}

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const session = await auth();
  const data = await getCollectionByHandleSlug(
    handle,
    slug,
    session?.user?.id ?? null,
  );
  if (!data) notFound();

  const { collection, recipes } = data;
  const isOwner = session?.user?.id === collection.ownerId;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href={`/u/${handle}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />@{handle}
      </Link>

      <header className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
            {collection.coverPhoto ? (
              <Image
                src={collection.coverPhoto}
                alt=""
                fill
                sizes="96px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/15 to-accent/10">
                <Folder className="size-8 text-primary/60" />
              </div>
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <VisibilityBadge visibility={collection.visibility} />
              {collection.isDefaultSaves && (
                <Badge variant="secondary">Auto-managed</Badge>
              )}
            </div>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {collection.description}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {`${collection.recipeCount} recipe${collection.recipeCount === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {isOwner && !collection.isDefaultSaves && (
          <CollectionMenu
            collectionId={collection.id}
            handle={handle}
            initialName={collection.name}
            initialDescription={collection.description}
            initialVisibility={collection.visibility}
          />
        )}
      </header>

      {recipes.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <ChefHat className="size-8 text-muted-foreground" />
          <h2 className="mt-3 font-display text-lg font-semibold">
            Nothing here yet
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {isOwner
              ? "Save recipes to this collection from any recipe page."
              : "This collection is empty."}
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r, i) => (
            <li key={r.id}>
              <RecipeCard recipe={r} priority={i < 3} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
