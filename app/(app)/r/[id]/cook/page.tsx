import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getRecipe } from "@/lib/actions/recipes";
import { auth } from "@/lib/auth";
import { CookMode } from "@/components/recipe/CookMode";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getRecipe(id);
  if (!data) return { title: "Recipe not found" };
  return { title: `Cooking: ${data.recipe.title}` };
}

export default async function CookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getRecipe(id);
  if (!data) notFound();

  const session = await auth();
  const isAuthor = session?.user?.id === data.recipe.authorId;
  if (data.recipe.visibility === "private" && !isAuthor) notFound();

  return (
    <CookMode
      recipe={{
        id: data.recipe.id,
        title: data.recipe.title,
        servings: data.recipe.servings ?? null,
        servingsNumeric: data.recipe.servingsNumeric ?? null,
        prepMinutes: data.recipe.prepMinutes ?? null,
        cookMinutes: data.recipe.cookMinutes ?? null,
      }}
      ingredients={data.ingredients.map((ing) => ({
        id: ing.id,
        quantity: ing.quantity ?? null,
        quantityNumeric: ing.quantityNumeric ?? null,
        unit: ing.unit ?? null,
        name: ing.name,
        note: ing.note ?? null,
      }))}
      steps={data.steps.map((s) => ({ id: s.id, body: s.body }))}
    />
  );
}
