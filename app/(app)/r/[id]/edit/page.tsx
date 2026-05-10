import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { getRecipe } from "@/lib/actions/recipes";
import { RecipeForm } from "@/components/recipe/RecipeForm";
import type { UploadedPhoto } from "@/components/upload/PhotoPicker";
import type { RecipeFormInput } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getRecipe(id);
  if (!data) return { title: "Edit recipe" };
  return { title: `Edit: ${data.recipe.title}` };
}

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/r/${id}/edit`);
  }

  const data = await getRecipe(id);
  if (!data) notFound();
  if (data.recipe.authorId !== session.user.id) notFound();

  const initial: Partial<RecipeFormInput> = {
    title: data.recipe.title,
    description: data.recipe.description ?? "",
    prepMinutes: data.recipe.prepMinutes ?? null,
    cookMinutes: data.recipe.cookMinutes ?? null,
    servings: data.recipe.servings ?? "",
    mealType: data.recipe.mealType ?? null,
    cuisine: data.recipe.cuisine ?? "",
    diets: data.recipe.diets ?? [],
    tags: data.tagNames,
    visibility: data.recipe.visibility,
    kind: data.recipe.kind,
    sourceUrl: data.recipe.sourceUrl ?? null,
    ingredients: data.ingredients.map((ing, i) => ({
      position: i,
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      name: ing.name,
      note: ing.note ?? null,
    })),
    steps: data.steps.map((s, i) => ({ position: i, body: s.body })),
    photoIds: data.photos.map((p) => p.path),
  };

  const initialPhotos: UploadedPhoto[] = data.photos.map((p) => ({
    publicPath: p.path,
    width: p.width ?? 0,
    height: p.height ?? 0,
    placeholder: p.blurhash ?? "",
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 sm:px-6">
      <Link
        href={`/r/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back to recipe
      </Link>

      <header className="mt-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Edit recipe
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes save instantly. The URL stays the same.
        </p>
      </header>

      <div className="mt-6">
        <RecipeForm
          mode="edit"
          recipeId={id}
          initial={initial}
          initialPhotos={initialPhotos}
        />
      </div>
    </div>
  );
}
